"""
PDF 特征分析器 - 判断 PDF 类型和最佳解析策略
"""
import fitz  # PyMuPDF
from dataclasses import dataclass
from typing import List

@dataclass
class PDFAnalysis:
    page_count: int
    is_scanned: bool           # 是否为扫描版
    text_ratio: float          # 文字占比 (0-1)
    has_images: bool           # 是否包含图片
    has_tables: bool           # 是否包含表格（启发式检测）
    recommended_method: str    # 推荐解析方法


class PDFAnalyzer:
    """
    PDF 特征分析器
    
    通过采样分析确定 PDF 特征，避免全文档扫描
    """
    
    async def analyze(self, file_path: str) -> PDFAnalysis:
        doc = fitz.open(file_path)
        page_count = len(doc)
        
        # 采样页面（首、中、尾各一页）
        sample_pages = self._get_sample_pages(page_count)
        
        total_text_len = 0
        total_image_area = 0
        total_page_area = 0
        has_images = False
        has_tables = False
        
        for page_num in sample_pages:
            page = doc[page_num]
            
            # 提取文字
            text = page.get_text()
            total_text_len += len(text.strip())
            
            # 计算页面面积
            rect = page.rect
            page_area = rect.width * rect.height
            total_page_area += page_area
            
            # 检测图片
            images = page.get_images()
            if images:
                has_images = True
                for img in images:
                    xref = img[0]
                    try:
                        # 估算图片面积占比 - 这里的 img_info 提取可能会比较耗时，仅做存在性检查或简单估算
                        # 简化处理：只要有图片就标记
                        pass
                    except:
                        pass
            
            # 启发式表格检测（检查是否有规则的行列结构）
            if self._detect_table_heuristic(page):
                has_tables = True
        
        doc.close()
        
        # 判断是否为扫描版
        # 扫描版特征：文字极少，但有大图片
        # 如果是空文件或者只有很少的几页，分母可能很小
        num_samples = len(sample_pages)
        avg_text_per_page = total_text_len / num_samples if num_samples > 0 else 0
        
        # 如果每一页平均少于100个字符且有图片，很可能是扫描版
        is_scanned = avg_text_per_page < 100 and has_images
        
        # 计算文字占比
        text_ratio = min(avg_text_per_page / 1000, 1.0)  # 假设正常页面约 1000 字符
        
        # 推荐方法
        if is_scanned:
            recommended = "ocr"
        elif has_tables:
            recommended = "text_with_table_extraction"
        else:
            recommended = "text_extraction"
        
        return PDFAnalysis(
            page_count=page_count,
            is_scanned=is_scanned,
            text_ratio=text_ratio,
            has_images=has_images,
            has_tables=has_tables,
            recommended_method=recommended
        )
    
    def _get_sample_pages(self, total: int) -> List[int]:
        """获取采样页面索引"""
        if total <= 3:
            return list(range(total))
        return [0, total // 2, total - 1]
    
    def _detect_table_heuristic(self, page) -> bool:
        """
        启发式表格检测
        
        通过检测页面中的线条和文字块分布来判断
        """
        # 获取页面中的矩形（线条）
        drawings = page.get_drawings()
        horizontal_lines = 0
        vertical_lines = 0
        
        for d in drawings:
            # 简化判断：rect属性存在且长宽比悬殊
            rect = d.get("rect")
            if not rect:
                continue
                
            # fitz.Rect
            width = rect[2] - rect[0]
            height = rect[3] - rect[1]
            
            if width > 50 and height < 5: # 认为是水平线
                horizontal_lines += 1
            elif height > 50 and width < 5: # 认为是垂直线
                vertical_lines += 1
            
            # 或者通过 type=='l' (line) 
            # item["type"] == "l" 需要在 get_cdrawings 或者更底层访问
            # get_drawings 返回的是 dictionary path items
            
        # 简化实现：如果有多条水平线且文字块规则排列，认为有表格
        # 注意：pdfplumber 的检测更准，这里只是快速筛选
        return horizontal_lines > 3 or (horizontal_lines > 1 and vertical_lines > 1)
