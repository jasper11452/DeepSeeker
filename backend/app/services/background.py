"""
Atlas MVP - Background Tasks
"""
import asyncio
import logging
from typing import Optional

from fastapi import BackgroundTasks
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, AsyncSession

from ..database import get_db_context
from ..models import Document, Chunk
from ..services import parser, indexing_service

logger = logging.getLogger(__name__)

class BackgroundProcessor:
    """Service for handling background document processing."""

    async def update_status(self, document_id: int, status: str, message: str, progress: float):
        """Update document status in database."""
        async with get_db_context() as db:
            stmt = (
                update(Document)
                .where(Document.id == document_id)
                .values(
                    status=status,
                    processing_message=message,
                    processing_progress=progress
                )
            )
            await db.execute(stmt)
            await db.commit()

    def _should_generate_title(self, title: str, filename: str) -> bool:
        """判断是否需要使用 LLM 生成标题
        
        标题质量差的情况：
        1. 标题太短（< 3字符）
        2. 标题太长（> 100字符）
        3. 标题与文件名几乎相同（未提取到有意义的标题）
        4. 标题看起来像编码/日期/数字序列
        5. 标题包含明显的垃圾内容
        """
        import re
        
        if not title:
            return True
        
        title = title.strip()
        
        # 太短或太长
        if len(title) < 3 or len(title) > 100:
            return True
        
        # 与文件名相同（去除扩展名）
        base_filename = filename.rsplit('.', 1)[0] if '.' in filename else filename
        if title.lower() == base_filename.lower():
            return True
        
        # 看起来像编码/UUID/数字序列
        # 例如: "a1b2c3d4", "20231207", "document_1234"
        if re.match(r'^[\da-f\-_]+$', title, re.IGNORECASE):
            return True
        
        # 主要是数字和标点
        non_alnum = re.sub(r'[\d\s\-_\.\,]', '', title)
        if len(non_alnum) < len(title) * 0.3:  # 少于30%是有意义的字符
            return True
        
        # 包含明显的垃圾字符模式
        garbage_patterns = [
            r'^page\s*\d+',  # "Page 1"
            r'^第\d+页',     # "第1页"
            r'^\d+\s*$',    # 纯数字
            r'^untitled',   # "untitled"
            r'^无标题',
            r'^document',
            r'^file\d*',
        ]
        for pattern in garbage_patterns:
            if re.match(pattern, title, re.IGNORECASE):
                return True
        
        return False

    async def process_document_task(self, document_id: int):
        """Main processing task."""
        try:
            # Get document info
            async with get_db_context() as db:
                result = await db.execute(
                    select(Document).where(Document.id == document_id)
                )
                document = result.scalar_one_or_none()
                if not document:
                    logger.error(f"Document {document_id} not found for processing")
                    return
                
                file_path = document.file_path
                file_type = document.file_type

            # 1. Parsing Phase
            await self.update_status(document_id, "parsing", "Starting parsing...", 0.0)
            
            async def progress_callback(msg, pct):
                # MarkItDown 内部进度映射到 0-50% 范围
                overall_progress = pct * 0.5
                await self.update_status(document_id, "parsing", msg, overall_progress)

            try:
                # 使用统一的 parse 方法（MarkItDown 已集成）
                if file_type in ["pdf", "docx", "pptx", "xlsx"]:
                    # 传递回调用于进度更新
                    parsed = await parser._parse_with_markitdown(file_path, file_type, update_progress_callback=progress_callback)
                else:
                    parsed = await parser.parse(file_path, file_type)
            except Exception as e:
                logger.error(f"Parsing failed: {e}")
                await self.update_status(document_id, "failed", f"Parsing error: {str(e)}", 0.0)
                return

            # Update Content in DB
            # MarkItDown 已输出高质量 Markdown，无需额外的 LLM 格式化
            
            # 智能标题生成：检测提取的标题质量
            final_title = parsed.title or document.title
            needs_llm_title = self._should_generate_title(final_title, document.filename)
            
            if needs_llm_title and parsed.content:
                await self.update_status(document_id, "parsing", "Generating smart title...", 45.0)
                try:
                    from .llm import llm_service
                    llm_title = await llm_service.generate_document_title(
                        parsed.content, 
                        document.filename
                    )
                    if llm_title and llm_title != "未命名文档":
                        final_title = llm_title
                        logger.info(f"Generated LLM title for doc {document_id}: {llm_title}")
                except Exception as e:
                    logger.warning(f"LLM title generation failed: {e}")
            
            async with get_db_context() as db:
                stmt = (
                    update(Document)
                    .where(Document.id == document_id)
                    .values(
                        content=parsed.content,
                        title=final_title,
                        meta_data=parsed.metadata
                    )
                )
                await db.execute(stmt)
                await db.commit()
                
                # Fetch fresh object for indexing service
                result = await db.execute(select(Document).where(Document.id == document_id))
                fresh_doc = result.scalar_one()

            # 2. Embedding Phase
            await self.update_status(document_id, "embedding", "Generating embeddings...", 50.0)
            
            async with get_db_context() as db:
                # Use fresh session for indexing
                # Indexing service handles chunking and embedding
                # We might want to clear old chunks first if re-processing (handled by update)
                # But here valid new doc. 
                
                # We pass the content we just parsed
                await indexing_service.index_document(fresh_doc, parsed.content, db)
                await db.commit()

            # 3. Complete
            await self.update_status(document_id, "completed", "Ready", 100.0)

        except Exception as e:
            logger.exception(f"Processing failed for doc {document_id}")
            await self.update_status(document_id, "failed", f"System error: {str(e)}", 0.0)

# Singleton
background_processor = BackgroundProcessor()
