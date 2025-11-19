use anyhow::{Context, Result};
use rusqlite::{Connection, params, ffi::sqlite3_auto_extension};
use sqlite_vec::sqlite3_vec_init;
use std::path::Path;
use std::sync::Once;

static SQLITE_VEC_INIT: Once = Once::new();

/// Initialize the database with all required tables and extensions
pub fn init_database(db_path: &Path) -> Result<()> {
    // Register sqlite-vec extension globally (only once)
    SQLITE_VEC_INIT.call_once(|| {
        unsafe {
            sqlite3_auto_extension(Some(std::mem::transmute(sqlite3_vec_init as *const ())));
        }
        log::info!("sqlite-vec extension registered");
    });

    let conn = Connection::open(db_path)
        .context("Failed to open database")?;

    // Enable WAL mode for better concurrency
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    // Verify sqlite-vec is loaded by checking version
    let vec_version: String = conn
        .query_row("SELECT vec_version()", [], |row| row.get(0))
        .context("Failed to verify sqlite-vec extension")?;
    log::info!("sqlite-vec version: {}", vec_version);

    create_schema(&conn)?;

    log::info!("Database initialized successfully");
    Ok(())
}

/// Create all database tables
fn create_schema(conn: &Connection) -> Result<()> {
    // Collections table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            folder_path TEXT,
            file_count INTEGER NOT NULL DEFAULT 0,
            last_sync INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Add new columns if they don't exist (for existing databases)
    let _ = conn.execute("ALTER TABLE collections ADD COLUMN folder_path TEXT", []);
    let _ = conn.execute("ALTER TABLE collections ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE collections ADD COLUMN last_sync INTEGER", []);

    // Documents table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            hash TEXT NOT NULL,
            last_modified INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            status TEXT DEFAULT 'normal',
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
            UNIQUE(collection_id, path)
        )",
        [],
    )?;

    // Add status column if it doesn't exist (for existing databases)
    let _ = conn.execute("ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'normal'", []);

    // Chunks table with metadata
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT, -- JSON: {headers: ['H1', 'H2', 'H3'], type: 'code'|'text'}
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            embedding BLOB, -- Vector embedding (will use sqlite-vec later)
            created_at INTEGER NOT NULL,
            FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Create FTS5 virtual table for full-text search
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            content,
            metadata,
            content_rowid UNINDEXED,
            tokenize = 'porter unicode61'
        )",
        [],
    )?;

    // Trigger to keep FTS5 in sync with chunks table
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
            INSERT INTO chunks_fts(rowid, content, metadata, content_rowid)
            VALUES (new.id, new.content, new.metadata, new.id);
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
            DELETE FROM chunks_fts WHERE rowid = old.id;
        END",
        [],
    )?;

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
            UPDATE chunks_fts SET content = new.content, metadata = new.metadata
            WHERE rowid = new.id;
        END",
        [],
    )?;

    // Create vector search virtual table for embeddings
    // Using sqlite-vec for efficient vector similarity search
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
            embedding float[1024]
        )",
        [],
    )?;

    // Indexes for performance
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_collection
         ON documents(collection_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chunks_doc
         ON chunks(doc_id)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_hash
         ON documents(hash)",
        [],
    )?;

    log::info!("Database schema created successfully");
    Ok(())
}

/// Get a database connection
pub fn get_connection(db_path: &Path) -> Result<Connection> {
    Connection::open(db_path)
        .context("Failed to open database connection")
}

/// Check for and remove ghost data (files that no longer exist on disk)
pub fn cleanup_ghost_data(db_path: &Path) -> Result<usize> {
    let conn = get_connection(db_path)?;

    let mut stmt = conn.prepare(
        "SELECT id, path FROM documents"
    )?;

    let docs: Vec<(i64, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut deleted = 0;
    for (doc_id, path) in docs {
        if !Path::new(&path).exists() {
            conn.execute("DELETE FROM documents WHERE id = ?", params![doc_id])?;
            deleted += 1;
            log::info!("Removed ghost document: {}", path);
        }
    }

    log::info!("Cleaned up {} ghost documents", deleted);
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs;

    #[test]
    fn test_init_database() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        init_database(&db_path).unwrap();

        // Verify database was created
        assert!(db_path.exists());

        // Verify tables exist
        let conn = get_connection(&db_path).unwrap();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(tables.contains(&"collections".to_string()));
        assert!(tables.contains(&"documents".to_string()));
        assert!(tables.contains(&"chunks".to_string()));
    }

    #[test]
    fn test_fts5_enabled() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        init_database(&db_path).unwrap();

        let conn = get_connection(&db_path).unwrap();

        // Verify FTS5 virtual table exists
        let fts_tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(fts_tables.len(), 1);
        assert_eq!(fts_tables[0], "chunks_fts");
    }

    #[test]
    fn test_ghost_data_cleanup() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        init_database(&db_path).unwrap();

        let conn = get_connection(&db_path).unwrap();

        // Create a test collection
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?)",
            params!["test", now, now],
        )
        .unwrap();
        let collection_id = conn.last_insert_rowid();

        // Create a temporary file
        let temp_file = dir.path().join("test.md");
        fs::write(&temp_file, "# Test\n\nContent").unwrap();

        // Insert document pointing to this file
        conn.execute(
            "INSERT INTO documents (collection_id, path, hash, last_modified, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![
                collection_id,
                temp_file.to_str().unwrap(),
                "hash123",
                now,
                now
            ],
        )
        .unwrap();

        let doc_id = conn.last_insert_rowid();

        // Insert a chunk
        conn.execute(
            "INSERT INTO chunks (doc_id, content, start_line, end_line, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![doc_id, "Test content", 1, 1, now],
        )
        .unwrap();

        drop(conn);

        // Verify document exists
        let conn = get_connection(&db_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(conn);

        // Delete the file
        fs::remove_file(&temp_file).unwrap();

        // Run cleanup
        let deleted = cleanup_ghost_data(&db_path).unwrap();
        assert_eq!(deleted, 1);

        // Verify document was removed
        let conn = get_connection(&db_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);

        // Verify chunks were cascaded deleted
        let chunk_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(chunk_count, 0);
    }

    #[test]
    fn test_cascade_delete() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        init_database(&db_path).unwrap();

        let conn = get_connection(&db_path).unwrap();

        // Create collection
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?)",
            params!["test", now, now],
        )
        .unwrap();
        let collection_id = conn.last_insert_rowid();

        // Create document
        conn.execute(
            "INSERT INTO documents (collection_id, path, hash, last_modified, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![collection_id, "/test/path.md", "hash", now, now],
        )
        .unwrap();
        let doc_id = conn.last_insert_rowid();

        // Create chunk
        conn.execute(
            "INSERT INTO chunks (doc_id, content, start_line, end_line, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![doc_id, "content", 1, 1, now],
        )
        .unwrap();

        // Delete collection (should cascade to documents and chunks)
        conn.execute("DELETE FROM collections WHERE id = ?", params![collection_id])
            .unwrap();

        // Verify documents were deleted
        let doc_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(doc_count, 0);

        // Verify chunks were deleted
        let chunk_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(chunk_count, 0);
    }

    #[test]
    fn test_fts5_triggers() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        init_database(&db_path).unwrap();

        let conn = get_connection(&db_path).unwrap();

        // Create collection and document
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?)",
            params!["test", now, now],
        )
        .unwrap();
        let collection_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO documents (collection_id, path, hash, last_modified, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![collection_id, "/test.md", "hash", now, now],
        )
        .unwrap();
        let doc_id = conn.last_insert_rowid();

        // Insert chunk
        conn.execute(
            "INSERT INTO chunks (doc_id, content, start_line, end_line, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![doc_id, "python machine learning", 1, 1, now],
        )
        .unwrap();

        // Verify FTS5 index was updated via trigger
        let fts_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks_fts WHERE content MATCH 'python'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 1);
    }

    #[test]
    fn test_sqlite_vec_loaded() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // This test verifies that sqlite-vec extension loads without error
        let result = init_database(&db_path);
        assert!(result.is_ok(), "sqlite-vec extension should load successfully");
    }
}
