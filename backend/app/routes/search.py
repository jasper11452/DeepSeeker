"""
Atlas MVP - Search API Routes
"""
from typing import Optional, Dict, Any

from fastapi import APIRouter, Query, Depends, BackgroundTasks
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


@router.post("/index/rebuild")
async def rebuild_index(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger a full index rebuild in the background."""
    from ..services.indexing import indexing_service
    
    async def run_rebuild():
        print("Starting index rebuild...")
        try:
            count = await indexing_service.rebuild_index()
            print(f"Index rebuild complete. Processed {count} chunks.")
        except Exception as e:
            print(f"Index rebuild failed: {e}")
        
    background_tasks.add_task(run_rebuild)
    
    return {"message": "Index rebuild started in background."}


@router.get("/index/health")
async def check_index_health(
    db: AsyncSession = Depends(get_db),
):
    """Check consistency of search indexes."""
    from ..services.indexing import indexing_service
    report = await indexing_service.check_consistency(db)
    return report
