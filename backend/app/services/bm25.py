"""
DeepSeeker MVP - BM25 Search Index
"""
import re
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from rank_bm25 import BM25Okapi

try:
    import jieba
    jieba.setLogLevel(jieba.logging.INFO)  # 减少日志输出
    HAS_JIEBA = True
except ImportError:
    HAS_JIEBA = False


@dataclass
class BM25Document:
    """Document for BM25 indexing."""
    id: str
    content: str
    metadata: Dict[str, Any]


class BM25Index:
    """BM25 search index for keyword-based retrieval."""

    def __init__(self):
        self.documents: List[BM25Document] = []
        self.tokenized_corpus: List[List[str]] = []
        self.bm25: Optional[BM25Okapi] = None
        self.id_to_index: Dict[str, int] = {}
        # 停用词列表
        self.stop_words = {
            '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一',
            '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
            '没有', '看', '好', '自己', '这', '那', 'the', 'a', 'an', 'is', 'are',
            'was', 'were', 'be', 'been', 'to', 'of', 'and', 'in', 'that', 'it'
        }

    def _tokenize(self, text: str) -> List[str]:
        """改进的分词：使用 jieba 对中文进行词级分词。"""
        text = text.lower()
        
        if HAS_JIEBA:
            # Add technical terms to dictionary
            tech_terms = [
                "RAG", "LLM", "Transformer", "Embedding", "Embeddings", "FastAPI", 
                "React", "Vue", "Next.js", "Vite", "Python", "TypeScript", "JavaScript",
                "Docker", "Kubernetes", "Redis", "PostgreSQL", "MySQL", "MongoDB",
                "Chroma", "ChromaDB", "Milvus", "Pinecone", "Weaviate", "Qdrant",
                "LangChain", "LlamaIndex", "HuggingFace", "PyTorch", "TensorFlow",
                "MLX", "Apple Silicon", "MPS", "CUDA", "GPU", "CPU",
                "BM25", "TF-IDF", "HNSW", "IVF", "PQ", "Rerank", "Reranker",
                "Ollama", "vLLM", "TGI", "Text Generation Inference",
                "MarkItDown", "PDF", "Word", "Excel", "PPT", "PowerPoint",
                "Markdown", "JSON", "XML", "YAML", "HTML", "CSS", "SQL",
                "REST API", "GraphQL", "gRPC", "WebSocket", "SSE",
                "DeepSeeker", "Knowledge Base", "Vector Store", "Semantic Search",
                "Zero-shot", "Few-shot", "Fine-tuning", "Prompt Engineering"
            ]
            for term in tech_terms:
                jieba.add_word(term)
            
            # 使用 jieba 分词
            tokens = list(jieba.cut(text))
            # 过滤：只保留有意义的词（长度>=2 或英文/数字）
            tokens = [
                t.strip() for t in tokens 
                if t.strip() and t not in self.stop_words and (
                    len(t) >= 2 or re.match(r'^[a-zA-Z0-9]+$', t)
                )
            ]
        else:
            # 降级：使用正则分词
            tokens = re.findall(r'[\u4e00-\u9fff]+|[a-zA-Z0-9]+', text)
            tokens = [t for t in tokens if t not in self.stop_words]
        
        return tokens

    def add_documents(self, documents: List[BM25Document]) -> None:
        """Add documents to the index."""
        for doc in documents:
            if doc.id in self.id_to_index:
                continue

            self.id_to_index[doc.id] = len(self.documents)
            self.documents.append(doc)
            self.tokenized_corpus.append(self._tokenize(doc.content))

        # Rebuild BM25 index
        if self.tokenized_corpus:
            self.bm25 = BM25Okapi(self.tokenized_corpus)

    def remove_document(self, doc_id: str) -> None:
        """Remove a document from the index."""
        if doc_id not in self.id_to_index:
            return

        index = self.id_to_index[doc_id]
        self.documents.pop(index)
        self.tokenized_corpus.pop(index)
        del self.id_to_index[doc_id]

        # Rebuild index mapping
        self.id_to_index = {doc.id: i for i, doc in enumerate(self.documents)}

        # Rebuild BM25 index
        if self.tokenized_corpus:
            self.bm25 = BM25Okapi(self.tokenized_corpus)
        else:
            self.bm25 = None

    def remove_by_document_id(self, document_id: int) -> None:
        """Remove all chunks for a document."""
        ids_to_remove = [
            doc.id for doc in self.documents
            if doc.metadata.get("document_id") == document_id
        ]
        for doc_id in ids_to_remove:
            self.remove_document(doc_id)

    def search(self, query: str, top_k: int = 10) -> List[Tuple[str, float]]:
        """Search for documents matching the query."""
        if not self.bm25 or not self.documents:
            return []

        tokenized_query = self._tokenize(query)
        if not tokenized_query:
            return []

        scores = self.bm25.get_scores(tokenized_query)

        # Get top-k results
        scored_docs = list(zip(range(len(scores)), scores))
        scored_docs.sort(key=lambda x: x[1], reverse=True)

        results = []
        for idx, score in scored_docs[:top_k]:
            if score > 0:
                results.append((self.documents[idx].id, score))

        return results

    def get_document(self, doc_id: str) -> Optional[BM25Document]:
        """Get a document by ID."""
        if doc_id in self.id_to_index:
            return self.documents[self.id_to_index[doc_id]]
        return None

    def clear(self) -> None:
        """Clear the index."""
        self.documents = []
        self.tokenized_corpus = []
        self.bm25 = None
        self.id_to_index = {}

    def save(self, filepath: str = "./bm25_index.pkl") -> bool:
        """
        保存索引到磁盘。
        
        Args:
            filepath: 保存路径，默认为 ./bm25_index.pkl
            
        Returns:
            是否保存成功
        """
        import pickle
        import logging
        logger = logging.getLogger(__name__)
        
        try:
            data = {
                "documents": self.documents,
                "tokenized_corpus": self.tokenized_corpus,
                "id_to_index": self.id_to_index,
            }
            with open(filepath, "wb") as f:
                pickle.dump(data, f)
            logger.info(f"BM25 index saved to {filepath} ({len(self.documents)} documents)")
            return True
        except Exception as e:
            logger.error(f"Failed to save BM25 index: {e}")
            return False

    def load(self, filepath: str = "./bm25_index.pkl") -> bool:
        """
        从磁盘加载索引。
        
        Args:
            filepath: 加载路径，默认为 ./bm25_index.pkl
            
        Returns:
            是否加载成功
        """
        import pickle
        import os
        import logging
        logger = logging.getLogger(__name__)
        
        if not os.path.exists(filepath):
            logger.info(f"BM25 index file not found: {filepath}")
            return False
            
        try:
            with open(filepath, "rb") as f:
                data = pickle.load(f)
            
            self.documents = data["documents"]
            self.tokenized_corpus = data["tokenized_corpus"]
            self.id_to_index = data["id_to_index"]
            
            # 重建 BM25 索引
            if self.tokenized_corpus:
                self.bm25 = BM25Okapi(self.tokenized_corpus)
            else:
                self.bm25 = None
                
            logger.info(f"BM25 index loaded from {filepath} ({len(self.documents)} documents)")
            return True
        except Exception as e:
            logger.error(f"Failed to load BM25 index: {e}")
            return False


# Singleton instance
bm25_index = BM25Index()

# 尝试从磁盘恢复索引
bm25_index.load()
