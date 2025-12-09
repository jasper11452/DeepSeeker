"""
DeepSeeker MVP - Background Tasks
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

class TaskQueue:
    """
    Async Task Queue with Concurrency Control.
    Replaces FastAPI BackgroundTasks for better control over resource usage.
    """
    def __init__(self, max_concurrent: int = 2):
        self.queue = asyncio.Queue()
        self.max_concurrent = max_concurrent
        self.workers = []
        self.running = False
        
    async def start(self):
        """Start worker tasks."""
        if self.running:
            return
        
        self.running = True
        # Start workers
        for i in range(self.max_concurrent):
            worker = asyncio.create_task(self._worker(i))
            self.workers.append(worker)
        logger.info(f"TaskQueue started with {self.max_concurrent} workers.")
            
    async def stop(self):
        """Stop worker tasks."""
        self.running = False
        # Send None to queue to signal stop for each worker
        for _ in range(self.max_concurrent):
            await self.queue.put(None)
        
        if self.workers:
            await asyncio.gather(*self.workers)
            self.workers = []
        logger.info("TaskQueue stopped.")

    async def enqueue(self, task_func, *args, **kwargs):
        """Add a task to the queue."""
        await self.queue.put((task_func, args, kwargs))
        logger.info(f"Task enqueued. Queue size: {self.queue.qsize()}")

    async def _worker(self, worker_id: int):
        """Worker loop."""
        logger.info(f"Worker {worker_id} started.")
        while True:
            try:
                item = await self.queue.get()
                if item is None:
                    # Stop signal
                    self.queue.task_done()
                    break
                
                func, args, kwargs = item
                try:
                    if asyncio.iscoroutinefunction(func):
                        await func(*args, **kwargs)
                    else:
                        await asyncio.to_thread(func, *args, **kwargs)
                except Exception as e:
                    logger.error(f"Worker {worker_id} task failed: {e}")
                finally:
                    self.queue.task_done()
            except Exception as e:
                logger.error(f"Worker {worker_id} critical error: {e}")
                # Don't break the loop on task error, but break on system error if needed
                if not self.running:
                    break


class BackgroundProcessor:
    """Service for handling background document processing using TaskQueue."""
    
    def __init__(self):
        self.task_queue = TaskQueue(max_concurrent=2)

    async def start(self):
        await self.task_queue.start()

    async def stop(self):
        await self.task_queue.stop()

    async def add_document_task(self, document_id: int):
        """Enqueue a document processing task."""
        await self.task_queue.enqueue(self.process_document_task, document_id)

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
        
        检测以下情况应触发 LLM 重命名：
        1. 标题为空或过短/过长
        2. 标题与文件名完全相同
        3. 纯数字、UUID、时间戳风格的名称
        4. 截屏、录屏等系统自动生成的命名
        5. 乱码或信息量极低的名称
        """
        import re
        
        if not title:
            return True
        
        title = title.strip()
        
        # 长度检查
        if len(title) < 3 or len(title) > 100:
            return True
        
        # 与原始文件名相同
        base_filename = filename.rsplit('.', 1)[0] if '.' in filename else filename
        if title.lower() == base_filename.lower():
            return True
        
        # 检查文件名本身是否需要重命名（即使 title == filename 也要检测这些模式）
        check_str = title.lower()
        
        # 纯十六进制/UUID 风格 (如：a1b2c3d4-e5f6...)
        if re.match(r'^[\da-f\-_]+$', check_str, re.IGNORECASE) and len(check_str) > 6:
            return True
        
        # 时间戳风格 (如：20241208_143052, 1702012345678, 2024-12-08_14-30-52)
        if re.match(r'^\d{8,}[\-_]?\d*$', check_str):
            return True
        if re.match(r'^\d{4}[\-_]\d{2}[\-_]\d{2}', check_str):
            return True
        
        # 截屏/录屏等系统自动命名
        screenshot_patterns = [
            r'^screenshot', r'^screen\s*shot', r'^截屏', r'^截图',
            r'^屏幕快照', r'^屏幕录制', r'^screen\s*recording',
            r'^img[_\-]?\d+', r'^image[_\-]?\d+', r'^photo[_\-]?\d+',
            r'^pic[_\-]?\d+', r'^dsc[_\-]?\d+', r'^dcim',
            r'^微信图片', r'^qq图片', r'^wechat', r'^wx_',
        ]
        for pattern in screenshot_patterns:
            if re.match(pattern, check_str, re.IGNORECASE):
                return True
        
        # 信息量检测：非字母数字内容太少
        non_alnum = re.sub(r'[\d\s\-_\.\,\(\)\[\]]', '', title)
        if len(non_alnum) < len(title) * 0.25:
            return True
        
        # 常见无意义名称模式
        garbage_patterns = [
            r'^page\s*\d+', r'^第\d+页', r'^\d+\s*$', r'^untitled', 
            r'^无标题', r'^document\d*', r'^file\d*', r'^新建',
            r'^新文档', r'^new\s*doc', r'^copy\s*of', r'^副本',
            r'^temp', r'^tmp', r'^draft', r'^草稿', r'^\(\d+\)$',
        ]
        for pattern in garbage_patterns:
            if re.match(pattern, check_str, re.IGNORECASE):
                return True
        
        return False

    async def process_document_task(self, document_id: int):
        """Main processing task."""
        try:
            logger.info(f"Starting processing for doc {document_id}")
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
                # OCR/解析阶段占 95% 的进度 (0% - 95%)
                overall_progress = pct * 0.95
                await self.update_status(document_id, "parsing", msg, overall_progress)

            try:
                # 使用统一的 parse 接口，支持所有格式
                # 智能路由会自动选择最佳解析引擎 (RapidOCR/MarkItDown/etc)
                parsed = await parser.parse(file_path, file_type, update_progress_callback=progress_callback)
            except Exception as e:
                logger.error(f"Parsing failed: {e}")
                await self.update_status(document_id, "failed", f"Parsing error: {str(e)}", 0.0)
                return

            # Update Content in DB
            final_title = parsed.title or document.title
            
            # 始终尝试 LLM 生成标题（除非原标题已经很好）
            # 即使解析器提取了标题，也尝试让 LLM 生成更好的标题
            if parsed.content:
                await self.update_status(document_id, "parsing", "正在智能生成标题...", 45.0)
                try:
                    from .llm import llm_service
                    llm_title = await llm_service.generate_document_title(
                        parsed.content, 
                        document.filename
                    )
                    
                    # 验证 LLM 生成的标题质量
                    if llm_title and llm_title != "未命名文档":
                        import re
                        is_valid = (
                            len(llm_title) >= 4 and
                            not re.match(r'^[,，。.、;；:：!！?？]', llm_title.strip()) and
                            not llm_title.strip().lower().startswith('including') and
                            not llm_title.strip().lower().startswith('and ') and
                            llm_title.count(' ') < len(llm_title) / 2 and  # 不能全是空格
                            re.search(r'[a-zA-Z\u4e00-\u9fa5]', llm_title)  # 必须包含字母或中文
                        )
                        
                        if is_valid:
                            # 比较 LLM 标题和解析器标题的质量
                            use_llm_title = True
                            if final_title and len(final_title) >= 4:
                                # 如果原标题包含更多有意义的中文/英文字符，可能更好
                                orig_meaningful = len(re.findall(r'[a-zA-Z\u4e00-\u9fa5]', final_title))
                                llm_meaningful = len(re.findall(r'[a-zA-Z\u4e00-\u9fa5]', llm_title))
                                
                                # 原标题不是从文件名派生且质量不错时保留
                                orig_looks_good = (
                                    orig_meaningful >= 4 and
                                    not self._should_generate_title(final_title, document.filename)
                                )
                                
                                # 如果原标题质量很好，但 LLM 标题更长更有信息量，还是用 LLM
                                if orig_looks_good and llm_meaningful <= orig_meaningful * 0.8:
                                    use_llm_title = False
                            
                            if use_llm_title:
                                final_title = llm_title
                                logger.info(f"Generated LLM title for doc {document_id}: {llm_title}")
                        else:
                            logger.warning(f"LLM title invalid, rejected: {llm_title}")
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
                
                result = await db.execute(select(Document).where(Document.id == document_id))
                fresh_doc = result.scalar_one()

            # 2. Embedding Phase (占 5% 的进度: 95% - 100%)
            await self.update_status(document_id, "embedding", "Generating embeddings...", 95.0)
            
            async with get_db_context() as db:
                await indexing_service.sync_document(fresh_doc, parsed.content, db)
                await db.commit()

            # 3. Complete
            await self.update_status(document_id, "completed", "Ready", 100.0)
            logger.info(f"Processing complete for doc {document_id}")
            
            # 4. 后台预生成 AI 洞察（不阻塞，加速后续访问）
            try:
                asyncio.create_task(self._pregenerate_insights(document_id))
            except Exception as e:
                logger.warning(f"Failed to schedule insights generation: {e}")

        except Exception as e:
            logger.exception(f"Processing failed for doc {document_id}")
            await self.update_status(document_id, "failed", f"System error: {str(e)}", 0.0)

    async def _pregenerate_insights(self, document_id: int):
        """后台预生成 AI 洞察（摘要、关键词、推荐问题），加速后续访问"""
        import httpx
        try:
            # 使用 httpx 调用自己的 API 端点来生成洞察
            # 这样可以复用已有的逻辑并确保缓存被填充
            async with httpx.AsyncClient() as client:
                # 本地调用，使用内部端口
                response = await client.get(
                    f"http://127.0.0.1:8000/api/insights/documents/{document_id}/insights",
                    timeout=180.0  # 洞察生成可能需要较长时间
                )
                if response.status_code == 200:
                    logger.info(f"Successfully pre-generated insights for doc {document_id}")
                else:
                    logger.warning(f"Failed to pre-generate insights for doc {document_id}: {response.status_code}")
        except Exception as e:
            logger.warning(f"Pre-generate insights failed for doc {document_id}: {e}")

# Singleton
background_processor = BackgroundProcessor()
