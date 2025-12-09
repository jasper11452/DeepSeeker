"""
DeepSeeker MVP - Knowledge Graph API Routes
"""
from typing import List, Dict, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Document, KnowledgeLink
from ..services import llm_service, vector_store

router = APIRouter()


class BuildGraphRequest(BaseModel):
    """Request to build knowledge graph."""
    threshold: float = 0.5


@router.get("")
async def get_graph(
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Get knowledge graph data."""
    # Get documents as nodes
    result = await db.execute(
        select(Document)
        .order_by(Document.created_at.desc())
        .limit(limit)
    )
    documents = result.scalars().all()

    # Get links
    doc_ids = [d.id for d in documents]
    if doc_ids:
        links_result = await db.execute(
            select(KnowledgeLink)
            .where(
                KnowledgeLink.source_id.in_(doc_ids),
                KnowledgeLink.target_id.in_(doc_ids),
            )
        )
        links = links_result.scalars().all()
    else:
        links = []

    # Build nodes
    nodes = []
    for doc in documents:
        nodes.append({
            "id": f"doc_{doc.id}",
            "label": doc.title or doc.filename,
            "type": "document",
            "file_type": doc.file_type,
            "metadata": {
                "document_id": doc.id,
                "filename": doc.filename,
                "created_at": doc.created_at.isoformat(),
            },
        })

    # Build edges
    edges = []
    for link in links:
        edges.append({
            "id": f"link_{link.id}",
            "source": f"doc_{link.source_id}",
            "target": f"doc_{link.target_id}",
            "type": link.link_type,
            "strength": link.strength,
        })

    return {
        "nodes": nodes,
        "edges": edges,
        "total_nodes": len(nodes),
        "total_edges": len(edges),
    }


@router.post("/build")
async def build_graph(
    request: BuildGraphRequest,
    db: AsyncSession = Depends(get_db),
):
    """Build or rebuild knowledge graph based on document similarity."""
    # Get all documents
    result = await db.execute(select(Document))
    documents = result.scalars().all()

    if len(documents) < 2:
        return {"message": "Need at least 2 documents to build graph", "links_created": 0}

    # Clear existing links
    await db.execute(
        KnowledgeLink.__table__.delete()
    )

    # Get embeddings for document titles/summaries
    doc_texts = [
        (doc.title or doc.filename) + "\n" + (doc.content[:500] if doc.content else "")
        for doc in documents
    ]

    try:
        embeddings = await llm_service.embed(doc_texts)
    except Exception as e:
        return {"message": f"Error getting embeddings: {str(e)}", "links_created": 0}

    # Calculate similarities and create links
    links_created = 0
    threshold = request.threshold

    for i, doc1 in enumerate(documents):
        for j, doc2 in enumerate(documents):
            if i >= j:
                continue

            # Calculate cosine similarity
            emb1 = embeddings[i]
            emb2 = embeddings[j]

            dot_product = sum(a * b for a, b in zip(emb1, emb2))
            norm1 = sum(a * a for a in emb1) ** 0.5
            norm2 = sum(a * a for a in emb2) ** 0.5
            similarity = dot_product / (norm1 * norm2) if norm1 and norm2 else 0

            if similarity >= threshold:
                link = KnowledgeLink(
                    source_id=doc1.id,
                    target_id=doc2.id,
                    link_type="similar",
                    strength=similarity,
                )
                db.add(link)
                links_created += 1

    await db.commit()

    return {
        "message": "Graph built successfully",
        "links_created": links_created,
        "threshold": threshold,
    }


@router.get("/stats")
async def get_graph_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get graph statistics."""
    # Count documents
    doc_count_result = await db.execute(select(func.count(Document.id)))
    doc_count = doc_count_result.scalar()

    # Count links
    link_count_result = await db.execute(select(func.count(KnowledgeLink.id)))
    link_count = link_count_result.scalar()

    # Get vector store count
    vector_count = vector_store.count()

    return {
        "documents": doc_count,
        "links": link_count,
        "vectors": vector_count,
    }
