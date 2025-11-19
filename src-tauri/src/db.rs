use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use std::path::Path;

/// Initialize the database with all required tables and extensions
pub fn init_database(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)
        .context("Failed to open database")?;

    // Enable FTS5
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    // Load sqlite-vec extension
    // Note: In production, we'll need to handle loading the extension properly
    // For now, we'll create tables without it and add vector support later

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
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
            UNIQUE(collection_id, path)
        )",
        [],
    )?;

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
}
