"""
Atlas MVP - Hybrid Search Service
"""
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from ..config import get_settings
from .vector_store import vector_store
from .bm25 import bm25_index
from .llm import llm_service

settings = get_settings()


@dataclass
class SearchResult:
    """Search result item."""
    chunk_id: int
    document_id: int
    content: str
    score: float
    filename: Optional[str] = None
    preview: Optional[str] = None
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}
        if self.preview is None:
            # Default fallback if not provided
            self.preview = self.content[:200] + "..." if len(self.content) > 200 else self.content


class HybridSearch:
    """Hybrid search combining vector and BM25 search."""

    def __init__(self):
        self.bm25_weight = settings.bm25_weight
        self.vector_weight = settings.vector_weight
        self.top_k_retrieval = settings.top_k_retrieval

    def _highlight_content(self, content: str, query: str) -> str:
        """Generate a highlighted preview snippet."""
        import jieba
        import re
        
        # Tokenize query
        query_tokens = list(set(jieba.cut_for_search(query)))
        if not query_tokens:
            return content[:200]
            
        # Find all token positions
        matches = []
        for token in query_tokens:
            if not token.strip():
                continue
            # Case insensitive search
            for m in re.finditer(re.escape(token), content, re.IGNORECASE):
                matches.append((m.start(), m.end()))
                
        if not matches:
            return content[:200]
            
        # Sort matches
        matches.sort()
        
        # Find best window (dense matches)
        window_size = 150
        max_density = 0
        best_window_start = 0
        
        # Simple sliding window check could be expensive. 
        # Instead, look at clusters of matches. 
        # For simplicity, if we have matches, center around the first cluster.
        # Let's try to find a window containing the most unique tokens or just most tokens.
        
        # Naive approach: find window starting at each match
        for start_pos, _ in matches:
            end_pos = start_pos + window_size
            density = 0
            for m_start, m_end in matches:
                if m_start >= start_pos and m_end <= end_pos:
                    density += (m_end - m_start)
            
            if density > max_density:
                max_density = density
                best_window_start = start_pos
                
        # Expand window slightly backwards
        start = max(0, best_window_start - 20)
        end = min(len(content), start + window_size)
        
        snippet = content[start:end]
        
        # Apply highlighting to the snippet
        # We need to re-locate matches within the snippet
        highlighted = snippet
        # Sort tokens by length desc to handle overlapping (greedy)
        query_tokens.sort(key=len, reverse=True)
        
        for token in query_tokens:
            if not token.strip(): 
                continue
            # Use simple replace for visual highlighting, but handle overlapping?
            # Regex sub is better
            highlighted = re.sub(
                f"(?i)({re.escape(token)})", 
                r'<span class="text-accent-primary font-bold">\1</span>', 
                highlighted
            )
            
        return ("..." if start > 0 else "") + highlighted + ("..." if end < len(content) else "")

    async def search(
        self,
        query: str,
        top_k: int = 10,
        document_id: Optional[int] = None,
    ) -> List[SearchResult]:
        """Perform hybrid search."""
        # Get query embedding
        query_embedding = await llm_service.embed_single(query)

        # Vector search
        where_filter = {"document_id": document_id} if document_id else None
        vector_results = vector_store.query(
            query_embedding=query_embedding,
            n_results=self.top_k_retrieval,
            where=where_filter,
        )

        # BM25 search
        bm25_results = bm25_index.search(query, top_k=self.top_k_retrieval)

        # Combine results using reciprocal rank fusion
        combined_scores: Dict[str, Dict[str, Any]] = {}

        # Process vector results
        for i, chunk_id in enumerate(vector_results["ids"]):
            rank = i + 1
            score = 1.0 / (60 + rank)  # RRF formula

            combined_scores[chunk_id] = {
                "vector_score": score * self.vector_weight,
                "bm25_score": 0,
                "content": vector_results["documents"][i],
                "metadata": vector_results["metadatas"][i],
                "distance": vector_results["distances"][i],
            }

        # Process BM25 results
        for i, (chunk_id, bm25_score) in enumerate(bm25_results):
            rank = i + 1
            score = 1.0 / (60 + rank)

            if chunk_id in combined_scores:
                combined_scores[chunk_id]["bm25_score"] = score * self.bm25_weight
            else:
                doc = bm25_index.get_document(chunk_id)
                if doc:
                    combined_scores[chunk_id] = {
                        "vector_score": 0,
                        "bm25_score": score * self.bm25_weight,
                        "content": doc.content,
                        "metadata": doc.metadata,
                        "distance": 1.0,
                    }

        # Calculate final scores and sort
        results = []
        for chunk_id, data in combined_scores.items():
            final_score = data["vector_score"] + data["bm25_score"]
            metadata = data["metadata"]

            # Filter by document_id if specified
            if document_id and metadata.get("document_id") != document_id:
                continue

            # Generate highlighted preview
            preview = self._highlight_content(data["content"], query)

            results.append(SearchResult(
                chunk_id=int(chunk_id.split("_")[-1]) if "_" in chunk_id else 0,
                document_id=metadata.get("document_id", 0),
                content=data["content"],
                score=final_score,
                filename=metadata.get("filename"),
                preview=preview,  # Use highlighted preview
                metadata=metadata,
            ))

        # Sort by score and return top_k
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

    async def quick_search(self, query: str, top_k: int = 5) -> List[SearchResult]:
        """Quick search using only vector similarity."""
        if not query.strip():
            return []

        query_embedding = await llm_service.embed_single(query)

        results = vector_store.query(
            query_embedding=query_embedding,
            n_results=top_k,
        )

        search_results = []
        for i, chunk_id in enumerate(results["ids"]):
            metadata = results["metadatas"][i]
            distance = results["distances"][i]

            # Generate highlighted preview
            preview = self._highlight_content(results["documents"][i], query)

            search_results.append(SearchResult(
                chunk_id=int(chunk_id.split("_")[-1]) if "_" in chunk_id else 0,
                document_id=metadata.get("document_id", 0),
                content=results["documents"][i],
                score=1.0 - distance,  # Convert distance to similarity
                filename=metadata.get("filename"),
                preview=preview,
                metadata=metadata,
            ))

        return search_results


# Singleton instance
hybrid_search = HybridSearch()
