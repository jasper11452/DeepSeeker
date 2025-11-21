# DeepSeeker Implementation Quick Reference

## File Sizes & Complexity

```
Core Engine:
  chunker.rs      20 KB  (Markdown parsing + chunking)
  search.rs       13 KB  (Hybrid search algorithm)
  db.rs           16 KB  (Database schema + queries)
  commands.rs     15 KB  (Indexing + collection management)
  embeddings.rs  8.1 KB  (ONNX model wrapper)
  pdf_parser.rs   5.0 KB  (PDF text extraction)
  http_server.rs  5.3 KB  (Browser extension API)
  watcher.rs      2.2 KB  (File watching)
  models.rs       1.8 KB  (Data structures)
  main.rs         2.8 KB  (App initialization)
  lib.rs           250B  (Module declarations)
```

---

## Key Implementation Locations

### 1. MARKDOWN PARSING WITH AST

**File**: `/home/user/deepseeker/src-tauri/src/chunker.rs`

**Key Functions**:
- `MarkdownChunker::chunk()` - Line 48-169: Main parsing loop
- `MarkdownChunker::flush_chunk()` - Line 172-213: Chunk flushing logic
- `chunk_markdown()` - Line 217-240: Public API wrapper

**Key Algorithm**:
```rust
// Line 64-84: Header tracking
Event::Start(Tag::Heading { level, .. }) => {
    self.flush_chunk("text");
    let depth = level as usize;
    self.header_stack.truncate(depth - 1);
}

// Line 86-126: Code block preservation (NEVER SPLIT)
Event::End(TagEnd::CodeBlock) => {
    let chunk = ChunkInfo {
        content: code_block_content.trim().to_string(),
        headers: self.header_stack.clone(),  // Full context
        chunk_type: "code".to_string(),
        language: code_block_lang.clone(),
        start_line: code_block_start_line,
        end_line: self.current_line,
    };
    self.chunks.push(chunk);  // ATOMIC - never split
}
```

**Tests**: Lines 242-700+ (10 test scenarios)

---

### 2. DATABASE SCHEMA & FTS5

**File**: `/home/user/deepseeker/src-tauri/src/db.rs`

**Key Functions**:
- `init_database()` - Line 10-35: Database initialization
- `create_schema()` - Line 38-192: Schema creation with triggers

**Schema Highlights**:

Collections Table (Line 40-51):
```rust
id, name, folder_path, file_count, last_sync, created_at, updated_at
```

Chunks Table (Line 78-91):
```rust
id, doc_id, content, metadata (JSON), start_line, end_line, embedding (BLOB), created_at
```

FTS5 Virtual Table (Line 94-102):
```rust
// Indexed columns: content, metadata
// Porter tokenizer for English stemming
// Triggers keep it synced (Line 105-126)
```

Ghost Data Cleanup (Line 229-251):
```rust
pub fn cleanup_ghost_data(db_path: &Path) -> Result<usize> {
    // Find documents with deleted files
    // DELETE FROM documents WHERE file not exists
    // Cascade delete triggers chunks automatically
}
```

---

### 3. SQLITE-VEC VECTOR STORAGE

**File**: `/home/user/deepseeker/src-tauri/src/db.rs`

**Vector Table Creation** (Line 131-137):
```rust
CREATE VIRTUAL TABLE chunks_vec USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding float[1024]  // 1024-dim BAAI/bge-m3 vectors
)
```

**Triggers for Sync** (Line 141-169):
```rust
// Auto-insert when embedding added to chunks table
// Auto-update when embedding modified
// Auto-delete when chunk removed
```

**Usage in Search** (search.rs Line 114-131):
```rust
SELECT c.id, vec_distance_cosine(v.embedding, ?) as distance
FROM chunks_vec v
JOIN chunks c ON v.chunk_id = c.id
ORDER BY distance
LIMIT k
```

---

### 4. VECTOR EMBEDDINGS (ONNX)

**File**: `/home/user/deepseeker/src-tauri/src/embeddings.rs`

**Model Loading** (Line 35-72):
```rust
pub fn new() -> Result<Self> {
    let model_dir = Self::get_model_dir()?;  // ~/.deepseeker/models/bge-m3/
    let model_path = model_dir.join("model.onnx");
    let tokenizer_path = model_dir.join("tokenizer.json");
    
    let session = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_intra_threads(4)?
        .commit_from_file(&model_path)?;
    
    let tokenizer = Tokenizer::from_file(tokenizer_path)?;
}
```

**Batch Embedding** (Line 111-168):
```rust
pub fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
    // Tokenize all texts
    let encodings = self.tokenizer.encode_batch(texts.to_vec(), true)?;
    
    // Pad/truncate to MAX_SEQ_LENGTH (512 tokens)
    // Create input_ids and attention_mask tensors
    
    // Run ONNX inference
    let outputs = session.run(ort::inputs![
        "input_ids" => input_ids_value,
        "attention_mask" => attention_mask_value,
    ])?;
    
    // Extract sentence embeddings (1024-dim)
    let (_shape, embeddings_data) = outputs["sentence_embedding"]
        .try_extract_tensor::<f32>()?;
    
    // Chunk into Vec<Vec<f32>> by batch_size * EMBEDDING_DIM
}
```

**Vector Math** (Line 171-194):
```rust
// Normalization for unit vectors
pub fn normalize(embedding: &[f32]) -> Vec<f32>

// Cosine similarity (dot product of normalized vectors)
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32
```

---

### 5. HYBRID SEARCH (BM25 + VECTOR)

**File**: `/home/user/deepseeker/src-tauri/src/search.rs`

**Weight Constants** (Line 9-10):
```rust
const BM25_WEIGHT: f32 = 0.3;
const VECTOR_WEIGHT: f32 = 0.7;
```

**Main Entry Point** (Line 18-40):
```rust
pub fn search_hybrid(db_path: &Path, query: &str, collection_id: Option<i64>, limit: usize) {
    let embedding_model = EmbeddingModel::new();
    
    match embedding_model {
        Ok(model) => hybrid_search_full(&conn, query, collection_id, limit, &model),
        Err(e) => bm25_search_only(&conn, query, collection_id, limit),  // Fallback
    }
}
```

**BM25 Search** (Line 43-97):
```rust
fn bm25_search_only() {
    // Query FTS5 virtual table with MATCH operator
    SELECT c.id, c.doc_id, d.path, c.content, c.metadata, rank
    FROM chunks_fts
    JOIN chunks c ON chunks_fts.rowid = c.id
    JOIN documents d ON c.doc_id = d.id
    WHERE chunks_fts MATCH ?
    ORDER BY rank  // FTS5 rank is negative, ascending = best match
}
```

**Vector Search** (Line 113-145):
```rust
fn hybrid_search_full() {
    // Step 1: Generate query embedding
    let query_embedding = model.embed(query)?;
    let query_embedding_bytes = f32_vec_to_bytes(&query_embedding);
    
    // Step 2: Vector KNN via sqlite-vec
    SELECT c.id, vec_distance_cosine(v.embedding, ?) as distance
    FROM chunks_vec v
    JOIN chunks c ON v.chunk_id = c.id
    WHERE d.collection_id = ?
    ORDER BY distance
    LIMIT limit * 3  // Get 3x candidates
    
    // Convert distance to similarity: (1 - distance).max(0).min(1)
}
```

**Hybrid Ranking** (Line 230-243):
```rust
// Step 4: BM25 score normalization
let normalized = 1.0 / (1.0 + r.score.abs());

// Step 5: Combine scores
let hybrid_score = VECTOR_WEIGHT * vec_score + BM25_WEIGHT * bm25_score;

// Step 6: Sort and return
hybrid_results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
hybrid_results.truncate(limit);
```

---

### 6. FILE INDEXING & INCREMENTAL UPDATES

**File**: `/home/user/deepseeker/src-tauri/src/commands.rs`

**Index Directory** (Line 171-350):
```rust
pub async fn index_directory(
    state: State<'_, AppState>,
    collection_id: i64,
    directory_path: String,
) {
    // Step 1: Walk directory
    let files: Vec<_> = WalkDir::new(&directory_path)
        .into_iter()
        .filter(|e| e.path().extension() in ["md", "markdown", "pdf"])
        .collect();
    
    // Step 2: For each file
    for entry in files {
        let path = entry.path();
        
        // Step 2a: Read content
        let content = fs::read_to_string(path)?;
        
        // Step 2b: Compute SHA256 hash (Line 245-247)
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = hex::encode(hasher.finalize());
        
        // Step 2c: Check if unchanged (Line 258-265)
        let exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM documents WHERE collection_id = ? AND path = ? AND hash = ?",
            params![collection_id, path_str, hash],
            |row| row.get(0),
        )?;
        if exists {
            processed += 1;
            continue;  // Skip unchanged
        }
        
        // Step 2d: Chunk content
        let chunks = if is_pdf {
            crate::pdf_parser::chunk_pdf_text(0, &text, page_count)?
        } else {
            crate::chunker::chunk_markdown(0, &content)?
        };
        
        // Step 2e: Insert document + chunks (Line 282-312)
        conn.execute("INSERT INTO documents (...)", params![...]);
        let doc_id = conn.last_insert_rowid();
        
        for chunk in chunks {
            // Generate embedding
            let embedding = model.embed(&chunk.content)?;
            let embedding_bytes = f32_vec_to_bytes(&embedding);
            
            conn.execute(
                "INSERT INTO chunks (doc_id, content, metadata, embedding, ...)",
                params![doc_id, chunk.content, metadata_json, embedding_bytes, ...],
            );
            // Triggers automatically sync to chunks_fts and chunks_vec
        }
    }
}
```

---

### 7. FILE WATCHING (Incomplete)

**File**: `/home/user/deepseeker/src-tauri/src/watcher.rs`

**Current Implementation** (Line 19-66):
```rust
pub fn init_watcher(app_handle: &AppHandle) -> anyhow::Result<()> {
    let (tx, rx) = channel();
    
    // Create file watcher with 2-second debounce
    let config = Config::default().with_poll_interval(Duration::from_secs(2));
    let watcher = RecommendedWatcher::new(tx, config)?;
    
    // Store watcher in state
    let watcher_state = app_handle.state::<WatcherState>();
    *watcher_state.watcher.lock()? = Some(watcher);
    
    // Spawn thread to handle events
    std::thread::spawn(move || {
        for res in rx {
            match res {
                Ok(event) => {
                    log::info!("File event: {:?}", event);
                    
                    // Emit events to frontend
                    match event.kind {
                        notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
                            let _ = app.emit("file-changed", &path_str);
                        }
                        notify::EventKind::Remove(_) => {
                            let _ = app.emit("file-removed", &path_str);
                        }
                        _ => {}
                    }
                }
                Err(e) => log::error!("watch error: {:?}", e),
            }
        }
    });
}
```

**TODO**: Connect to `index_directory()` for smart incremental updates

---

### 8. PDF SUPPORT

**File**: `/home/user/deepseeker/src-tauri/src/pdf_parser.rs`

**Text Extraction** (Line 17-47):
```rust
pub fn extract_text_from_pdf(path: &Path) -> Result<PdfStatus> {
    let bytes = std::fs::read(path)?;
    
    // Extract using pdf-extract crate
    let extracted = pdf_extract::extract_text_from_mem(&bytes)?;
    
    // Estimate page count
    let page_count = estimate_page_count(&bytes);
    
    // Detect if scanned (heuristic: < 50 chars/page)
    if is_scanned_pdf(&extracted, page_count) {
        return Ok(PdfStatus::ScannedPdf { page_count });
    }
    
    Ok(PdfStatus::Success { text: extracted, page_count })
}
```

**Scanned Detection** (Line 51-72):
```rust
fn is_scanned_pdf(text: &str, page_count: usize) -> bool {
    let text_length = text.trim().len();
    
    if text_length == 0 {
        return true;  // No text at all = definitely scanned
    }
    
    let chars_per_page = text_length / page_count.max(1);
    if chars_per_page < 50 {
        return true;  // < 50 chars/page = likely scanned
    }
    
    false
}
```

**Chunking** (Line 89-120+):
```rust
pub fn chunk_pdf_text(doc_id: i64, text: &str, page_count: usize) -> Result<Vec<Chunk>> {
    // Simple chunking: split by paragraphs (double newlines)
    let paragraphs: Vec<&str> = text.split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .collect();
    
    // Create chunks from paragraphs
    // Store metadata with page numbers
}
```

---

## Test Coverage Summary

**Total Tests**: 30+

### By Module:

**db.rs** (6 tests):
- `test_init_database` - Schema creation
- `test_fts5_enabled` - FTS5 virtual table
- `test_ghost_data_cleanup` - Orphan cleanup
- `test_cascade_delete` - Foreign key cascades
- `test_fts5_triggers` - Auto-sync triggers
- `test_sqlite_vec_loaded` - Extension loading

**chunker.rs** (10 tests):
- `test_basic_chunking` - Basic parsing
- `test_header_hierarchy` - Header tracking
- `test_no_code_block_splitting` - Code integrity
- `test_complex_nested_headers_with_code` - Deep nesting
- `test_multiple_code_blocks_same_header` - Multiple blocks
- ... (5 more complex scenarios)

**embeddings.rs** (3 tests):
- `test_normalize` - Vector normalization
- `test_cosine_similarity` - Similarity computation
- `test_model_initialization_stub` - Model loading

**search.rs** (6 tests):
- `test_search_empty_db` - Empty database
- `test_bm25_score_normalization` - Normalization
- `test_f32_serialization` - Vector serialization
- `test_hybrid_weights` - Weight verification
- `test_bytes_to_f32_conversion` - Type conversion
- `test_hybrid_search_fallback` - Fallback mechanism

### Untested Components:

- `commands.rs` - Integration tests needed
- `watcher.rs` - Not tested
- `pdf_parser.rs` - Not tested
- `http_server.rs` - Not tested

---

## Data Flow Diagrams

### Index → Search Flow

```
User Document
     ↓
[Chunker.chunk()] ← Extract headers, code blocks
     ↓
ChunkInfo: {content, headers, type, language, start_line, end_line}
     ↓
[Embeddings.embed()] ← Generate 1024-dim vector
     ↓
[Database Insert]
     ├→ INSERT chunks (id, doc_id, content, metadata JSON, embedding BLOB, ...)
     ├→ TRIGGER chunks_ai → INSERT chunks_fts (FTS5 index)
     └→ TRIGGER chunks_vec_ai → INSERT chunks_vec (Vector index)
     ↓
[User Query]
     ↓
[search_hybrid()]
     ├→ [embeddings.embed(query)] → 1024-dim query vector
     ├→ [BM25 search] → FTS5 keyword candidates
     ├→ [Vector search] → sqlite-vec KNN candidates
     ├→ [Merge & rank] → hybrid_score = 0.7*vec + 0.3*bm25
     └→ SearchResult[] with metadata
```

### Incremental Update Desired Flow (TODO)

```
File System Event
     ↓
[watcher.rs] → Detect file-changed / file-removed
     ↓
[commands.rs] → index_directory() with file-specific logic
     ├→ Skip if hash matches (no changes)
     └→ Update if hash differs
          ├→ Delete old chunks
          ├→ Insert new chunks
          └→ Update embeddings (only new/modified)
     ↓
Result: Efficient incremental updates
```

---

## Build & Test Commands

```bash
# Run all tests
cd src-tauri && cargo test --lib

# Run specific module tests
cargo test --lib db::
cargo test --lib chunker::
cargo test --lib search::
cargo test --lib embeddings::

# Build for development
npm run tauri dev

# Build for production
npm run tauri build

# Check code
cargo check

# Format code
cargo fmt
```

---

## Key Files You'll Want to Understand

Priority reading order for implementation planning:

1. **search.rs** - Hybrid algorithm (70 lines of actual algorithm)
2. **chunker.rs** - Markdown parsing (120 lines of core logic)
3. **embeddings.rs** - ONNX integration (50 lines of inference)
4. **db.rs** - Schema & triggers (150 lines of DDL)
5. **commands.rs** - Indexing flow (150 lines)
6. **watcher.rs** - File watching (simple, needs integration)
7. **models.rs** - Data structures (quick read)

