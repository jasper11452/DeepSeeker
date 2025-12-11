"""
DeepSeeker - 知识发现服务
自动发现文档间的隐含关联
"""
import logging
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
import asyncio
import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..models import Document, Chunk
from .llm import llm_service
from .vector_store import vector_store

logger = logging.getLogger(__name__)


class KnowledgeDiscoveryService:
    """知识发现服务 - 发现文档间的隐含关联"""
    
    def __init__(self):
        self.similarity_threshold = 0.65  # 相似度阈值
        self.min_connection_strength = 0.5  # 最小连接强度
        self.max_connections_per_doc = 10  # 每个文档最多连接数
        
    async def discover_connections(
        self,
        db: AsyncSession,
        document_id: Optional[int] = None,
        top_k: int = 20
    ) -> List[Dict[str, Any]]:
        """
        发现文档间的隐含关联
        
        返回格式:
        [
            {
                "source_doc_id": 1,
                "target_doc_id": 2,
                "connection_type": "semantic",  # semantic, entity, topic
                "strength": 0.85,
                "evidence": ["共同讨论了 AI 技术", "都提到了机器学习"],
                "shared_concepts": ["AI", "机器学习"]
            }
        ]
        """
        connections = []
        
        # 获取所有文档
        if document_id:
            stmt = select(Document).where(Document.id == document_id)
        else:
            stmt = select(Document).where(Document.status == "completed")
        
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        if not documents:
            return connections
        
        # 获取文档嵌入
        doc_embeddings = await self._get_document_embeddings(db, documents)
        
        # 计算文档间相似度
        for i, doc1 in enumerate(documents):
            if doc1.id not in doc_embeddings:
                continue
                
            emb1 = doc_embeddings[doc1.id]
            
            for j, doc2 in enumerate(documents):
                if i >= j or doc2.id not in doc_embeddings:
                    continue
                    
                emb2 = doc_embeddings[doc2.id]
                
                # 计算余弦相似度
                similarity = self._cosine_similarity(emb1, emb2)
                
                if similarity >= self.similarity_threshold:
                    # 发现连接，分析连接类型和证据
                    connection = await self._analyze_connection(
                        db, doc1, doc2, similarity
                    )
                    if connection:
                        connections.append(connection)
        
        # 按强度排序
        connections.sort(key=lambda x: x["strength"], reverse=True)
        
        return connections[:top_k]
    
    async def find_similar_documents(
        self,
        db: AsyncSession,
        document_id: int,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """找到与指定文档最相似的文档"""
        # 获取目标文档的嵌入
        stmt = select(Document).where(Document.id == document_id)
        result = await db.execute(stmt)
        target_doc = result.scalar_one_or_none()
        
        if not target_doc:
            return []
        
        # 获取文档的平均嵌入
        target_embedding = await self._get_document_embedding(db, document_id)
        if not target_embedding:
            return []
        
        # 在向量库中搜索相似文档
        similar_chunks = await vector_store.search(
            query_embedding=target_embedding,
            top_k=top_k * 5,  # 获取更多结果用于去重
            filter_doc_id=None  # 搜索所有文档
        )
        
        # 按文档聚合并去除自身
        doc_scores = defaultdict(list)
        for chunk in similar_chunks:
            if chunk.document_id != document_id:
                doc_scores[chunk.document_id].append(chunk.score)
        
        # 计算每个文档的平均相似度
        results = []
        for doc_id, scores in doc_scores.items():
            avg_score = np.mean(scores)
            if avg_score >= self.min_connection_strength:
                # 获取文档信息
                stmt = select(Document).where(Document.id == doc_id)
                result = await db.execute(stmt)
                doc = result.scalar_one_or_none()
                
                if doc:
                    results.append({
                        "document_id": doc_id,
                        "title": doc.title,
                        "filename": doc.filename,
                        "similarity": float(avg_score),
                        "preview": doc.content[:200] if doc.content else ""
                    })
        
        # 排序并返回
        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:top_k]
    
    async def extract_shared_concepts(
        self,
        db: AsyncSession,
        doc_id_1: int,
        doc_id_2: int
    ) -> List[str]:
        """提取两个文档共有的概念"""
        # 获取两个文档的内容
        stmt1 = select(Document).where(Document.id == doc_id_1)
        stmt2 = select(Document).where(Document.id == doc_id_2)
        
        result1 = await db.execute(stmt1)
        result2 = await db.execute(stmt2)
        
        doc1 = result1.scalar_one_or_none()
        doc2 = result2.scalar_one_or_none()
        
        if not doc1 or not doc2:
            return []
        
        # 使用 LLM 提取共同概念
        prompt = f"""分析这两个文档的共同主题和概念。

文档1标题: {doc1.title}
文档1内容摘要: {doc1.content[:1000] if doc1.content else '无'}

文档2标题: {doc2.title}
文档2内容摘要: {doc2.content[:1000] if doc2.content else '无'}

请列出它们共同讨论的3-5个核心概念或主题，每行一个：/no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=200)
            
            concepts = [
                line.strip().lstrip("-").lstrip("•").lstrip("0123456789.").strip()
                for line in response.strip().split("\n")
                if line.strip() and len(line.strip()) > 1
            ]
            return concepts[:5]
        except Exception as e:
            logger.error(f"Failed to extract shared concepts: {e}")
            return []
    
    async def build_knowledge_graph(
        self,
        db: AsyncSession,
        include_concepts: bool = True
    ) -> Dict[str, Any]:
        """
        构建知识图谱数据
        
        返回格式:
        {
            "nodes": [
                {"id": "doc_1", "type": "document", "label": "文档标题", ...},
                {"id": "concept_ai", "type": "concept", "label": "AI", ...}
            ],
            "edges": [
                {"source": "doc_1", "target": "doc_2", "type": "similar", "weight": 0.8},
                {"source": "doc_1", "target": "concept_ai", "type": "contains", "weight": 1.0}
            ]
        }
        """
        nodes = []
        edges = []
        
        # 获取所有文档
        stmt = select(Document).where(Document.status == "completed")
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        # 添加文档节点
        for doc in documents:
            nodes.append({
                "id": f"doc_{doc.id}",
                "type": "document",
                "label": doc.title or doc.filename,
                "document_id": doc.id,
                "created_at": doc.created_at.isoformat() if doc.created_at else None
            })
        
        # 发现文档间连接
        connections = await self.discover_connections(db, top_k=100)
        
        for conn in connections:
            edges.append({
                "source": f"doc_{conn['source_doc_id']}",
                "target": f"doc_{conn['target_doc_id']}",
                "type": conn["connection_type"],
                "weight": conn["strength"]
            })
            
            # 添加共享概念节点
            if include_concepts and conn.get("shared_concepts"):
                for concept in conn["shared_concepts"]:
                    concept_id = f"concept_{concept.lower().replace(' ', '_')}"
                    
                    # 检查概念节点是否已存在
                    if not any(n["id"] == concept_id for n in nodes):
                        nodes.append({
                            "id": concept_id,
                            "type": "concept",
                            "label": concept
                        })
                    
                    # 添加文档到概念的边
                    edges.append({
                        "source": f"doc_{conn['source_doc_id']}",
                        "target": concept_id,
                        "type": "contains",
                        "weight": 0.5
                    })
                    edges.append({
                        "source": f"doc_{conn['target_doc_id']}",
                        "target": concept_id,
                        "type": "contains",
                        "weight": 0.5
                    })
        
        return {
            "nodes": nodes,
            "edges": edges,
            "stats": {
                "total_documents": len(documents),
                "total_connections": len(connections),
                "total_concepts": len([n for n in nodes if n["type"] == "concept"])
            }
        }
    
    async def _get_document_embeddings(
        self,
        db: AsyncSession,
        documents: List[Document]
    ) -> Dict[int, np.ndarray]:
        """获取多个文档的平均嵌入"""
        embeddings = {}
        
        for doc in documents:
            emb = await self._get_document_embedding(db, doc.id)
            if emb is not None:
                embeddings[doc.id] = emb
        
        return embeddings
    
    async def _get_document_embedding(
        self,
        db: AsyncSession,
        document_id: int
    ) -> Optional[np.ndarray]:
        """获取单个文档的平均嵌入"""
        # 从向量库获取该文档的所有 chunks
        chunks = await vector_store.get_document_chunks(document_id)
        
        if not chunks:
            return None
        
        # 计算平均嵌入
        embeddings = [c.embedding for c in chunks if c.embedding is not None]
        if not embeddings:
            return None
        
        return np.mean(embeddings, axis=0)
    
    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """计算余弦相似度"""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))
    
    async def _analyze_connection(
        self,
        db: AsyncSession,
        doc1: Document,
        doc2: Document,
        similarity: float
    ) -> Optional[Dict[str, Any]]:
        """分析两个文档间的连接类型和证据"""
        # 基础连接信息
        connection = {
            "source_doc_id": doc1.id,
            "source_title": doc1.title,
            "target_doc_id": doc2.id,
            "target_title": doc2.title,
            "connection_type": "semantic",
            "strength": similarity,
            "evidence": [],
            "shared_concepts": []
        }
        
        # 提取共享概念
        shared_concepts = await self.extract_shared_concepts(db, doc1.id, doc2.id)
        connection["shared_concepts"] = shared_concepts
        
        # 根据共享概念数量调整连接类型
        if len(shared_concepts) >= 3:
            connection["connection_type"] = "topic"
            connection["evidence"].append(f"共享 {len(shared_concepts)} 个核心主题")
        elif len(shared_concepts) >= 1:
            connection["connection_type"] = "semantic"
            connection["evidence"].append(f"共同讨论了: {', '.join(shared_concepts)}")
        
        return connection


# 单例实例
knowledge_discovery_service = KnowledgeDiscoveryService()
