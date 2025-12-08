"""
Atlas MVP - Search API Routes
"""
from typing import Optional

from fastapi import APIRouter, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..services import hybrid_search

router = APIRouter()


@router.get("")
async def search(
    query: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
    document_id: Optional[int] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Perform hybrid search across documents."""
    if not query.strip():
        return {"results": [], "total": 0}

    results = await hybrid_search.search(
        query=query,
        top_k=limit,
        document_id=document_id,
    )

    return {
        "results": [
            {
                "chunk_id": r.chunk_id,
                "document_id": r.document_id,
                "filename": r.filename,
                "preview": r.preview,
                "score": r.score,
            }
            for r in results
        ],
        "total": len(results),
        "query": query,
    }


@router.get("/quick")
async def quick_search(
    query: str = Query(..., min_length=1),
    limit: int = Query(default=5, ge=1, le=20),
):
    """Quick search for command palette."""
    if not query.strip():
        return {"results": []}

    results = await hybrid_search.quick_search(
        query=query,
        top_k=limit,
    )

    return {
        "results": [
            {
                "chunk_id": r.chunk_id,
                "document_id": r.document_id,
                "filename": r.filename,
                "preview": r.preview,
                "score": r.score,
            }
            for r in results
        ],
    }
