"""
DeepSeeker - Services Module
AI 研究助手核心服务
"""
from .parser import DocumentParser, parser
from .llm import LLMService, llm_service
from .vector_store import VectorStore, vector_store
from .bm25 import BM25Index, bm25_index
from .search import HybridSearch, hybrid_search, SearchResult
from .indexing import IndexingService, indexing_service
from .rag import RAGService, rag_service

# 新增研究助手服务
from .discovery import KnowledgeDiscoveryService, knowledge_discovery_service
from .clustering import ClusteringService, clustering_service
from .trends import TrendsService, trends_service
from .reports import ReportService, report_service
from .gaps import KnowledgeGapsService, knowledge_gaps_service

__all__ = [
    # Parser
    "DocumentParser",
    "parser",
    
    # LLM
    "LLMService",
    "llm_service",
    
    # Vector Store
    "VectorStore",
    "vector_store",
    
    # BM25
    "BM25Index",
    "bm25_index",
    
    # Search
    "HybridSearch",
    "hybrid_search",
    "SearchResult",
    
    # Indexing
    "IndexingService",
    "indexing_service",
    
    # RAG
    "RAGService",
    "rag_service",
    
    # Knowledge Discovery (知识发现)
    "KnowledgeDiscoveryService",
    "knowledge_discovery_service",
    
    # Clustering (主题聚类)
    "ClusteringService",
    "clustering_service",
    
    # Trends (趋势分析)
    "TrendsService",
    "trends_service",
    
    # Reports (报告生成)
    "ReportService",
    "report_service",
    
    # Knowledge Gaps (知识空白)
    "KnowledgeGapsService",
    "knowledge_gaps_service",
]
