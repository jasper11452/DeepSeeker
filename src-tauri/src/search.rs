use crate::db;
use crate::models::{ChunkMetadata, SearchResult};
use anyhow::Result;
use rusqlite::params;
use std::path::Path;

/// Perform hybrid search combining BM25 and vector similarity
///
/// For MVP: Focus on BM25 (FTS5) search
/// TODO: Add vector search when embeddings are ready
pub fn search_hybrid(
    db_path: &Path,
    query: &str,
    collection_id: Option<i64>,
    limit: usize,
) -> Result<Vec<SearchResult>> {
    let conn = db::get_connection(db_path)?;

    // For now, use pure BM25 search via FTS5
    // TODO: Implement hybrid scoring with vector similarity

    let sql = if collection_id.is_some() {
        format!(
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
             LIMIT ?",
        )
    } else {
        format!(
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
             LIMIT ?",
        )
    };

    let mut stmt = conn.prepare(&sql)?;

    let results: Vec<SearchResult> = if let Some(cid) = collection_id {
        stmt.query_map(params![query, cid, limit], |row| {
            let metadata_str: Option<String> = row.get(4)?;
            let metadata: Option<ChunkMetadata> = metadata_str
                .and_then(|s| serde_json::from_str(&s).ok());

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
        })?
        .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![query, limit], |row| {
            let metadata_str: Option<String> = row.get(4)?;
            let metadata: Option<ChunkMetadata> = metadata_str
                .and_then(|s| serde_json::from_str(&s).ok());

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
        })?
        .collect::<Result<Vec<_>, _>>()?
    };

    log::info!("Found {} results for query: {}", results.len(), query);

    Ok(results)
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
}
