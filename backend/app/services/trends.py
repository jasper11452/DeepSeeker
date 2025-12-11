"""
DeepSeeker - 趋势分析服务
分析关注领域的变化趋势
"""
import logging
from typing import List, Dict, Any, Optional
from collections import defaultdict
from datetime import datetime, timedelta
import asyncio
import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from ..models import Document, Chunk
from .llm import llm_service
from .clustering import clustering_service

logger = logging.getLogger(__name__)


class TrendsService:
    """趋势分析服务 - 分析关注领域的变化趋势"""
    
    def __init__(self):
        self.time_windows = {
            "week": 7,
            "month": 30,
            "quarter": 90,
            "year": 365
        }
    
    async def analyze_trends(
        self,
        db: AsyncSession,
        time_range: str = "month",  # week, month, quarter, year
        topic: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        分析趋势
        
        返回格式:
        {
            "time_range": "month",
            "total_documents": 50,
            "trends": [
                {
                    "topic": "AI",
                    "direction": "rising",  # rising, stable, declining
                    "change_rate": 0.25,  # 增长率
                    "document_count": 15,
                    "timeline": [
                        {"date": "2024-01", "count": 3},
                        {"date": "2024-02", "count": 5}
                    ]
                }
            ],
            "hot_topics": ["AI", "LLM", "RAG"],
            "emerging_topics": ["多模态", "Agent"],
            "declining_topics": ["区块链"]
        }
        """
        days = self.time_windows.get(time_range, 30)
        start_date = datetime.now() - timedelta(days=days)
        
        # 获取时间范围内的文档
        stmt = select(Document).where(
            and_(
                Document.status == "completed",
                Document.created_at >= start_date
            )
        ).order_by(Document.created_at)
        
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        if not documents:
            return {
                "time_range": time_range,
                "total_documents": 0,
                "trends": [],
                "hot_topics": [],
                "emerging_topics": [],
                "declining_topics": []
            }
        
        # 提取每个文档的主题
        doc_topics = await self._extract_document_topics(documents)
        
        # 按时间分组统计主题
        topic_timeline = self._build_topic_timeline(documents, doc_topics, days)
        
        # 分析趋势
        trends = self._analyze_topic_trends(topic_timeline)
        
        # 分类主题
        hot_topics = [t["topic"] for t in trends if t["document_count"] >= 3][:10]
        emerging_topics = [
            t["topic"] for t in trends 
            if t["direction"] == "rising" and t["change_rate"] > 0.3
        ][:5]
        declining_topics = [
            t["topic"] for t in trends 
            if t["direction"] == "declining" and t["change_rate"] < -0.3
        ][:5]
        
        return {
            "time_range": time_range,
            "total_documents": len(documents),
            "trends": trends[:20],  # 返回前20个主要趋势
            "hot_topics": hot_topics,
            "emerging_topics": emerging_topics,
            "declining_topics": declining_topics
        }
    
    async def get_topic_evolution(
        self,
        db: AsyncSession,
        topic: str,
        time_range: str = "quarter"
    ) -> Dict[str, Any]:
        """获取特定主题的演变历史"""
        days = self.time_windows.get(time_range, 90)
        start_date = datetime.now() - timedelta(days=days)
        
        # 获取时间范围内的文档
        stmt = select(Document).where(
            and_(
                Document.status == "completed",
                Document.created_at >= start_date
            )
        ).order_by(Document.created_at)
        
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        # 过滤包含该主题的文档
        related_docs = []
        for doc in documents:
            content = (doc.title or "") + " " + (doc.content or "")
            if topic.lower() in content.lower():
                related_docs.append(doc)
        
        if not related_docs:
            return {
                "topic": topic,
                "time_range": time_range,
                "document_count": 0,
                "evolution": [],
                "key_developments": []
            }
        
        # 按时间分组
        timeline = self._group_documents_by_time(related_docs, days)
        
        # 分析关键发展
        key_developments = await self._extract_key_developments(related_docs, topic)
        
        return {
            "topic": topic,
            "time_range": time_range,
            "document_count": len(related_docs),
            "evolution": timeline,
            "key_developments": key_developments,
            "related_documents": [
                {
                    "id": d.id,
                    "title": d.title or d.filename,
                    "date": d.created_at.isoformat() if d.created_at else None
                }
                for d in related_docs[:10]
            ]
        }
    
    async def compare_periods(
        self,
        db: AsyncSession,
        period1_start: datetime,
        period1_end: datetime,
        period2_start: datetime,
        period2_end: datetime
    ) -> Dict[str, Any]:
        """比较两个时间段的主题分布"""
        # 获取两个时间段的文档
        stmt1 = select(Document).where(
            and_(
                Document.status == "completed",
                Document.created_at >= period1_start,
                Document.created_at <= period1_end
            )
        )
        stmt2 = select(Document).where(
            and_(
                Document.status == "completed",
                Document.created_at >= period2_start,
                Document.created_at <= period2_end
            )
        )
        
        result1 = await db.execute(stmt1)
        result2 = await db.execute(stmt2)
        
        docs1 = result1.scalars().all()
        docs2 = result2.scalars().all()
        
        # 提取主题
        topics1 = await self._extract_document_topics(docs1)
        topics2 = await self._extract_document_topics(docs2)
        
        # 统计主题频率
        freq1 = self._count_topic_frequency(topics1)
        freq2 = self._count_topic_frequency(topics2)
        
        # 找出变化
        all_topics = set(freq1.keys()) | set(freq2.keys())
        changes = []
        
        for topic in all_topics:
            count1 = freq1.get(topic, 0)
            count2 = freq2.get(topic, 0)
            
            if count1 == 0 and count2 > 0:
                change_type = "new"
                change_rate = 1.0
            elif count2 == 0 and count1 > 0:
                change_type = "disappeared"
                change_rate = -1.0
            else:
                change_rate = (count2 - count1) / max(count1, 1)
                if change_rate > 0.2:
                    change_type = "rising"
                elif change_rate < -0.2:
                    change_type = "declining"
                else:
                    change_type = "stable"
            
            changes.append({
                "topic": topic,
                "period1_count": count1,
                "period2_count": count2,
                "change_type": change_type,
                "change_rate": change_rate
            })
        
        # 按变化率排序
        changes.sort(key=lambda x: abs(x["change_rate"]), reverse=True)
        
        return {
            "period1": {
                "start": period1_start.isoformat(),
                "end": period1_end.isoformat(),
                "document_count": len(docs1)
            },
            "period2": {
                "start": period2_start.isoformat(),
                "end": period2_end.isoformat(),
                "document_count": len(docs2)
            },
            "changes": changes[:20],
            "new_topics": [c["topic"] for c in changes if c["change_type"] == "new"][:5],
            "disappeared_topics": [c["topic"] for c in changes if c["change_type"] == "disappeared"][:5]
        }
    
    async def get_activity_heatmap(
        self,
        db: AsyncSession,
        time_range: str = "year"
    ) -> Dict[str, Any]:
        """获取活动热力图数据"""
        days = self.time_windows.get(time_range, 365)
        start_date = datetime.now() - timedelta(days=days)
        
        # 按日期统计文档数量
        stmt = select(
            func.date(Document.created_at).label('date'),
            func.count(Document.id).label('count')
        ).where(
            and_(
                Document.status == "completed",
                Document.created_at >= start_date
            )
        ).group_by(
            func.date(Document.created_at)
        ).order_by(
            func.date(Document.created_at)
        )
        
        result = await db.execute(stmt)
        data = result.all()
        
        heatmap_data = [
            {
                "date": row.date.isoformat() if hasattr(row.date, 'isoformat') else str(row.date) if row.date else None,
                "count": row.count
            }
            for row in data
        ]
        
        # 计算统计信息
        counts = [row.count for row in data]
        
        return {
            "time_range": time_range,
            "data": heatmap_data,
            "stats": {
                "total_days": len(data),
                "total_documents": sum(counts) if counts else 0,
                "max_daily": max(counts) if counts else 0,
                "avg_daily": np.mean(counts) if counts else 0,
                "active_days": len([c for c in counts if c > 0])
            }
        }
    
    async def _extract_document_topics(
        self,
        documents: List[Document]
    ) -> Dict[int, List[str]]:
        """提取每个文档的主题"""
        doc_topics = {}
        
        for doc in documents:
            content = (doc.title or "") + " " + (doc.content[:1000] if doc.content else "")
            topics = await llm_service.extract_concepts(content)
            doc_topics[doc.id] = topics
        
        return doc_topics
    
    def _build_topic_timeline(
        self,
        documents: List[Document],
        doc_topics: Dict[int, List[str]],
        days: int
    ) -> Dict[str, List[Dict[str, Any]]]:
        """构建主题时间线"""
        # 确定时间分组粒度
        if days <= 7:
            date_format = "%Y-%m-%d"
        elif days <= 90:
            date_format = "%Y-%W"  # 按周
        else:
            date_format = "%Y-%m"  # 按月
        
        topic_timeline = defaultdict(lambda: defaultdict(int))
        
        for doc in documents:
            if not doc.created_at:
                continue
            
            date_key = doc.created_at.strftime(date_format)
            topics = doc_topics.get(doc.id, [])
            
            for topic in topics:
                topic_timeline[topic][date_key] += 1
        
        # 转换为列表格式
        result = {}
        for topic, timeline in topic_timeline.items():
            result[topic] = [
                {"date": date, "count": count}
                for date, count in sorted(timeline.items())
            ]
        
        return result
    
    def _analyze_topic_trends(
        self,
        topic_timeline: Dict[str, List[Dict[str, Any]]]
    ) -> List[Dict[str, Any]]:
        """分析主题趋势"""
        trends = []
        
        for topic, timeline in topic_timeline.items():
            if len(timeline) < 2:
                # 数据点太少，无法判断趋势
                trends.append({
                    "topic": topic,
                    "direction": "stable",
                    "change_rate": 0,
                    "document_count": sum(t["count"] for t in timeline),
                    "timeline": timeline
                })
                continue
            
            # 计算趋势
            counts = [t["count"] for t in timeline]
            
            # 简单线性回归判断趋势
            x = np.arange(len(counts))
            y = np.array(counts)
            
            if len(x) > 1:
                slope, _ = np.polyfit(x, y, 1)
                avg = np.mean(y)
                change_rate = slope / avg if avg > 0 else 0
            else:
                change_rate = 0
            
            # 判断趋势方向
            if change_rate > 0.1:
                direction = "rising"
            elif change_rate < -0.1:
                direction = "declining"
            else:
                direction = "stable"
            
            trends.append({
                "topic": topic,
                "direction": direction,
                "change_rate": float(change_rate),
                "document_count": sum(counts),
                "timeline": timeline
            })
        
        # 按文档数量排序
        trends.sort(key=lambda x: x["document_count"], reverse=True)
        
        return trends
    
    def _group_documents_by_time(
        self,
        documents: List[Document],
        days: int
    ) -> List[Dict[str, Any]]:
        """按时间分组文档"""
        if days <= 7:
            date_format = "%Y-%m-%d"
        elif days <= 90:
            date_format = "%Y-%W"
        else:
            date_format = "%Y-%m"
        
        grouped = defaultdict(list)
        
        for doc in documents:
            if doc.created_at:
                date_key = doc.created_at.strftime(date_format)
                grouped[date_key].append({
                    "id": doc.id,
                    "title": doc.title or doc.filename
                })
        
        return [
            {"date": date, "documents": docs, "count": len(docs)}
            for date, docs in sorted(grouped.items())
        ]
    
    async def _extract_key_developments(
        self,
        documents: List[Document],
        topic: str
    ) -> List[Dict[str, Any]]:
        """提取关键发展"""
        if not documents:
            return []
        
        # 收集文档内容
        doc_summaries = []
        for doc in documents[:10]:
            content = doc.content[:500] if doc.content else ""
            doc_summaries.append(f"【{doc.title or doc.filename}】({doc.created_at.strftime('%Y-%m-%d') if doc.created_at else '未知日期'})\n{content}")
        
        prompt = f"""分析以下关于"{topic}"的文档,提取3-5个关键发展或里程碑:

{chr(10).join(doc_summaries)}

请按时间顺序列出关键发展,每行一个,格式为:
- 发展描述

/no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=300)
            
            developments = []
            for line in response.strip().split("\n"):
                line = line.strip().lstrip("-").lstrip("•").strip()
                if line and len(line) > 5:
                    developments.append({
                        "description": line,
                        "importance": "high" if len(developments) < 2 else "medium"
                    })
            
            return developments[:5]
            
        except Exception as e:
            logger.error(f"Failed to extract key developments: {e}")
            return []
    
    def _count_topic_frequency(
        self,
        doc_topics: Dict[int, List[str]]
    ) -> Dict[str, int]:
        """统计主题频率"""
        freq = defaultdict(int)
        for topics in doc_topics.values():
            for topic in topics:
                freq[topic] += 1
        return freq


# 单例实例
trends_service = TrendsService()
