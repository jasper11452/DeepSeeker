"""
智能路由器 - 根据文件特征选择最优解析路径
"""
from dataclasses import dataclass
from typing import Optional, List, Any
from .pdf_analyzer import PDFAnalyzer
from .text_extractor import TextExtractor
from .ocr_engine import OCREngine
from .table_extractor import TableExtractor
from .models import ParseRequest, ParseResult

class ParsingRouter:
    """
    解析路由器
    
    决策逻辑：
    1. 根据文件类型确定候选方法
    2. 根据文件特征（扫描版/文字版）细化选择
    3. 执行解析并评估结果
    4. 必要时降级到备选方法
    """
    
    async def route(self, request: ParseRequest) -> ParseResult:
        file_type = request.file_type.lower()
        
        # 路由表
        if file_type in ["txt", "md"]:
            return await self._parse_plain_text(request)
        
        elif file_type in ["docx", "xlsx", "pptx", "html", "htm", "epub"]:
            return await self._parse_with_markitdown(request)
        
        elif file_type == "pdf":
            return await self._parse_pdf_smart(request)
        
        elif file_type in ["png", "jpg", "jpeg", "webp", "bmp", "tiff"]:
            return await self._parse_image(request)
        
        else:
            raise ValueError(f"Unsupported file type: {file_type}")
    
    async def _parse_plain_text(self, request: ParseRequest) -> ParseResult:
        """解析纯文本"""
        import asyncio
        
        def _read():
            with open(request.file_path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read()
                
        content = await asyncio.to_thread(_read)
        
        return ParseResult(
            content=content,
            title=None,
            metadata={"parser": "text"},
            tables=[],
            images=[],
            parse_method="text"
        )
    
    async def _parse_with_markitdown(self, request: ParseRequest) -> ParseResult:
        """使用 MarkItDown 解析"""
        extractor = TextExtractor()
        return await extractor.extract_with_markitdown(request.file_path, request.file_type)

    async def _parse_image(self, request: ParseRequest) -> ParseResult:
        """解析图片"""
        engine = OCREngine()
        return await engine.process_image(request.file_path)

    async def _parse_pdf_smart(self, request: ParseRequest) -> ParseResult:
        """
        智能 PDF 解析
        
        流程：
        1. 分析 PDF 特征（是否扫描版）
        2. 尝试文字提取
        3. 评估提取质量
        4. 必要时使用 OCR
        """
        analyzer = PDFAnalyzer()
        analysis = await analyzer.analyze(request.file_path)
        
        # 判断是否为扫描版
        if analysis.is_scanned or analysis.text_ratio < 0.1:
            # 扫描版 → 直接 OCR
            return await OCREngine().process_pdf(request.file_path)
        
        # 文字版 → 先尝试提取
        extractor = TextExtractor()
        result = await extractor.extract_pdf(request.file_path)
        
        # 评估提取质量
        if self._evaluate_extraction(result) < 0.6:
            # 质量不佳 → 降级到 OCR
            return await OCREngine().process_pdf(request.file_path)
        
        # 提取表格（增强）
        # TextExtractor already calls table extractor, so we might duplicate effort if we call it again?
        # TextExtractor.extract_pdf calls extract_from_pdf.
        # So 'result' already has tables.
        # But let's verify if TextExtractor's tables are populated.
        # Yes, TextExtractor.extract_pdf implementation I wrote calls TableExtractor.
        
        return result
    
    def _evaluate_extraction(self, result: ParseResult) -> float:
        """
        评估提取质量
        
        评分维度：
        - 文本长度是否合理
        - 是否包含乱码
        - 段落结构是否完整
        """
        content = result.content
        
        if not content or len(content) < 50:
            return 0.0
        
        score = 1.0
        
        # 检查乱码比例
        garbage_chars = sum(1 for c in content if ord(c) > 0xFFFF or c in '□■▪▫')
        if garbage_chars / len(content) > 0.1:
            score -= 0.4
        
        # 检查是否有正常段落
        paragraphs = content.split('\n\n')
        avg_para_len = sum(len(p) for p in paragraphs) / max(len(paragraphs), 1)
        if avg_para_len < 20:
            score -= 0.3
        
        return max(0.0, score)