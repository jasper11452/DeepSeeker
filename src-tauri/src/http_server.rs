use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

use crate::db;

#[derive(Clone)]
pub struct ServerState {
    pub db_path: PathBuf,
}

#[derive(Debug, Deserialize)]
pub struct ClipRequest {
    pub url: String,
    pub title: String,
    pub content: String,
    pub context: Option<String>,
    pub collection_id: Option<i64>,
    pub timestamp: String,
    pub source: String,
}

#[derive(Debug, Serialize)]
pub struct ClipResponse {
    pub success: bool,
    pub message: String,
    pub document_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
}

/// Start the HTTP server for browser extension communication
pub async fn start_server(db_path: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(ServerState { db_path });

    // Configure CORS to allow localhost requests
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health_check))
        .route("/api/clip", post(handle_clip))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3737));
    log::info!("HTTP server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Health check endpoint
async fn health_check() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// Handle clip request from browser extension
async fn handle_clip(
    State(state): State<Arc<ServerState>>,
    Json(payload): Json<ClipRequest>,
) -> impl IntoResponse {
    log::info!("Received clip request from: {}", payload.url);

    // For now, store as a text document
    // TODO: Implement proper web content storage with metadata
    match store_web_clip(&state.db_path, payload).await {
        Ok(doc_id) => (
            StatusCode::OK,
            Json(ClipResponse {
                success: true,
                message: "Content clipped successfully".to_string(),
                document_id: Some(doc_id),
            }),
        ),
        Err(e) => {
            log::error!("Failed to store clip: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ClipResponse {
                    success: false,
                    message: format!("Failed to store clip: {}", e),
                    document_id: None,
                }),
            )
        }
    }
}

/// Store web clip in database
async fn store_web_clip(
    db_path: &PathBuf,
    clip: ClipRequest,
) -> Result<i64, Box<dyn std::error::Error>> {
    let conn = db::get_connection(db_path)?;

    // Use collection_id 1 as default if not specified
    let collection_id = clip.collection_id.unwrap_or(1);

    // Create a pseudo-path for the web clip
    let pseudo_path = format!("web://{}", clip.url);

    // Calculate hash of the content
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(clip.content.as_bytes());
    let hash = hex::encode(hasher.finalize());

    // Get current timestamp
    let now = chrono::Utc::now().timestamp();

    // Check if this URL was already clipped
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM documents WHERE collection_id = ? AND path = ?",
        rusqlite::params![collection_id, pseudo_path],
        |row| row.get(0),
    )?;

    // Delete old version if exists
    if exists {
        conn.execute(
            "DELETE FROM documents WHERE collection_id = ? AND path = ?",
            rusqlite::params![collection_id, pseudo_path],
        )?;
    }

    // Insert document
    conn.execute(
        "INSERT INTO documents (collection_id, path, hash, last_modified, created_at)
         VALUES (?, ?, ?, ?, ?)",
        rusqlite::params![collection_id, pseudo_path, hash, now, now],
    )?;

    let doc_id = conn.last_insert_rowid();

    // Create a single chunk with the web content
    let metadata = serde_json::json!({
        "headers": [clip.title],
        "chunk_type": "web",
        "url": clip.url,
        "timestamp": clip.timestamp,
        "source": clip.source
    });

    let full_content = if let Some(context) = clip.context {
        format!("# {}\n\n{}\n\n---\n\nContext:\n{}", clip.title, clip.content, context)
    } else {
        format!("# {}\n\n{}", clip.title, clip.content)
    };

    conn.execute(
        "INSERT INTO chunks (doc_id, content, metadata, start_line, end_line, created_at)
         VALUES (?, ?, ?, 1, 1, ?)",
        rusqlite::params![doc_id, full_content, metadata.to_string(), now],
    )?;

    log::info!("Stored web clip with doc_id: {}", doc_id);

    Ok(doc_id)
}
