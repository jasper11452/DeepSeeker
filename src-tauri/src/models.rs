use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub folder_path: Option<String>,
    pub file_count: i64,
    pub last_sync: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: i64,
    pub collection_id: i64,
    pub path: String,
    pub hash: String,
    pub last_modified: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chunk {
    pub id: i64,
    pub doc_id: i64,
    pub content: String,
    pub metadata: Option<ChunkMetadata>,
    pub start_line: usize,
    pub end_line: usize,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkMetadata {
    /// Header hierarchy: ["H1 Title", "H2 Subtitle", "H3 Section"]
    pub headers: Vec<String>,
    /// Chunk type: "code", "text", "table", etc.
    pub chunk_type: String,
    /// Language for code blocks
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub chunk_id: i64,
    pub doc_id: i64,
    pub document_path: String,
    pub content: String,
    pub metadata: Option<ChunkMetadata>,
    pub score: f32,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub query: String,
    pub collection_id: Option<i64>,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexProgress {
    pub total_files: usize,
    pub processed_files: usize,
    pub current_file: Option<String>,
}
