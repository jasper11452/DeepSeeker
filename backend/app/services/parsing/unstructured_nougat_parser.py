"""
Unstructured + Nougat 组合解析器

方案特点：
1. Unstructured: 高质量 PDF 解析，支持图片/公式提取
2. Nougat: 学术圈标配，公式还原准确率 95%+

适用场景：
- 论文（尤其是数学、物理、理论CS）
- 公式密集型文档
- 需要高精度 LaTeX 还原的场景
"""
import os
import asyncio
import tempfile
import shutil
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any
from dataclasses import dataclass
from PIL import Image
import numpy as np

from .models import ParseResult


@dataclass
class ExtractedElement:
    """提取的文档元素"""
    type: str  # text, image, table, formula
    content: str
    metadata: Dict[str, Any] = None
    page_number: int = 0


class UnstructuredNougatParser:
    """
    Unstructured + Nougat 组合解析器
    
    工作流程：
    1. 使用 Unstructured 进行高分辨率 PDF 解析
    2. 提取图片、公式到临时目录
    3. 使用 Nougat 将公式图片转换为 LaTeX
    4. 合并所有内容为 Markdown 格式
    """
    
    def __init__(self):
        self._nougat_model = None
        self._nougat_processor = None
        self._device = None
        
    def _ensure_nougat_loaded(self):
        """延迟加载 Nougat 模型"""
        if self._nougat_model is not None:
            return
            
        try:
            import torch
            from transformers import NougatProcessor, VisionEncoderDecoderModel
            
            # 检测设备
            if torch.backends.mps.is_available():
                self._device = torch.device("mps")
            elif torch.cuda.is_available():
                self._device = torch.device("cuda")
            else:
                self._device = torch.device("cpu")
            
            print(f"[Nougat] 加载模型到 {self._device}...")
            
            # 加载模型和处理器
            # 使用 nougat-base 或 nougat-small 取决于性能需求
            model_name = "facebook/nougat-base"
            
            self._nougat_processor = NougatProcessor.from_pretrained(model_name)
            self._nougat_model = VisionEncoderDecoderModel.from_pretrained(model_name)
            self._nougat_model.to(self._device)
            self._nougat_model.eval()
            
            print("[Nougat] 模型加载完成")
            
        except ImportError as e:
            raise ImportError(
                "Nougat 依赖未安装。请运行: pip install nougat-ocr transformers torch"
            ) from e
    
    async def parse_pdf(self, file_path: str, 
                        progress_callback=None) -> ParseResult:
        """
        解析 PDF 文件
        
        Args:
            file_path: PDF 文件路径
            progress_callback: 进度回调函数
            
        Returns:
            ParseResult: 解析结果
        """
        # 创建临时目录存放提取的图片
        temp_dir = tempfile.mkdtemp(prefix="deepseeker_parse_")
        
        try:
            if progress_callback:
                await progress_callback("使用 Unstructured 解析文档...", 5)
            
            # 1. 使用 Unstructured 解析 PDF
            elements = await self._extract_with_unstructured(
                file_path, temp_dir, progress_callback
            )
            
            if progress_callback:
                await progress_callback("处理公式和图片...", 40)
            
            # 2. 收集需要 Nougat 处理的公式图片
            formula_images = self._collect_formula_images(temp_dir)
            
            # 3. 使用 Nougat 处理公式
            latex_results = {}
            if formula_images:
                if progress_callback:
                    await progress_callback(
                        f"使用 Nougat 处理 {len(formula_images)} 个公式...", 50
                    )
                latex_results = await self._process_formulas_with_nougat(
                    formula_images, progress_callback
                )
            
            if progress_callback:
                await progress_callback("合并内容...", 80)
            
            # 4. 合并所有内容
            content, tables = self._merge_content(elements, latex_results, temp_dir)
            
            # 5. 提取标题
            title = self._extract_title(content)
            
            if progress_callback:
                await progress_callback("解析完成", 100)
            
            return ParseResult(
                content=content,
                title=title,
                metadata={
                    "parser": "unstructured_nougat",
                    "formula_count": len(latex_results),
                    "element_count": len(elements)
                },
                tables=tables,
                images=[],
                parse_method="unstructured_nougat"
            )
            
        finally:
            # 清理临时目录
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
    
    async def _extract_with_unstructured(
        self, 
        file_path: str, 
        output_dir: str,
        progress_callback=None
    ) -> List[Any]:
        """
        使用 Unstructured 提取 PDF 内容（优化版：按页处理，支持进度更新）
        
        优化策略：
        1. 使用 PyMuPDF 按页转换为图片
        2. 对每页单独调用 partition_image（比 partition_pdf 更可控）
        3. 每页处理后更新进度
        4. 使用 fast 策略加速（可选 hi_res）
        """
        import fitz
        from io import BytesIO
        
        doc = fitz.open(file_path)
        total_pages = len(doc)
        all_elements = []
        
        # 对于图片，只能使用 hi_res 或 ocr_only
        # ocr_only 更快（跳过布局分析），但 hi_res 更准确
        # 根据页数选择：少于 15 页用 hi_res，否则用 ocr_only 加速
        use_hi_res = total_pages <= 15
        strategy = "hi_res" if use_hi_res else "ocr_only"
        
        if progress_callback:
            strategy_name = "高分辨率" if use_hi_res else "OCR 快速"
            await progress_callback(f"使用 {strategy_name}模式处理 {total_pages} 页...", 5)
        
        for page_num in range(total_pages):
            # 更新进度（解析阶段占 5% - 35%）
            if progress_callback:
                progress = 5 + (page_num / total_pages) * 30
                await progress_callback(f"解析第 {page_num + 1}/{total_pages} 页...", progress)
            
            try:
                # 将页面渲染为图片
                page = doc[page_num]
                # DPI 150 足够识别文字，且速度更快
                pix = page.get_pixmap(dpi=150)
                img_data = pix.tobytes("png")
                
                # 保存临时图片
                temp_img_path = os.path.join(output_dir, f"page_{page_num + 1}.png")
                with open(temp_img_path, "wb") as f:
                    f.write(img_data)
                
                # 使用线程池处理（避免阻塞事件循环）
                def _process_page():
                    from unstructured.partition.image import partition_image
                    
                    elements = partition_image(
                        filename=temp_img_path,
                        strategy=strategy,
                        # 禁用表格推断（主要的性能瓶颈）
                        infer_table_structure=False,
                        languages=["eng", "chi_sim"],
                    )
                    
                    # 为每个元素添加页码
                    for elem in elements:
                        if hasattr(elem, 'metadata'):
                            elem.metadata.page_number = page_num + 1
                    
                    return elements
                
                page_elements = await asyncio.to_thread(_process_page)
                all_elements.extend(page_elements)
                
            except Exception as e:
                print(f"[Unstructured] 第 {page_num + 1} 页处理失败: {e}")
                continue
        
        doc.close()
        
        if progress_callback:
            await progress_callback(f"提取了 {len(all_elements)} 个元素", 35)
        
        return all_elements
    
    def _collect_formula_images(self, image_dir: str) -> List[str]:
        """
        收集可能是公式的图片
        
        启发式规则：
        - 宽高比 > 3（横向长条，可能是行内/行间公式）
        - 或面积较小但内容密集（可能是单个公式）
        """
        formula_images = []
        image_path = Path(image_dir)
        
        if not image_path.exists():
            return formula_images
        
        for img_file in image_path.glob("*.png"):
            try:
                img = Image.open(img_file)
                width, height = img.size
                
                # 过滤太小的图片（可能是图标）
                if width < 30 or height < 20:
                    continue
                
                aspect_ratio = width / max(height, 1)
                area = width * height
                
                # 公式特征判断
                is_likely_formula = (
                    # 横向长条（行间公式）
                    aspect_ratio > 2.5 or
                    # 小面积图片（单个符号或短公式）
                    (area < 50000 and height < 200) or
                    # 或者宽度较大但高度较小（多行公式）
                    (width > 300 and height < 300)
                )
                
                if is_likely_formula:
                    formula_images.append(str(img_file))
                    
            except Exception:
                continue
        
        return formula_images
    
    async def _process_formulas_with_nougat(
        self,
        image_paths: List[str],
        progress_callback=None
    ) -> Dict[str, str]:
        """
        使用 Nougat 处理公式图片
        
        Returns:
            Dict[图片路径, LaTeX字符串]
        """
        results = {}
        
        def _process_batch():
            self._ensure_nougat_loaded()
            
            import torch
            
            batch_results = {}
            total = len(image_paths)
            
            for idx, img_path in enumerate(image_paths):
                try:
                    # 加载图片
                    image = Image.open(img_path).convert("RGB")
                    
                    # 预处理
                    pixel_values = self._nougat_processor(
                        images=image, 
                        return_tensors="pt"
                    ).pixel_values.to(self._device)
                    
                    # 生成
                    with torch.no_grad():
                        outputs = self._nougat_model.generate(
                            pixel_values,
                            max_length=512,
                            num_beams=4,
                            early_stopping=True,
                            pad_token_id=self._nougat_processor.tokenizer.pad_token_id,
                            eos_token_id=self._nougat_processor.tokenizer.eos_token_id,
                        )
                    
                    # 解码
                    latex = self._nougat_processor.batch_decode(
                        outputs, 
                        skip_special_tokens=True
                    )[0]
                    
                    # 清理结果
                    latex = self._clean_latex(latex)
                    
                    if latex:
                        batch_results[img_path] = latex
                        
                except Exception as e:
                    print(f"[Nougat] 处理 {img_path} 失败: {e}")
                    continue
            
            return batch_results
        
        results = await asyncio.to_thread(_process_batch)
        
        return results
    
    def _clean_latex(self, latex: str) -> str:
        """清理 Nougat 生成的 LaTeX"""
        if not latex:
            return ""
        
        # 移除多余的空白
        latex = latex.strip()
        
        # 移除 Nougat 可能添加的特殊标记
        latex = latex.replace("[MISSING_PAGE_FAIL:1]", "")
        latex = latex.replace("[MISSING_PAGE_EMPTY:1]", "")
        
        # 如果不是 LaTeX 数学公式，尝试包装
        if latex and not latex.startswith("$") and not latex.startswith("\\["):
            # 检查是否包含常见的 LaTeX 数学命令
            math_indicators = ["\\frac", "\\sum", "\\int", "\\sqrt", 
                             "\\alpha", "\\beta", "\\mathcal", "\\mathbb",
                             "^", "_", "\\left", "\\right"]
            
            if any(ind in latex for ind in math_indicators):
                # 包装为行间公式
                latex = f"$$ {latex} $$"
        
        return latex
    
    def _merge_content(
        self,
        elements: List[Any],
        latex_results: Dict[str, str],
        image_dir: str
    ) -> Tuple[str, List[str]]:
        """
        合并 Unstructured 提取的内容和 Nougat 的公式结果
        """
        content_parts = []
        tables = []
        current_page = 0
        
        # 创建图片路径到 LaTeX 的映射
        image_basename_to_latex = {}
        for path, latex in latex_results.items():
            basename = os.path.basename(path)
            image_basename_to_latex[basename] = latex
        
        for element in elements:
            element_type = type(element).__name__
            
            # 获取页码
            if hasattr(element, 'metadata') and hasattr(element.metadata, 'page_number'):
                page = element.metadata.page_number
                if page != current_page:
                    current_page = page
                    content_parts.append(f"\n## 第 {page} 页\n")
            
            # 处理不同类型的元素
            if element_type == "Title":
                content_parts.append(f"### {element.text}\n")
                
            elif element_type == "NarrativeText":
                content_parts.append(f"{element.text}\n\n")
                
            elif element_type == "ListItem":
                content_parts.append(f"- {element.text}\n")
                
            elif element_type == "Table":
                # 表格转换为 Markdown
                table_md = self._element_to_table_markdown(element)
                if table_md:
                    content_parts.append(f"\n{table_md}\n\n")
                    tables.append(table_md)
                    
            elif element_type in ["Image", "Figure"]:
                # 检查是否有对应的 LaTeX
                if hasattr(element, 'metadata'):
                    # 尝试获取图片路径
                    image_path = getattr(element.metadata, 'image_path', None)
                    if image_path:
                        basename = os.path.basename(image_path)
                        if basename in image_basename_to_latex:
                            latex = image_basename_to_latex[basename]
                            content_parts.append(f"\n{latex}\n\n")
                            continue
                
                # 如果没有 LaTeX，添加图片描述占位符
                if hasattr(element, 'text') and element.text:
                    content_parts.append(f"\n> **[图片]**: {element.text}\n\n")
                    
            elif element_type == "Formula":
                # Unstructured 直接识别的公式
                if hasattr(element, 'text') and element.text:
                    formula_text = element.text
                    # 如果不是 LaTeX 格式，尝试包装
                    if not formula_text.startswith("$"):
                        formula_text = f"$$ {formula_text} $$"
                    content_parts.append(f"\n{formula_text}\n\n")
                    
            else:
                # 其他类型直接添加文本
                if hasattr(element, 'text') and element.text:
                    content_parts.append(f"{element.text}\n\n")
        
        # 如果有未使用的公式 LaTeX，追加到末尾
        used_basenames = set()
        for element in elements:
            if hasattr(element, 'metadata'):
                image_path = getattr(element.metadata, 'image_path', None)
                if image_path:
                    used_basenames.add(os.path.basename(image_path))
        
        unused_latex = []
        for path, latex in latex_results.items():
            basename = os.path.basename(path)
            if basename not in used_basenames:
                unused_latex.append(latex)
        
        if unused_latex:
            content_parts.append("\n---\n## 检测到的公式\n\n")
            for i, latex in enumerate(unused_latex, 1):
                content_parts.append(f"**公式 {i}:**\n{latex}\n\n")
        
        return "".join(content_parts), tables
    
    def _element_to_table_markdown(self, element) -> Optional[str]:
        """将 Unstructured 的表格元素转换为 Markdown"""
        try:
            if hasattr(element, 'metadata') and hasattr(element.metadata, 'text_as_html'):
                html = element.metadata.text_as_html
                return self._html_to_markdown_table(html)
            elif hasattr(element, 'text') and element.text:
                return element.text
        except Exception:
            pass
        return None
    
    def _html_to_markdown_table(self, html: str) -> str:
        """将 HTML 表格转换为 Markdown"""
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
                
                if i == 0:
                    md_lines.append("| " + " | ".join(["---"] * len(cell_texts)) + " |")
            
            return "\n".join(md_lines)
        except Exception:
            return ""
    
    def _extract_title(self, text: str) -> Optional[str]:
        """从文本中提取标题"""
        if not text:
            return None
        
        for line in text.split('\n'):
            stripped = line.strip()
            if stripped.startswith('## 第') or not stripped:
                continue
            clean = stripped.lstrip('#').strip()
            if clean and 3 <= len(clean) <= 100:
                return clean
        
        return None


# 备用方案：纯 Nougat 解析（整页处理）
class FullPageNougatParser:
    """
    纯 Nougat 全页解析器
    
    适用场景：
    - 整篇论文都是公式密集型
    - 需要最高精度的 LaTeX 还原
    
    注意：这个方案比较慢，但对公式的处理最准确
    """
    
    def __init__(self):
        self._model = None
        self._processor = None
        self._device = None
    
    def _ensure_loaded(self):
        if self._model is not None:
            return
            
        import torch
        from transformers import NougatProcessor, VisionEncoderDecoderModel
        
        if torch.backends.mps.is_available():
            self._device = torch.device("mps")
        elif torch.cuda.is_available():
            self._device = torch.device("cuda")
        else:
            self._device = torch.device("cpu")
        
        model_name = "facebook/nougat-base"
        self._processor = NougatProcessor.from_pretrained(model_name)
        self._model = VisionEncoderDecoderModel.from_pretrained(model_name)
        self._model.to(self._device)
        self._model.eval()
    
    async def parse_pdf(self, file_path: str,
                        progress_callback=None) -> ParseResult:
        """使用 Nougat 逐页解析整个 PDF"""
        import fitz
        import torch
        
        def _process():
            self._ensure_loaded()
            
            doc = fitz.open(file_path)
            total_pages = len(doc)
            all_content = []
            
            for page_num in range(total_pages):
                page = doc[page_num]
                
                # 渲染为高分辨率图片
                pix = page.get_pixmap(dpi=200)
                img_data = pix.tobytes("png")
                
                from io import BytesIO
                image = Image.open(BytesIO(img_data)).convert("RGB")
                
                # Nougat 处理
                pixel_values = self._processor(
                    images=image,
                    return_tensors="pt"
                ).pixel_values.to(self._device)
                
                with torch.no_grad():
                    outputs = self._model.generate(
                        pixel_values,
                        max_length=4096,
                        num_beams=4,
                        early_stopping=True,
                        bad_words_ids=[[self._processor.tokenizer.unk_token_id]],
                        pad_token_id=self._processor.tokenizer.pad_token_id,
                        eos_token_id=self._processor.tokenizer.eos_token_id,
                    )
                
                page_text = self._processor.batch_decode(
                    outputs,
                    skip_special_tokens=True
                )[0]
                
                # 清理 Nougat 输出
                page_text = self._post_process_nougat_output(page_text)
                
                all_content.append(f"## 第 {page_num + 1} 页\n\n{page_text}")
            
            doc.close()
            return "\n\n".join(all_content), total_pages
        
        content, page_count = await asyncio.to_thread(_process)
        
        return ParseResult(
            content=content,
            title=self._extract_title(content),
            metadata={
                "parser": "nougat_full",
                "page_count": page_count
            },
            tables=[],
            images=[],
            parse_method="nougat_full"
        )
    
    def _post_process_nougat_output(self, text: str) -> str:
        """后处理 Nougat 输出"""
        # 移除特殊标记
        text = text.replace("[MISSING_PAGE_FAIL:1]", "")
        text = text.replace("[MISSING_PAGE_EMPTY:1]", "")
        
        # 修复常见的 LaTeX 问题
        import re
        
        # 确保数学环境正确闭合
        text = re.sub(r'\$\$\s*\$\$', '$$', text)
        
        return text.strip()
    
    def _extract_title(self, text: str) -> Optional[str]:
        if not text:
            return None
        for line in text.split('\n'):
            stripped = line.strip()
            if stripped.startswith('## 第') or not stripped:
                continue
            clean = stripped.lstrip('#').strip()
            if clean and 3 <= len(clean) <= 100:
                return clean
        return None


# 便捷函数
def get_unstructured_nougat_parser() -> UnstructuredNougatParser:
    """获取 Unstructured + Nougat 组合解析器"""
    return UnstructuredNougatParser()


def get_full_nougat_parser() -> FullPageNougatParser:
    """获取纯 Nougat 全页解析器"""
    return FullPageNougatParser()
