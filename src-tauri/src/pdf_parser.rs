use anyhow::{Context, Result};
use std::path::Path;

/// Status of PDF text extraction
#[derive(Debug, Clone)]
pub enum PdfStatus {
    /// Successfully extracted text from text layer
    Success { text: String, page_count: usize },
    /// Successfully extracted text using OCR
    OcrSuccess { text: String, page_count: usize },
    /// PDF appears to be scanned (no text layer)
    ScannedPdf { page_count: usize },
    /// Extraction failed
    Error(String),
}

/// Extract text from a PDF file
/// Returns the extracted text or an error status
/// If the PDF is scanned (no text layer), automatically attempts OCR extraction
pub fn extract_text_from_pdf(path: &Path) -> Result<PdfStatus> {
    extract_text_from_pdf_with_progress(path, None)
}

/// Extract text from a PDF file with optional progress callback
/// Returns the extracted text or an error status
/// If the PDF is scanned (no text layer), automatically attempts OCR extraction
///
/// # Arguments
/// * `path` - Path to the PDF file
/// * `progress_callback` - Optional callback for OCR progress (current_page, total_pages)
pub fn extract_text_from_pdf_with_progress(
    path: &Path,
    progress_callback: Option<crate::pdf_ocr::OcrProgressCallback>,
) -> Result<PdfStatus> {
    log::info!("Extracting text from PDF: {:?}", path);

    // Read PDF file
    let bytes = std::fs::read(path)
        .with_context(|| format!("Failed to read PDF file: {:?}", path))?;

    // Extract text using pdf-extract
    let extracted = pdf_extract::extract_text_from_mem(&bytes)
        .with_context(|| format!("Failed to extract PDF text from: {:?}", path))?;

    // Count pages (rough estimation)
    let page_count = estimate_page_count(&bytes);

    // Check if PDF is scanned (minimal or no text)
    if is_scanned_pdf(&extracted, page_count) {
        log::warn!("Detected scanned PDF (no text layer): {:?}", path);
        log::info!("Attempting OCR extraction for scanned PDF...");

        // Attempt OCR extraction
        match crate::pdf_ocr::ocr_pdf(&bytes, page_count, progress_callback) {
            Ok(ocr_text) => {
                log::info!(
                    "✓ OCR successful: Extracted {} chars from {} pages",
                    ocr_text.len(),
                    page_count
                );
                return Ok(PdfStatus::OcrSuccess {
                    text: ocr_text,
                    page_count,
                });
            }
            Err(e) => {
                log::error!("OCR failed: {}", e);
                return Ok(PdfStatus::ScannedPdf { page_count });
            }
        }
    }

    log::info!(
        "Successfully extracted {} chars from PDF with {} pages",
        extracted.len(),
        page_count
    );

    Ok(PdfStatus::Success {
        text: extracted,
        page_count,
    })
}

/// Detect if a PDF is scanned (no text layer)
/// Heuristic: If text is very sparse relative to page count, likely scanned
fn is_scanned_pdf(text: &str, page_count: usize) -> bool {
    let text_length = text.trim().len();

    // If no text at all, definitely scanned
    if text_length == 0 {
        return true;
    }

    // If less than 50 characters per page on average, likely scanned
    // (A typical page has 1000-3000 characters)
    let chars_per_page = text_length / page_count.max(1);
    if chars_per_page < 50 {
        log::debug!(
            "PDF appears scanned: {} chars / {} pages = {} chars/page",
            text_length,
            page_count,
            chars_per_page
        );
        return true;
    }

    false
}

/// Estimate page count from PDF bytes
/// This is a rough heuristic based on "/Type /Page" occurrences
fn estimate_page_count(bytes: &[u8]) -> usize {
    let content = String::from_utf8_lossy(bytes);
    let page_markers = content.matches("/Type /Page").count();

    // Subtract potential false positives (like /Pages object)
    let pages_object = content.matches("/Type /Pages").count();

    (page_markers.saturating_sub(pages_object)).max(1)
}

/// Convert PDF text to chunks
/// Similar to Markdown chunker, but simpler (just split by pages or paragraphs)
pub fn chunk_pdf_text(
    doc_id: i64,
    text: &str,
    page_count: usize,
) -> Result<Vec<crate::models::Chunk>> {
    let now = chrono::Utc::now().timestamp();
    let mut chunks = Vec::new();

    // Simple strategy: Split by double newlines (paragraphs)
    let paragraphs: Vec<&str> = text.split("\n\n").filter(|p| !p.trim().is_empty()).collect();

    if paragraphs.is_empty() {
        // If no paragraphs found, use the whole text as one chunk
        chunks.push(crate::models::Chunk {
            id: 0, // Will be set by DB
            doc_id,
            content: text.to_string(),
            metadata: Some(crate::models::ChunkMetadata {
                headers: vec![],
                chunk_type: "pdf".to_string(),
                language: None,
            }),
            start_line: 1,
            end_line: page_count,
            created_at: now,
        });
    } else {
        // Create chunks from paragraphs
        for (idx, para) in paragraphs.iter().enumerate() {
            let content = para.trim();

            // Skip very short paragraphs (likely artifacts)
            if content.len() < 20 {
                continue;
            }

            chunks.push(crate::models::Chunk {
                id: 0,
                doc_id,
                content: content.to_string(),
                metadata: Some(crate::models::ChunkMetadata {
                    headers: vec![],
                    chunk_type: "pdf".to_string(),
                    language: None,
                }),
                start_line: idx + 1,
                end_line: idx + 1,
                created_at: now,
            });
        }
    }

    log::info!("Created {} chunks from PDF text", chunks.len());

    Ok(chunks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_scanned_pdf() {
        // Empty text = scanned
        assert!(is_scanned_pdf("", 1));

        // Very little text = scanned
        assert!(is_scanned_pdf("ABC", 10));

        // Reasonable amount of text = not scanned
        let text = "a".repeat(1000);
        assert!(!is_scanned_pdf(&text, 2));
    }

    #[test]
    fn test_estimate_page_count() {
        let pdf_like = "/Type /Page\n/Type /Page\n/Type /Pages\n".as_bytes();
        let count = estimate_page_count(pdf_like);
        assert_eq!(count, 2); // 2 pages, not counting /Pages object
    }
}
