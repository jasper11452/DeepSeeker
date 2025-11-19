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
struct ChunkInfo {
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
        .map(|(idx, info)| Chunk {
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
}
