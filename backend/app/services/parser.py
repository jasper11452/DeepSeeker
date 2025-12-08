"""
Atlas MVP - Document Parser Service
"""
import os
from typing import List, Optional
from dataclasses import dataclass

import markdown
from bs4 import BeautifulSoup
from pypdf import PdfReader

from ..config import get_settings

settings = get_settings()


@dataclass
class ParsedDocument:
    """Parsed document result."""
    content: str
    title: Optional[str] = None
    metadata: dict = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


@dataclass
class TextChunk:
    """Text chunk for indexing."""
    content: str
    index: int
    start_char: int
    end_char: int
    metadata: dict = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


class DocumentParser:
    """Document parser for various file types."""

    def __init__(self):
        self.chunk_size = settings.chunk_size
        self.chunk_overlap = settings.chunk_overlap

    async def parse(self, file_path: str, file_type: str) -> ParsedDocument:
        """Parse a document based on its file type."""
        # MarkItDown 支持的格式 (Office, PDF, Web/Data, Archive, Ebook)
        markitdown_types = [
            # PDF
            "pdf",
            # Office
            "docx", "pptx", "xlsx", "xls",
            # Web/Data
            "html", "htm", "json", "xml", "csv",
            # Archives & Ebooks
            "zip", "epub"
        ]
        
        if file_type in markitdown_types:
            return await self._parse_with_markitdown(file_path, file_type)
        elif file_type == "md":
            return await self._parse_markdown(file_path)
        elif file_type == "txt":
            return await self._parse_text(file_path)
        else:
            raise ValueError(f"Unsupported file type: {file_type}")

    async def _parse_with_markitdown(self, file_path: str, file_type: str, 
                                       update_progress_callback=None) -> ParsedDocument:
        """使用 MarkItDown 解析文档，支持 PDF/Word/PPT/Excel 等格式。"""
        import asyncio
        from markitdown import MarkItDown
        
        if update_progress_callback:
            await update_progress_callback("Converting document to Markdown...", 10.0)
        
        # MarkItDown 是同步的，包装为异步
        md_converter = MarkItDown(enable_plugins=False)
        result = await asyncio.to_thread(md_converter.convert, file_path)
        content = result.text_content
        
        if update_progress_callback:
            await update_progress_callback("Markdown conversion complete", 50.0)
        
        # 对 PDF 额外处理图片（使用视觉模型）
        if file_type == "pdf":
            image_descriptions = await self._extract_pdf_images(file_path, update_progress_callback)
            if image_descriptions:
                content = content + "\n\n---\n\n## 图片内容\n\n" + "\n\n".join(image_descriptions)
        
        # 提取标题
        title = None
        if content:
            lines = content.split('\n')
            for line in lines:
                stripped = line.strip()
                if stripped.startswith('# '):
                    title = stripped[2:].strip()
                    break
                elif stripped and len(stripped) < 200:
                    title = stripped
                    break
        
        return ParsedDocument(
            content=content,
            title=title,
            metadata={"parser": "markitdown", "file_type": file_type}
        )

    async def _extract_pdf_images(self, file_path: str, update_progress_callback=None) -> list:
        """从 PDF 中提取图片并使用视觉模型生成描述。"""
        import fitz  # PyMuPDF
        import base64
        import asyncio
        from .llm import llm_service
        
        descriptions = []
        try:
            doc = fitz.open(file_path)
            total_pages = len(doc)
            image_count = 0
            
            MAX_IMAGES = 5
            
            for i, page in enumerate(doc):
                if image_count >= MAX_IMAGES:
                    print(f"Reached maximum image limit ({MAX_IMAGES}). Skipping remaining images.")
                    break
                    
                if update_progress_callback:
                    progress = 50.0 + (i / total_pages) * 40.0  # 50% - 90%
                    await update_progress_callback(f"Processing images (page {i+1}/{total_pages})...", progress)
                
                image_list = page.get_images()
                for img_index, img in enumerate(image_list):
                    if image_count >= MAX_IMAGES:
                        break
                        
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    
                    # 过滤小图标/logo
                    if len(image_bytes) < 5000:  # < 5KB
                        continue
                    
                    # 转换为 base64
                    image_b64 = base64.b64encode(image_bytes).decode('utf-8')
                    
                    # 使用视觉模型生成描述
                    try:
                        print(f"Processing image {image_count+1} (Page {i+1})...")
                        # Add timeout to avoid hanging forever
                        description = await asyncio.wait_for(
                            llm_service.describe_image(image_b64),
                            timeout=60.0
                        )
                        if description and "Failed" not in description:
                            image_count += 1
                            descriptions.append(f"**图片 {image_count}** (第{i+1}页): {description}")
                    except asyncio.TimeoutError:
                        print(f"Image {image_count+1} processing timed out.")
                    except Exception as e:
                        print(f"Image processing error: {e}")
                        pass
            
            doc.close()
        except Exception as e:
            print(f"Image extraction failed: {e}")
        
        return descriptions

    async def _parse_pdf(self, file_path: str, update_progress_callback=None) -> ParsedDocument:
        """Parse PDF file - 现在使用 MarkItDown 实现。"""
        return await self._parse_with_markitdown(file_path, "pdf", update_progress_callback)

    async def _parse_markdown(self, file_path: str) -> ParsedDocument:
        """Parse Markdown file."""
        with open(file_path, "r", encoding="utf-8") as f:
            md_content = f.read()

        # Convert to HTML then extract text
        html = markdown.markdown(md_content)
        soup = BeautifulSoup(html, "html.parser")
        content = soup.get_text(separator="\n")

        # Extract title from first heading
        title = None
        h1 = soup.find("h1")
        if h1:
            title = h1.get_text()
        elif md_content.startswith("# "):
            title = md_content.split("\n")[0][2:].strip()

        return ParsedDocument(
            content=content,
            title=title,
            metadata={"format": "markdown"}
        )

    async def _parse_text(self, file_path: str) -> ParsedDocument:
        """Parse plain text file."""
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Use first line as title if short enough
        title = None
        if content:
            first_line = content.split("\n")[0].strip()
            if len(first_line) < 200:
                title = first_line

        return ParsedDocument(
            content=content,
            title=title,
            metadata={"format": "text"}
        )

    def chunk_text(self, text: str) -> List[TextChunk]:
        """Split text into overlapping chunks."""
        if not text:
            return []

        chunks = []
        start = 0
        index = 0

        while start < len(text):
            end = start + self.chunk_size

            # Try to break at sentence boundary
            if end < len(text):
                # Look for sentence ending
                for sep in ["。", ".", "！", "!", "？", "?", "\n\n", "\n"]:
                    last_sep = text[start:end].rfind(sep)
                    if last_sep > self.chunk_size // 2:
                        end = start + last_sep + 1
                        break

            chunk_content = text[start:end].strip()

            if chunk_content:
                chunks.append(TextChunk(
                    content=chunk_content,
                    index=index,
                    start_char=start,
                    end_char=end,
                ))
                index += 1

            # Move start with overlap
            start = end - self.chunk_overlap
            if start >= len(text):
                break

        return chunks


# Singleton instance
parser = DocumentParser()
