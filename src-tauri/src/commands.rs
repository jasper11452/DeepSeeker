use crate::db;
use crate::models::*;
use crate::AppState;
use anyhow::Result;
use rusqlite::params;
use serde::{Serialize, Deserialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use tauri::{State, AppHandle, Manager}; // Added Manager
use walkdir::WalkDir;
use crate::watcher::WatcherState;
use notify::Watcher; // Added for watcher logic

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchFilters {
    #[serde(rename = "fileTypes")]
    pub file_types: Vec<String>,
}

#[tauri::command]
pub async fn create_collection(
    app_handle: AppHandle,
    name: String,
    folder_path: Option<String>,
) -> Result<Collection, String> {
    let state = app_handle.state::<AppState>();
    let watcher_state = app_handle.state::<WatcherState>();
    
    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO collections (name, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?)",
        params![name, folder_path, now, now],
    )
    .map_err(|e| format!("Failed to create collection: {}", e))?;

    let id = conn.last_insert_rowid();

    // Start watching if it's a folder
    if let Some(path) = &folder_path {
        if let Ok(mut watcher_guard) = watcher_state.watcher.lock() {
             if let Some(watcher) = watcher_guard.as_mut() {
                 let _ = watcher.watch(Path::new(path), notify::RecursiveMode::Recursive);
                 log::info!("Started watching collection: {}", path);
             }
        }
    }

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

        // Insert chunks with correct doc_id and embeddings
        let mut chunks = chunks_result?;

        // Generate embeddings in batch for efficiency
        let chunk_embeddings = if !chunks.is_empty() {
            // Try to load embedding model
            match crate::embeddings::EmbeddingModel::new() {
                Ok(model) => {
                    // Collect all chunk contents for batch embedding
                    let chunk_texts: Vec<String> = chunks.iter()
                        .map(|c| c.content.clone())
                        .collect();

                    // Generate embeddings in batch (5-10x faster than individual)
                    match model.embed_batch(&chunk_texts) {
                        Ok(embeddings) => {
                            log::debug!("Generated {} embeddings for {}", embeddings.len(), path_str);
                            Some(embeddings)
                        }
                        Err(e) => {
                            log::warn!("Failed to generate embeddings for {}: {}", path_str, e);
                            None
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Embedding model not available: {}", e);
                    None
                }
            }
        } else {
            None
        };

        // Insert chunks with embeddings
        for (idx, chunk) in chunks.iter_mut().enumerate() {
            chunk.doc_id = doc_id;
            let metadata_json = serde_json::to_string(&chunk.metadata).ok();

            // Convert embedding to bytes if available
            let embedding_blob = chunk_embeddings.as_ref()
                .and_then(|embs| embs.get(idx))
                .map(|emb| crate::search::f32_vec_to_bytes(emb));

            conn.execute(
                "INSERT INTO chunks (doc_id, content, metadata, start_line, end_line, embedding, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
                params![
                    chunk.doc_id,
                    chunk.content,
                    metadata_json,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
                    embedding_blob,
                    chunk.created_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        processed += 1;
        log::info!("Indexed {} with {} chunks ({}/{})",
                   path_str, chunks.len(), processed, total_files);
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
        errors: Vec::new(),
        status: "completed".to_string(),
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

#[tauri::command]
pub async fn check_model_status() -> Result<bool, String> {
    crate::embeddings::EmbeddingModel::check_model_exists().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_watching_collections(
    state: State<'_, AppState>,
    watcher_state: State<'_, WatcherState>,
) -> Result<(), String> {
    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;
    let collections = db::get_collections(&conn).map_err(|e| e.to_string())?;

    if let Ok(mut watcher_guard) = watcher_state.watcher.lock() {
        if let Some(watcher) = watcher_guard.as_mut() {
            use notify::Watcher;
            for collection in collections {
                if let Some(path) = collection.folder_path {
                    if Path::new(&path).exists() {
                        let _ = watcher.watch(Path::new(&path), notify::RecursiveMode::Recursive);
                        log::info!("Restored watch for: {}", path);
                    }
                }
            }
        }
    }
    Ok(())
}

/// Handle incremental update for a single file
/// This is called when a file is modified (detected by file watcher)
#[tauri::command]
pub async fn update_file_incremental(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    log::info!("Incremental update for: {}", file_path);

    let path = Path::new(&file_path);

    // Check if file exists
    if !path.exists() {
        log::warn!("File no longer exists: {}", file_path);
        return handle_file_removal(state, file_path).await;
    }

    // Check file extension
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    if extension != "md" && extension != "markdown" && extension != "pdf" {
        log::debug!("Ignoring non-document file: {}", file_path);
        return Ok(());
    }

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    // Find which collection this file belongs to
    let collection_id: Option<i64> = conn
        .query_row(
            "SELECT collection_id FROM documents WHERE path = ?",
            params![file_path],
            |row| row.get(0),
        )
        .ok();

    let collection_id = match collection_id {
        Some(id) => id,
        None => {
            // File not in database - check if it belongs to any watched collection
            let collections = db::get_collections(&conn).map_err(|e| e.to_string())?;

            let mut found_collection = None;
            for collection in collections {
                if let Some(folder_path) = &collection.folder_path {
                    if file_path.starts_with(folder_path) {
                        found_collection = Some(collection.id);
                        break;
                    }
                }
            }

            match found_collection {
                Some(id) => {
                    log::info!("New file detected in collection {}: {}", id, file_path);
                    id
                }
                None => {
                    log::debug!("File not in any watched collection: {}", file_path);
                    return Ok(());
                }
            }
        }
    };

    // Extract content and chunk
    let (content, chunks_result, doc_status) = if extension == "pdf" {
        // Handle PDF files
        match crate::pdf_parser::extract_text_from_pdf(path) {
            Ok(crate::pdf_parser::PdfStatus::Success { text, page_count }) => {
                let chunks = crate::pdf_parser::chunk_pdf_text(0, &text, page_count)
                    .map_err(|e| format!("Failed to chunk PDF: {}", e))?;
                (text, Ok::<Vec<Chunk>, String>(chunks), "normal".to_string())
            }
            Ok(crate::pdf_parser::PdfStatus::ScannedPdf { page_count }) => {
                log::warn!("Scanned PDF (no text layer): {}", file_path);
                ("".to_string(), Ok::<Vec<Chunk>, String>(vec![]), "scanned_pdf".to_string())
            }
            Ok(crate::pdf_parser::PdfStatus::Error(error_msg)) => {
                log::error!("PDF extraction error {}: {}", file_path, error_msg);
                ("".to_string(), Ok::<Vec<Chunk>, String>(vec![]), "error".to_string())
            }
            Err(e) => {
                log::error!("Failed to extract PDF {}: {}", file_path, e);
                ("".to_string(), Ok::<Vec<Chunk>, String>(vec![]), "error".to_string())
            }
        }
    } else {
        // Handle Markdown files
        let content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read {}: {}", file_path, e))?;

        let chunks = crate::chunker::chunk_markdown(0, &content)
            .map_err(|e| format!("Failed to chunk {}: {}", file_path, e))?;

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

    // Check if document exists with same hash (no changes)
    let unchanged: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM documents WHERE collection_id = ? AND path = ? AND hash = ?",
            params![collection_id, file_path, hash],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if unchanged {
        log::debug!("File unchanged (same hash): {}", file_path);
        return Ok(());
    }

    // Delete old version
    conn.execute(
        "DELETE FROM documents WHERE collection_id = ? AND path = ?",
        params![collection_id, file_path],
    )
    .map_err(|e| format!("Failed to delete old document: {}", e))?;

    // Insert new document
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO documents (collection_id, path, hash, last_modified, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![collection_id, file_path, hash, last_modified, now, doc_status],
    )
    .map_err(|e| format!("Failed to insert document: {}", e))?;

    let doc_id = conn.last_insert_rowid();

    // Insert chunks with embeddings
    let mut chunks = chunks_result?;

    // Generate embeddings in batch
    let chunk_embeddings = if !chunks.is_empty() {
        match crate::embeddings::EmbeddingModel::new() {
            Ok(model) => {
                let chunk_texts: Vec<String> = chunks.iter()
                    .map(|c| c.content.clone())
                    .collect();

                match model.embed_batch(&chunk_texts) {
                    Ok(embeddings) => {
                        log::debug!("Generated {} embeddings for {}", embeddings.len(), file_path);
                        Some(embeddings)
                    }
                    Err(e) => {
                        log::warn!("Failed to generate embeddings: {}", e);
                        None
                    }
                }
            }
            Err(e) => {
                log::debug!("Embedding model not available: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Insert chunks
    for (idx, chunk) in chunks.iter_mut().enumerate() {
        chunk.doc_id = doc_id;
        let metadata_json = serde_json::to_string(&chunk.metadata).ok();

        let embedding_blob = chunk_embeddings.as_ref()
            .and_then(|embs| embs.get(idx))
            .map(|emb| crate::search::f32_vec_to_bytes(emb));

        conn.execute(
            "INSERT INTO chunks (doc_id, content, metadata, start_line, end_line, embedding, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                chunk.doc_id,
                chunk.content,
                metadata_json,
                chunk.start_line as i64,
                chunk.end_line as i64,
                embedding_blob,
                chunk.created_at,
            ],
        )
        .map_err(|e| format!("Failed to insert chunk: {}", e))?;
    }

    // Update collection metadata
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "UPDATE collections SET updated_at = ? WHERE id = ?",
        params![now, collection_id],
    )
    .map_err(|e| e.to_string())?;

    log::info!("✓ Incrementally updated {} with {} chunks", file_path, chunks.len());
    Ok(())
}

/// Handle file removal (detected by file watcher)
#[tauri::command]
pub async fn handle_file_removal(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<(), String> {
    log::info!("Handling file removal: {}", file_path);

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    // Delete document (chunks will be cascade deleted)
    let deleted = conn.execute(
        "DELETE FROM documents WHERE path = ?",
        params![file_path],
    )
    .map_err(|e| format!("Failed to delete document: {}", e))?;

    if deleted > 0 {
        log::info!("✓ Removed {} from index", file_path);
    } else {
        log::debug!("File not in index: {}", file_path);
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorLog {
    pub message: String,
    pub stack: Option<String>,
    pub component_stack: Option<String>,
    pub timestamp: String,
}

#[tauri::command]
pub async fn log_error(app_handle: AppHandle, error: ErrorLog) -> Result<(), String> {
    use std::io::Write;

    let log_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs");

    // Create logs directory if it doesn't exist
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    let log_file = log_dir.join("errors.log");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file)
        .map_err(|e| e.to_string())?;

    let log_entry = format!(
        "\n[{}] {}\nStack: {}\nComponent: {}\n{}\n",
        error.timestamp,
        error.message,
        error.stack.unwrap_or_else(|| "N/A".to_string()),
        error.component_stack.unwrap_or_else(|| "N/A".to_string()),
        "-".repeat(80)
    );

    file.write_all(log_entry.as_bytes())
        .map_err(|e| e.to_string())?;

    log::error!("Frontend error logged: {}", error.message);

    Ok(())
}

#[tauri::command]
pub async fn get_error_logs(app_handle: AppHandle) -> Result<String, String> {
    let log_file = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs")
        .join("errors.log");

    if !log_file.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(&log_file).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_error_logs(app_handle: AppHandle) -> Result<(), String> {
    let log_file = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("logs")
        .join("errors.log");

    if log_file.exists() {
        fs::remove_file(&log_file).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PerformanceStats {
    pub total_collections: i64,
    pub total_documents: i64,
    pub total_chunks: i64,
    pub database_size_mb: f64,
    pub index_size_mb: f64,
    pub avg_search_time_ms: f64,
    pub recent_searches: Vec<SearchStats>,
    pub memory_usage_mb: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchStats {
    pub query: String,
    pub results_count: usize,
    pub time_ms: u64,
    pub timestamp: String,
}

#[tauri::command]
pub async fn get_performance_stats(state: State<'_, AppState>) -> Result<PerformanceStats, String> {
    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    // Get total collections
    let total_collections: i64 = conn
        .query_row("SELECT COUNT(*) FROM collections", [], |row| row.get(0))
        .unwrap_or(0);

    // Get total documents
    let total_documents: i64 = conn
        .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
        .unwrap_or(0);

    // Get total chunks
    let total_chunks: i64 = conn
        .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
        .unwrap_or(0);

    // Get database file size
    let db_size = std::fs::metadata(&state.db_path)
        .map(|m| m.len() as f64 / 1_048_576.0) // Convert to MB
        .unwrap_or(0.0);

    // Estimate index size (simplified)
    let index_size = db_size * 0.3; // Rough estimate

    // Placeholder for recent searches and performance
    let recent_searches = Vec::new();

    Ok(PerformanceStats {
        total_collections,
        total_documents,
        total_chunks,
        database_size_mb: db_size,
        index_size_mb: index_size,
        avg_search_time_ms: 0.0,
        recent_searches,
        memory_usage_mb: None,
    })
}

/// Get adjacent chunks for context preview
/// Fetches chunks before and after the target chunk from the same document
#[tauri::command]
pub async fn get_chunk_context(
    state: State<'_, AppState>,
    doc_id: i64,
    start_line: i64,
    context_size: Option<i64>,
) -> Result<Vec<SearchResult>, String> {
    let context_size = context_size.unwrap_or(5);
    log::info!("Fetching chunk context for doc_id={}, start_line={}, context_size={}",
               doc_id, start_line, context_size);

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    // Get the target chunk and its neighbors
    // We fetch chunks from the same document, ordered by start_line
    // Get N chunks before and N chunks after the target chunk
    let sql = "
        SELECT
            c.id as chunk_id,
            c.doc_id,
            d.path as document_path,
            COALESCE(d.status, 'normal') as document_status,
            c.content,
            c.metadata,
            c.start_line,
            c.end_line
        FROM chunks c
        JOIN documents d ON c.doc_id = d.id
        WHERE c.doc_id = ?
        ORDER BY c.start_line
    ";

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let all_chunks: Vec<SearchResult> = stmt
        .query_map(params![doc_id], |row| {
            let metadata_str: Option<String> = row.get(5)?;
            let metadata: Option<ChunkMetadata> =
                metadata_str.and_then(|s| serde_json::from_str(&s).ok());

            Ok(SearchResult {
                chunk_id: row.get(0)?,
                doc_id: row.get(1)?,
                document_path: row.get(2)?,
                document_status: row.get(3)?,
                content: row.get(4)?,
                metadata,
                score: 0.0,
                start_line: row.get::<_, i64>(6)? as usize,
                end_line: row.get::<_, i64>(7)? as usize,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Find the index of the target chunk
    let target_index = all_chunks
        .iter()
        .position(|chunk| chunk.start_line == start_line as usize);

    let result = match target_index {
        Some(idx) => {
            // Calculate the range of chunks to return
            let start = idx.saturating_sub(context_size as usize);
            let end = (idx + context_size as usize + 1).min(all_chunks.len());

            all_chunks[start..end].to_vec()
        }
        None => {
            // If we can't find the exact chunk, return all chunks
            // This handles edge cases where start_line might not match exactly
            log::warn!("Could not find target chunk at start_line={}, returning all chunks", start_line);
            all_chunks
        }
    };

    log::info!("Returning {} chunks for context", result.len());
    Ok(result)
}
