# Awesome Rust Project

A comprehensive guide to building production-ready Rust applications.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Contributing](#contributing)

## Installation

### Prerequisites

Before you begin, ensure you have met the following requirements:

- Rust 1.70 or higher
- Cargo package manager
- SQLite 3.35+

```bash
# Check your Rust version
rustc --version

# Install dependencies
sudo apt-get install libsqlite3-dev
```

### From Source

Clone the repository and build:

```bash
git clone https://github.com/example/awesome-rust.git
cd awesome-rust
cargo build --release
```

### Using Cargo

```bash
cargo install awesome-rust
```

## Quick Start

### Basic Usage

Here's a simple example to get you started:

```rust
use awesome_rust::{Config, Engine};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::new("./data");
    let engine = Engine::init(config)?;

    engine.run()?;
    Ok(())
}
```

### Configuration

Create a `config.toml` file:

```toml
[server]
host = "127.0.0.1"
port = 8080

[database]
path = "./data/db.sqlite"
pool_size = 10
```

## Architecture

### Core Components

#### Search Engine

The search engine uses a hybrid approach combining BM25 and vector similarity:

```rust
pub fn hybrid_search(
    query: &str,
    alpha: f32,
) -> Result<Vec<SearchResult>> {
    let bm25_results = bm25_search(query)?;
    let vec_results = vector_search(embed(query))?;

    merge_results(bm25_results, vec_results, alpha)
}
```

#### Indexer

Processes documents with structure awareness:

```rust
pub struct Indexer {
    chunker: MarkdownChunker,
    embedder: EmbeddingModel,
}

impl Indexer {
    pub fn process(&self, doc: &str) -> Result<Vec<Chunk>> {
        let chunks = self.chunker.chunk(doc)?;

        for chunk in &mut chunks {
            chunk.embedding = self.embedder.embed(&chunk.content)?;
        }

        Ok(chunks)
    }
}
```

### Database Schema

```sql
CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL,
    hash TEXT NOT NULL,
    created_at INTEGER
);

CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    doc_id INTEGER,
    content TEXT,
    embedding BLOB,
    FOREIGN KEY (doc_id) REFERENCES documents(id)
);
```

## API Reference

### Core Functions

#### `init(config: Config) -> Result<Engine>`

Initialize the search engine with configuration.

**Parameters:**
- `config`: Configuration object

**Returns:**
- `Result<Engine>`: Initialized engine or error

**Example:**

```rust
let config = Config::from_file("config.toml")?;
let engine = init(config)?;
```

#### `search(query: &str, options: SearchOptions) -> Result<Vec<Result>>`

Perform a search query.

```rust
let results = engine.search(
    "rust async programming",
    SearchOptions {
        limit: 20,
        collection: Some("docs"),
    }
)?;
```

### Error Handling

Custom error types:

```rust
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid configuration: {0}")]
    Config(String),
}
```

## Performance Benchmarks

Results on AMD Ryzen 9 5900X:

```
Indexing:    1000 docs/sec
BM25 Search: <5ms (p95)
Vector Search: <15ms (p95)
Hybrid Search: <20ms (p95)
```

## Contributing

### Development Setup

```bash
# Clone the repository
git clone https://github.com/example/awesome-rust.git

# Install development dependencies
cargo install cargo-watch

# Run tests in watch mode
cargo watch -x test
```

### Code Style

Follow Rust standard formatting:

```bash
cargo fmt --all -- --check
cargo clippy -- -D warnings
```

### Running Tests

```bash
# Unit tests
cargo test

# Integration tests
cargo test --test '*'

# With coverage
cargo tarpaulin --out Html
```

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- Powered by [Tantivy](https://github.com/tantivy-search/tantivy)
- Vector search via [FAISS](https://github.com/facebookresearch/faiss)
- Built with [Tauri](https://tauri.app)
