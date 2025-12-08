"""
表格提取器 - 使用 pdfplumber 进行精准表格提取
"""
import pdfplumber
from typing import List, Optional
from dataclasses import dataclass

@dataclass
class ExtractedTable:
    page_number: int
    markdown: str              # Markdown 格式的表格
    raw_data: List[List[str]]  # 原始数据
    bbox: tuple = None         # 边界框


class TableExtractor:
    """
    基于 pdfplumber 的表格提取器
    
    特点：
    - 精准识别表格边界
    - 正确处理合并单元格
    - 输出标准 Markdown 表格
    """
    
    def __init__(self):
        # 表格检测参数
        self.table_settings = {
            "vertical_strategy": "lines_strict",
            "horizontal_strategy": "lines_strict",
            "snap_tolerance": 3,
            "join_tolerance": 3,
        }
    
    async def extract_from_pdf(self, file_path: str) -> List[ExtractedTable]:
        """从 PDF 中提取所有表格"""
        import asyncio
        
        tables = []
        
        def _extract():
            with pdfplumber.open(file_path) as pdf:
                for page_num, page in enumerate(pdf.pages, 1):
                    page_tables = page.extract_tables(self.table_settings)
                    
                    for table_data in page_tables:
                        if not table_data or not table_data[0]:
                            continue
                        
                        # 清理空行空列
                        cleaned = self._clean_table(table_data)
                        
                        if cleaned:
                            markdown = self._to_markdown(cleaned)
                            tables.append(ExtractedTable(
                                page_number=page_num,
                                markdown=markdown,
                                raw_data=cleaned,
                                bbox=None  # 简化
                            ))
            
            return tables
        
        return await asyncio.to_thread(_extract)
    
    def _clean_table(self, data: List[List[str]]) -> List[List[str]]:
        """清理表格数据"""
        # 移除全空的行
        cleaned = []
        for row in data:
            # check if row has any content
            if any(cell and str(cell).strip() for cell in row):
                # clean each cell
                cleaned_row = [str(cell).strip() if cell else "" for cell in row]
                cleaned.append(cleaned_row)
        
        if not cleaned:
            return []
        
        # 确保所有行长度一致
        max_cols = max(len(row) for row in cleaned)
        for row in cleaned:
            while len(row) < max_cols:
                row.append("")
        
        return cleaned
    
    def _to_markdown(self, data: List[List[str]]) -> str:
        """转换为 Markdown 表格格式"""
        if not data:
            return ""
        
        lines = []
        
        # 表头
        header = data[0]
        lines.append("| " + " | ".join(header) + " |")
        
        # 分隔行
        lines.append("| " + " | ".join(["---"] * len(header)) + " |")
        
        # 数据行
        for row in data[1:]:
            lines.append("| " + " | ".join(row) + " |")
        
        return "\n".join(lines)
