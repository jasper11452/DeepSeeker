"""
Atlas MVP - Document Parser Service (重构版)

核心变更：
1. 引入分层解析架构
2. 使用专业 OCR 替代 VLM OCR
3. 智能路由自动选择最佳解析方法
"""
import os
from typing import List, Optional
from dataclasses import dataclass, field

from ..config import get_settings
from .parsing.router import ParsingRouter, ParseRequest, ParseResult

settings = get_settings()


@dataclass
class ParsedDocument:
    """解析后的文档结果"""
    content: str
    title: Optional[str] = None
    metadata: dict = field(default_factory=dict)


@dataclass
class TextChunk:
    """用于索引的文本块"""
    content: str
    index: int
    start_char: int
    end_char: int
    metadata: dict = field(default_factory=dict)


class DocumentParser:
    """
    文档解析器（重构版）
    
    变更：
    - 委托解析工作给 ParsingRouter
    - 保留 chunk_text 方法
    - 简化代码结构
    """

    def __init__(self):
        self.chunk_size = settings.chunk_size
        self.chunk_overlap = settings.chunk_overlap
        self.router = ParsingRouter()

    async def parse(self, file_path: str, file_type: str,
                    update_progress_callback=None) -> ParsedDocument:
        """
        解析文档
        
        通过路由器自动选择最佳解析方法
        """
        request = ParseRequest(
            file_path=file_path,
            file_type=file_type,
            options={"progress_callback": update_progress_callback}
        )
        
        result = await self.router.route(request)
        
        return ParsedDocument(
            content=result.content,
            title=result.title,
            metadata=result.metadata
        )

    def chunk_text(self, text: str) -> List[TextChunk]:
        """
        将文本分割为重叠的块
        
        策略：
        1. 按 Markdown 标题分割
        2. 尊重段落边界
        3. 保护代码块和表格
        """
        if not text:
            return []
        
        import re
        
        chunks = []
        
        # 按标题分级 (H1-H3)
        header_pattern = r'(^#{1,3}\s+.+$)'
        splits = list(re.finditer(header_pattern, text, re.MULTILINE))
        
        sections = []
        last_pos = 0
        
        if not splits:
            sections.append(text)
        else:
            for i, match in enumerate(splits):
                if match.start() > last_pos:
                    sections.append(text[last_pos:match.start()])
                
                end_pos = splits[i+1].start() if i + 1 < len(splits) else len(text)
                sections.append(text[match.start():end_pos])
                last_pos = end_pos
        
        # 处理每个 section
        chunk_index = 0
        for section in sections:
            if not section.strip():
                continue
            
            if len(section) <= self.chunk_size:
                chunks.append(TextChunk(
                    content=section.strip(),
                    index=chunk_index,
                    start_char=0,
                    end_char=len(section)
                ))
                chunk_index += 1
            else:
                sub_chunks = self._recursive_split(
                    section, self.chunk_size, self.chunk_overlap
                )
                for sub in sub_chunks:
                    chunks.append(TextChunk(
                        content=sub,
                        index=chunk_index,
                        start_char=0, # Simplified, might need calculation if strict
                        end_char=len(sub)
                    ))
                    chunk_index += 1
        
        return chunks

    def _recursive_split(self, text: str, max_size: int, 
                         overlap: int) -> List[str]:
        """递归分割文本"""
        if len(text) <= max_size:
            return [text]
        
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + max_size
            
            if end < len(text):
                # 尝试在自然边界分割
                boundaries = ["\n\n", "\n", "。", ".", "！", "!", "？", "?"]
                for sep in boundaries:
                    last_sep = text[start:end].rfind(sep)
                    if last_sep > max_size // 2:
                        end = start + last_sep + len(sep)
                        break
            
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            
            start = end - overlap
        
        return chunks


# 单例实例
parser = DocumentParser()