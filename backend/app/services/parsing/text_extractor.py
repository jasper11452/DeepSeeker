"""
结构化文本提取器 - 使用传统方法提取文字型文档
"""
import fitz  # PyMuPDF
import asyncio
from typing import Optional
import io
from PIL import Image
from markitdown import MarkItDown
from .models import ParseResult

class TextExtractor:
    """
    结构化文本提取器
    
    适用于文字型 PDF 和 Office 文档
    优点：快速、准确、保留结构
    """
    
    def __init__(self):
        # enable_plugins=False mainly to avoid some complex dependencies or behaviors if needed
        # but markitdown documentation should be checked. Assuming False is safe per plan.
        self.markitdown = MarkItDown(enable_plugins=False)
    
    async def extract_pdf(self, file_path: str) -> ParseResult:
        """
        提取文字型 PDF (增强版：包含嵌入图片的语义描述)
        
        策略：
        1. 使用 fitz 提取文字（极快）
        2. 对较大图片使用 VLM 生成语义描述（而非 OCR）
        3. 使用 pdfplumber 提取表格
        4. 合并结果
        """
        import base64
        import tempfile
        import os
        from ..llm import llm_service
        
        doc = fitz.open(file_path)
        all_text = []
        
        for page_num, page in enumerate(doc, 1):
            # 1. 提取文字（同步，快速）
            text = page.get_text()
            
            # 2. 收集需要描述的图片
            image_descriptions = []
            try:
                image_list = page.get_images()
                for img in image_list:
                    xref = img[0]
                    try:
                        base_image = doc.extract_image(xref)
                        image_bytes = base_image["image"]
                        
                        image = Image.open(io.BytesIO(image_bytes))
                        if image.mode != 'RGB':
                            image = image.convert('RGB')
                        
                        # 跳过小图片（图标、装饰线等）
                        width, height = image.size
                        if width < 100 or height < 100:
                            continue
                        
                        # 跳过过大的图片（可能是全页扫描）
                        if width > 2000 or height > 2000:
                            continue
                        
                        # 使用 VLM 描述图片
                        image_data = base64.b64encode(image_bytes).decode('utf-8')
                        description = await llm_service.describe_image(image_data, mode="figure")
                        
                        if description and not description.startswith("["):
                            image_descriptions.append(f"\n> **[图片描述]**: {description}\n")
                            
                    except Exception as e:
                        continue
            except Exception:
                pass
            
            # 组合页面内容
            content = f"## 第 {page_num} 页\n\n{text}"
            if image_descriptions:
                content += "\n" + "\n".join(image_descriptions)
            
            all_text.append(content)
        
        doc.close()
        combined_text = "\n\n".join(all_text)
        
        # 提取表格（使用 TableExtractor）
        from .table_extractor import TableExtractor
        table_extractor = TableExtractor()
        tables = await table_extractor.extract_from_pdf(file_path)
        
        # 提取标题
        title = self._extract_title(combined_text)
        
        return ParseResult(
            content=combined_text,
            title=title,
            metadata={"parser": "fitz_with_vlm"},
            tables=[t.markdown for t in tables],
            images=[],
            parse_method="text_extraction_vlm"
        )
    
    async def extract_with_markitdown(self, file_path: str, 
                                      file_type: str): # -> ParseResult
        """使用 MarkItDown 提取 Office 等格式"""
        
        result = await asyncio.to_thread(
            self.markitdown.convert, file_path
        )
        
        content = result.text_content or ""
        title = self._extract_title(content)
        
        return ParseResult(
            content=content,
            title=title,
            metadata={"parser": "markitdown", "file_type": file_type},
            tables=[],
            images=[],
            parse_method="markitdown"
        )
    
    def _extract_title(self, text: str) -> Optional[str]:
        """提取标题"""
        if not text:
            return None
        
        for line in text.split('\n'):
            stripped = line.strip()
            # 跳过 Markdown 标题标记和页码
            if stripped.startswith('## 第') or not stripped:
                continue
            # 移除 Markdown 标记
            clean = stripped.lstrip('#').strip()
            if clean and 3 <= len(clean) <= 100:
                return clean
        
        return None