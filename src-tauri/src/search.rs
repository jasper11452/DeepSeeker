use crate::db;
use crate::embeddings::EmbeddingModel;
use crate::models::{ChunkMetadata, SearchResult};
use anyhow::Result;
use rusqlite::params;
use std::collections::HashMap;
use std::path::Path;

const BM25_WEIGHT: f32 = 0.3;
const VECTOR_WEIGHT: f32 = 0.7;

/// Perform hybrid search combining BM25 (keyword) and vector (semantic) similarity
///
/// Algorithm:
/// 1. BM25 search via FTS5 (keyword matching)
/// 2. Vector search via sqlite-vec (semantic similarity)
/// 3. Merge and re-rank with weighted scores: alpha * vec_score + (1 - alpha) * bm25_score
pub fn search_hybrid(
    db_path: &Path,
    query: &str,
    collection_id: Option<i64>,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let conn = db::get_connection(db_path)?;

    // Try to load embedding model for vector search
    // If model not available, fall back to BM25 only
    let embedding_model = EmbeddingModel::new();

    match embedding_model {
        Ok(model) => {
            // Full hybrid search (BM25 + Vector)
            hybrid_search_full(&conn, query, collection_id, limit, &model)
        }
        Err(e) => {
            log::warn!("Embedding model not available ({}), falling back to BM25 only", e);
            bm25_search_only(&conn, query, collection_id, limit)
        }
    }
}

/// BM25-only search (fallback when embeddings not available)
fn bm25_search_only(
    conn: &rusqlite::Connection,
    query: &str,
    collection_id: Option<i64>,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let sql = if collection_id.is_some() {
        "SELECT
            c.id as chunk_id,
            c.doc_id,
            d.path as document_path,
            c.content,
            c.metadata,
            c.start_line,
            c.end_line,
            rank as score
         FROM chunks_fts
         JOIN chunks c ON chunks_fts.rowid = c.id
         JOIN documents d ON c.doc_id = d.id
         WHERE chunks_fts MATCH ? AND d.collection_id = ?
         ORDER BY rank
         LIMIT ?"
    } else {
        "SELECT
            c.id as chunk_id,
            c.doc_id,
            d.path as document_path,
            c.content,
            c.metadata,
            c.start_line,
            c.end_line,
            rank as score
         FROM chunks_fts
         JOIN chunks c ON chunks_fts.rowid = c.id
         JOIN documents d ON c.doc_id = d.id
         WHERE chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?"
    };

    let mut stmt = conn.prepare(sql)?;

    let results: Vec<SearchResult> = if let Some(cid) = collection_id {
        stmt.query_map(params![query, cid, limit], parse_search_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![query, limit], parse_search_row)?
            .collect::<Result<Vec<_>, _>>()?
    };

    log::info!("BM25 found {} results for query: {}", results.len(), query);
    Ok(results)
}

/// Full hybrid search combining BM25 and vector similarity
fn hybrid_search_full(
    conn: &rusqlite::Connection,
    query: &str,
    collection_id: Option<i64>,
    limit: usize,
    model: &EmbeddingModel,
) -> Result<Vec<SearchResult>> {
    // Step 1: BM25 Search (get more results for re-ranking)
    let bm25_results = bm25_search_only(conn, query, collection_id, limit * 3)?;

    // If no BM25 results, return empty
    if bm25_results.is_empty() {
        return Ok(vec![]);
    }

    // Step 2: Generate query embedding
    let query_embedding = model.embed(query)?;
    let query_embedding_normalized = EmbeddingModel::normalize(&query_embedding);

    // Step 3: Get embeddings for all BM25 results
    let chunk_ids: Vec<i64> = bm25_results.iter().map(|r| r.chunk_id).collect();

    let placeholders = chunk_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");

    let sql = format!(
        "SELECT id, embedding FROM chunks WHERE id IN ({})",
        placeholders
    );

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = chunk_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let embeddings_map: HashMap<i64, Vec<f32>> = stmt
        .query_map(&params[..], |row| {
            let id: i64 = row.get(0)?;
            let embedding_blob: Option<Vec<u8>> = row.get(1)?;

            let embedding = if let Some(blob) = embedding_blob {
                // Deserialize embedding from BLOB (f32 array)
                bytes_to_f32_vec(&blob)
            } else {
                vec![]
            };

            Ok((id, embedding))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Step 4: Calculate hybrid scores
    let mut hybrid_results: Vec<SearchResult> = bm25_results
        .into_iter()
        .filter_map(|mut result| {
            // Normalize BM25 score to [0, 1] range
            // FTS5 rank is negative (lower is better), so we invert it
            let bm25_score_normalized = 1.0 / (1.0 + result.score.abs());

            // Get vector similarity
            let vec_score = if let Some(chunk_embedding) = embeddings_map.get(&result.chunk_id) {
                if !chunk_embedding.is_empty() {
                    let normalized_chunk_emb = EmbeddingModel::normalize(chunk_embedding);
                    EmbeddingModel::cosine_similarity(
                        &query_embedding_normalized,
                        &normalized_chunk_emb,
                    )
                } else {
                    0.0 // No embedding available
                }
            } else {
                0.0
            };

            // Hybrid score: weighted combination
            let hybrid_score =
                VECTOR_WEIGHT * vec_score + BM25_WEIGHT * bm25_score_normalized;

            result.score = hybrid_score;

            Some(result)
        })
        .collect();

    // Step 5: Re-rank by hybrid score
    hybrid_results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());

    // Step 6: Return top results
    hybrid_results.truncate(limit);

    log::info!(
        "Hybrid search found {} results (BM25 weight: {}, Vector weight: {})",
        hybrid_results.len(),
        BM25_WEIGHT,
        VECTOR_WEIGHT
    );

    Ok(hybrid_results)
}

/// Parse a search result row from SQL
fn parse_search_row(row: &rusqlite::Row) -> rusqlite::Result<SearchResult> {
    let metadata_str: Option<String> = row.get(4)?;
    let metadata: Option<ChunkMetadata> =
        metadata_str.and_then(|s| serde_json::from_str(&s).ok());

    Ok(SearchResult {
        chunk_id: row.get(0)?,
        doc_id: row.get(1)?,
        document_path: row.get(2)?,
        content: row.get(3)?,
        metadata,
        score: row.get::<_, f64>(7)? as f32,
        start_line: row.get::<_, i64>(5)? as usize,
        end_line: row.get::<_, i64>(6)? as usize,
    })
}

/// Convert bytes to f32 vector (embedding deserialization)
fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| {
            let arr: [u8; 4] = [chunk[0], chunk[1], chunk[2], chunk[3]];
            f32::from_le_bytes(arr)
        })
        .collect()
}

/// Convert f32 vector to bytes (embedding serialization)
pub fn f32_vec_to_bytes(vec: &[f32]) -> Vec<u8> {
    vec.iter()
        .flat_map(|f| f.to_le_bytes().to_vec())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    #[test]
    fn test_search_empty_db() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        db::init_database(&db_path).unwrap();

        let results = search_hybrid(&db_path, "test query", None, 10).unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_bm25_score_normalization() {
        // Test BM25 score normalization function
        let test_scores = vec![-1.0, -5.0, -10.0, -20.0];

        for score in test_scores {
            let normalized = 1.0 / (1.0 + score.abs());
            assert!(normalized > 0.0 && normalized <= 1.0);
        }
    }

    #[test]
    fn test_f32_serialization() {
        let original = vec![1.0, 2.5, -3.7, 0.0, 100.5];
        let bytes = f32_vec_to_bytes(&original);
        let deserialized = bytes_to_f32_vec(&bytes);

        assert_eq!(original.len(), deserialized.len());

        for (a, b) in original.iter().zip(deserialized.iter()) {
            assert!((a - b).abs() < 0.0001);
        }
    }

    #[test]
    fn test_hybrid_weights() {
        // Verify weights sum to 1.0
        assert!((BM25_WEIGHT + VECTOR_WEIGHT - 1.0).abs() < 0.0001);

        // Vector weight should be higher (0.7)
        assert!(VECTOR_WEIGHT > BM25_WEIGHT);
    }

    #[test]
    fn test_bytes_to_f32_conversion() {
        // Test edge cases
        let empty: Vec<u8> = vec![];
        let result = bytes_to_f32_vec(&empty);
        assert_eq!(result.len(), 0);

        // Test single value
        let single = f32_vec_to_bytes(&[42.5]);
        let result = bytes_to_f32_vec(&single);
        assert_eq!(result.len(), 1);
        assert!((result[0] - 42.5).abs() < 0.0001);
    }

    #[test]
    fn test_hybrid_search_fallback() {
        // When embedding model is not available, should fall back to BM25
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        db::init_database(&db_path).unwrap();

        let conn = db::get_connection(&db_path).unwrap();

        // Add test data
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO collections (name, created_at, updated_at) VALUES (?, ?, ?)",
            params!["test", now, now],
        )
        .unwrap();

        let collection_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO documents (collection_id, path, hash, last_modified, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![collection_id, "/test.md", "hash", now, now],
        )
        .unwrap();

        let doc_id = conn.last_insert_rowid();

        conn.execute(
            "INSERT INTO chunks (doc_id, content, start_line, end_line, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![doc_id, "rust programming language tutorial", 1, 1, now],
        )
        .unwrap();

        drop(conn);

        // Search should work even without embeddings (falls back to BM25)
        let results = search_hybrid(&db_path, "rust", None, 10).unwrap();
        assert!(results.len() > 0);
    }
}
