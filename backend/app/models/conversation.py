from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer
from sqlalchemy.orm import relationship
from ..database import Base

class Conversation(Base):
    __tablename__ = "conversations"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    title = Column(String, default="新对话")
    # 关联的文档ID，用于存储对话内容的向量化版本
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")

class Message(Base):
    __tablename__ = "messages"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    conversation_id = Column(String, ForeignKey("conversations.id"))
    role = Column(String)  # 'user' | 'assistant'
    content = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)
    sources_json = Column(Text, nullable=True)  # JSON storage for sources
    
    conversation = relationship("Conversation", back_populates="messages")

