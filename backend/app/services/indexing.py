"""
Atlas MVP - Indexing Service
"""
from typing import List

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Document, Chunk
from ..database import get_db_context
from .parser import parser, TextChunk
from .llm import llm_service
from .vector_store import vector_store
from .bm25 import bm25_index, BM25Document


class IndexingService:
    """Service for indexing documents."""

    async def sync_document(self, document: Document, content: str, db: AsyncSession) -> int:
        """
        Sync a document: incrementally update chunks, embeddings, and index.
        Returns: total number of current chunks.
        """
        import hashlib

        # 1. Parse and chunk the new content
        new_chunks = parser.chunk_text(content)
        if not new_chunks:
            # Handle empty content: remove all existing chunks
            await self.remove_document(document.id)
            return 0

        # Implement simple content hashing for diffing
        def _content_hash(text: str) -> str:
            return hashlib.md5(text.encode()).hexdigest()

        # 2. Get existing chunks from DB
        result = await db.execute(
            select(Chunk).where(Chunk.document_id == document.id)
        )
        existing_chunks = result.scalars().all()
        
        # Map hash to chunk object
        existing_map = {_content_hash(c.content): c for c in existing_chunks}
        new_map = {_content_hash(c.content): c for c in new_chunks}
        
        # 3. Identify changes
        hashes_to_add = set(new_map.keys()) - set(existing_map.keys())
        hashes_to_remove = set(existing_map.keys()) - set(new_map.keys())
        hashes_to_keep = set(new_map.keys()) & set(existing_map.keys())
        
        # If no changes in content (hashes match), we still might need to update indices if chunk index/order changed
        # But for simplicity and performance, if mostly same, we assume "keep" is fine.
        # Ideally we should update chunk_index if reordered.
        
        # For a robust implementation:
        # - Remove strictly "removed" chunks
        # - Add strictly "new" chunks
        # - Update "keep" chunks to ensure metadata (chunk_index) is correct (DB update only)
        
        # Execute deletions
        if hashes_to_remove:
            remove_chunk_ids = [f"chunk_{existing_map[h].id}" for h in hashes_to_remove]
            
            # DB delete
            for h in hashes_to_remove:
                await db.delete(existing_map[h])
            
            # Vector store delete
            try:
                vector_store.delete(ids=remove_chunk_ids)
            except Exception:
                pass
            
            # BM25 delete
            bm25_index.remove_documents(remove_chunk_ids)
            
        # Execute additions
        chunks_to_add_db = [new_map[h] for h in hashes_to_add]
        
        # We need to add them to DB first to get IDs
        added_records = []
        for chunk in chunks_to_add_db:
             chunk_record = Chunk(
                document_id=document.id,
                content=chunk.content,
                chunk_index=chunk.index,
                start_char=chunk.start_char,
                end_char=chunk.end_char,
                meta_data={},
            )
             db.add(chunk_record)
             added_records.append(chunk_record)
             
        # Also update chunk_index for kept chunks
        for h in hashes_to_keep:
            chunk = new_map[h]
            # Find the existing DB record
            db_record = existing_map[h]
            if db_record.chunk_index != chunk.index:
                db_record.chunk_index = chunk.index
                db.add(db_record)
                
        await db.flush() # Commit changes to get IDs
        
        # Index newly added chunks
        if added_records:
            texts = [c.content for c in added_records]
            embeddings = await llm_service.embed(texts)
            
            ids = [f"chunk_{c.id}" for c in added_records]
            metadatas = [
                {
                    "document_id": document.id,
                    "chunk_index": c.chunk_index,
                    "filename": document.filename,
                }
                for c in added_records
            ]
            
            vector_store.add(
                ids=ids,
                embeddings=embeddings,
                documents=texts,
                metadatas=metadatas
            )
            
            bm25_docs = [
                BM25Document(
                    id=f"chunk_{c.id}",
                    content=c.content,
                    metadata={
                        "document_id": document.id,
                        "chunk_index": c.chunk_index,
                        "filename": document.filename,
                    },
                )
                for c in added_records
            ]
            bm25_index.add_documents(bm25_docs)

        # Save BM25
        if hashes_to_remove or hashes_to_add:
            bm25_index.save()

        return len(new_chunks)

    async def remove_document(self, document_id: int) -> None:
        """Remove a document from all indexes."""
        # Remove from vector store
        vector_store.delete_by_document(document_id)

        # Remove from BM25 index
        bm25_index.remove_by_document_id(document_id)
        
        # 持久化 BM25 索引
        bm25_index.save()

    async def check_consistency(self, db: AsyncSession) -> dict:
        """
        Check consistency between Database, Vector Store, and BM25.
        Returns a report of counts and discrepancies.
        """
        # 1. DB Stats
        result = await db.execute(select(func.count(Document.id)).where(Document.status == 'completed'))
        db_doc_count = result.scalar() or 0
        
        result = await db.execute(select(func.count(Chunk.id)))
        db_chunk_count = result.scalar() or 0
        
        # 2. Vector Store Stats
        # Chroma count is simple
        try:
             vector_count = vector_store.collection.count()
        except:
             vector_count = -1
             
        # 3. BM25 Stats
        bm25_count = len(bm25_index.documents)
        
        # 4. Status
        status = "healthy"
        if db_chunk_count != vector_count and vector_count != -1:
            status = "degraded (vector mismatch)"
        if db_chunk_count != bm25_count:
            status = "degraded (bm25 mismatch)"
        if db_chunk_count == 0 and db_doc_count > 0:
             status = "critical (no chunks)"
             
        return {
            "status": status,
            "db_documents": db_doc_count,
            "db_chunks": db_chunk_count,
            "vector_chunks": vector_count,
            "bm25_chunks": bm25_count,
        }

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
            bm25_index.save()
            
            try:
                # Reset vector store if possible or just overwrite
                # vector_store.reset() # Not always available
                pass
            except:
                pass

            # Process in batches
            batch_size = 50
            total = 0

            for i in range(0, len(rows), batch_size):
                batch = rows[i:i + batch_size]

                chunk_texts = [chunk.content for chunk, _ in batch]
                
                # Re-embed is expensive! Ideally we should store embeddings in DB or cache?
                # For now we re-embed which makes rebuild heavy.
                # Assuming this is explicit user action.
                try: 
                    embeddings = await llm_service.embed(chunk_texts)
                except Exception as e:
                     print(f"Embedding failed during rebuild batch {i}: {e}")
                     continue

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
                # Ideally we clear all first, but here we upsert
                vector_store.add(
                    ids=ids,
                    embeddings=embeddings,
                    documents=chunk_texts,
                    metadatas=metadatas,
                )

                bm25_index.add_documents(bm25_docs)
                total += len(batch)
                print(f"Rebuilt index: {total}/{len(rows)}")

            # 持久化 BM25 索引
            bm25_index.save()
            
            return total


# Singleton instance
indexing_service = IndexingService()
