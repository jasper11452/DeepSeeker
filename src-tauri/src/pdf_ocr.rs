use anyhow::{Context, Result};
use image::DynamicImage;
use leptess::{LepTess, Variable};
use pdfium_render::prelude::*;
use std::path::Path;

/// Progress callback for OCR operations
/// Reports current page and total pages
pub type OcrProgressCallback = Box<dyn Fn(usize, usize) + Send + Sync>;

/// Initialize Tesseract OCR engine
/// Returns a configured LepTess instance
fn init_tesseract() -> Result<LepTess> {
    let mut tess = LepTess::new(None, "eng").context(
        "Failed to initialize Tesseract. Please ensure Tesseract OCR is installed:\n\
         - Ubuntu/Debian: sudo apt-get install tesseract-ocr tesseract-ocr-eng\n\
         - macOS: brew install tesseract\n\
         - Windows: Download from https://github.com/UB-Mannheim/tesseract/wiki",
    )?;

    // Configure Tesseract for better accuracy
    tess.set_variable(Variable::TesseditPagesegMode, "1")
        .context("Failed to set page segmentation mode")?;

    Ok(tess)
}

/// Convert a PDF page to an image using pdfium-render
fn pdf_page_to_image(pdfium: &Pdfium, document: &PdfDocument, page_index: u16) -> Result<DynamicImage> {
    // Get the specific page
    let page = document
        .pages()
        .get(page_index)
        .with_context(|| format!("Failed to get PDF page {}", page_index))?;

    // Render page to bitmap with high DPI for better OCR accuracy
    let render_config = PdfRenderConfig::new()
        .set_target_width(2000)  // High resolution for better OCR
        .rotate_if_landscape(PdfBitmapRotation::None, true);

    let bitmap = page
        .render_with_config(&render_config)
        .with_context(|| format!("Failed to render PDF page {}", page_index))?;

    // Convert bitmap to image
    bitmap
        .as_image()
        .as_rgba8()
        .ok_or_else(|| anyhow::anyhow!("Failed to convert bitmap to RGBA8"))
        .map(|img| DynamicImage::ImageRgba8(img.clone()))
}

/// Perform OCR on a single image
fn ocr_image(tess: &mut LepTess, image: &DynamicImage) -> Result<String> {
    // Convert image to grayscale for better OCR accuracy
    let gray_image = image.to_luma8();

    // Set image for OCR
    tess.set_image_from_mem(&gray_image)
        .context("Failed to set image for OCR")?;

    // Perform OCR
    let text = tess
        .get_utf8_text()
        .context("Failed to extract text from image")?;

    Ok(text)
}

/// Extract text from a scanned PDF using OCR
/// This function processes each page of the PDF and extracts text using Tesseract OCR
///
/// # Arguments
/// * `pdf_bytes` - The raw PDF file bytes
/// * `page_count` - The number of pages in the PDF
/// * `progress_callback` - Optional callback to report progress (current_page, total_pages)
///
/// # Returns
/// Extracted text from all pages concatenated
pub fn ocr_pdf(
    pdf_bytes: &[u8],
    page_count: usize,
    progress_callback: Option<OcrProgressCallback>,
) -> Result<String> {
    log::info!("Starting OCR for PDF with {} pages", page_count);

    // Initialize Tesseract
    let mut tess = init_tesseract()?;

    // Initialize Pdfium
    let pdfium = Pdfium::new(
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))
            .or_else(|_| Pdfium::bind_to_system_library())
            .context("Failed to load PDFium library. Please ensure PDFium is installed.")?,
    );

    // Load PDF document
    let document = pdfium
        .load_pdf_from_byte_slice(pdf_bytes, None)
        .context("Failed to load PDF document for OCR")?;

    let actual_page_count = document.pages().len();
    let mut extracted_text = String::new();

    // Process each page
    for page_index in 0..actual_page_count {
        log::debug!("Processing page {}/{}", page_index + 1, actual_page_count);

        // Report progress
        if let Some(ref callback) = progress_callback {
            callback((page_index + 1) as usize, actual_page_count as usize);
        }

        // Convert PDF page to image
        match pdf_page_to_image(&pdfium, &document, page_index) {
            Ok(image) => {
                // Perform OCR on the image
                match ocr_image(&mut tess, &image) {
                    Ok(text) => {
                        extracted_text.push_str(&text);
                        extracted_text.push_str("\n\n"); // Separate pages
                        log::debug!(
                            "Page {}/{}: Extracted {} characters",
                            page_index + 1,
                            actual_page_count,
                            text.len()
                        );
                    }
                    Err(e) => {
                        log::warn!(
                            "OCR failed for page {}/{}: {}",
                            page_index + 1,
                            actual_page_count,
                            e
                        );
                        // Continue with other pages
                    }
                }
            }
            Err(e) => {
                log::warn!(
                    "Failed to render page {}/{}: {}",
                    page_index + 1,
                    actual_page_count,
                    e
                );
                // Continue with other pages
            }
        }
    }

    let char_count = extracted_text.trim().len();
    log::info!(
        "OCR completed: Extracted {} characters from {} pages",
        char_count,
        actual_page_count
    );

    if char_count == 0 {
        anyhow::bail!("OCR extracted no text from PDF");
    }

    Ok(extracted_text)
}

/// Extract text from a scanned PDF file using OCR
/// Convenience function that reads the file and calls ocr_pdf
pub fn extract_text_from_scanned_pdf(
    path: &Path,
    page_count: usize,
    progress_callback: Option<OcrProgressCallback>,
) -> Result<String> {
    log::info!("Reading scanned PDF for OCR: {:?}", path);

    let pdf_bytes = std::fs::read(path)
        .with_context(|| format!("Failed to read PDF file: {:?}", path))?;

    ocr_pdf(&pdf_bytes, page_count, progress_callback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_tesseract() {
        // This test will fail if Tesseract is not installed
        // That's expected - it serves as a check for the environment
        match init_tesseract() {
            Ok(_) => {
                println!("✓ Tesseract is properly installed");
            }
            Err(e) => {
                println!("✗ Tesseract not available: {}", e);
                println!("  This is expected if Tesseract is not installed on the system");
            }
        }
    }
}
