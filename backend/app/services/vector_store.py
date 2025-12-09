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


# Singleton instance
vector_store = VectorStore()
