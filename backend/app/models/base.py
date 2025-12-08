from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey, JSON
from sqlalchemy.orm import relationship

from ..database import Base


class Document(Base):
    """Document model for storing uploaded files."""
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    title = Column(String(500), nullable=True)
    file_type = Column(String(50), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_size = Column(Integer, default=0)
    content = Column(Text, nullable=True)
    meta_data = Column(JSON, default=dict)
    
    # Status tracking
    status = Column(String(50), default="pending")  # pending, parsing, embedding, completed, failed
    processing_message = Column(String(255), nullable=True)
    processing_progress = Column(Float, default=0.0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")
    
    # Organization
    folder_id = Column(Integer, ForeignKey("folders.id"), nullable=True)
    folder = relationship("Folder", back_populates="documents")
    tags = relationship("Tag", secondary="document_tags", backref="documents")


class Chunk(Base):
    """Chunk model for document segments."""
    __tablename__ = "chunks"

    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    content = Column(Text, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    start_char = Column(Integer, nullable=True)
    end_char = Column(Integer, nullable=True)
    meta_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    document = relationship("Document", back_populates="chunks")


class KnowledgeLink(Base):
    """Knowledge link model for graph connections."""
    __tablename__ = "knowledge_links"

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    link_type = Column(String(100), default="related")
    strength = Column(Float, default=0.5)
    meta_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)


class SearchHistory(Base):
    """Search history model."""
    __tablename__ = "search_history"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(Text, nullable=False)
    results_count = Column(Integer, default=0)
    meta_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatHistory(Base):
    """Chat history model."""
    __tablename__ = "chat_history"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(100), nullable=True)
    role = Column(String(50), nullable=False)  # user or assistant
    content = Column(Text, nullable=False)
    meta_data = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
