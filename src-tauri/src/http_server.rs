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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tempfile::tempdir;
    use tower::ServiceExt; // for `oneshot`

    async fn create_test_app() -> (Router, PathBuf, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        db::init_database(&db_path).unwrap();

        // Create a default collection for testing
        let conn = db::get_connection(&db_path).unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?)",
            rusqlite::params!["default", now, now],
        )
        .unwrap();
        drop(conn);

        let state = Arc::new(ServerState {
            db_path: db_path.clone(),
        });

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let app = Router::new()
            .route("/api/health", get(health_check))
            .route("/api/clip", post(handle_clip))
            .layer(cors)
            .with_state(state);

        (app, db_path, dir)
    }

    #[tokio::test]
    async fn test_health_check() {
        let (app, _db_path, _dir) = create_test_app().await;

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let health: HealthResponse = serde_json::from_slice(&body).unwrap();

        assert_eq!(health.status, "ok");
        assert!(!health.version.is_empty());
    }

    #[tokio::test]
    async fn test_clip_simple() {
        let (app, db_path, _dir) = create_test_app().await;

        let clip_request = ClipRequest {
            url: "https://example.com/article".to_string(),
            title: "Test Article".to_string(),
            content: "This is the content of the test article.".to_string(),
            context: None,
            collection_id: Some(1),
            timestamp: "2024-01-01T12:00:00Z".to_string(),
            source: "browser-extension".to_string(),
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/clip")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&clip_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let clip_response: ClipResponse = serde_json::from_slice(&body).unwrap();

        assert!(clip_response.success);
        assert!(clip_response.document_id.is_some());

        // Verify it was stored in database
        let conn = db::get_connection(&db_path).unwrap();
        let doc_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(doc_count, 1);

        let chunk_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(chunk_count, 1);
    }

    #[tokio::test]
    async fn test_clip_with_context() {
        let (app, db_path, _dir) = create_test_app().await;

        let clip_request = ClipRequest {
            url: "https://example.com/docs".to_string(),
            title: "API Documentation".to_string(),
            content: "Main API content here.".to_string(),
            context: Some("Additional context about the API.".to_string()),
            collection_id: Some(1),
            timestamp: "2024-01-01T12:00:00Z".to_string(),
            source: "browser-extension".to_string(),
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/clip")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&clip_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Verify context was included in chunk
        let conn = db::get_connection(&db_path).unwrap();
        let content: String = conn
            .query_row("SELECT content FROM chunks", [], |row| row.get(0))
            .unwrap();

        assert!(content.contains("Main API content"));
        assert!(content.contains("Additional context"));
        assert!(content.contains("Context:"));
    }

    #[tokio::test]
    async fn test_clip_duplicate_url() {
        let (app, db_path, _dir) = create_test_app().await;

        let clip_request1 = ClipRequest {
            url: "https://example.com/page".to_string(),
            title: "Original Title".to_string(),
            content: "Original content.".to_string(),
            context: None,
            collection_id: Some(1),
            timestamp: "2024-01-01T12:00:00Z".to_string(),
            source: "browser-extension".to_string(),
        };

        // First clip
        let response1 = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/clip")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&clip_request1).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response1.status(), StatusCode::OK);

        // Second clip with same URL but different content
        let clip_request2 = ClipRequest {
            url: "https://example.com/page".to_string(),
            title: "Updated Title".to_string(),
            content: "Updated content.".to_string(),
            context: None,
            collection_id: Some(1),
            timestamp: "2024-01-02T12:00:00Z".to_string(),
            source: "browser-extension".to_string(),
        };

        let response2 = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/clip")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&clip_request2).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response2.status(), StatusCode::OK);

        // Should only have one document (replaced)
        let conn = db::get_connection(&db_path).unwrap();
        let doc_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(doc_count, 1);

        // Content should be updated
        let content: String = conn
            .query_row("SELECT content FROM chunks", [], |row| row.get(0))
            .unwrap();
        assert!(content.contains("Updated"));
    }

    #[tokio::test]
    async fn test_clip_metadata() {
        let (app, db_path, _dir) = create_test_app().await;

        let clip_request = ClipRequest {
            url: "https://example.com/tech".to_string(),
            title: "Tech Article".to_string(),
            content: "Technical content.".to_string(),
            context: None,
            collection_id: Some(1),
            timestamp: "2024-01-01T12:00:00Z".to_string(),
            source: "chrome-extension".to_string(),
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/clip")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&clip_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Verify metadata was stored
        let conn = db::get_connection(&db_path).unwrap();
        let metadata: String = conn
            .query_row("SELECT metadata FROM chunks", [], |row| row.get(0))
            .unwrap();

        let meta: serde_json::Value = serde_json::from_str(&metadata).unwrap();
        assert_eq!(meta["chunk_type"], "web");
        assert_eq!(meta["url"], "https://example.com/tech");
        assert_eq!(meta["source"], "chrome-extension");
        assert_eq!(meta["headers"][0], "Tech Article");
    }

    #[tokio::test]
    async fn test_clip_pseudo_path() {
        let (app, db_path, _dir) = create_test_app().await;

        let clip_request = ClipRequest {
            url: "https://docs.rust-lang.org/book/ch01-00-getting-started.html".to_string(),
            title: "Getting Started".to_string(),
            content: "Rust getting started guide.".to_string(),
            context: None,
            collection_id: Some(1),
            timestamp: "2024-01-01T12:00:00Z".to_string(),
            source: "browser-extension".to_string(),
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/clip")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&clip_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Verify pseudo-path was created correctly
        let conn = db::get_connection(&db_path).unwrap();
        let path: String = conn
            .query_row("SELECT path FROM documents", [], |row| row.get(0))
            .unwrap();

        assert!(path.starts_with("web://"));
        assert!(path.contains("docs.rust-lang.org"));
    }

    #[tokio::test]
    async fn test_store_web_clip_default_collection() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        db::init_database(&db_path).unwrap();

        // Create collection with id 1
        let conn = db::get_connection(&db_path).unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO collections (id, name, created_at, updated_at) VALUES (1, ?, ?, ?)",
            rusqlite::params!["default", now, now],
        )
        .unwrap();
        drop(conn);

        let clip_request = ClipRequest {
            url: "https://example.com".to_string(),
            title: "Example".to_string(),
            content: "Example content".to_string(),
            context: None,
            collection_id: None, // No collection specified
            timestamp: "2024-01-01T12:00:00Z".to_string(),
            source: "test".to_string(),
        };

        let doc_id = store_web_clip(&db_path, clip_request).await.unwrap();
        assert!(doc_id > 0);

        // Verify it was stored in collection 1
        let conn = db::get_connection(&db_path).unwrap();
        let collection_id: i64 = conn
            .query_row(
                "SELECT collection_id FROM documents WHERE id = ?",
                rusqlite::params![doc_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(collection_id, 1);
    }

    #[tokio::test]
    async fn test_clip_fts_indexing() {
        let (app, db_path, _dir) = create_test_app().await;

        let clip_request = ClipRequest {
            url: "https://example.com/rust".to_string(),
            title: "Rust Programming Language".to_string(),
            content: "Rust is a systems programming language focused on safety and performance."
                .to_string(),
            context: None,
            collection_id: Some(1),
            timestamp: "2024-01-01T12:00:00Z".to_string(),
            source: "browser-extension".to_string(),
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/clip")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(&clip_request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        // Verify FTS indexing works
        let conn = db::get_connection(&db_path).unwrap();
        let fts_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chunks_fts WHERE content MATCH 'rust'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fts_count, 1);
    }
}
