from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, desc
from sqlalchemy.orm import selectinload
from typing import List, Optional, Dict, Any
from uuid import uuid4
import json
from datetime import datetime

from ..models.conversation import Conversation, Message
from ..models import Document, Chunk


class ConversationService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.max_context_turns = 20  # 最多取20轮对话历史

    async def create(self) -> Conversation:
        conversation = Conversation()
        self.db.add(conversation)
        await self.db.commit()
        await self.db.refresh(conversation)
        return conversation

    async def list(self, search: str = None) -> List[Conversation]:
        query = select(Conversation).order_by(desc(Conversation.updated_at))
        if search:
            query = query.where(Conversation.title.ilike(f"%{search}%"))
        
        result = await self.db.execute(query)
        conversations = result.scalars().all()
        return conversations

    async def get(self, id: str) -> Optional[Conversation]:
        query = select(Conversation).options(
            selectinload(Conversation.messages)
        ).where(Conversation.id == id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def update_title(self, id: str, title: str) -> Optional[Conversation]:
        query = update(Conversation).where(Conversation.id == id).values(title=title).returning(Conversation)
        result = await self.db.execute(query)
        await self.db.commit()
        return result.scalar_one_or_none()

    async def delete(self, id: str) -> bool:
        # 先获取对话，检查是否有关联文档
        conversation = await self.get(id)
        if conversation and conversation.document_id:
            # 删除关联的对话文档
            from .indexing import indexing_service
            await indexing_service.remove_document(conversation.document_id)
            await self.db.execute(delete(Document).where(Document.id == conversation.document_id))
        
        query = delete(Conversation).where(Conversation.id == id)
        result = await self.db.execute(query)
        await self.db.commit()
        return result.rowcount > 0

    async def add_message(self, conversation_id: str, role: str, content: str, sources: list = None) -> Message:
        # Ensure conversation exists and update updated_at
        await self.update_conversation_timestamp(conversation_id)
        
        message = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            sources_json=json.dumps(sources) if sources else None
        )
        self.db.add(message)
        await self.db.commit()
        await self.db.refresh(message)
        return message

    async def update_conversation_timestamp(self, conversation_id: str):
        query = update(Conversation).where(Conversation.id == conversation_id).values(updated_at=datetime.utcnow())
        await self.db.execute(query)

    async def auto_generate_title(self, conversation_id: str) -> Optional[str]:
        """使用LLM自动生成对话标题"""
        from .llm import llm_service
        
        conversation = await self.get(conversation_id)
        if not conversation or not conversation.messages:
            return None
        
        # 只在标题仍为默认值时才自动生成
        if conversation.title != "新对话":
            return conversation.title
        
        # 获取对话历史
        messages = sorted(conversation.messages, key=lambda x: x.timestamp)
        chat_history = [
            {"role": msg.role, "content": msg.content}
            for msg in messages[:6]
        ]
        
        if not chat_history:
            return None
        
        try:
            new_title = await llm_service.generate_conversation_title(chat_history)
            if new_title and new_title != "新对话":
                await self.update_title(conversation_id, new_title)
                return new_title
        except Exception as e:
            print(f"Warning: Failed to generate title: {e}")
        
        return None


    async def get_chat_history(self, conversation_id: str, max_turns: int = None) -> List[Dict[str, str]]:
        """获取对话历史，用于上下文"""
        if max_turns is None:
            max_turns = self.max_context_turns
        
        conversation = await self.get(conversation_id)
        if not conversation or not conversation.messages:
            return []
        
        # 按时间排序
        messages = sorted(conversation.messages, key=lambda x: x.timestamp)
        
        # 取最近的 max_turns * 2 条消息（因为一轮 = user + assistant）
        recent_messages = messages[-(max_turns * 2):]
        
        return [
            {"role": msg.role, "content": msg.content}
            for msg in recent_messages
        ]

    async def vectorize_conversation(self, conversation_id: str) -> Optional[int]:
        """
        将对话内容向量化并存储为文档。
        返回文档ID。
        """
        from .indexing import indexing_service
        
        conversation = await self.get(conversation_id)
        if not conversation or not conversation.messages:
            return None
        
        # 按时间排序
        messages = sorted(conversation.messages, key=lambda x: x.timestamp)
        
        # 构建对话内容文本
        content_parts = []
        for msg in messages:
            role_label = "用户" if msg.role == "user" else "助手"
            content_parts.append(f"【{role_label}】{msg.content}")
        
        conversation_content = "\n\n".join(content_parts)
        
        # 检查是否已有关联文档
        if conversation.document_id:
            # 更新现有文档
            result = await self.db.execute(
                select(Document).where(Document.id == conversation.document_id)
            )
            doc = result.scalar_one_or_none()
            if doc:
                doc.content = conversation_content
                doc.file_size = len(conversation_content.encode('utf-8'))
                doc.title = f"对话: {conversation.title}"
                
                # 删除旧的索引
                await indexing_service.remove_document(doc.id)
                await self.db.execute(delete(Chunk).where(Chunk.document_id == doc.id))
                
                # 重新索引
                chunk_count = await indexing_service.sync_document(
                    document=doc,
                    content=conversation_content,
                    db=self.db,
                )
                await self.db.commit()
                return doc.id
        
        # 创建新文档
        doc = Document(
            filename=f"conversation_{conversation_id}.md",
            title=f"对话: {conversation.title}",
            file_type="md",
            file_path=f"conversation://{conversation_id}",
            file_size=len(conversation_content.encode('utf-8')),
            content=conversation_content,
            meta_data={
                "is_conversation": True,
                "conversation_id": conversation_id,
                "message_count": len(messages),
            },
        )
        self.db.add(doc)
        await self.db.flush()
        
        # 索引文档
        chunk_count = await indexing_service.sync_document(
            document=doc,
            content=conversation_content,
            db=self.db,
        )
        
        # 更新对话的 document_id
        conversation.document_id = doc.id
        await self.db.commit()
        
        return doc.id
