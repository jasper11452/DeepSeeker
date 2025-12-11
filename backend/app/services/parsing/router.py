"""
智能路由器 - 根据文件特征选择最优解析路径

更新：添加 Unstructured + Nougat 方案支持（公式密集型文档首选）
"""
from dataclasses import dataclass
from typing import Optional, List, Any
from .text_extractor import TextExtractor
from .ocr_engine import OCREngine, get_ocr_engine
from .models import ParseRequest, ParseResult


# 解析策略枚举
class ParseStrategy:
    """解析策略"""
    TEXT_EXTRACTION = "text_extraction"     # PyMuPDF 快速文本提取
    OCR = "ocr"                             # PaddleOCR 扫描版处理
    MARKITDOWN = "markitdown"               # Office 文档
    UNSTRUCTURED_NOUGAT = "unstructured_nougat"  # 公式密集型（学术论文）
    NOUGAT_FULL = "nougat_full"             # 纯 Nougat 全页解析（最高精度）


class ParsingRouter:
    """
    解析路由器
    
    决策逻辑：
    1. 根据文件类型确定候选方法
    2. 根据文件特征（扫描版/文字版/公式密集型）细化选择
    3. 执行解析并评估结果
    4. 必要时降级到备选方法
    
    新增：
    - 支持 Unstructured + Nougat 组合方案
    - 自动检测公式密集型文档
    """
    
    def __init__(self, default_pdf_strategy: str = None):
        """
        初始化路由器
        
        Args:
            default_pdf_strategy: 默认 PDF 解析策略
                - None: 自动选择（默认）
                - "unstructured_nougat": 强制使用 Unstructured + Nougat
                - "nougat_full": 强制使用纯 Nougat
                - "ocr": 强制使用 PaddleOCR
                - "text_extraction": 强制使用文本提取
        """
        self.default_pdf_strategy = default_pdf_strategy
    
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
        engine = get_ocr_engine()
        return await engine.process_image(request.file_path)

    async def _parse_pdf_smart(self, request: ParseRequest) -> ParseResult:
        """
        智能 PDF 解析
        
        策略选择（优先级从高到低）：
        1. 用户指定策略 → 直接使用
        2. 默认策略为 unstructured_nougat → 使用 Unstructured + Nougat
        3. 自动检测：
           - 公式密集型 → Unstructured + Nougat（学术圈标配）
           - 扫描版 → PaddleOCR
           - 文字版 → PyMuPDF 快速提取
        """
        from .pdf_analyzer import PDFAnalyzer
        
        progress_callback = request.options.get("progress_callback") if request.options else None
        
        # 检查是否指定了解析策略
        strategy = None
        if request.options:
            strategy = request.options.get("parse_strategy")
        
        # 使用默认策略
        if not strategy and self.default_pdf_strategy:
            strategy = self.default_pdf_strategy
        
        # ==========================================
        # 策略：Unstructured + Nougat（公式密集型首选）
        # ==========================================
        if strategy == ParseStrategy.UNSTRUCTURED_NOUGAT:
            return await self._parse_with_unstructured_nougat(request, progress_callback)
        
        # ==========================================
        # 策略：纯 Nougat 全页解析（最高精度）
        # ==========================================
        if strategy == ParseStrategy.NOUGAT_FULL:
            return await self._parse_with_nougat_full(request, progress_callback)
        
        # ==========================================
        # 自动选择策略
        # ==========================================
        
        # 1. 快速分析 PDF 类型
        analyzer = PDFAnalyzer()
        analysis = await analyzer.analyze(request.file_path)
        
        # 2. 检测是否为学术论文/公式密集型
        if strategy != ParseStrategy.OCR:
            is_academic = await self._detect_academic_paper(request.file_path, analysis)
            
            if is_academic:
                if progress_callback:
                    await progress_callback("检测到学术论文，使用 Unstructured + Nougat...", 5)
                return await self._parse_with_unstructured_nougat(request, progress_callback)
        
        # 3. 文字版 PDF → 直接提取（快 30 倍）
        if not analysis.is_scanned and analysis.text_ratio > 0.1:
            if progress_callback:
                await progress_callback("使用快速文字提取...", 10)
            
            extractor = TextExtractor()
            result = await extractor.extract_pdf(request.file_path)
            
            # 验证提取质量
            if self._evaluate_extraction(result) >= 0.6:
                if progress_callback:
                    await progress_callback("提取完成", 100)
                return result
        
        # 4. 扫描版或提取质量不佳 → OCR
        if progress_callback:
            await progress_callback("检测到扫描版，启用 OCR...", 10)
        
        return await get_ocr_engine().process_pdf(
            request.file_path,
            progress_callback=progress_callback
        )
    
    async def _parse_with_unstructured_nougat(
        self, 
        request: ParseRequest,
        progress_callback=None
    ) -> ParseResult:
        """
        使用 Unstructured + Nougat 组合方案解析
        
        特点：
        - Unstructured: 高质量 PDF 解析，支持图片/公式提取
        - Nougat: 公式还原准确率 95%+
        
        适用：学术论文、公式密集型文档
        """
        try:
            from .unstructured_nougat_parser import get_unstructured_nougat_parser
            
            parser = get_unstructured_nougat_parser()
            return await parser.parse_pdf(request.file_path, progress_callback)
            
        except Exception as e:
            # 降级到默认方案
            print(f"[Router] Unstructured/Nougat 解析失败，降级到默认方案: {e}")
            if progress_callback:
                await progress_callback("Unstructured/Nougat 解析失败，使用默认方案...", 10)
            return await self._fallback_parse(request, progress_callback)
    
    async def _parse_with_nougat_full(
        self,
        request: ParseRequest,
        progress_callback=None
    ) -> ParseResult:
        """
        使用纯 Nougat 全页解析
        
        特点：最高精度的 LaTeX 还原，但速度较慢
        """
        try:
            from .unstructured_nougat_parser import get_full_nougat_parser
            
            parser = get_full_nougat_parser()
            return await parser.parse_pdf(request.file_path, progress_callback)
            
        except Exception as e:
            print(f"[Router] Nougat 解析失败，降级到默认方案: {e}")
            if progress_callback:
                await progress_callback("Nougat 解析失败，使用默认方案...", 10)
            return await self._fallback_parse(request, progress_callback)
    
    async def _fallback_parse(
        self,
        request: ParseRequest,
        progress_callback=None
    ) -> ParseResult:
        """降级解析方案"""
        from .pdf_analyzer import PDFAnalyzer
        
        analyzer = PDFAnalyzer()
        analysis = await analyzer.analyze(request.file_path)
        
        if not analysis.is_scanned and analysis.text_ratio > 0.1:
            extractor = TextExtractor()
            return await extractor.extract_pdf(request.file_path)
        else:
            return await get_ocr_engine().process_pdf(
                request.file_path,
                progress_callback=progress_callback
            )
    
    async def _detect_academic_paper(self, file_path: str, analysis) -> bool:
        """
        检测是否为学术论文/公式密集型文档
        
        启发式规则：
        1. 检测 LaTeX 关键词
        2. 检测公式相关字符
        3. 检测学术论文结构
        """
        import fitz
        
        try:
            doc = fitz.open(file_path)
            
            # 采样前几页
            sample_text = ""
            for i in range(min(3, len(doc))):
                sample_text += doc[i].get_text()
            
            doc.close()
            
            # 学术论文标志
            academic_indicators = [
                "Abstract", "Introduction", "Conclusion",
                "References", "Bibliography", "et al.",
                "Theorem", "Lemma", "Proof", "Proposition",
                "摘要", "参考文献", "引言", "结论"
            ]
            
            # 公式相关字符
            formula_chars = ['∫', '∑', '∏', '√', '∞', '≠', '≤', '≥', 
                            '∈', '∉', '⊂', '⊃', 'α', 'β', 'γ', 'δ',
                            'θ', 'λ', 'μ', 'σ', 'π', 'φ', 'ψ', 'ω']
            
            # LaTeX 命令模式
            latex_patterns = [
                r'\\frac', r'\\sum', r'\\int', r'\\partial',
                r'\\mathcal', r'\\mathbb', r'\\left', r'\\right',
                r'\\begin{equation}', r'\\end{equation}',
                r'$.*$'
            ]
            
            score = 0
            
            # 检测学术指标
            for indicator in academic_indicators:
                if indicator.lower() in sample_text.lower():
                    score += 1
            
            # 检测公式字符
            formula_char_count = sum(1 for c in sample_text if c in formula_chars)
            if formula_char_count > 5:
                score += 2
            if formula_char_count > 20:
                score += 2
            
            # 检测 LaTeX 模式
            import re
            for pattern in latex_patterns:
                if re.search(pattern, sample_text):
                    score += 1
            
            # 阈值判断
            return score >= 4
            
        except Exception:
            return False
    
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
