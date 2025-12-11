"""
DeepSeeker MVP - Vector Store Service (ChromaDB)
"""
from typing import List, Optional, Dict, Any
import chromadb
from chromadb.config import Settings as ChromaSettings

from ..config import get_settings

settings = get_settings()


class VectorStore:
    """Vector store service using ChromaDB."""

    def __init__(self):
        self.client = chromadb.PersistentClient(
            path=settings.chroma_persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self.collection = self.client.get_or_create_collection(
            name="atlas_chunks",
            metadata={"hnsw:space": "cosine"},
        )

    def add(
        self,
        ids: List[str],
        embeddings: List[List[float]],
        documents: List[str],
        metadatas: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Add documents with embeddings to the store."""
        self.collection.add(
            ids=ids,
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas or [{}] * len(ids),
        )

    def query(
        self,
        query_embedding: List[float],
        n_results: int = 10,
        where: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Query similar documents."""
        kwargs = {
            "query_embeddings": [query_embedding],
            "n_results": n_results,
        }
        if where:
            kwargs["where"] = where

        results = self.collection.query(**kwargs)

        return {
            "ids": results["ids"][0] if results["ids"] else [],
            "documents": results["documents"][0] if results["documents"] else [],
            "metadatas": results["metadatas"][0] if results["metadatas"] else [],
            "distances": results["distances"][0] if results["distances"] else [],
        }

    def delete(self, ids: Optional[List[str]] = None, where: Optional[Dict[str, Any]] = None) -> None:
        """Delete documents from the store."""
        if ids:
            self.collection.delete(ids=ids)
        elif where:
            self.collection.delete(where=where)

    def delete_by_document(self, document_id: int) -> None:
        """Delete all chunks for a document."""
        self.collection.delete(where={"document_id": document_id})

    def count(self) -> int:
        """Get total number of documents in the store."""
        return self.collection.count()

    def get_all_ids(self) -> List[str]:
        """Get all document IDs."""
        result = self.collection.get()
        return result["ids"] if result["ids"] else []

    def get_document_chunks(self, document_id: int) -> List[Any]:
        """
        Get all chunks for a document with their embeddings.
        Returns a list of objects with 'embedding' attribute.
        """
        result = self.collection.get(
            where={"document_id": document_id},
            include=["embeddings", "documents", "metadatas"]
        )
        
        chunks = []
        if result["ids"]:
            for i, chunk_id in enumerate(result["ids"]):
                chunk = type('Chunk', (), {
                    'id': chunk_id,
                    'content': result["documents"][i] if result["documents"] else "",
                    'embedding': result["embeddings"][i] if result["embeddings"] is not None else None,
                    'metadata': result["metadatas"][i] if result["metadatas"] else {}
                })()
                chunks.append(chunk)
        
        return chunks

    async def search(
        self,
        query_embedding: List[float],
        top_k: int = 10,
        filter_doc_id: Optional[int] = None
    ) -> List[Any]:
        """
        Search for similar chunks.
        Returns a list of objects with score, document_id, etc.
        """
        where = None
        if filter_doc_id is not None:
            where = {"document_id": {"$ne": filter_doc_id}}
        
        result = self.query(
            query_embedding=query_embedding,
            n_results=top_k,
            where=where
        )
        
        chunks = []
        for i, chunk_id in enumerate(result["ids"]):
            metadata = result["metadatas"][i] if result["metadatas"] else {}
            # Convert distance to similarity score (cosine)
            distance = result["distances"][i] if result["distances"] else 1.0
            score = 1.0 - distance  # ChromaDB returns distance, convert to similarity
            
            chunk = type('SearchResult', (), {
                'chunk_id': chunk_id,
                'document_id': metadata.get('document_id'),
                'content': result["documents"][i] if result["documents"] else "",
                'score': score,
                'metadata': metadata
            })()
            chunks.append(chunk)
        
        return chunks


# Singleton instance
vector_store = VectorStore()
