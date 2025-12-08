"""
专业 OCR 引擎 - 使用 RapidOCR 进行稳定的文字识别
"""
from rapidocr_onnxruntime import RapidOCR
import fitz
import numpy as np
from PIL import Image
import io
import asyncio
from typing import List, Optional, Tuple
from .models import ParseResult

class OCREngine:
    """
    基于 RapidOCR 的专业 OCR 引擎
    
    特点：
    - 专为 OCR 优化，输出稳定
    - 支持多语言（中英文混合）
    - 表格结构识别
    - 无幻觉问题
    """
    
    def __init__(self):
        # 初始化 RapidOCR
        self.ocr = RapidOCR()
        
        # 配置参数
        self.dpi = 200  # PDF 转图片 DPI
        self.min_confidence = 0.5  # 最小置信度
    
    async def process_pdf(self, file_path: str, 
                          progress_callback=None): # -> ParseResult
        """
        处理 PDF 文件
        
        流程：
        1. 将每页转换为图片
        2. 对每页进行 OCR
        3. 合并结果，保留页面结构
        """
        # 延迟导入以避免循环依赖
        # from .router import ParseResult
        
        doc = fitz.open(file_path)
        total_pages = len(doc)
        all_text = []
        all_tables = []
        
        for page_num in range(total_pages):
            if progress_callback:
                progress = (page_num / total_pages) * 100
                await progress_callback(f"OCR 第 {page_num + 1}/{total_pages} 页", progress)
            
            page = doc[page_num]
            
            # 转换为图片
            pix = page.get_pixmap(dpi=self.dpi)
            img_data = pix.tobytes("png")
            image = Image.open(io.BytesIO(img_data))
            img_array = np.array(image)
            
            # OCR 识别
            # Run in thread executor
            result, _ = await asyncio.to_thread(self.ocr, img_array)
            
            if result:
                page_text = self._format_ocr_result(result)
                all_text.append(f"\n## 第 {page_num + 1} 页\n\n{page_text}")
                
                # 检测并提取表格 (简化版，仅做标记或简单的结构保留)
                tables = self._detect_tables(result)
                if tables:
                    all_tables.extend(tables)
        
        doc.close()
        
        combined_text = "\n".join(all_text)
        
        # 提取标题
        title = self._extract_title(combined_text)
        
        return ParseResult(
            content=combined_text,
            title=title,
            metadata={"parser": "rapidocr", "page_count": total_pages},
            tables=all_tables,
            images=[],
            parse_method="ocr"
        )
    
    async def process_image(self, file_path: str): # -> ParseResult
        """处理单张图片"""
        
        image = Image.open(file_path)
        # convert to RGB just in case
        if image.mode != 'RGB':
            image = image.convert('RGB')
        img_array = np.array(image)
        
        result, _ = await asyncio.to_thread(self.ocr, img_array)
        
        if result:
            text = self._format_ocr_result(result)
        else:
            text = ""
        
        return ParseResult(
            content=text,
            title=None,
            metadata={"parser": "rapidocr", "source": "image"},
            tables=[],
            images=[],
            parse_method="ocr"
        )
    
    def _format_ocr_result(self, result: list) -> str:
        """
        格式化 OCR 结果
        
        RapidOCR 输出格式：
        [[box, (text, confidence)], ...]
        
        其中 box 是四个点的坐标
        """
        lines = []
        
        if not result:
            return ""

        # result item structure: [ [[x1,y1],[x2,y2],[x3,y3],[x4,y4]], ("text", conf) ]
        # 按 Y 坐标排序（从上到下）。box[0][1] 是左上角的y坐标
        sorted_result = sorted(result, key=lambda x: x[0][0][1])
        
        current_y = -1
        current_line = []
        
        # 行高阈值，用于判断是否同一行
        line_height_threshold = 20 
        
        for item in sorted_result:
            box = item[0]
            text, confidence = item[1]
            
            # float conversion because rapidocr might return strings or floats
            try:
                confidence = float(confidence)
            except:
                confidence = 0.0

            if confidence < self.min_confidence:
                continue
            
            # 获取中心 Y 坐标 (y1 + y3) / 2 approx
            y_center = (box[0][1] + box[2][1]) / 2
            
            # 判断是否同一行（Y 坐标接近）
            if current_y < 0 or abs(y_center - current_y) < line_height_threshold:
                current_line.append((box[0][0], text))  # (x, text)
                if current_y < 0:
                     current_y = y_center
                # optional: update current_y to average? keep it simple for now
            else:
                # 新行，先处理上一行
                if current_line:
                    # 按 X 坐标排序
                    current_line.sort(key=lambda x: x[0])
                    line_text = " ".join(t for _, t in current_line)
                    lines.append(line_text)
                
                current_line = [(box[0][0], text)]
                current_y = y_center
        
        # 处理最后一行
        if current_line:
            current_line.sort(key=lambda x: x[0])
            line_text = " ".join(t for _, t in current_line)
            lines.append(line_text)
        
        return "\n".join(lines)
    
    def _detect_tables(self, ocr_result: list) -> List[dict]:
        """
        从 OCR 结果中检测表格结构
        
        策略：
        - 检测文字块的规则排列
        - 识别行列对齐
        """
        # 简化实现：依赖后续的 TableExtractor
        # 这里仅做标记
        return []
    
    def _extract_title(self, text: str) -> Optional[str]:
        """从文本中提取标题"""
        if not text:
            return None
        
        lines = text.split('\n')
        for line in lines:
            stripped = line.strip()
            # 跳过页码标记
            if stripped.startswith('## 第') or not stripped:
                continue
            # 第一个有效行作为标题
            if len(stripped) >= 3 and len(stripped) <= 100:
                return stripped
        
        return None
