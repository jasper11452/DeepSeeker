use notify::{Config, RecommendedWatcher, Watcher};
use std::collections::HashMap;
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use std::sync::{Arc, Mutex};
use crate::AppState;

/// Debounce state to prevent duplicate file updates
pub struct DebounceState {
    /// Map of file path to last event time
    pending_files: Arc<Mutex<HashMap<String, Instant>>>,
    /// Debounce delay in milliseconds
    debounce_delay: Duration,
}

impl DebounceState {
    pub fn new(debounce_ms: u64) -> Self {
        Self {
            pending_files: Arc::new(Mutex::new(HashMap::new())),
            debounce_delay: Duration::from_millis(debounce_ms),
        }
    }

    /// Check if a file should be processed (i.e., it's been stable for debounce_delay)
    pub fn should_process(&self, file_path: &str) -> bool {
        let mut pending = self.pending_files.lock().unwrap();

        if let Some(&last_time) = pending.get(file_path) {
            let elapsed = last_time.elapsed();
            if elapsed >= self.debounce_delay {
                // File has been stable, remove from pending and allow processing
                pending.remove(file_path);
                true
            } else {
                // Still within debounce window
                false
            }
        } else {
            // First time seeing this file, add to pending
            pending.insert(file_path.to_string(), Instant::now());
            false
        }
    }

    /// Update the timestamp for a file (called when new event received)
    pub fn update_timestamp(&self, file_path: &str) {
        let mut pending = self.pending_files.lock().unwrap();
        pending.insert(file_path.to_string(), Instant::now());
    }

    /// Remove a file from pending (called after successful processing)
    pub fn clear(&self, file_path: &str) {
        let mut pending = self.pending_files.lock().unwrap();
        pending.remove(file_path);
    }
}

pub struct WatcherState {
    pub watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    pub debounce: Arc<DebounceState>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Arc::new(Mutex::new(None)),
            debounce: Arc::new(DebounceState::new(500)), // 500ms debounce
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

    // Get debounce state for event handling
    let debounce_state = watcher_state.debounce.clone();

    // Spawn a thread to handle events
    let app = app_handle.clone();
    std::thread::spawn(move || {
        for res in rx {
            match res {
                Ok(event) => {
                    log::debug!("File event: {:?}", event);

                    // Handle different event types
                    // Extract paths
                    for path in event.paths {
                        let path_str = path.to_string_lossy().to_string();

                        match event.kind {
                            notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
                                // Update timestamp in debounce state
                                debounce_state.update_timestamp(&path_str);

                                // Schedule a delayed check
                                let app_clone = app.clone();
                                let path_clone = path_str.clone();
                                let debounce_clone = debounce_state.clone();

                                std::thread::spawn(move || {
                                    // Wait for debounce delay + small buffer
                                    std::thread::sleep(Duration::from_millis(550));

                                    // Check if file is ready to process
                                    if debounce_clone.should_process(&path_clone) {
                                        log::info!("🔄 File changed (after debounce), triggering update: {}", path_clone);

                                        // Emit to frontend
                                        let _ = app_clone.emit("file-changed", &path_clone);

                                        // Trigger incremental update
                                        if let Err(e) = update_file_sync(&app_clone, path_clone.clone()) {
                                            log::error!("Failed to update file incrementally: {}", e);
                                        } else {
                                            // Clear from debounce state after successful processing
                                            debounce_clone.clear(&path_clone);
                                        }
                                    } else {
                                        log::debug!("File update skipped (still receiving events): {}", path_clone);
                                    }
                                });
                            }
                            notify::EventKind::Remove(_) => {
                                // Emit to frontend
                                let _ = app.emit("file-removed", &path_str);

                                // Trigger removal from index (no debounce needed)
                                log::info!("🗑️ File removed, updating index: {}", path_str);

                                // Clear from debounce state if present
                                debounce_state.clear(&path_str);

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
///
/// Improvements:
/// 1. Atomic updates - uses SQLite transactions
/// 2. Smart Diff - reuses embeddings for unchanged chunks
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
    let mut conn = crate::db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

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

    let mut chunks = chunks_result?;

    // Smart Diff: Retrieve old chunks to reuse embeddings for unchanged content
    let old_doc_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM documents WHERE collection_id = ? AND path = ?",
            params![collection_id, file_path],
            |row| row.get(0),
        )
        .ok();

    // Map from chunk content hash to embedding
    let mut old_embeddings: std::collections::HashMap<String, Vec<u8>> = std::collections::HashMap::new();

    if let Some(old_id) = old_doc_id {
        let mut stmt = conn
            .prepare("SELECT content, embedding FROM chunks WHERE doc_id = ?")
            .map_err(|e| e.to_string())?;

        let old_chunks = stmt
            .query_map(params![old_id], |row| {
                let content: String = row.get(0)?;
                let embedding: Option<Vec<u8>> = row.get(1)?;
                Ok((content, embedding))
            })
            .map_err(|e| e.to_string())?;

        for chunk_result in old_chunks {
            if let Ok((content, Some(embedding))) = chunk_result {
                // Calculate content hash for smart matching
                let mut chunk_hasher = Sha256::new();
                chunk_hasher.update(content.as_bytes());
                let content_hash = hex::encode(chunk_hasher.finalize());
                old_embeddings.insert(content_hash, embedding);
            }
        }

        log::debug!("Loaded {} old embeddings for smart diff", old_embeddings.len());
    }

    // Calculate which chunks need new embeddings
    let mut chunks_needing_embeddings = Vec::new();
    let mut chunk_content_hashes = Vec::new();

    for chunk in &chunks {
        let mut chunk_hasher = Sha256::new();
        chunk_hasher.update(chunk.content.as_bytes());
        let content_hash = hex::encode(chunk_hasher.finalize());
        chunk_content_hashes.push(content_hash.clone());

        if !old_embeddings.contains_key(&content_hash) {
            chunks_needing_embeddings.push(chunk.content.clone());
        }
    }

    log::debug!(
        "Smart Diff: {} chunks total, {} need new embeddings, {} reusing old",
        chunks.len(),
        chunks_needing_embeddings.len(),
        chunks.len() - chunks_needing_embeddings.len()
    );

    // Generate embeddings only for new/changed chunks
    let new_embeddings = if !chunks_needing_embeddings.is_empty() {
        match crate::embeddings::EmbeddingModel::new() {
            Ok(model) => {
                match model.embed_batch(&chunks_needing_embeddings) {
                    Ok(embeddings) => {
                        log::debug!("Generated {} new embeddings", embeddings.len());
                        Some(embeddings)
                    }
                    Err(e) => {
                        log::warn!("Failed to generate embeddings: {}", e);
                        None
                    }
                }
            }
            Err(_) => None,
        }
    } else {
        None
    };

    // Map new embeddings back to chunks
    let mut new_embedding_idx = 0;
    let mut chunk_embeddings = Vec::new();

    for (idx, chunk) in chunks.iter().enumerate() {
        let content_hash = &chunk_content_hashes[idx];

        // Try to reuse old embedding first
        if let Some(old_embedding) = old_embeddings.get(content_hash) {
            chunk_embeddings.push(Some(old_embedding.clone()));
        } else if let Some(ref new_embs) = new_embeddings {
            // Use newly generated embedding
            if new_embedding_idx < new_embs.len() {
                chunk_embeddings.push(Some(crate::search::f32_vec_to_bytes(&new_embs[new_embedding_idx])));
                new_embedding_idx += 1;
            } else {
                chunk_embeddings.push(None);
            }
        } else {
            chunk_embeddings.push(None);
        }
    }

    // Get file metadata
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let last_modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;

    // Begin atomic transaction
    let tx = conn.transaction().map_err(|e| format!("Failed to begin transaction: {}", e))?;

    // Delete old document (and chunks via CASCADE)
    tx.execute(
        "DELETE FROM documents WHERE collection_id = ? AND path = ?",
        params![collection_id, file_path],
    )
    .map_err(|e| format!("Failed to delete old document: {}", e))?;

    // Insert new document
    let now = chrono::Utc::now().timestamp();
    tx.execute(
        "INSERT INTO documents (collection_id, path, hash, last_modified, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![collection_id, file_path, hash, last_modified, now, doc_status],
    )
    .map_err(|e| format!("Failed to insert document: {}", e))?;

    let doc_id = tx.last_insert_rowid();

    // Insert chunks with embeddings (reused or newly generated)
    for (idx, chunk) in chunks.iter_mut().enumerate() {
        chunk.doc_id = doc_id;
        let metadata_json = serde_json::to_string(&chunk.metadata).ok();
        let embedding_blob = chunk_embeddings.get(idx).and_then(|e| e.clone());

        tx.execute(
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

    // Commit transaction
    tx.commit().map_err(|e| format!("Failed to commit transaction: {}", e))?;

    log::info!(
        "✓ Incrementally updated {} ({} chunks, {} embeddings reused, {} new)",
        file_path,
        chunks.len(),
        chunks.len() - chunks_needing_embeddings.len(),
        chunks_needing_embeddings.len()
    );

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
