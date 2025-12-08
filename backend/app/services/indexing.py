"""
Atlas MVP - Indexing Service
"""
from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Document, Chunk
from ..database import get_db_context
from .parser import parser, TextChunk
from .llm import llm_service
from .vector_store import vector_store
from .bm25 import bm25_index, BM25Document


class IndexingService:
    """Service for indexing documents."""

    async def index_document(self, document: Document, content: str, db: AsyncSession) -> int:
        """Index a document: parse, chunk, embed, and store."""
        # Chunk the content
        chunks = parser.chunk_text(content)

        if not chunks:
            return 0

        # Create chunk records
        chunk_records = []
        for chunk in chunks:
            chunk_record = Chunk(
                document_id=document.id,
                content=chunk.content,
                chunk_index=chunk.index,
                start_char=chunk.start_char,
                end_char=chunk.end_char,
                meta_data={},
            )
            db.add(chunk_record)
            chunk_records.append(chunk_record)

        await db.flush()  # Get IDs

        # Get embeddings for all chunks
        chunk_texts = [c.content for c in chunks]
        embeddings = await llm_service.embed(chunk_texts)

        # Store in vector store
        ids = [f"chunk_{cr.id}" for cr in chunk_records]
        metadatas = [
            {
                "document_id": document.id,
                "chunk_index": chunk.index,
                "filename": document.filename,
            }
            for chunk in chunks
        ]

        vector_store.add(
            ids=ids,
            embeddings=embeddings,
            documents=chunk_texts,
            metadatas=metadatas,
        )

        # Add to BM25 index
        bm25_docs = [
            BM25Document(
                id=f"chunk_{cr.id}",
                content=chunk.content,
                metadata={
                    "document_id": document.id,
                    "chunk_index": chunk.index,
                    "filename": document.filename,
                },
            )
            for cr, chunk in zip(chunk_records, chunks)
        ]
        bm25_index.add_documents(bm25_docs)
        
        # 持久化 BM25 索引
        bm25_index.save()

        return len(chunk_records)

    async def remove_document(self, document_id: int) -> None:
        """Remove a document from all indexes."""
        # Remove from vector store
        vector_store.delete_by_document(document_id)

        # Remove from BM25 index
        bm25_index.remove_by_document_id(document_id)
        
        # 持久化 BM25 索引
        bm25_index.save()

    async def rebuild_index(self) -> int:
        """Rebuild the entire index from database."""
        async with get_db_context() as db:
            # Get all chunks with documents
            result = await db.execute(
                select(Chunk, Document)
                .join(Document, Chunk.document_id == Document.id)
                .order_by(Chunk.id)
            )
            rows = result.all()

            if not rows:
                return 0

            # Clear existing indexes
            bm25_index.clear()

            # Process in batches
            batch_size = 50
            total = 0

            for i in range(0, len(rows), batch_size):
                batch = rows[i:i + batch_size]

                chunk_texts = [chunk.content for chunk, _ in batch]
                embeddings = await llm_service.embed(chunk_texts)

                ids = []
                metadatas = []
                bm25_docs = []

                for (chunk, doc), embedding in zip(batch, embeddings):
                    chunk_id = f"chunk_{chunk.id}"
                    ids.append(chunk_id)

                    metadata = {
                        "document_id": doc.id,
                        "chunk_index": chunk.chunk_index,
                        "filename": doc.filename,
                    }
                    metadatas.append(metadata)

                    bm25_docs.append(BM25Document(
                        id=chunk_id,
                        content=chunk.content,
                        metadata=metadata,
                    ))

                # Update vector store (delete and re-add)
                for chunk_id in ids:
                    try:
                        vector_store.delete(ids=[chunk_id])
                    except Exception:
                        pass

                vector_store.add(
                    ids=ids,
                    embeddings=embeddings,
                    documents=chunk_texts,
                    metadatas=metadatas,
                )

                bm25_index.add_documents(bm25_docs)
                total += len(batch)

            # 持久化 BM25 索引
            bm25_index.save()
            
            return total


# Singleton instance
indexing_service = IndexingService()
