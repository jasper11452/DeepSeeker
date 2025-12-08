"""
解析服务的数据模型定义
"""
from dataclasses import dataclass
from typing import Optional, List, Any

@dataclass
class ParseRequest:
    file_path: str
    file_type: str
    options: dict = None  # 用户可覆盖默认行为

@dataclass  
class ParseResult:
    content: str
    title: Optional[str]
    metadata: dict
    tables: List[Any]        # 提取的表格
    images: List[dict]        # 图片信息
    parse_method: str         # 使用的解析方法
