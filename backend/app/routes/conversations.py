from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
import json
from datetime import datetime

from ..database import get_db
from ..services.conversation import ConversationService
from ..schemas.conversation import (
    ConversationResponse, 
    ConversationDetailResponse, 
    ConversationUpdate,
    MessageCreate,
    MessageResponse
)
from ..services.rag import rag_service

router = APIRouter()


@router.get("/", response_model=List[ConversationResponse])
async def list_conversations(
    search: str = None,
    db: AsyncSession = Depends(get_db)
):
    service = ConversationService(db)
    conversations = await service.list(search)
    return conversations

@router.post("/", response_model=ConversationResponse)
async def create_conversation(db: AsyncSession = Depends(get_db)):
    service = ConversationService(db)
    return await service.create()

@router.get("/{id}", response_model=ConversationDetailResponse)
async def get_conversation(
    id: str,
    db: AsyncSession = Depends(get_db)
):
    service = ConversationService(db)
    conversation = await service.get(id)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Transform messages sources_json
    messages = []
    for msg in conversation.messages:
        msg_dict = {
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "timestamp": msg.timestamp,
            "sources": json.loads(msg.sources_json) if msg.sources_json else None
        }
        messages.append(msg_dict)
    
    # Sort messages by timestamp
    messages.sort(key=lambda x: x["timestamp"])
        
    return {
        "id": conversation.id,
        "title": conversation.title,
        "created_at": conversation.created_at,
        "updated_at": conversation.updated_at,
        "messages": messages,
        "message_count": len(messages)
    }

@router.patch("/{id}", response_model=ConversationResponse)
async def update_conversation(
    id: str,
    data: ConversationUpdate,
    db: AsyncSession = Depends(get_db)
):
    service = ConversationService(db)
    conversation = await service.update_title(id, data.title)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation

@router.delete("/{id}")
async def delete_conversation(
    id: str,
    db: AsyncSession = Depends(get_db)
):
    service = ConversationService(db)
    success = await service.delete(id)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "success"}

@router.post("/{id}/messages", response_model=MessageResponse)
async def send_message(
    id: str,
    data: MessageCreate,
    db: AsyncSession = Depends(get_db)
):
    service = ConversationService(db)
    
    # 1. Save User Message
    await service.add_message(id, "user", data.message)
    
    # 2. 获取对话历史上下文（最近20轮）
    chat_history = await service.get_chat_history(id, max_turns=20)
    
    # 3. Get AI Response with chat history context
    result = await rag_service.answer(
        question=data.message,
        db=db,
        conversation_id=id,
        chat_history=chat_history,  # 传入对话历史
    )
    
    # 4. 后台任务：自动生成标题（第一次对话后）
    conversation = await service.get(id)
    if conversation:
        # 第一次完整对话（1条用户 + 1条助手 = 2条消息）后生成标题
        if len(conversation.messages) == 2 and conversation.title == "新对话":
            try:
                await service.auto_generate_title(id)
            except Exception as e:
                print(f"Warning: Failed to auto-generate title: {e}")
        
        # 5. 每5条消息向量化一次
        if len(conversation.messages) % 5 == 0:
            try:
                await service.vectorize_conversation(id)
            except Exception as e:
                print(f"Warning: Failed to vectorize conversation: {e}")
    
    return {
        "id": "temp_id_returned_in_next_fetch",
        "role": "assistant",
        "content": result["response"],
        "timestamp": datetime.utcnow(),
        "sources": result["sources"]
    }


@router.post("/{id}/vectorize")
async def vectorize_conversation(
    id: str,
    db: AsyncSession = Depends(get_db)
):
    """手动触发对话向量化"""
    service = ConversationService(db)
    doc_id = await service.vectorize_conversation(id)
    if doc_id:
        return {"status": "success", "document_id": doc_id}
    else:
        raise HTTPException(status_code=404, detail="Conversation not found or empty")


# 存储正在进行流式响应的对话ID，防止并发请求
_streaming_conversations: set = set()
import asyncio
_streaming_lock = asyncio.Lock()


@router.post("/{id}/messages/stream")
async def send_message_stream(
    id: str,
    data: MessageCreate,
    db: AsyncSession = Depends(get_db)
):
    """流式发送消息并获取回复"""
    
    # 检查是否已有该对话的流式请求正在进行
    async with _streaming_lock:
        if id in _streaming_conversations:
            raise HTTPException(
                status_code=429, 
                detail="该对话正在处理中，请稍后再试"
            )
        _streaming_conversations.add(id)
    
    try:
        service = ConversationService(db)
        
        # 1. 保存用户消息
        await service.add_message(id, "user", data.message)
        
        # 2. 获取对话历史
        chat_history = await service.get_chat_history(id, max_turns=20)
        
        # 3. 创建流式响应生成器
        async def generate():
            full_response = ""
            sources_data = []
            
            try:
                async for chunk in rag_service.answer_stream(
                    question=data.message,
                    chat_history=chat_history,
                ):
                    yield chunk
                    
                    # 解析完成信号
                    if chunk.startswith("data: "):
                        try:
                            event_data = json.loads(chunk[6:].strip())
                            if event_data.get("type") == "done":
                                full_response = event_data["data"]["response"]
                                sources_data = event_data["data"]["sources"]
                        except:
                            pass
                
                # 流结束后保存助手消息 - 使用新的独立 Session
                if full_response:
                    from ..database import get_db_context
                    
                    async with get_db_context() as new_db:
                        new_service = ConversationService(new_db)
                        await new_service.add_message(id, "assistant", full_response, sources_data)
                        
                        # 后台任务
                        conversation = await new_service.get(id)
                        if conversation:
                            # 自动生成标题
                            if len(conversation.messages) == 2 and conversation.title == "新对话":
                                try:
                                    await new_service.auto_generate_title(id)
                                except:
                                    pass
                            
                            # 每5条消息向量化一次
                            if len(conversation.messages) % 5 == 0:
                                try:
                                    await new_service.vectorize_conversation(id)
                                except:
                                    pass
            finally:
                # 无论成功还是失败，都要从正在处理集合中移除
                async with _streaming_lock:
                    _streaming_conversations.discard(id)
        
        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    except HTTPException:
        # 如果是 HTTP 异常，需要清理状态
        async with _streaming_lock:
            _streaming_conversations.discard(id)
        raise
    except Exception as e:
        # 其他异常也需要清理
        async with _streaming_lock:
            _streaming_conversations.discard(id)
        raise
