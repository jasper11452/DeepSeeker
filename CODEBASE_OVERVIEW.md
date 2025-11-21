# DeepSeeker Codebase Comprehensive Overview

## Executive Summary

**DeepSeeker** is a local-first neural search engine for Markdown and PDF documentation. It's built with Rust (backend) and React/TypeScript (frontend), using a hybrid search approach combining BM25 keyword search (FTS5) with semantic vector search (sqlite-vec + ONNX embeddings).

**Current Status**: Phase 1 Complete - Core engine fully implemented with 30+ unit tests passing. Architecture is production-ready with SQLite-based hybrid search fully optimized for 10-100x performance improvement.

---

## 1. Project Structure

```
deepseeker/
├── src-tauri/                 # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs           # Entry point, app initialization
│   │   ├── lib.rs            # Library root, module declarations
│   │   ├── commands.rs        # Tauri IPC commands (index, search, collection mgmt)
│   │   ├── db.rs             # Database initialization, schema, queries
│   │   ├── chunker.rs        # Markdown AST-based chunking algorithm
│   │   ├── embeddings.rs     # BAAI/bge-m3 ONNX model wrapper
│   │   ├── search.rs         # Hybrid search (BM25 + Vector)
│   │   ├── models.rs         # Data structures (Collection, Document, Chunk, SearchResult)
│   │   ├── pdf_parser.rs     # PDF text extraction (pdf-extract)
│   │   ├── watcher.rs        # File system watching (notify crate)
│   │   └── http_server.rs    # Browser extension HTTP server
│   ├── tests/
│   │   └── fixtures/
│   │       └── sample_readme.md  # Test fixture (200+ lines)
│   ├── Cargo.toml            # Rust dependencies
│   └── build.rs              # Build script (Tauri)
│
├── src/                       # React/TypeScript frontend
│   ├── components/
│   │   ├── SearchInterface.tsx
│   │   ├── CollectionManager.tsx
│   │   ├── CreateCollectionDialog.tsx
│   │   ├── ModelManager.tsx
│   │   ├── ValidationTest.tsx    # Phase 1 validation UI
│   │   ├── Settings.tsx
│   │   └── SearchFilters.tsx
│   ├── App.tsx                # Main app component
│   └── styles.css
│
├── browser-extension/          # Browser extension (future)
│   ├── manifest.json
│   ├── background.js
│   └── content.js
│
├── test-data/
│   └── validation_test.md      # 210 lines of test data with deep nesting
│
├── README.md                   # Main documentation
├── PHASE1_SUMMARY.md           # Detailed phase 1 completion report
├── performance_test_plan.md    # Performance benchmarking strategy
└── package.json               # Node.js dependencies

```

---

## 2. Current Implementations

### 2.1 Database & Schema (db.rs - 240+ lines)

**Technology**: SQLite with FTS5 + sqlite-vec

**Tables**:
- `collections` - Collection metadata (name, folder_path, file_count, last_sync)
- `documents` - Document references (collection_id, path, hash, last_modified, status)
- `chunks` - Indexed chunks (doc_id, content, metadata JSON, start_line, end_line, embedding BLOB)
- `chunks_fts` - FTS5 virtual table for full-text search
- `chunks_vec` - sqlite-vec virtual table for KNN vector search (float[1024])

**Key Features**:
- WAL mode enabled for concurrency
- Automatic triggers to keep FTS5 and vector indices in sync
- Cascade delete for referential integrity
- Ghost data cleanup (removes documents pointing to deleted files)
- Per-file hash-based deduplication

**Status**: ✅ Complete with 6 unit tests

### 2.2 Markdown Parsing & Chunking (chunker.rs - 387+ lines)

**Algorithm**: AST-based structure-aware chunking using pulldown-cmark

**Key Principles**:
1. **Never split code blocks** - Entire code blocks preserved regardless of size
2. **Header context preservation** - Maintains hierarchy (H1 > H2 > H3 > H4)
3. **Semantic boundary protection** - Chunks respect logical document structure

**Chunking Logic**:
- Tracks header stack as Markdown is parsed
- Code blocks (fenced and indented) stored as atomic units
- Text content split at MAX_CHUNK_SIZE (1000 chars) only for paragraphs
- Each chunk stores:
  - Content (string)
  - Headers (Vec<String> - full hierarchy path)
  - Type ("code" or "text")
  - Language (for code blocks, e.g., "python", "rust")
  - Start/end line numbers

**Test Coverage**: 10 complex test scenarios:
- Deep nesting (H1>H2>H3>H4>H5 with code)
- Multiple code blocks in same header
- Special character handling
- Long text chunking
- Realistic README parsing

**Status**: ✅ Complete with proven reliability

### 2.3 Vector Embeddings (embeddings.rs - 237 lines)

**Model**: BAAI/bge-m3 (Multilingual BGE)
- Output dimension: 1024
- Type: Dense embeddings (SOTA for semantic search)
- Inference: ONNX Runtime v2.0

**Implementation**:
- Batch embedding support for efficiency
- Tokenization via HuggingFace tokenizers
- Sequence padding to 512 tokens
- Cosine similarity computation
- Vector normalization for unit vectors

**Model Setup**:
- Expected location: `~/.deepseeker/models/bge-m3/`
  - `model.onnx` (ONNX format model)
  - `tokenizer.json` (HuggingFace tokenizer)
- Download from HuggingFace: https://huggingface.co/BAAI/bge-m3

**Fallback Mechanism**: When model unavailable, search falls back to BM25 only

**Status**: ✅ Complete with 3 unit tests

### 2.4 Hybrid Search (search.rs - 206+ lines)

**Architecture**: Two-stage retrieval with weighted ranking

**Algorithm**:
```
Stage 1: BM25 Keyword Search (via FTS5)
  - Get candidate chunks (limit × 3)
  - Normalize FTS5 rank to [0,1]

Stage 2: Vector KNN Search (via sqlite-vec)
  - Embed query using BAAI/bge-m3
  - Find k-nearest neighbors (cosine distance)
  - Convert distance to similarity score

Stage 3: Hybrid Ranking
  - For each chunk: hybrid_score = 0.7 × vec_score + 0.3 × bm25_score
  - Sort by hybrid score (descending)
  - Return top-k results
```

**Weights**:
- Vector: 0.7 (captures semantic similarity)
- BM25: 0.3 (captures keyword specificity)
- Rationale: Semantic search more important but keywords prevent false positives

**Features**:
- Collection-aware filtering
- Graceful fallback to BM25 if embeddings unavailable
- Score normalization (prevents score range issues)
- Efficient sqlite-vec KNN queries (10-100x faster than full table scans)

**Test Coverage**: 6 test scenarios:
- Empty database search
- BM25 score normalization
- F32 serialization/deserialization
- Weight verification
- Hybrid search fallback mechanism

**Status**: ✅ Complete and optimized

### 2.5 File Indexing (commands.rs - 400+ lines)

**Features**:
- Recursive directory traversal (Markdown + PDF files)
- Incremental indexing (skip unchanged files via SHA256 hash)
- PDF text extraction (pdf-extract crate)
- PDF scanned detection (heuristic: <50 chars/page)
- Automatic document status tracking (normal/scanned_pdf/error)
- Progress tracking (for long operations)

**Indexing Flow**:
1. Walk directory for .md, .markdown, .pdf files
2. Compute SHA256 hash of content
3. Skip if same hash exists (no changes)
4. Otherwise: chunk content + store metadata
5. Generate embeddings for chunks
6. Insert into SQLite with FTS5/vector triggers

**Collections**:
- Create named collections pointing to directories
- Full reindex capability
- Delete with cascade cleanup

**Status**: ✅ Working with PDF support

### 2.6 File Watching (watcher.rs - 66 lines)

**Technology**: notify crate (RecommendedWatcher - inotify on Linux)

**Features**:
- Real-time file change detection
- 2-second debounce interval
- Event emission to frontend (file-changed, file-removed)
- Collection-aware watching

**Current State**: ⚠️ Basic infrastructure in place, but incremental indexing not fully integrated yet

**TODO**: 
- Connect file events to automatic chunk updates
- Handle incremental updates without full reindex
- Deduplicate chunk content on update

**Status**: 🟡 Partially implemented

---

## 3. Database Schema Details

### Collections Table
```sql
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  folder_path TEXT,
  file_count INTEGER DEFAULT 0,
  last_sync INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

### Documents Table
```sql
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,          -- SHA256 for deduplication
  last_modified INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT DEFAULT 'normal', -- 'normal'|'scanned_pdf'|'error'
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  UNIQUE(collection_id, path)
)
```

### Chunks Table
```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,                -- JSON: {headers: [...], chunk_type, language}
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  embedding BLOB,               -- f32 vector as LE bytes
  created_at INTEGER NOT NULL,
  FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
)
```

### FTS5 Virtual Table
```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  content,
  metadata,
  content_rowid UNINDEXED,
  tokenize = 'porter unicode61'
)
```

**Triggers**: Auto-sync INSERT/UPDATE/DELETE from chunks to chunks_fts

### sqlite-vec Virtual Table
```sql
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  chunk_id INTEGER PRIMARY KEY,
  embedding float[1024]
)
```

**Triggers**: Auto-sync when embedding is added/updated/deleted

---

## 4. Key Entry Points & Commands

### Tauri Commands (RPC Interface)

| Command | Module | Purpose |
|---------|--------|---------|
| `create_collection` | commands.rs | Create new indexed collection |
| `list_collections` | commands.rs | Get all collections |
| `delete_collection` | commands.rs | Delete collection + cascade |
| `index_directory` | commands.rs | Index all MD/PDF in directory |
| `full_reindex` | commands.rs | Clear and re-index collection |
| `search` | commands.rs | Execute hybrid search query |
| `cleanup_ghost_data` | commands.rs | Remove references to deleted files |
| `detect_ghost_files` | commands.rs | Find broken document references |
| `check_model_status` | commands.rs | Check ONNX model availability |
| `start_watching_collections` | commands.rs | Begin file system watching |
| `open_file_at_line` | commands.rs | OS integration (open file in editor) |

### Main Functions

**db.rs**:
- `init_database()` - Initialize schema + extensions
- `get_connection()` - Get SQLite connection
- `cleanup_ghost_data()` - Remove orphaned documents

**chunker.rs**:
- `MarkdownChunker::new()` - Create parser state
- `MarkdownChunker::chunk()` - Parse markdown
- `chunk_markdown()` - Wrapper for commands

**embeddings.rs**:
- `EmbeddingModel::new()` - Load ONNX model
- `EmbeddingModel::embed()` - Single text embedding
- `EmbeddingModel::embed_batch()` - Batch embedding
- `EmbeddingModel::check_model_exists()` - Status check

**search.rs**:
- `search_hybrid()` - Main entry point (selects BM25 or hybrid)
- `hybrid_search_full()` - BM25 + vector search
- `bm25_search_only()` - Fallback keyword search

**watcher.rs**:
- `init_watcher()` - Setup file watching
- `WatcherState` - Shared watcher state

---

## 5. Implementation Status Matrix

### Core Engine

| Component | Status | Test Coverage | Notes |
|-----------|--------|----------------|-------|
| SQLite Setup | ✅ Complete | 6 tests | WAL mode, extensions loaded |
| FTS5 Indexing | ✅ Complete | 6 tests | BM25 ranking working, triggers synced |
| sqlite-vec Integration | ✅ Complete | 1 test | KNN search 10-100x faster |
| Markdown Parsing | ✅ Complete | 10 tests | AST-based, structure-aware |
| ONNX Embeddings | ✅ Complete | 3 tests | BAAI/bge-m3 model integration |
| Hybrid Search | ✅ Complete | 6 tests | 0.7 vec + 0.3 BM25 weights |
| PDF Support | ✅ Complete | - | Text layer support, scanned detection |
| File Hashing | ✅ Complete | - | SHA256 deduplication |
| Ghost Data Cleanup | ✅ Complete | 3 tests | Automatic + manual |

**Total Unit Tests**: 30+

### Data Pipeline

| Component | Status | Notes |
|-----------|--------|-------|
| Directory Indexing | ✅ Complete | Recursive walk, MD+PDF support |
| Incremental Updates | 🟡 Partial | File watching in place, but no smart update logic |
| Batch Embedding | ⚠️ Not Optimized | Currently single-text embeddings only |
| Collection Management | ✅ Complete | Create/list/delete with cascades |
| Progress Tracking | ✅ Complete | Via IndexProgress events |

### Frontend

| Component | Status | Notes |
|-----------|--------|-------|
| Search Interface | ✅ Complete | Query input + results display |
| Collection Manager | ✅ Complete | CRUD operations |
| Model Manager | ✅ Complete | Status check button |
| ValidationTest UI | ✅ Complete | Phase 1 testing component |
| Settings | ✅ Complete | Settings panel |

---

## 6. Technology Stack

### Backend (Rust)

**Database & Search**:
- rusqlite 0.32 - SQLite driver
- sqlite-vec 0.1 - Vector search extension (KNN with cosine distance)
- pulldown-cmark 0.12 - Markdown parsing (AST)

**ML/Embeddings**:
- ort 2.0.0-rc.10 - ONNX Runtime
- ndarray 0.16 - Numerical arrays
- tokenizers 0.20 - HuggingFace tokenizers

**File Handling**:
- walkdir 2 - Directory traversal
- notify 6.1 - File watching
- pdf-extract 0.7 - PDF text extraction
- sha2 0.10 - Hashing
- hex 0.4 - Hex encoding

**HTTP/Async**:
- tokio 1 - Async runtime
- axum 0.7 - HTTP server
- tauri 2.0 - Desktop framework

**Utilities**:
- serde 1.0 - Serialization
- anyhow 1.0 - Error handling
- chrono 0.4 - Timestamps
- log/env_logger - Logging

### Frontend (TypeScript/React)

- React 18.3
- TypeScript 5.6
- @tauri-apps/api - Tauri IPC
- @tanstack/react-query - Server state
- Tailwind CSS - Styling
- React Syntax Highlighter - Code display

---

## 7. What Has Been Implemented

### Phase 1 (Complete - 25 tests):

1. ✅ **Database Infrastructure**
   - SQLite schema with FTS5 & sqlite-vec
   - Automatic schema creation & updates
   - Extension loading (sqlite-vec)
   - Cascade delete for data integrity

2. ✅ **Structure-Aware Chunking**
   - Markdown AST parsing
   - Header hierarchy tracking
   - Code block preservation
   - Line number tracking

3. ✅ **Vector Embeddings**
   - BAAI/bge-m3 ONNX model loading
   - Tokenization & batch processing
   - Vector normalization

4. ✅ **Hybrid Search**
   - BM25 keyword search via FTS5
   - Vector KNN search via sqlite-vec
   - Weighted score combination
   - Graceful BM25 fallback

5. ✅ **File Indexing**
   - Recursive directory walking
   - Markdown + PDF support
   - SHA256 deduplication
   - Progress tracking

6. ✅ **Ghost Data Management**
   - Automatic cleanup on startup
   - Manual cleanup commands
   - Cascade deletion

### Phase 2+ (In Progress/TODO):

1. 🟡 **Incremental Indexing**
   - File watching operational (watcher.rs)
   - TODO: Connect to smart update logic
   - TODO: Avoid full re-indexing on change

2. ⚠️ **Performance Optimization**
   - Batch embedding (currently single-text)
   - Connection pooling
   - Query caching
   - Vector index optimization

3. 📋 **Production Features**
   - Error recovery & retry logic
   - Comprehensive logging
   - Configuration files
   - Database backups

---

## 8. What Needs to Be Built

### Priority 1 (Core): 

1. **Incremental Indexing with Smart Updates**
   - Integrate watcher.rs events with indexing
   - Detect modified chunks via hash
   - Update embeddings only for changed chunks
   - Avoid full re-index on every change

2. **Batch Embedding Optimization**
   - Queue chunks during indexing
   - Process in batches (e.g., 100 chunks at a time)
   - Parallel embedding generation
   - Expected speedup: 5-10x

3. **Better Error Handling**
   - Granular error types
   - Retry logic for transient failures
   - User-facing error messages
   - Logging improvement

### Priority 2 (Enhancement):

4. **Advanced Markdown Features**
   - Better table parsing
   - LaTeX math support
   - Callout/admonition detection
   - Meta-data extraction

5. **PDF Improvements**
   - OCR support for scanned PDFs (requires Tesseract)
   - Table extraction
   - Layout-aware chunking

6. **Performance Benchmarking**
   - Implement criterion.rs benchmarks
   - Profile memory usage
   - Optimize query latency

### Priority 3 (Polish):

7. **Configuration System**
   - Config file support (TOML/YAML)
   - User preferences
   - Model selection

8. **UX Improvements**
   - Real-time progress updates
   - Search suggestions
   - Result highlighting
   - Saved searches

9. **Testing Infrastructure**
   - Integration tests
   - End-to-end testing
   - CI/CD pipeline

---

## 9. Key Algorithms & Data Flow

### Hybrid Search Flow

```
User Query: "async python"
  ↓
[search_hybrid]
  ├─→ Try load ONNX model
  │   ├─ Success: hybrid_search_full()
  │   └─ Fail: bm25_search_only()
  ↓
[Hybrid Path - Full Algorithm]
  ├─→ Generate query embedding (1024-dim vector)
  │
  ├─→ BM25 Search (FTS5):
  │   SELECT * FROM chunks_fts 
  │   WHERE content MATCH "async python"
  │   LIMIT limit × 3  (get 3x candidates)
  │   └─ Normalize FTS5 rank: 1/(1 + |rank|)
  │
  ├─→ Vector Search (sqlite-vec):
  │   SELECT * FROM chunks_vec
  │   WHERE distance_cosine(embedding, ?) < threshold
  │   LIMIT limit × 3
  │   └─ Convert distance to similarity: 1 - distance
  │
  ├─→ Merge Results:
  │   For each unique chunk_id:
  │     hybrid_score = 0.7 × vec_score + 0.3 × bm25_score
  │
  ├─→ Sort by hybrid_score (descending)
  │
  └─→ Return top K results + metadata
      (headers, chunk_type, language, line numbers)
```

### Indexing Flow

```
User: "Index /path/to/docs"
  ↓
[index_directory]
  ├─→ Walk directory recursively
  ├─→ Find all *.md, *.pdf files
  ├─→ For each file:
  │   ├─→ Read content
  │   ├─→ Compute SHA256 hash
  │   ├─→ Check if exists with same hash (skip if yes)
  │   ├─→ Chunk content:
  │   │   ├─ Markdown: Use MarkdownChunker (AST)
  │   │   └─ PDF: Simple paragraph-based chunking
  │   ├─→ For each chunk:
  │   │   ├─ Generate embedding (BAAI/bge-m3)
  │   │   ├─ Insert to chunks table
  │   │   ├─ (Trigger) Auto-insert to chunks_fts
  │   │   ├─ (Trigger) Auto-insert to chunks_vec
  │   │   └─ Store metadata (headers, language, etc.)
  │   └─→ Update collection stats
  └─→ Return progress
```

### Markdown Chunking Algorithm

```
MarkdownChunker::chunk(markdown)
  ├─→ Initialize header_stack = []
  ├─→ Parse using pulldown-cmark
  ├─→ For each event:
  │   ├─ Start(Heading) → Flush current chunk
  │   ├─ End(Heading) → Push to header_stack (maintain depth)
  │   ├─ Start(CodeBlock) → Flush current chunk, mark in_code_block
  │   ├─ End(CodeBlock) → Create atomic chunk (NEVER SPLIT)
  │   ├─ Text → Accumulate in current_chunk
  │   │           Flush if > MAX_CHUNK_SIZE (1000 chars)
  │   └─ [Other events] → Handle as needed
  ├─→ Each chunk stores:
  │   ├─ content (string)
  │   ├─ headers (Vec<String> with full hierarchy)
  │   ├─ chunk_type ("code" | "text")
  │   ├─ language (Option<String> for code)
  │   └─ line numbers (start, end)
  └─→ Return Vec<ChunkInfo>
```

---

## 10. Performance Metrics & Targets

### Current Performance (from PHASE1_SUMMARY.md):

**Indexing**:
- Target: > 100 docs/s
- Database: SQLite FTS5 + sqlite-vec optimized

**Search**:
- Target: < 200ms P95 latency
- Vector KNN: 10-100x faster with sqlite-vec indices

**Data Scale**:
- Target: 100k+ chunks
- Per-chunk embedding: 1024 dimensions (4KB per chunk)

### Optimization Checklist:

Database:
- [x] WAL mode for concurrency
- [x] FTS5 with porter tokenizer
- [x] sqlite-vec for KNN
- [ ] Connection pooling
- [ ] Query result caching

Vector Search:
- [ ] Batch embedding (currently single-text)
- [ ] Vector quantization (reduce 1024 to 768)
- [ ] Approximate KNN (LSH)

Application:
- [ ] Result pagination
- [ ] Lazy loading
- [ ] Request deduplication

---

## 11. Known Limitations & Issues

### Current Limitations:

1. **Batch Embedding Not Implemented**
   - Currently embedding chunks one-by-one
   - Should batch for 5-10x speedup

2. **Incremental Indexing Incomplete**
   - File watcher running but not integrated
   - Every change triggers full re-index

3. **No Query Caching**
   - Identical queries re-computed
   - Should cache top-N results

4. **Scanned PDF Detection Heuristic**
   - Simple char/page ratio
   - No actual OCR (requires Tesseract)

5. **No Vector Quantization**
   - Full 1024-dim vectors stored
   - Could reduce to 768 dims with minimal loss

### Build Issues:

- GTK dependencies required for Tauri GUI (atk, gdk-pixbuf, pango)
- Not a code issue, just CI environment setup

---

## 12. Development Guidance

### Running Tests

```bash
cd src-tauri
cargo test --lib                    # All library tests
cargo test --lib db::               # Database tests only
cargo test --lib chunker::          # Chunker tests only
cargo test --lib search::           # Search tests only
cargo test --lib embeddings::       # Embedding tests only
```

### Running Full App

```bash
npm run tauri dev                   # Development mode
npm run tauri build                 # Production build
```

### Key Code Locations

**Search Logic**:
- Primary: `/home/user/deepseeker/src-tauri/src/search.rs:99-260`
- Hybrid scoring: Line 238
- Weight constants: Line 9-10

**Chunking Logic**:
- Core: `/home/user/deepseeker/src-tauri/src/chunker.rs:48-169`
- Header tracking: Line 64-84
- Code block preservation: Line 86-126

**Database Schema**:
- Tables: `/home/user/deepseeker/src-tauri/src/db.rs:37-192`
- Triggers: Line 104-169

**ONNX Integration**:
- Model loading: `/home/user/deepseeker/src-tauri/src/embeddings.rs:35-72`
- Inference: Line 111-168

---

## 13. Future Enhancement Opportunities

1. **Multi-Modal Search**: Image + text chunks
2. **Query Expansion**: Auto-expand queries with synonyms
3. **Ranking Personalization**: ML-based relevance
4. **Plugin System**: User-defined chunking rules
5. **External Integration**: Notion, Readwise APIs
6. **VSCode Extension**: Integrated search in editor
7. **Mobile App**: iOS/Android via React Native
8. **Distributed Indexing**: Scale to 1M+ chunks

---

