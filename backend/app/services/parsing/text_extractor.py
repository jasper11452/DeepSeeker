"""
结构化文本提取器 - 使用传统方法提取文字型文档
"""
import pypdf
import asyncio
from typing import Optional
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
    
    async def extract_pdf(self, file_path: str): # -> ParseResult
        """
        提取文字型 PDF
        
        策略：
        1. 使用 pypdf 提取文字
        2. 使用 pdfplumber 提取表格
        3. 合并结果
        """
        
        def _extract():
            reader = pypdf.PdfReader(file_path)
            all_text = []
            
            for page_num, page in enumerate(reader.pages, 1):
                text = page.extract_text()
                if text and text.strip():
                    all_text.append(f"## 第 {page_num} 页\n\n{text}")
            
            return "\n\n".join(all_text)
        
        text = await asyncio.to_thread(_extract)
        
        # 提取表格（使用 TableExtractor）
        from .table_extractor import TableExtractor
        table_extractor = TableExtractor()
        tables = await table_extractor.extract_from_pdf(file_path)
        
        # 提取标题
        title = self._extract_title(text)
        
        return ParseResult(
            content=text,
            title=title,
            metadata={"parser": "pypdf"},
            tables=[t.markdown for t in tables],
            images=[],
            parse_method="text_extraction"
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
