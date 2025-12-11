"""
DeepSeeker - 主题聚类服务
自动归类相似文档
"""
import logging
from typing import List, Dict, Any, Optional, Tuple
from collections import defaultdict
import asyncio
import numpy as np
from sklearn.cluster import HDBSCAN, KMeans
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..models import Document, Chunk
from .llm import llm_service
from .vector_store import vector_store

logger = logging.getLogger(__name__)


class ClusteringService:
    """主题聚类服务 - 自动归类相似文档"""
    
    def __init__(self):
        self.min_cluster_size = 2  # 最小聚类大小
        self.min_samples = 1  # HDBSCAN 参数
        self.cluster_selection_epsilon = 0.3  # 聚类选择阈值
        
    async def cluster_documents(
        self,
        db: AsyncSession,
        method: str = "hdbscan",  # hdbscan, kmeans
        n_clusters: Optional[int] = None  # 仅 kmeans 使用
    ) -> Dict[str, Any]:
        """
        对文档进行聚类
        
        返回格式:
        {
            "clusters": [
                {
                    "id": 0,
                    "label": "AI 与机器学习",
                    "description": "关于人工智能和机器学习技术的文档",
                    "documents": [
                        {"id": 1, "title": "...", "similarity_to_center": 0.9}
                    ],
                    "keywords": ["AI", "机器学习", "深度学习"],
                    "size": 5
                }
            ],
            "unclustered": [...],  # 未能归类的文档
            "stats": {
                "total_documents": 20,
                "total_clusters": 4,
                "clustered_documents": 18
            }
        }
        """
        # 获取所有已完成的文档
        stmt = select(Document).where(Document.status == "completed")
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        if len(documents) < self.min_cluster_size:
            return {
                "clusters": [],
                "unclustered": [{"id": d.id, "title": d.title} for d in documents],
                "stats": {
                    "total_documents": len(documents),
                    "total_clusters": 0,
                    "clustered_documents": 0
                }
            }
        
        # 获取文档嵌入
        doc_ids = []
        embeddings = []
        doc_map = {}
        
        for doc in documents:
            emb = await self._get_document_embedding(db, doc.id)
            if emb is not None:
                doc_ids.append(doc.id)
                embeddings.append(emb)
                doc_map[doc.id] = doc
        
        if len(embeddings) < self.min_cluster_size:
            return {
                "clusters": [],
                "unclustered": [{"id": d.id, "title": d.title} for d in documents],
                "stats": {
                    "total_documents": len(documents),
                    "total_clusters": 0,
                    "clustered_documents": 0
                }
            }
        
        embeddings_array = np.array(embeddings)
        
        # 执行聚类
        if method == "kmeans" and n_clusters:
            labels = self._kmeans_clustering(embeddings_array, n_clusters)
        else:
            labels = self._hdbscan_clustering(embeddings_array)
        
        # 整理聚类结果
        clusters_data = defaultdict(list)
        unclustered = []
        
        for i, label in enumerate(labels):
            doc_id = doc_ids[i]
            doc = doc_map[doc_id]
            
            doc_info = {
                "id": doc_id,
                "title": doc.title or doc.filename,
                "filename": doc.filename,
                "embedding_index": i
            }
            
            if label == -1:  # 噪声点（未聚类）
                unclustered.append(doc_info)
            else:
                clusters_data[label].append(doc_info)
        
        # 为每个聚类生成标签和描述
        clusters = []
        for cluster_id, docs in clusters_data.items():
            # 计算聚类中心
            cluster_embeddings = [embeddings[d["embedding_index"]] for d in docs]
            center = np.mean(cluster_embeddings, axis=0)
            
            # 计算每个文档到中心的相似度
            for doc in docs:
                doc_emb = embeddings[doc["embedding_index"]]
                doc["similarity_to_center"] = float(
                    cosine_similarity([doc_emb], [center])[0][0]
                )
            
            # 按相似度排序
            docs.sort(key=lambda x: x["similarity_to_center"], reverse=True)
            
            # 生成聚类标签和描述
            cluster_docs = [doc_map[d["id"]] for d in docs]
            label, description, keywords = await self._generate_cluster_info(cluster_docs)
            
            clusters.append({
                "id": int(cluster_id),
                "label": label,
                "description": description,
                "documents": [
                    {k: v for k, v in d.items() if k != "embedding_index"}
                    for d in docs
                ],
                "keywords": keywords,
                "size": len(docs)
            })
        
        # 按大小排序
        clusters.sort(key=lambda x: x["size"], reverse=True)
        
        return {
            "clusters": clusters,
            "unclustered": [
                {k: v for k, v in d.items() if k != "embedding_index"}
                for d in unclustered
            ],
            "stats": {
                "total_documents": len(documents),
                "total_clusters": len(clusters),
                "clustered_documents": sum(c["size"] for c in clusters)
            }
        }
    
    async def get_cluster_details(
        self,
        db: AsyncSession,
        cluster_id: int,
        document_ids: List[int]
    ) -> Dict[str, Any]:
        """获取聚类的详细信息"""
        # 获取聚类中的文档
        stmt = select(Document).where(Document.id.in_(document_ids))
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        if not documents:
            return {}
        
        # 生成聚类摘要
        summary = await self._generate_cluster_summary(documents)
        
        # 获取关键主题
        topics = await self._extract_cluster_topics(documents)
        
        return {
            "cluster_id": cluster_id,
            "summary": summary,
            "topics": topics,
            "document_count": len(documents),
            "documents": [
                {
                    "id": d.id,
                    "title": d.title,
                    "filename": d.filename,
                    "preview": d.content[:200] if d.content else ""
                }
                for d in documents
            ]
        }
    
    async def suggest_document_cluster(
        self,
        db: AsyncSession,
        document_id: int,
        existing_clusters: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """为新文档推荐最合适的聚类"""
        # 获取文档嵌入
        doc_embedding = await self._get_document_embedding(db, document_id)
        if doc_embedding is None:
            return None
        
        best_cluster = None
        best_similarity = 0.0
        
        for cluster in existing_clusters:
            # 计算文档与聚类中心的相似度
            cluster_doc_ids = [d["id"] for d in cluster["documents"]]
            cluster_embeddings = []
            
            for doc_id in cluster_doc_ids:
                emb = await self._get_document_embedding(db, doc_id)
                if emb is not None:
                    cluster_embeddings.append(emb)
            
            if cluster_embeddings:
                center = np.mean(cluster_embeddings, axis=0)
                similarity = float(
                    cosine_similarity([doc_embedding], [center])[0][0]
                )
                
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_cluster = cluster
        
        if best_cluster and best_similarity > 0.5:
            return {
                "cluster_id": best_cluster["id"],
                "cluster_label": best_cluster["label"],
                "similarity": best_similarity,
                "confidence": "high" if best_similarity > 0.7 else "medium"
            }
        
        return None
    
    def _hdbscan_clustering(self, embeddings: np.ndarray) -> np.ndarray:
        """使用 HDBSCAN 进行聚类"""
        try:
            clusterer = HDBSCAN(
                min_cluster_size=self.min_cluster_size,
                min_samples=self.min_samples,
                cluster_selection_epsilon=self.cluster_selection_epsilon,
                metric='cosine'
            )
            labels = clusterer.fit_predict(embeddings)
            return labels
        except Exception as e:
            logger.error(f"HDBSCAN clustering failed: {e}")
            # 降级到 KMeans
            n_clusters = max(2, len(embeddings) // 5)
            return self._kmeans_clustering(embeddings, n_clusters)
    
    def _kmeans_clustering(self, embeddings: np.ndarray, n_clusters: int) -> np.ndarray:
        """使用 KMeans 进行聚类"""
        try:
            n_clusters = min(n_clusters, len(embeddings))
            clusterer = KMeans(
                n_clusters=n_clusters,
                random_state=42,
                n_init=10
            )
            labels = clusterer.fit_predict(embeddings)
            return labels
        except Exception as e:
            logger.error(f"KMeans clustering failed: {e}")
            return np.zeros(len(embeddings), dtype=int)
    
    async def _get_document_embedding(
        self,
        db: AsyncSession,
        document_id: int
    ) -> Optional[np.ndarray]:
        """获取文档的平均嵌入"""
        chunks = vector_store.get_document_chunks(document_id)
        
        if not chunks:
            return None
        
        embeddings = [c.embedding for c in chunks if c.embedding is not None]
        if not embeddings:
            return None
        
        return np.mean(embeddings, axis=0)
    
    async def _generate_cluster_info(
        self,
        documents: List[Document]
    ) -> Tuple[str, str, List[str]]:
        """生成聚类的标签、描述和关键词"""
        # 收集文档标题和内容摘要
        doc_summaries = []
        for doc in documents[:5]:  # 最多取5个文档
            title = doc.title or doc.filename
            content_preview = doc.content[:300] if doc.content else ""
            doc_summaries.append(f"- {title}: {content_preview}")
        
        prompt = f"""分析以下文档集合,为这个主题聚类生成:
1. 一个简短的标签(5-10字)
2. 一句话描述(20-40字)
3. 3-5个关键词

文档列表:
{chr(10).join(doc_summaries)}

请按以下格式输出:
标签: xxx
描述: xxx
关键词: xxx, xxx, xxx

/no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=200)
            
            # 解析响应
            lines = response.strip().split("\n")
            label = "未命名聚类"
            description = ""
            keywords = []
            
            for line in lines:
                if line.startswith("标签:") or line.startswith("标签："):
                    label = line.split(":", 1)[-1].strip()
                elif line.startswith("描述:") or line.startswith("描述："):
                    description = line.split(":", 1)[-1].strip()
                elif line.startswith("关键词:") or line.startswith("关键词："):
                    keywords = [k.strip() for k in line.split(":", 1)[-1].split(",")]
            
            return label, description, keywords
            
        except Exception as e:
            logger.error(f"Failed to generate cluster info: {e}")
            return "未命名聚类", "", []
    
    async def _generate_cluster_summary(
        self,
        documents: List[Document]
    ) -> str:
        """生成聚类的综合摘要"""
        doc_contents = []
        for doc in documents[:5]:
            content = doc.content[:500] if doc.content else ""
            doc_contents.append(f"【{doc.title or doc.filename}】\n{content}")
        
        prompt = f"""请对以下文档集合进行综合分析,生成一个100-200字的摘要,概述这些文档的共同主题和核心内容:

{chr(10).join(doc_contents)}

摘要: /no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=300)
            return response.strip()
        except Exception as e:
            logger.error(f"Failed to generate cluster summary: {e}")
            return ""
    
    async def _extract_cluster_topics(
        self,
        documents: List[Document]
    ) -> List[Dict[str, Any]]:
        """提取聚类中的关键主题"""
        # 收集所有文档的关键词
        all_keywords = []
        for doc in documents:
            keywords = await llm_service.extract_concepts(
                doc.content[:2000] if doc.content else ""
            )
            all_keywords.extend(keywords)
        
        # 统计关键词频率
        from collections import Counter
        keyword_counts = Counter(all_keywords)
        
        # 返回最常见的主题
        topics = []
        for keyword, count in keyword_counts.most_common(10):
            topics.append({
                "keyword": keyword,
                "frequency": count,
                "relevance": count / len(documents) if documents else 0
            })
        
        return topics


# 单例实例
clustering_service = ClusteringService()
