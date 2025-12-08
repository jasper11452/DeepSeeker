"""
Atlas MVP - Chat API Routes
"""
from typing import Optional, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import ChatHistory
from ..services import rag_service

router = APIRouter()


class ChatRequest(BaseModel):
    """Chat request model."""
    message: str
    document_id: Optional[int] = None
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    """Chat response model."""
    response: str
    sources: List[dict]


@router.post("")
async def chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """Send a chat message and get a response."""
    # Get chat history if session_id provided
    chat_history = []
    if request.session_id:
        result = await db.execute(
            select(ChatHistory)
            .where(ChatHistory.session_id == request.session_id)
            .order_by(ChatHistory.created_at.desc())
            .limit(10)
        )
        history = result.scalars().all()

        chat_history = [
            {"role": h.role, "content": h.content}
            for h in reversed(history)
        ]

    # Get RAG response
    result = await rag_service.answer(
        question=request.message,
        document_id=request.document_id,
        chat_history=chat_history,
    )

    # Save to history if session_id provided
    if request.session_id:
        # Save user message
        user_msg = ChatHistory(
            session_id=request.session_id,
            role="user",
            content=request.message,
        )
        db.add(user_msg)

        # Save assistant response
        assistant_msg = ChatHistory(
            session_id=request.session_id,
            role="assistant",
            content=result["response"],
            meta_data={"sources": result["sources"]},
        )
        db.add(assistant_msg)
        await db.commit()

    return {
        "response": result["response"],
        "sources": result["sources"],
    }


@router.get("/history/{session_id}")
async def get_chat_history(
    session_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """Get chat history for a session."""
    result = await db.execute(
        select(ChatHistory)
        .where(ChatHistory.session_id == session_id)
        .order_by(ChatHistory.created_at.asc())
        .limit(limit)
    )
    history = result.scalars().all()

    return {
        "messages": [
            {
                "id": h.id,
                "role": h.role,
                "content": h.content,
                "created_at": h.created_at.isoformat(),
            }
            for h in history
        ],
        "session_id": session_id,
    }


@router.delete("/history/{session_id}")
async def clear_chat_history(
    session_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Clear chat history for a session."""
    result = await db.execute(
        select(ChatHistory).where(ChatHistory.session_id == session_id)
    )
    messages = result.scalars().all()

    for msg in messages:
        await db.delete(msg)

    await db.commit()

    return {"message": "Chat history cleared"}
