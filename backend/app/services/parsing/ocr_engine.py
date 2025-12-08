"""
专业 OCR 引擎 - 使用 PaddleOCR 进行稳定的文字识别

特点：
- 统一将文档转换为图像后处理
- 支持表格识别（PPStructure）
- 中英文混合识别
"""
from paddleocr import PaddleOCR, PPStructureV3
import fitz
import numpy as np
from PIL import Image
import io
import asyncio
import tempfile
import os
from typing import List, Optional, Tuple
from functools import lru_cache
from .models import ParseResult


class OCREngine:
    """
    基于 PaddleOCR 的专业 OCR 引擎
    
    特点：
    - 统一将所有文档转为图像处理
    - 支持版面分析和表格识别（可选）
    - 中英文混合识别效果好
    - 无幻觉问题
    """
    
    def __init__(self, enable_structure: bool = False):
        """
        初始化 OCR 引擎
        
        Args:
            enable_structure: 是否启用 PPStructureV3（表格/图表识别）
                             启用会显著降低速度，默认禁用
        """
        # 初始化 PaddleOCR (3.x 版本)
        # 加速优化：禁用不必要的预处理步骤
        self.ocr = PaddleOCR(
            lang='ch',
            use_doc_orientation_classify=False,  # 禁用文档方向分类
            use_doc_unwarping=False,             # 禁用文档纠偏
            use_textline_orientation=False,       # 禁用文本行方向检测
        )
        
        # PPStructureV3 用于表格识别和版面分析（可选，非常耗时）
        self._structure = None
        self._enable_structure = enable_structure
        
        # 配置参数 - 降低 DPI 加快处理
        self.dpi = 150  # 从 200 降低到 150
        self.min_confidence = 0.5
    
    @property
    def structure(self):
        """延迟加载 PPStructureV3（表格识别较重）"""
        if self._structure is None and self._enable_structure:
            self._structure = PPStructureV3()
        return self._structure
    
    async def process_pdf(self, file_path: str, 
                          progress_callback=None) -> ParseResult:
        """
        处理 PDF 文件
        
        流程：
        1. 将每页转换为图片
        2. 对每页进行 OCR + 表格识别
        3. 合并结果，保留页面结构
        """
        doc = fitz.open(file_path)
        total_pages = len(doc)
        all_text = []
        all_tables = []
        all_charts = []
        
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
            
            # OCR 识别 - 使用 predict() 方法 (PaddleOCR 3.x)
            result = await asyncio.to_thread(self.ocr.predict, img_array)
            
            if result and len(result) > 0:
                page_text = self._format_ocr_result_v3(result[0])
                all_text.append(f"\n## 第 {page_num + 1} 页\n\n{page_text}")
            
            # 使用 PPStructureV3 进行结构化分析（表格 + 图表）- 仅在启用时执行
            if self._enable_structure and self.structure is not None:
                try:
                    structure_result = await asyncio.to_thread(self.structure.predict, img_array)
                    if structure_result and len(structure_result) > 0:
                        struct = structure_result[0]
                        
                        # 提取表格
                        tables = self._extract_tables_from_structure(struct, page_num + 1)
                        all_tables.extend(tables)
                        
                        # 提取并描述图表
                        charts = await self._describe_charts(struct, img_array, page_num + 1)
                        all_charts.extend(charts)
                except Exception as e:
                    print(f"结构化分析警告: {e}")
        
        doc.close()
        
        combined_text = "\n".join(all_text)
        
        # 追加表格
        if all_tables:
            combined_text += "\n\n---\n## 检测到的表格\n\n"
            for i, table in enumerate(all_tables, 1):
                combined_text += f"### 表格 {i} (第 {table['page']} 页)\n\n"
                combined_text += table['markdown'] + "\n\n"
        
        # 追加图表描述
        if all_charts:
            combined_text += "\n\n---\n## 图表分析\n\n"
            for i, chart in enumerate(all_charts, 1):
                combined_text += f"### 图表 {i} (第 {chart['page']} 页)\n\n"
                combined_text += chart['description'] + "\n\n"
        
        # 提取标题
        title = self._extract_title(combined_text)
        
        return ParseResult(
            content=combined_text,
            title=title,
            metadata={"parser": "paddleocr", "page_count": total_pages},
            tables=all_tables,
            images=[],
            parse_method="ocr"
        )
    
    async def process_image(self, file_path: str) -> ParseResult:
        """处理单张图片"""
        image = Image.open(file_path)
        # convert to RGB just in case
        if image.mode != 'RGB':
            image = image.convert('RGB')
        img_array = np.array(image)
        
        result = await asyncio.to_thread(self.ocr.predict, img_array)
        
        if result and len(result) > 0:
            text = self._format_ocr_result_v3(result[0])
        else:
            text = ""
        
        # 尝试提取表格
        tables = await self._extract_tables_from_image(img_array, 1)
        
        if tables:
            text += "\n\n---\n## 检测到的表格\n\n"
            for i, table in enumerate(tables, 1):
                text += f"### 表格 {i}\n\n"
                text += table['markdown'] + "\n\n"
        
        return ParseResult(
            content=text,
            title=None,
            metadata={"parser": "paddleocr", "source": "image"},
            tables=tables,
            images=[],
            parse_method="ocr"
        )

    def recognize(self, img_array: np.ndarray) -> str:
        """
        直接识别图像数组并返回格式化文本
        用于被 TextExtractor 等其他模块调用
        """
        result = self.ocr.predict(img_array)
        if result and len(result) > 0:
            return self._format_ocr_result_v3(result[0])
        return ""
    
    def _format_ocr_result_v3(self, result: dict) -> str:
        """
        格式化 PaddleOCR 3.x OCR 结果
        
        PaddleOCR 3.x 输出格式:
        {
            'rec_texts': ['文本1', '文本2', ...],
            'rec_scores': [0.99, 0.98, ...],
            'rec_polys': [[[x1,y1],[x2,y2],[x3,y3],[x4,y4]], ...]
        }
        """
        if not result:
            return ""
        
        rec_texts = result.get('rec_texts', [])
        rec_scores = result.get('rec_scores', [])
        rec_polys = result.get('rec_polys', [])
        
        if not rec_texts:
            return ""
        
        # 构建文本块列表，每个元素包含 (y_center, x, text)
        text_blocks = []
        for i, text in enumerate(rec_texts):
            score = rec_scores[i] if i < len(rec_scores) else 0.0
            
            # 过滤低置信度文本
            if score < self.min_confidence:
                continue
            
            # 获取位置信息
            if i < len(rec_polys) and len(rec_polys[i]) >= 4:
                poly = rec_polys[i]
                # 计算中心 Y 坐标和 X 坐标
                y_center = (poly[0][1] + poly[2][1]) / 2
                x = poly[0][0]
                text_blocks.append((y_center, x, text))
            else:
                # 没有位置信息，按顺序添加
                text_blocks.append((i * 20, 0, text))
        
        if not text_blocks:
            return ""
        
        # 按 Y 坐标排序
        text_blocks.sort(key=lambda x: x[0])
        
        # 合并同一行的文本
        lines = []
        current_y = -1
        current_line = []
        line_height_threshold = 20
        
        for y_center, x, text in text_blocks:
            if current_y < 0 or abs(y_center - current_y) < line_height_threshold:
                current_line.append((x, text))
                if current_y < 0:
                    current_y = y_center
            else:
                # 新行，先处理上一行
                if current_line:
                    current_line.sort(key=lambda item: item[0])
                    line_text = " ".join(t for _, t in current_line)
                    lines.append(line_text)
                
                current_line = [(x, text)]
                current_y = y_center
        
        # 处理最后一行
        if current_line:
            current_line.sort(key=lambda item: item[0])
            line_text = " ".join(t for _, t in current_line)
            lines.append(line_text)
        
        return "\n".join(lines)
    
    def _html_table_to_markdown(self, html: str) -> str:
        """
        将 HTML 表格转换为 Markdown 格式
        """
        from bs4 import BeautifulSoup
        
        try:
            soup = BeautifulSoup(html, 'html.parser')
            table = soup.find('table')
            if not table:
                return ""
            
            rows = table.find_all('tr')
            if not rows:
                return ""
            
            md_lines = []
            
            for i, row in enumerate(rows):
                cells = row.find_all(['td', 'th'])
                cell_texts = [cell.get_text(strip=True) for cell in cells]
                md_lines.append("| " + " | ".join(cell_texts) + " |")
                
                # 表头后添加分隔行
                if i == 0:
                    md_lines.append("| " + " | ".join(["---"] * len(cell_texts)) + " |")
            
            return "\n".join(md_lines)
        except Exception:
            return ""
    
    def _extract_tables_from_structure(self, struct: dict, page_num: int) -> List[dict]:
        """
        从 PPStructureV3 结果中提取表格
        
        PPStructureV3 输出格式:
        {
            'table_res_list': [
                {'pred_html': '<table>...</table>', 'bbox': [...], ...},
                ...
            ]
        }
        """
        tables = []
        table_res_list = struct.get('table_res_list', [])
        
        for table_res in table_res_list:
            # PPStructureV3 表格结果包含 pred_html
            html = table_res.get('pred_html', '')
            if not html:
                # 尝试其他可能的键名
                html = table_res.get('html', '')
            
            if html:
                markdown = self._html_table_to_markdown(html)
                if markdown:
                    tables.append({
                        'page': page_num,
                        'markdown': markdown,
                        'html': html,
                        'bbox': table_res.get('bbox', [])
                    })
        
        return tables
    
    async def _describe_charts(self, struct: dict, img_array: np.ndarray, 
                               page_num: int) -> List[dict]:
        """
        从 PPStructureV3 结果中提取图表并使用 VLM 描述
        
        PPStructureV3 输出格式:
        {
            'chart_res_list': [
                {'bbox': [x1, y1, x2, y2], ...},
                ...
            ]
        }
        """
        charts = []
        chart_res_list = struct.get('chart_res_list', [])
        
        if not chart_res_list:
            return charts
        
        # 动态导入以避免循环依赖
        from ..llm import llm_service
        
        for chart_res in chart_res_list:
            bbox = chart_res.get('bbox', [])
            if len(bbox) < 4:
                continue
            
            try:
                # 裁剪图表区域
                x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
                chart_img = img_array[y1:y2, x1:x2]
                
                if chart_img.size == 0:
                    continue
                
                # 将图表图像保存为临时文件
                pil_img = Image.fromarray(chart_img)
                
                with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
                    tmp_path = tmp.name
                    pil_img.save(tmp, format='PNG')
                
                try:
                    # 读取图像并编码为 base64
                    import base64
                    with open(tmp_path, 'rb') as f:
                        image_data = base64.b64encode(f.read()).decode('utf-8')
                    
                    # 使用 VLM 描述图表
                    description = await llm_service.describe_image(image_data, mode="figure")
                    
                    charts.append({
                        'page': page_num,
                        'description': description,
                        'bbox': bbox
                    })
                finally:
                    # 清理临时文件
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                        
            except Exception as e:
                print(f"图表描述警告: {e}")
                continue
        
        return charts
    
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


@lru_cache()
def get_ocr_engine(enable_structure: bool = False) -> OCREngine:
    """
    获取 OCREngine 单例
    
    Args:
        enable_structure: 是否启用表格/图表识别
                         启用会显著降低速度，默认禁用以加速 OCR
    """
    return OCREngine(enable_structure=enable_structure)