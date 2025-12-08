"""
视觉描述器 - 使用 VLM 描述图片内容（非 OCR）
"""
import asyncio
import base64

class VisionDescriber:
    """
    图片内容描述器
    
    注意：这不是 OCR！
    
    用途：
    - 描述图片中的场景、物体
    - 解释图表的含义
    - 生成图片的语义摘要
    
    不用于：
    - 提取图片中的文字（用 OCREngine）
    """
    
    def __init__(self):
        self._model = None
        self._processor = None
    
    async def describe_image(self, image_path: str) -> str:
        """
        描述图片内容
        
        返回图片的语义描述，而非 OCR 文字
        """
        # 动态导入以避免循环引用
        from ..llm import llm_service
        
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")
        
        # 使用明确的描述 prompt，而非 OCR prompt
        description = await llm_service.describe_image(
            image_data, 
            mode="describe"  # 明确使用描述模式
        )
        
        return description
    
    async def explain_figure(self, image_path: str) -> str:
        """
        解释图表/图形的含义
        
        适用于流程图、架构图、数据图表等
        """
        from ..llm import llm_service
        
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")
        
        explanation = await llm_service.describe_image(
            image_data,
            mode="figure"
        )
        
        return explanation
