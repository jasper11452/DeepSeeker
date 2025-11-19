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
) -> Result<Collection, String> {
    log::info!("Creating collection: {}", name);

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?)",
        params![name, now, now],
    )
    .map_err(|e| format!("Failed to create collection: {}", e))?;

    let id = conn.last_insert_rowid();

    Ok(Collection {
        id,
        name,
        created_at: now,
        updated_at: now,
    })
}

#[tauri::command]
pub async fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    log::info!("Listing collections");

    let conn = db::get_connection(&state.db_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, created_at, updated_at FROM collections ORDER BY name")
        .map_err(|e| e.to_string())?;

    let collections = stmt
        .query_map([], |row| {
            Ok(Collection {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
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

    // Find all Markdown files
    let files: Vec<_> = WalkDir::new(&directory_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().and_then(|s| s.to_str()) == Some("md")
                || e.path().extension().and_then(|s| s.to_str()) == Some("markdown")
        })
        .collect();

    let total_files = files.len();
    let mut processed = 0;

    for entry in files {
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();

        // Read file content
        let content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read {}: {}", path_str, e))?;

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

        // Chunk the document
        let chunks = crate::chunker::chunk_markdown(doc_id, &content)
            .map_err(|e| format!("Failed to chunk {}: {}", path_str, e))?;

        // Insert chunks
        for chunk in chunks {
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
