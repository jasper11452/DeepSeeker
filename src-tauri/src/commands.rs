use crate::db;
use crate::models::*;
use crate::AppState;
use anyhow::Result;
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use tauri::State;
use walkdir::WalkDir;

#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    name: String,
    folder_path: Option<String>,
) -> Result<Collection, String> {
    log::info!("Creating collection: {} with folder: {:?}", name, folder_path);

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO collections (name, folder_path, file_count, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
        params![name, folder_path, now, now],
    )
    .map_err(|e| format!("Failed to create collection: {}", e))?;

    let id = conn.last_insert_rowid();

    Ok(Collection {
        id,
        name,
        folder_path,
        file_count: 0,
        last_sync: None,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub async fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    log::info!("Listing collections");

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, folder_path, file_count, last_sync, created_at, updated_at FROM collections ORDER BY name")
        .map_err(|e| e.to_string())?;

    let collections = stmt
        .query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                folder_path: row.get(2)?,
                file_count: row.get(3)?,
                last_sync: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(collections)
}

#[tauri::command]
pub async fn delete_collection(
    state: State<'_, AppState>,
    collection_id: i64,
) -> Result<(), String> {
    log::info!("Deleting collection: {}", collection_id);

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM collections WHERE id = ?", params![collection_id])
        .map_err(|e| format!("Failed to delete collection: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn cleanup_ghost_data(state: State<'_, AppState>) -> Result<usize, String> {
    log::info!("Cleaning up ghost data");

    db::cleanup_ghost_data(&state.db_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn detect_ghost_files(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    log::info!("Detecting ghost files");

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT path FROM documents")
        .map_err(|e| e.to_string())?;

    let paths: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let ghost_files: Vec<String> = paths
        .into_iter()
        .filter(|path| !Path::new(path).exists())
        .collect();

    log::info!("Found {} ghost files", ghost_files.len());
    Ok(ghost_files)
}

#[tauri::command]
pub async fn full_reindex(
    state: State<'_, AppState>,
    collection_id: i64,
    directory_path: String,
) -> Result<IndexProgress, String> {
    log::info!("Full reindex for collection {} at {}", collection_id, directory_path);

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    // Delete all documents (and their chunks via CASCADE) for this collection
    conn.execute(
        "DELETE FROM documents WHERE collection_id = ?",
        params![collection_id],
    )
    .map_err(|e| format!("Failed to clear collection data: {}", e))?;

    // Reset collection metadata
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE collections SET file_count = 0, last_sync = NULL, updated_at = ? WHERE id = ?",
        params![now, collection_id],
    )
    .map_err(|e| e.to_string())?;

    log::info!("Cleared existing data for collection {}", collection_id);

    // Re-run indexing
    drop(conn); // Release connection before calling index_directory
    index_directory(state, collection_id, directory_path).await
}

#[tauri::command]
pub async fn index_directory(
    state: State<'_, AppState>,
    collection_id: i64,
    directory_path: String,
) -> Result<IndexProgress, String> {
    log::info!(
        "Indexing directory: {} for collection {}",
        directory_path,
        collection_id
    );

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    // Find all Markdown and PDF files
    let files: Vec<_> = WalkDir::new(&directory_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let ext = e.path().extension().and_then(|s| s.to_str());
            ext == Some("md")
                || ext == Some("markdown")
                || ext == Some("pdf")
        })
        .collect();

    let total_files = files.len();
    let mut processed = 0;

    for entry in files {
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();
        let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");

        // Determine file type and extract content
        let (content, chunks_result, doc_status) = if extension == "pdf" {
            // Handle PDF files
            match crate::pdf_parser::extract_text_from_pdf(path) {
                Ok(crate::pdf_parser::PdfStatus::Success { text, page_count }) => {
                    let chunks = crate::pdf_parser::chunk_pdf_text(0, &text, page_count)
                        .map_err(|e| format!("Failed to chunk PDF: {}", e))?;
                    (text, Ok::<Vec<Chunk>, String>(chunks), "normal".to_string())
                }
                Ok(crate::pdf_parser::PdfStatus::ScannedPdf { page_count }) => {
                    log::warn!(
                        "⚠️ Scanned PDF (Skipped) - {} pages, no text layer: {}",
                        page_count,
                        path_str
                    );
                    // Store as scanned_pdf with empty content
                    ("".to_string(), Ok::<Vec<Chunk>, String>(vec![]), "scanned_pdf".to_string())
                }
                Ok(crate::pdf_parser::PdfStatus::Error(error_msg)) => {
                    log::error!("PDF extraction error {}: {}", path_str, error_msg);
                    // Store as error with empty content
                    ("".to_string(), Ok::<Vec<Chunk>, String>(vec![]), "error".to_string())
                }
                Err(e) => {
                    log::error!("Failed to extract PDF {}: {}", path_str, e);
                    // Store as error with empty content
                    ("".to_string(), Ok::<Vec<Chunk>, String>(vec![]), "error".to_string())
                }
            }
        } else {
            // Handle Markdown files
            let content = fs::read_to_string(path)
                .map_err(|e| format!("Failed to read {}: {}", path_str, e))?;

            let chunks = crate::chunker::chunk_markdown(0, &content)
                .map_err(|e| format!("Failed to chunk {}: {}", path_str, e))?;

            (content, Ok(chunks), "normal".to_string())
        };

        // Calculate hash
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = hex::encode(hasher.finalize());

        // Get file metadata
        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        let last_modified = metadata
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs() as i64;

        // Check if document already exists with same hash
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM documents WHERE collection_id = ? AND path = ? AND hash = ?",
                params![collection_id, path_str, hash],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if exists {
            log::info!("Skipping unchanged file: {}", path_str);
            processed += 1;
            continue;
        }

        // Delete old version if exists
        conn.execute(
            "DELETE FROM documents WHERE collection_id = ? AND path = ?",
            params![collection_id, path_str],
        )
        .map_err(|e| e.to_string())?;

        // Insert document
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO documents (collection_id, path, hash, last_modified, created_at, status)
             VALUES (?, ?, ?, ?, ?, ?)",
            params![collection_id, path_str, hash, last_modified, now, doc_status],
        )
        .map_err(|e| e.to_string())?;

        let doc_id = conn.last_insert_rowid();

        // Insert chunks with correct doc_id
        let mut chunks = chunks_result?;
        for chunk in chunks.iter_mut() {
            chunk.doc_id = doc_id;
            let metadata_json = serde_json::to_string(&chunk.metadata).ok();

            conn.execute(
                "INSERT INTO chunks (doc_id, content, metadata, start_line, end_line, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
                params![
                    chunk.doc_id,
                    chunk.content,
                    metadata_json,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
                    chunk.created_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        processed += 1;
        log::info!("Indexed {} ({}/{})", path_str, processed, total_files);
    }

    // Update collection metadata after indexing
    let now = chrono::Utc::now().timestamp();
    let file_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM documents WHERE collection_id = ?",
            params![collection_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "UPDATE collections SET last_sync = ?, file_count = ?, updated_at = ? WHERE id = ?",
        params![now, file_count, now, collection_id],
    )
    .map_err(|e| e.to_string())?;

    log::info!("Collection {} updated: {} files indexed", collection_id, file_count);

    Ok(IndexProgress {
        total_files,
        processed_files: processed,
        current_file: None,
    })
}

#[tauri::command]
pub async fn search(
    state: State<'_, AppState>,
    query: String,
    collection_id: Option<i64>,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    log::info!("Searching for: {}", query);

    crate::search::search_hybrid(&state.db_path, &query, collection_id, limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_file_at_line(file_path: String, line: i64) -> Result<(), String> {
    log::info!("Opening file: {} at line {}", file_path, line);

    // Try to open with VSCode first (supports line jumping)
    #[cfg(target_os = "windows")]
    let vscode_cmd = "code.cmd";
    #[cfg(not(target_os = "windows"))]
    let vscode_cmd = "code";

    // Try VSCode with --goto flag
    let vscode_result = std::process::Command::new(vscode_cmd)
        .arg("--goto")
        .arg(format!("{}:{}", file_path, line))
        .spawn();

    if vscode_result.is_ok() {
        log::info!("Opened with VSCode");
        return Ok(());
    }

    // Fallback: Try to open with system default editor
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(&["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    log::info!("Opened with system default editor (no line jumping)");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;
    use std::fs;

    // Helper function to create test app state
    fn create_test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        db::init_database(&db_path).unwrap();

        let state = AppState {
            db_path: db_path.clone(),
        };

        (state, dir)
    }

    #[tokio::test]
    async fn test_create_collection() {
        let (state, _dir) = create_test_state();

        let result = create_collection(
            tauri::State::from(&state),
            "Test Collection".to_string(),
            Some("/test/path".to_string()),
        )
        .await;

        assert!(result.is_ok());
        let collection = result.unwrap();
        assert_eq!(collection.name, "Test Collection");
        assert_eq!(collection.folder_path, Some("/test/path".to_string()));
        assert_eq!(collection.file_count, 0);
    }

    #[tokio::test]
    async fn test_list_collections() {
        let (state, _dir) = create_test_state();

        // Create some collections
        create_collection(
            tauri::State::from(&state),
            "Collection 1".to_string(),
            None,
        )
        .await
        .unwrap();

        create_collection(
            tauri::State::from(&state),
            "Collection 2".to_string(),
            Some("/path".to_string()),
        )
        .await
        .unwrap();

        let result = list_collections(tauri::State::from(&state)).await;

        assert!(result.is_ok());
        let collections = result.unwrap();
        assert_eq!(collections.len(), 2);
        assert_eq!(collections[0].name, "Collection 1");
        assert_eq!(collections[1].name, "Collection 2");
    }

    #[tokio::test]
    async fn test_delete_collection() {
        let (state, _dir) = create_test_state();

        // Create a collection
        let collection = create_collection(
            tauri::State::from(&state),
            "To Delete".to_string(),
            None,
        )
        .await
        .unwrap();

        // Verify it exists
        let collections = list_collections(tauri::State::from(&state)).await.unwrap();
        assert_eq!(collections.len(), 1);

        // Delete it
        let result = delete_collection(tauri::State::from(&state), collection.id).await;
        assert!(result.is_ok());

        // Verify it's gone
        let collections = list_collections(tauri::State::from(&state)).await.unwrap();
        assert_eq!(collections.len(), 0);
    }

    #[tokio::test]
    async fn test_detect_ghost_files() {
        let (state, dir) = create_test_state();

        // Create a collection
        let collection = create_collection(
            tauri::State::from(&state),
            "Test".to_string(),
            None,
        )
        .await
        .unwrap();

        // Create a temporary file
        let test_file = dir.path().join("test.md");
        fs::write(&test_file, "# Test").unwrap();

        // Add it to the database
        let conn = db::get_connection(&state.db_path).unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO documents (collection_id, path, hash, last_modified, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![
                collection.id,
                test_file.to_str().unwrap(),
                "test_hash",
                now,
                now
            ],
        )
        .unwrap();

        // File exists, should not be ghost
        let ghosts = detect_ghost_files(tauri::State::from(&state))
            .await
            .unwrap();
        assert_eq!(ghosts.len(), 0);

        // Delete the file
        fs::remove_file(&test_file).unwrap();

        // Now should be detected as ghost
        let ghosts = detect_ghost_files(tauri::State::from(&state))
            .await
            .unwrap();
        assert_eq!(ghosts.len(), 1);
        assert_eq!(ghosts[0], test_file.to_str().unwrap());
    }

    #[tokio::test]
    async fn test_cleanup_ghost_data() {
        let (state, dir) = create_test_state();

        // Create a collection
        let collection = create_collection(
            tauri::State::from(&state),
            "Test".to_string(),
            None,
        )
        .await
        .unwrap();

        // Create a file and add to database
        let test_file = dir.path().join("test.md");
        fs::write(&test_file, "# Test").unwrap();

        let conn = db::get_connection(&state.db_path).unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO documents (collection_id, path, hash, last_modified, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![
                collection.id,
                test_file.to_str().unwrap(),
                "test_hash",
                now,
                now
            ],
        )
        .unwrap();
        drop(conn);

        // Delete the file
        fs::remove_file(&test_file).unwrap();

        // Cleanup should remove it
        let deleted = cleanup_ghost_data(tauri::State::from(&state))
            .await
            .unwrap();
        assert_eq!(deleted, 1);

        // Verify it's removed from database
        let conn = db::get_connection(&state.db_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_index_directory_markdown() {
        let (state, dir) = create_test_state();

        // Create a collection
        let collection = create_collection(
            tauri::State::from(&state),
            "Test".to_string(),
            Some(dir.path().to_str().unwrap().to_string()),
        )
        .await
        .unwrap();

        // Create some test markdown files
        let test_md1 = dir.path().join("test1.md");
        fs::write(
            &test_md1,
            r#"# Test Document 1

This is a test document with some content.

## Section 1

Some content here.

```rust
fn main() {
    println!("Hello, world!");
}
```
"#,
        )
        .unwrap();

        let test_md2 = dir.path().join("test2.md");
        fs::write(
            &test_md2,
            r#"# Test Document 2

Another test document."#,
        )
        .unwrap();

        // Index the directory
        let result = index_directory(
            tauri::State::from(&state),
            collection.id,
            dir.path().to_str().unwrap().to_string(),
        )
        .await;

        assert!(result.is_ok());
        let progress = result.unwrap();
        assert_eq!(progress.total_files, 2);
        assert_eq!(progress.processed_files, 2);

        // Verify documents were indexed
        let conn = db::get_connection(&state.db_path).unwrap();
        let doc_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM documents WHERE collection_id = ?",
                params![collection.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(doc_count, 2);

        // Verify chunks were created
        let chunk_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .unwrap();
        assert!(chunk_count > 0);
    }

    #[tokio::test]
    async fn test_full_reindex() {
        let (state, dir) = create_test_state();

        // Create a collection
        let collection = create_collection(
            tauri::State::from(&state),
            "Test".to_string(),
            Some(dir.path().to_str().unwrap().to_string()),
        )
        .await
        .unwrap();

        // Create and index a file
        let test_md = dir.path().join("test.md");
        fs::write(&test_md, "# Original Content").unwrap();

        index_directory(
            tauri::State::from(&state),
            collection.id,
            dir.path().to_str().unwrap().to_string(),
        )
        .await
        .unwrap();

        // Verify initial indexing
        let conn = db::get_connection(&state.db_path).unwrap();
        let initial_chunks: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .unwrap();
        assert!(initial_chunks > 0);
        drop(conn);

        // Modify the file
        fs::write(
            &test_md,
            r#"# Updated Content

This is completely different content with more chunks.

## Section 1

Content here.

## Section 2

More content here."#,
        )
        .unwrap();

        // Full reindex
        let result = full_reindex(
            tauri::State::from(&state),
            collection.id,
            dir.path().to_str().unwrap().to_string(),
        )
        .await;

        assert!(result.is_ok());

        // Verify chunks were updated
        let conn = db::get_connection(&state.db_path).unwrap();
        let new_chunks: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .unwrap();
        // Should have different (likely more) chunks now
        assert!(new_chunks >= initial_chunks);
    }

    #[tokio::test]
    async fn test_search_integration() {
        let (state, dir) = create_test_state();

        // Create a collection
        let collection = create_collection(
            tauri::State::from(&state),
            "Test".to_string(),
            None,
        )
        .await
        .unwrap();

        // Create test file with searchable content
        let test_md = dir.path().join("test.md");
        fs::write(
            &test_md,
            r#"# Rust Programming

Rust is a systems programming language that runs blazingly fast.

## Memory Safety

Rust provides memory safety without garbage collection."#,
        )
        .unwrap();

        // Index it
        index_directory(
            tauri::State::from(&state),
            collection.id,
            dir.path().to_str().unwrap().to_string(),
        )
        .await
        .unwrap();

        // Search for "rust"
        let results = search(
            tauri::State::from(&state),
            "rust".to_string(),
            Some(collection.id),
            Some(10),
        )
        .await;

        assert!(results.is_ok());
        let search_results = results.unwrap();
        assert!(search_results.len() > 0);

        // Verify result contains expected content
        let first_result = &search_results[0];
        assert!(
            first_result.content.to_lowercase().contains("rust")
                || first_result
                    .content
                    .to_lowercase()
                    .contains("programming")
        );
    }

    #[tokio::test]
    async fn test_index_skip_unchanged_files() {
        let (state, dir) = create_test_state();

        let collection = create_collection(
            tauri::State::from(&state),
            "Test".to_string(),
            None,
        )
        .await
        .unwrap();

        // Create test file
        let test_md = dir.path().join("test.md");
        fs::write(&test_md, "# Test Content").unwrap();

        // First indexing
        index_directory(
            tauri::State::from(&state),
            collection.id,
            dir.path().to_str().unwrap().to_string(),
        )
        .await
        .unwrap();

        let conn = db::get_connection(&state.db_path).unwrap();
        let initial_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        drop(conn);

        // Index again without changing file
        let result = index_directory(
            tauri::State::from(&state),
            collection.id,
            dir.path().to_str().unwrap().to_string(),
        )
        .await
        .unwrap();

        // Should still process the file but skip it
        assert_eq!(result.total_files, 1);
        assert_eq!(result.processed_files, 1);

        // Document count should remain the same
        let conn = db::get_connection(&state.db_path).unwrap();
        let final_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(initial_count, final_count);
    }
}
