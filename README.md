# DeepSeeker

**Stop talking to chatbots. Start finding your actual code.**

The first structure-aware, local-first neural search engine for your chaotic Obsidian vault and local documentation.

## 🛑 The Problem

You have 5,000+ Markdown files. You have Gigabytes of PDF research papers. But when you search for that "Python redis connection script" you wrote 6 months ago:

- **Obsidian/VSCode search fails**: Because you didn't type the exact keyword.
- **Standard "AI" tools fail**: They use naive chunking (splitting every 512 tokens). They slice your function definitions in half. They lose the context of the H2 header.
- **Cloud tools are a privacy nightmare**: You shouldn't have to upload your proprietary code or private journal to OpenAI just to search it.

## ⚡ The Solution: DeepSeeker

DeepSeeker is not a chatbot. It doesn't hallucinate answers. It is a **precision retrieval engine** running entirely on your localhost.

It uses **Hybrid Search (BM25 + Dense Vector)** combined with a proprietary **Structure-Aware Chunking** algorithm to ensure that when you search for a concept, you get the whole context, not a fragmented sentence.

## 🚀 Key Features

### 1. Structure-Aware Chunking (The Killer Feature)

Most RAG tools blindly chop text. DeepSeeker parses the AST (Abstract Syntax Tree) of your Markdown.

- **Code Integrity**: We never slice a code block in the middle.
- **Context Glue**: Every chunk carries its parent headers (H1 > H2 > H3) as metadata.

**Comparison:**
- Standard RAG: Returns lines 40-50 of a file. You have no idea what function this belongs to.
- DeepSeeker: Returns the full `def connect_db():` block, tagged with `Project A > Backend > Database Utils`.

### 2. True Hybrid Search

- **Keyword Search (BM25)**: Powered by SQLite FTS5. Finds exact matches like UUIDs, error codes, or specific variable names.
- **Semantic Search (Vector)**: Powered by BAAI/bge-m3 (SOTA open-source model). Finds concepts like "database retry logic" even if you never wrote the word "retry".
- **Weighted Ranking**: We mathematically fuse these scores to give you the best of both worlds.

### 3. 100% Local & Private

- **No Cloud**: Your data never leaves your machine.
- **No Subscriptions**: One-time purchase. Own it forever.
- **Tech Stack**: Built with Rust 🦀 and Tauri v2. Blazingly fast.

## 🛠️ Technical Stack

- **Core Logic**: Rust (Memory safety, Speed)
- **GUI**: Tauri v2 + React/TypeScript
- **Database**: SQLite with FTS5 full-text search + sqlite-vec for vector search
- **AI/ML**: BAAI/bge-m3 (Quantized ONNX) via ONNX Runtime
- **Parsing**: pulldown-cmark for AST-based Markdown processing

## 📥 Installation & Development

### Prerequisites

- **Rust** 1.70+ ([Install Rust](https://rustup.rs/))
- **Node.js** 18+ ([Install Node](https://nodejs.org/))
- **System Requirements**:
  - OS: macOS, Linux, or Windows 10/11
  - RAM: 8GB minimum (16GB recommended)
  - Disk: ~2GB space for model weights and vector indices

### Setup Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/deepseeker.git
   cd deepseeker
   ```

2. **Install frontend dependencies**:
   ```bash
   npm install
   ```

3. **Run in development mode**:
   ```bash
   npm run tauri dev
   ```

4. **Build for production**:
   ```bash
   npm run tauri build
   ```

### Usage

1. **Create a Collection**: Click "New Collection" in the sidebar
2. **Index a Directory**: Click "Index Directory" and provide the path to your Markdown files
3. **Search**: Type your query and hit Enter
4. **Results**: See structured results with full context preservation

## 🗺️ Roadmap

- [x] v1.0-MVP: Markdown support, BM25 Search, Structure-Aware Chunking
- [ ] v1.1: Vector embeddings integration (BAAI/bge-m3)
- [ ] v1.2: Hybrid search ranking (BM25 + Vector)
- [ ] v1.3: PDF text-layer support
- [ ] v1.4: "Ghost Data" management (auto-purge deleted files)
- [ ] v2.0: VSCode Extension
- [ ] v2.1: External Integrations (Notion/Readwise API)

## ⚠️ Current Limitations (MVP)

We believe in radical transparency. Here is what DeepSeeker cannot do yet:

- **No Image/OCR**: We do not index text inside images or scanned PDFs. Text-layer PDFs only.
- **No "Chat"**: We do not generate answers. We find the source. You are the intelligent agent; we are the index.
- **No Mobile App**: Desktop only.
- **Vector Search**: Not yet integrated (BM25 only in current build)

## 🧪 Testing

Run Rust tests:
```bash
cd src-tauri
cargo test
```

## 📄 License

Proprietary - All rights reserved

## 🤝 Contributing

This is currently a proprietary project. Contributions are not accepted at this time.

---

Built with ❤️ and Rust 🦀