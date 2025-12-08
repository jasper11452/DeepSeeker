"""
Atlas - 智能洞察 API Routes
提供文档摘要、关键词、chunk详情等功能
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List

from ..database import get_db
from ..models import Document, Chunk
from ..services.llm import llm_service
from ..services.search import hybrid_search, SearchResult

router = APIRouter()


class DocumentInsight(BaseModel):
    """文档洞察数据"""
    document_id: int
    summary: Optional[str] = None
    keywords: List[str] = []
    suggested_questions: List[str] = []
    is_cached: bool = False


class ChunkDetail(BaseModel):
    """Chunk 详细信息"""
    id: int
    document_id: int
    content: str
    chunk_index: int
    start_char: Optional[int] = None
    end_char: Optional[int] = None
    filename: Optional[str] = None
    title: Optional[str] = None
    # 上下文：前后各一个 chunk
    prev_chunk: Optional[str] = None
    next_chunk: Optional[str] = None


class RelevantChunk(BaseModel):
    """相关知识片段"""
    chunk_id: int
    document_id: int
    filename: str
    preview: str
    score: float
    content: str


async def _generate_suggested_questions(content: str, title: str) -> List[str]:
    """根据文档内容生成推荐问题"""
    if not content or len(content) < 50:
        return []
    
    # 只取前2000字符
    truncated = content[:2000] if len(content) > 2000 else content
    # /no_think 关闭 Qwen3 的思考模式
    prompt = f"/no_think 根据以下内容生成2个问题，每行一个：\n{truncated}\n问题："
    
    try:
        response = await llm_service.chat([
            {"role": "user", "content": prompt}
        ], temperature=0.5, max_tokens=200)
        
        questions = [
            line.strip().lstrip("0123456789.、）)").strip()
            for line in response.strip().split("\n")
            if line.strip() and len(line.strip()) > 5
        ]
        return questions[:3]
    except Exception as e:
        print(f"_generate_suggested_questions error: {type(e).__name__}: {e}")
        return []


@router.get("/documents/{document_id}/insights")
async def get_document_insights(
    document_id: int,
    force_refresh: bool = False,
    db: AsyncSession = Depends(get_db),
) -> DocumentInsight:
    """
    获取文档的 AI 洞察（摘要和关键词）。
    - 优先从 meta_data 缓存读取
    - 若无缓存或 force_refresh，则重新生成
    """
    result = await db.execute(
        select(Document).where(Document.id == document_id)
    )
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # 检查缓存
    cached_summary = document.meta_data.get("ai_summary") if document.meta_data else None
    cached_keywords = document.meta_data.get("ai_keywords") if document.meta_data else None
    cached_questions = document.meta_data.get("ai_questions") if document.meta_data else None
    
    if cached_summary and cached_keywords and cached_questions and not force_refresh:
        return DocumentInsight(
            document_id=document_id,
            summary=cached_summary,
            keywords=cached_keywords,
            suggested_questions=cached_questions,
            is_cached=True,
        )
    
    # 如果没有内容，返回空洞察
    if not document.content or not document.content.strip():
        return DocumentInsight(
            document_id=document_id,
            summary="暂无内容摘要",
            keywords=[],
            suggested_questions=[],
            is_cached=False,
        )
    
    # 生成新的洞察 - 串行执行避免并发问题
    import asyncio
    
    # 1. 生成摘要
    try:
        summary = await asyncio.wait_for(
            llm_service.generate_summary(document.content, max_length=150),
            timeout=120.0
        )
    except asyncio.TimeoutError:
        print("generate_summary timed out")
        summary = document.content[:200] + "..."
    except Exception as e:
        print(f"generate_summary error: {e}")
        summary = document.content[:200] + "..."
    
    # 2. 提取关键词
    try:
        keywords = await asyncio.wait_for(
            llm_service.extract_concepts(document.content),
            timeout=120.0
        )
    except asyncio.TimeoutError:
        print("extract_concepts timed out")
        keywords = []
    except Exception as e:
        print(f"extract_concepts error: {e}")
        keywords = []
    
    # 3. 生成推荐问题
    try:
        questions = await asyncio.wait_for(
            _generate_suggested_questions(document.content, document.title or document.filename),
            timeout=120.0
        )
    except asyncio.TimeoutError:
        print("_generate_suggested_questions timed out")
        questions = ["这篇文档的主要内容是什么？", "文档中有哪些关键信息？"]
    except Exception as e:
        print(f"_generate_suggested_questions error: {e}")
        questions = ["这篇文档的主要内容是什么？", "文档中有哪些关键信息？"]
    
    # 保存到缓存
    new_meta = document.meta_data.copy() if document.meta_data else {}
    new_meta["ai_summary"] = summary
    new_meta["ai_keywords"] = keywords
    new_meta["ai_questions"] = questions
    document.meta_data = new_meta
    await db.commit()
    
    return DocumentInsight(
        document_id=document_id,
        summary=summary,
        keywords=keywords,
        suggested_questions=questions,
        is_cached=False,
    )


@router.post("/documents/{document_id}/insights/refresh")
async def refresh_document_insights(
    document_id: int,
    db: AsyncSession = Depends(get_db),
) -> DocumentInsight:
    """强制刷新文档洞察"""
    return await get_document_insights(document_id, force_refresh=True, db=db)


@router.get("/chunks/{chunk_id}")
async def get_chunk_detail(
    chunk_id: int,
    db: AsyncSession = Depends(get_db),
) -> ChunkDetail:
    """
    获取单个 chunk 的详细信息，包括上下文
    """
    # 获取目标 chunk
    result = await db.execute(
        select(Chunk, Document)
        .join(Document, Chunk.document_id == Document.id)
        .where(Chunk.id == chunk_id)
    )
    row = result.first()
    
    if not row:
        raise HTTPException(status_code=404, detail="Chunk not found")
    
    chunk, document = row
    
    # 获取上下文 chunks
    prev_result = await db.execute(
        select(Chunk)
        .where(Chunk.document_id == chunk.document_id)
        .where(Chunk.chunk_index == chunk.chunk_index - 1)
    )
    prev_chunk = prev_result.scalar_one_or_none()
    
    next_result = await db.execute(
        select(Chunk)
        .where(Chunk.document_id == chunk.document_id)
        .where(Chunk.chunk_index == chunk.chunk_index + 1)
    )
    next_chunk = next_result.scalar_one_or_none()
    
    return ChunkDetail(
        id=chunk.id,
        document_id=chunk.document_id,
        content=chunk.content,
        chunk_index=chunk.chunk_index,
        start_char=chunk.start_char,
        end_char=chunk.end_char,
        filename=document.filename,
        title=document.title,
        prev_chunk=prev_chunk.content if prev_chunk else None,
        next_chunk=next_chunk.content if next_chunk else None,
    )


@router.get("/recommend")
async def get_recommendations(
    query: str,
    limit: int = 3,
) -> List[RelevantChunk]:
    """
    实时推荐：根据查询返回最相关的知识片段
    用于用户输入时的边栏实时推荐
    """
    if not query or not query.strip():
        return []
    
    try:
        results = await hybrid_search.quick_search(query, top_k=limit)
        
        return [
            RelevantChunk(
                chunk_id=r.chunk_id,
                document_id=r.document_id,
                filename=r.filename or "未知文档",
                preview=r.preview or r.content[:150],
                score=r.score,
                content=r.content,
            )
            for r in results
        ]
    except Exception:
        return []
