"""
DeepSeeker 文档解析模块

提供多种解析策略：
1. TextExtractor - 快速文本提取 (PyMuPDF)
2. OCREngine - 扫描版 PDF 处理 (PaddleOCR)
3. UnstructuredNougatParser - 公式密集型文档 (Unstructured + Nougat)
4. FullPageNougatParser - 最高精度 LaTeX 还原 (纯 Nougat)

使用方式：
    from app.services.parsing import ParsingRouter, ParseRequest, ParseStrategy
    
    router = ParsingRouter(default_pdf_strategy=ParseStrategy.UNSTRUCTURED_NOUGAT)
    result = await router.route(request)
"""

from .models import ParseRequest, ParseResult
from .router import ParsingRouter, ParseStrategy
from .text_extractor import TextExtractor
from .ocr_engine import OCREngine, get_ocr_engine
from .pdf_analyzer import PDFAnalyzer, PDFAnalysis
from .table_extractor import TableExtractor

# 可选导入（需要额外依赖）
try:
    from .unstructured_nougat_parser import (
        UnstructuredNougatParser,
        FullPageNougatParser,
        get_unstructured_nougat_parser,
        get_full_nougat_parser
    )
    NOUGAT_AVAILABLE = True
except ImportError:
    NOUGAT_AVAILABLE = False

__all__ = [
    # 核心类
    "ParsingRouter",
    "ParseRequest", 
    "ParseResult",
    "ParseStrategy",
    
    # 解析器
    "TextExtractor",
    "OCREngine",
    "get_ocr_engine",
    
    # 分析器
    "PDFAnalyzer",
    "PDFAnalysis",
    "TableExtractor",
    
    # 可用性标志
    "NOUGAT_AVAILABLE",
]

# 如果 Nougat 可用，添加到导出
if NOUGAT_AVAILABLE:
    __all__.extend([
        "UnstructuredNougatParser",
        "FullPageNougatParser",
        "get_unstructured_nougat_parser",
        "get_full_nougat_parser",
    ])
