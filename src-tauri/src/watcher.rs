use notify::{Config, RecommendedWatcher, Watcher};
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use std::sync::{Arc, Mutex};
use crate::AppState;

pub struct WatcherState {
    pub watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn init_watcher(app_handle: &AppHandle) -> anyhow::Result<()> {
    let (tx, rx) = channel();

    // Debounce events (2 seconds)
    let config = Config::default().with_poll_interval(Duration::from_secs(2));
    let watcher = RecommendedWatcher::new(tx, config)?;

    // We need to store the watcher in the state so it doesn't get dropped
    let watcher_state = app_handle.state::<WatcherState>();
    if let Ok(mut guard) = watcher_state.watcher.lock() {
        *guard = Some(watcher);
    }

    // Spawn a thread to handle events
    let app = app_handle.clone();
    std::thread::spawn(move || {
        for res in rx {
            match res {
                Ok(event) => {
                    log::info!("File event: {:?}", event);

                    // Handle different event types
                    // Extract paths
                    for path in event.paths {
                        let path_str = path.to_string_lossy().to_string();

                        match event.kind {
                            notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
                                // Emit to frontend
                                let _ = app.emit("file-changed", &path_str);

                                // Trigger incremental update
                                log::info!("🔄 File changed, triggering incremental update: {}", path_str);

                                // We need to use async runtime since update_file_incremental_sync might do I/O
                                let app_clone = app.clone();
                                let path_clone = path_str.clone();
                                std::thread::spawn(move || {
                                    if let Err(e) = update_file_sync(&app_clone, path_clone) {
                                        log::error!("Failed to update file incrementally: {}", e);
                                    }
                                });
                            }
                            notify::EventKind::Remove(_) => {
                                // Emit to frontend
                                let _ = app.emit("file-removed", &path_str);

                                // Trigger removal from index
                                log::info!("🗑️ File removed, updating index: {}", path_str);

                                let app_clone = app.clone();
                                let path_clone = path_str.clone();
                                std::thread::spawn(move || {
                                    if let Err(e) = remove_file_sync(&app_clone, path_clone) {
                                        log::error!("Failed to remove file from index: {}", e);
                                    }
                                });
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => log::error!("watch error: {:?}", e),
            }
        }
    });

    Ok(())
}

/// Synchronous wrapper for incremental file update
/// This is called from the file watcher thread
fn update_file_sync(app_handle: &AppHandle, file_path: String) -> Result<(), String> {
    use std::path::Path;
    use rusqlite::params;
    use sha2::{Digest, Sha256};
    use std::fs;
    use crate::models::Chunk;

    let path = Path::new(&file_path);

    // Check if file exists
    if !path.exists() {
        log::debug!("File no longer exists: {}", file_path);
        return Ok(());
    }

    // Check file extension
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    if extension != "md" && extension != "markdown" && extension != "pdf" {
        return Ok(());
    }

    let state = app_handle.state::<AppState>();
    let conn = crate::db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

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
            // Check if file belongs to any watched collection
            let collections = crate::db::get_collections(&conn).map_err(|e| e.to_string())?;
            let mut found = None;
            for coll in collections {
                if let Some(folder) = &coll.folder_path {
                    if file_path.starts_with(folder) {
                        found = Some(coll.id);
                        break;
                    }
                }
            }
            match found {
                Some(id) => id,
                None => return Ok(()), // Not in any watched collection
            }
        }
    };

    // Extract content and chunk
    let (content, chunks_result, doc_status) = if extension == "pdf" {
        match crate::pdf_parser::extract_text_from_pdf(path) {
            Ok(crate::pdf_parser::PdfStatus::Success { text, page_count }) => {
                let chunks = crate::pdf_parser::chunk_pdf_text(0, &text, page_count)
                    .map_err(|e| format!("Failed to chunk PDF: {}", e))?;
                (text, Ok::<Vec<Chunk>, String>(chunks), "normal".to_string())
            }
            Ok(crate::pdf_parser::PdfStatus::ScannedPdf { .. }) => {
                ("".to_string(), Ok(vec![]), "scanned_pdf".to_string())
            }
            _ => ("".to_string(), Ok(vec![]), "error".to_string()),
        }
    } else {
        let content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read file: {}", e))?;
        let chunks = crate::chunker::chunk_markdown(0, &content)
            .map_err(|e| format!("Failed to chunk: {}", e))?;
        (content, Ok(chunks), "normal".to_string())
    };

    // Calculate hash
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let hash = hex::encode(hasher.finalize());

    // Check if unchanged
    let unchanged: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM documents WHERE collection_id = ? AND path = ? AND hash = ?",
            params![collection_id, file_path, hash],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if unchanged {
        log::debug!("File unchanged: {}", file_path);
        return Ok(());
    }

    // Get file metadata
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let last_modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;

    // Delete old version
    conn.execute(
        "DELETE FROM documents WHERE collection_id = ? AND path = ?",
        params![collection_id, file_path],
    )
    .map_err(|e| format!("Failed to delete: {}", e))?;

    // Insert new document
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        "INSERT INTO documents (collection_id, path, hash, last_modified, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![collection_id, file_path, hash, last_modified, now, doc_status],
    )
    .map_err(|e| format!("Failed to insert: {}", e))?;

    let doc_id = conn.last_insert_rowid();

    // Insert chunks with embeddings
    let mut chunks = chunks_result?;
    let chunk_embeddings = if !chunks.is_empty() {
        // Get custom model path from config
        let custom_path = {
            let config = tokio::runtime::Handle::current()
                .block_on(state.config_manager.get());
            config.model_path.clone()
        };

        match crate::embeddings::EmbeddingModel::new(custom_path.as_deref()) {
            Ok(model) => {
                let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
                model.embed_batch(&texts).ok()
            }
            Err(_) => None,
        }
    } else {
        None
    };

    for (idx, chunk) in chunks.iter_mut().enumerate() {
        chunk.doc_id = doc_id;
        let metadata_json = serde_json::to_string(&chunk.metadata).ok();
        let embedding_blob = chunk_embeddings.as_ref()
            .and_then(|e| e.get(idx))
            .map(|e| crate::search::f32_vec_to_bytes(e));

        conn.execute(
            "INSERT INTO chunks (doc_id, content, metadata, start_line, end_line, embedding, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                chunk.doc_id, chunk.content, metadata_json,
                chunk.start_line as i64, chunk.end_line as i64,
                embedding_blob, chunk.created_at,
            ],
        )
        .map_err(|e| format!("Failed to insert chunk: {}", e))?;
    }

    log::info!("✓ Incrementally updated {} ({} chunks)", file_path, chunks.len());
    Ok(())
}

/// Synchronous wrapper for file removal
fn remove_file_sync(app_handle: &AppHandle, file_path: String) -> Result<(), String> {
    use rusqlite::params;

    let state = app_handle.state::<AppState>();
    let conn = crate::db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    let deleted = conn.execute(
        "DELETE FROM documents WHERE path = ?",
        params![file_path],
    )
    .map_err(|e| format!("Failed to delete: {}", e))?;

    if deleted > 0 {
        log::info!("✓ Removed {} from index", file_path);
    }

    Ok(())
}
