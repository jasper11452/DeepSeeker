use crate::models::{Chunk, ChunkMetadata};
use anyhow::Result;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

const MAX_CHUNK_SIZE: usize = 1000; // characters
const MIN_CHUNK_SIZE: usize = 100;

/// Structure-aware Markdown chunker
///
/// Key principles:
/// 1. Never split code blocks
/// 2. Maintain header context (H1 > H2 > H3 hierarchy)
/// 3. Preserve semantic boundaries
pub struct MarkdownChunker {
    /// Current header stack: ["H1", "H2", "H3"]
    header_stack: Vec<String>,
    /// Current chunk being built
    current_chunk: String,
    /// Line tracking
    current_line: usize,
    chunk_start_line: usize,
    /// Output chunks
    chunks: Vec<ChunkInfo>,
}

#[derive(Debug, Clone)]
pub struct ChunkInfo {
    pub content: String,
    pub headers: Vec<String>,
    pub chunk_type: String,
    pub language: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
}

impl MarkdownChunker {
    pub fn new() -> Self {
        Self {
            header_stack: Vec::new(),
            current_chunk: String::new(),
            current_line: 1,
            chunk_start_line: 1,
            chunks: Vec::new(),
        }
    }

    /// Chunk a Markdown document into structure-aware pieces
    pub fn chunk(&mut self, markdown: &str) -> Result<Vec<ChunkInfo>> {
        let mut options = Options::empty();
        options.insert(Options::ENABLE_TABLES);
        options.insert(Options::ENABLE_FOOTNOTES);
        options.insert(Options::ENABLE_STRIKETHROUGH);
        options.insert(Options::ENABLE_TASKLISTS);

        let parser = Parser::new_ext(markdown, options);

        let mut in_code_block = false;
        let mut code_block_content = String::new();
        let mut code_block_lang: Option<String> = None;
        let mut code_block_start_line = 0;

        for event in parser {
            match event {
                Event::Start(Tag::Heading { level, .. }) => {
                    // Flush current chunk before starting new header
                    self.flush_chunk("text");

                    // Update header stack
                    let depth = level as usize;
                    self.header_stack.truncate(depth - 1);
                }

                Event::End(TagEnd::Heading(level)) => {
                    // The current_chunk now contains the header text
                    let header_text = self.current_chunk.trim().to_string();

                    let depth = level as usize;
                    if self.header_stack.len() >= depth {
                        self.header_stack.truncate(depth - 1);
                    }
                    self.header_stack.push(header_text);

                    self.current_chunk.clear();
                }

                Event::Start(Tag::CodeBlock(kind)) => {
                    // Flush any pending text chunk
                    self.flush_chunk("text");

                    in_code_block = true;
                    code_block_start_line = self.current_line;
                    code_block_content.clear();

                    // Extract language
                    code_block_lang = match kind {
                        pulldown_cmark::CodeBlockKind::Fenced(lang) => {
                            if lang.is_empty() {
                                None
                            } else {
                                Some(lang.to_string())
                            }
                        }
                        pulldown_cmark::CodeBlockKind::Indented => None,
                    };
                }

                Event::End(TagEnd::CodeBlock) => {
                    // Code blocks are NEVER split - this is critical!
                    let chunk = ChunkInfo {
                        content: code_block_content.trim().to_string(),
                        headers: self.header_stack.clone(),
                        chunk_type: "code".to_string(),
                        language: code_block_lang.clone(),
                        start_line: code_block_start_line,
                        end_line: self.current_line,
                    };

                    if !chunk.content.is_empty() {
                        self.chunks.push(chunk);
                    }

                    in_code_block = false;
                    code_block_content.clear();
                    code_block_lang = None;
                    self.chunk_start_line = self.current_line + 1;
                }

                Event::Text(text) => {
                    if in_code_block {
                        code_block_content.push_str(&text);
                    } else {
                        self.current_chunk.push_str(&text);

                        // Check if we should flush (size-based chunking for text)
                        if self.current_chunk.len() > MAX_CHUNK_SIZE {
                            self.flush_chunk("text");
                        }
                    }

                    // Track lines
                    self.current_line += text.matches('\n').count();
                }

                Event::SoftBreak | Event::HardBreak => {
                    if in_code_block {
                        code_block_content.push('\n');
                    } else {
                        self.current_chunk.push('\n');
                    }
                    self.current_line += 1;
                }

                Event::Code(code) => {
                    self.current_chunk.push('`');
                    self.current_chunk.push_str(&code);
                    self.current_chunk.push('`');
                }

                _ => {
                    // Handle other events as needed
                }
            }
        }

        // Flush any remaining content
        self.flush_chunk("text");

        Ok(self.chunks.clone())
    }

    /// Flush the current chunk if it meets minimum size requirements
    fn flush_chunk(&mut self, chunk_type: &str) {
        let content = self.current_chunk.trim();

        if content.len() >= MIN_CHUNK_SIZE {
            let chunk = ChunkInfo {
                content: content.to_string(),
                headers: self.header_stack.clone(),
                chunk_type: chunk_type.to_string(),
                language: None,
                start_line: self.chunk_start_line,
                end_line: self.current_line,
            };

            self.chunks.push(chunk);
        }

        self.current_chunk.clear();
        self.chunk_start_line = self.current_line;
    }
}

/// Convert ChunkInfo to Chunk model (without embedding and IDs)
pub fn chunk_markdown(doc_id: i64, markdown: &str) -> Result<Vec<Chunk>> {
    let mut chunker = MarkdownChunker::new();
    let chunk_infos = chunker.chunk(markdown)?;

    let chunks: Vec<Chunk> = chunk_infos
        .into_iter()
        .enumerate()
        .map(|(_idx, info)| Chunk {
            id: 0, // Will be set by database
            doc_id,
            content: info.content,
            metadata: Some(ChunkMetadata {
                headers: info.headers,
                chunk_type: info.chunk_type,
                language: info.language,
            }),
            start_line: info.start_line,
            end_line: info.end_line,
            created_at: chrono::Utc::now().timestamp(),
        })
        .collect();

    Ok(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_chunking() {
        let markdown = r#"
# Main Title

This is some introductory text that should be chunked.

## Section 1

Some content under section 1.

```python
def hello():
    print("This code block should NEVER be split")
    print("Even if it's very long")
    return "complete"
```

More text after the code block.

### Subsection 1.1

Nested content here.
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        // Should have multiple chunks
        assert!(chunks.len() > 0);

        // Find the code block chunk
        let code_chunk = chunks.iter().find(|c| c.chunk_type == "code");
        assert!(code_chunk.is_some());

        let code_chunk = code_chunk.unwrap();
        assert_eq!(code_chunk.language, Some("python".to_string()));
        assert!(code_chunk.content.contains("def hello()"));
        assert!(code_chunk.content.contains("return \"complete\""));

        // Code chunk should have proper header context
        assert!(code_chunk.headers.contains(&"Main Title".to_string()));
        assert!(code_chunk.headers.contains(&"Section 1".to_string()));
    }

    #[test]
    fn test_header_hierarchy() {
        let markdown = r#"
# H1

Content under H1.

## H2

Content under H2.

### H3

Content under H3.

## Another H2

This should reset H3 context.
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        // Check that headers are properly maintained
        for chunk in chunks {
            println!("Headers: {:?}, Content: {}", chunk.headers, chunk.content);
        }
    }

    #[test]
    fn test_no_code_block_splitting() {
        let long_code = format!(
            "```rust\n{}\n```",
            "println!(\"line\");\n".repeat(100)
        );

        let markdown = format!("# Title\n\n{}", long_code);

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(&markdown).unwrap();

        // Should have exactly 1 code chunk (never split)
        let code_chunks: Vec<_> = chunks.iter().filter(|c| c.chunk_type == "code").collect();
        assert_eq!(code_chunks.len(), 1);
        assert!(code_chunks[0].content.len() > 1000); // Very long but intact
    }

    // Test Case 1: Complex nested headers with code blocks
    #[test]
    fn test_complex_nested_headers_with_code() {
        let markdown = r#"
# DeepSeeker - AI Search Engine

A local-first neural search engine for your documentation.

## Installation

### Prerequisites

Before installing, ensure you have:

```bash
node --version  # v18+
cargo --version # 1.70+
```

### Build from source

Clone and install:

```bash
git clone https://github.com/user/deepseeker
cd deepseeker
cargo build --release
```

## Architecture

### Core Components

#### Search Engine

The search engine uses hybrid retrieval:

```python
def hybrid_search(query, alpha=0.7):
    bm25_score = fts5_search(query)
    vec_score = vector_search(embed(query))
    return alpha * vec_score + (1 - alpha) * bm25_score
```

#### Indexer

Processes markdown with structure awareness.

### Database Schema

```sql
CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    content TEXT,
    embedding BLOB
);
```
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        // Find the Python code chunk
        let python_chunk = chunks.iter().find(|c|
            c.chunk_type == "code" && c.language == Some("python".to_string())
        );
        assert!(python_chunk.is_some());

        let python_chunk = python_chunk.unwrap();
        // Should preserve full header hierarchy
        assert!(python_chunk.headers.contains(&"DeepSeeker - AI Search Engine".to_string()));
        assert!(python_chunk.headers.contains(&"Architecture".to_string()));
        assert!(python_chunk.headers.contains(&"Core Components".to_string()));
        assert!(python_chunk.headers.contains(&"Search Engine".to_string()));

        // Code should be intact
        assert!(python_chunk.content.contains("def hybrid_search"));
        assert!(python_chunk.content.contains("return alpha"));
    }

    // Test Case 2: Multiple code blocks under same header
    #[test]
    fn test_multiple_code_blocks_same_header() {
        let markdown = r#"
# API Documentation

## Authentication

### JWT Token

Generate token:

```javascript
const token = jwt.sign({ userId: 123 }, SECRET_KEY);
```

Verify token:

```javascript
const decoded = jwt.verify(token, SECRET_KEY);
```

Usage in requests:

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com
```
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        let code_chunks: Vec<_> = chunks.iter().filter(|c| c.chunk_type == "code").collect();
        assert_eq!(code_chunks.len(), 3);

        // All should have same header context
        for chunk in &code_chunks {
            assert!(chunk.headers.contains(&"API Documentation".to_string()));
            assert!(chunk.headers.contains(&"Authentication".to_string()));
            assert!(chunk.headers.contains(&"JWT Token".to_string()));
        }
    }

    // Test Case 3: Deeply nested structure (H1 > H2 > H3 > H4)
    #[test]
    fn test_deep_nesting() {
        let markdown = r#"
# Project

## Module A

### Component X

#### Subcomponent Alpha

This is deeply nested content.

```rust
fn deeply_nested() {
    println!("Found me!");
}
```

## Module B

Content under Module B should not have Module A context.
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        // Find code chunk
        let code_chunk = chunks.iter().find(|c| c.chunk_type == "code");
        assert!(code_chunk.is_some());

        let code_chunk = code_chunk.unwrap();
        assert_eq!(code_chunk.headers.len(), 4);
        assert_eq!(code_chunk.headers[0], "Project");
        assert_eq!(code_chunk.headers[1], "Module A");
        assert_eq!(code_chunk.headers[2], "Component X");
        assert_eq!(code_chunk.headers[3], "Subcomponent Alpha");

        // Module B content should reset context
        let module_b_chunks: Vec<_> = chunks.iter()
            .filter(|c| c.headers.last() == Some(&"Module B".to_string()))
            .collect();

        for chunk in &module_b_chunks {
            assert!(!chunk.headers.contains(&"Module A".to_string()));
            assert!(!chunk.headers.contains(&"Component X".to_string()));
        }
    }

    // Test Case 4: Code block with special characters
    #[test]
    fn test_code_block_special_chars() {
        let markdown = r#"
# Regex Examples

## Pattern Matching

```regex
^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$
```

Special characters should be preserved.
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        let code_chunk = chunks.iter().find(|c| c.chunk_type == "code");
        assert!(code_chunk.is_some());

        let code_chunk = code_chunk.unwrap();
        assert!(code_chunk.content.contains("[a-zA-Z0-9._%+-]+"));
        assert!(code_chunk.content.contains("\\.[a-zA-Z]{2,}$"));
    }

    // Test Case 5: Mixed content types
    #[test]
    fn test_mixed_content_types() {
        let markdown = r#"
# Tutorial

## Step 1: Setup

Install dependencies:

```bash
npm install
```

## Step 2: Configuration

Edit your `config.json`:

```json
{
  "port": 3000,
  "host": "localhost"
}
```

Some inline `code snippet` here.

## Step 3: Run

Execute the server:

```bash
npm start
```
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        // Should have 3 code blocks
        let code_chunks: Vec<_> = chunks.iter().filter(|c| c.chunk_type == "code").collect();
        assert_eq!(code_chunks.len(), 3);

        // Verify languages
        assert_eq!(code_chunks[0].language, Some("bash".to_string()));
        assert_eq!(code_chunks[1].language, Some("json".to_string()));
        assert_eq!(code_chunks[2].language, Some("bash".to_string()));

        // Inline code should be in text chunks, not separate code chunks
        let text_chunks: Vec<_> = chunks.iter().filter(|c| c.chunk_type == "text").collect();
        let has_inline_code = text_chunks.iter().any(|c| c.content.contains("`code snippet`"));
        assert!(has_inline_code);
    }

    // Test Case 6: Empty code blocks
    #[test]
    fn test_empty_code_blocks() {
        let markdown = r#"
# Test

```python
```

Content after empty block.
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        // Empty code blocks should not create chunks
        let code_chunks: Vec<_> = chunks.iter().filter(|c| c.chunk_type == "code").collect();
        assert_eq!(code_chunks.len(), 0);
    }

    // Test Case 7: Very long text with headers
    #[test]
    fn test_long_text_chunking() {
        let long_paragraph = "Lorem ipsum dolor sit amet. ".repeat(100); // ~2800 chars
        let markdown = format!(r#"
# Long Article

## Introduction

{}

## Conclusion

Short ending.
"#, long_paragraph);

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(&markdown).unwrap();

        // Long text should be split into multiple chunks
        let intro_chunks: Vec<_> = chunks.iter()
            .filter(|c| c.headers.contains(&"Introduction".to_string()))
            .collect();

        assert!(intro_chunks.len() >= 2); // Should split long text
    }

    // Test Case 8: Indented code blocks
    #[test]
    fn test_indented_code_blocks() {
        let markdown = r#"
# Example

Regular text.

    indented code block
    line 2
    line 3

More text.
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        let code_chunks: Vec<_> = chunks.iter().filter(|c| c.chunk_type == "code").collect();
        assert_eq!(code_chunks.len(), 1);

        // Indented blocks have no language
        assert_eq!(code_chunks[0].language, None);
        assert!(code_chunks[0].content.contains("indented code block"));
    }

    // Test Case 9: Real-world README structure
    #[test]
    fn test_realistic_readme() {
        let markdown = include_str!("../tests/fixtures/sample_readme.md");

        let mut chunker = MarkdownChunker::new();
        let result = chunker.chunk(markdown);

        // Should not panic on real README
        assert!(result.is_ok());
        let chunks = result.unwrap();
        assert!(chunks.len() > 0);

        // Should have some code chunks
        let code_count = chunks.iter().filter(|c| c.chunk_type == "code").count();
        assert!(code_count > 0);
    }

    // Test Case 10: Header context reset
    #[test]
    fn test_header_context_reset() {
        let markdown = r#"
# Main

## Section A

### Subsection A1

Content A1.

```python
# Code under A1
print("A1")
```

## Section B

### Subsection B1

Content B1.

```python
# Code under B1
print("B1")
```
"#;

        let mut chunker = MarkdownChunker::new();
        let chunks = chunker.chunk(markdown).unwrap();

        let code_chunks: Vec<_> = chunks.iter().filter(|c| c.chunk_type == "code").collect();
        assert_eq!(code_chunks.len(), 2);

        // First code block
        assert_eq!(code_chunks[0].headers, vec!["Main", "Section A", "Subsection A1"]);

        // Second code block (context should reset at Section B)
        assert_eq!(code_chunks[1].headers, vec!["Main", "Section B", "Subsection B1"]);
        assert!(!code_chunks[1].headers.contains(&"Section A".to_string()));
    }
}
