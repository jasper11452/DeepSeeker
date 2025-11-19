use crate::db;
use crate::models::*;
use crate::AppState;
use anyhow::{Context, Result};
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
        let (content, chunks_result) = if extension == "pdf" {
            // Handle PDF files
            match crate::pdf_parser::extract_text_from_pdf(path) {
                Ok(crate::pdf_parser::PdfStatus::Success { text, page_count }) => {
                    let chunks = crate::pdf_parser::chunk_pdf_text(0, &text, page_count)
                        .map_err(|e| format!("Failed to chunk PDF: {}", e))?;
                    (text, Ok(chunks))
                }
                Ok(crate::pdf_parser::PdfStatus::ScannedPdf { page_count }) => {
                    log::warn!("⚠️ Scanned PDF (Skipped): {}", path_str);
                    // Create a placeholder chunk with warning
                    let warning = format!(
                        "⚠️ Scanned PDF (No text layer)\n\nThis PDF contains {} page(s) but no extractable text.\n\
                        The file appears to be a scanned document or image-based PDF.\n\n\
                        To index this content, you would need OCR (Optical Character Recognition).",
                        page_count
                    );
                    processed += 1;
                    // Skip this file but log it
                    log::info!("Skipped scanned PDF ({}/{}): {}", processed, total_files, path_str);
                    continue; // Skip to next file
                }
                Err(e) => {
                    log::error!("Failed to extract PDF {}: {}", path_str, e);
                    processed += 1;
                    continue;
                }
            }
        } else {
            // Handle Markdown files
            let content = fs::read_to_string(path)
                .map_err(|e| format!("Failed to read {}: {}", path_str, e))?;

            let chunks = crate::chunker::chunk_markdown(0, &content)
                .map_err(|e| format!("Failed to chunk {}: {}", path_str, e))?;

            (content, Ok(chunks))
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
            "INSERT INTO documents (collection_id, path, hash, last_modified, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![collection_id, path_str, hash, last_modified, now],
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
