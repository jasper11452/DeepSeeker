"""
DeepSeeker - 研究助手 API Routes
提供知识发现、聚类、趋势、报告、知识空白等功能
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List, Dict, Any
from datetime import datetime

from ..database import get_db
from ..services.discovery import knowledge_discovery_service
from ..services.clustering import clustering_service
from ..services.trends import trends_service
from ..services.reports import report_service
from ..services.gaps import knowledge_gaps_service

router = APIRouter()


# ==================== 知识发现 API ====================

class ConnectionResponse(BaseModel):
    """文档连接响应"""
    source_doc_id: int
    source_title: Optional[str]
    target_doc_id: int
    target_title: Optional[str]
    connection_type: str
    strength: float
    evidence: List[str] = []
    shared_concepts: List[str] = []


class SimilarDocumentResponse(BaseModel):
    """相似文档响应"""
    document_id: int
    title: str
    filename: str
    similarity: float
    preview: str


class KnowledgeGraphResponse(BaseModel):
    """知识图谱响应"""
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    stats: Dict[str, int]


@router.get("/discovery/connections", response_model=List[ConnectionResponse])
async def discover_connections(
    document_id: Optional[int] = None,
    top_k: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """发现文档间的隐含关联"""
    connections = await knowledge_discovery_service.discover_connections(
        db, document_id=document_id, top_k=top_k
    )
    return connections


@router.get("/discovery/similar/{document_id}", response_model=List[SimilarDocumentResponse])
async def find_similar_documents(
    document_id: int,
    top_k: int = Query(default=5, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """找到与指定文档最相似的文档"""
    similar_docs = await knowledge_discovery_service.find_similar_documents(
        db, document_id=document_id, top_k=top_k
    )
    return similar_docs


@router.get("/discovery/shared-concepts")
async def get_shared_concepts(
    doc_id_1: int,
    doc_id_2: int,
    db: AsyncSession = Depends(get_db),
):
    """获取两个文档共有的概念"""
    concepts = await knowledge_discovery_service.extract_shared_concepts(
        db, doc_id_1, doc_id_2
    )
    return {"concepts": concepts}


@router.get("/discovery/knowledge-graph", response_model=KnowledgeGraphResponse)
async def get_knowledge_graph(
    include_concepts: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """获取知识图谱数据"""
    graph = await knowledge_discovery_service.build_knowledge_graph(
        db, include_concepts=include_concepts
    )
    return graph


# ==================== 主题聚类 API ====================

class ClusterResponse(BaseModel):
    """聚类响应"""
    id: int
    label: str
    description: str
    documents: List[Dict[str, Any]]
    keywords: List[str]
    size: int


class ClusteringResultResponse(BaseModel):
    """聚类结果响应"""
    clusters: List[ClusterResponse]
    unclustered: List[Dict[str, Any]]
    stats: Dict[str, int]


@router.get("/clusters", response_model=ClusteringResultResponse)
async def cluster_documents(
    method: str = Query(default="hdbscan", regex="^(hdbscan|kmeans)$"),
    n_clusters: Optional[int] = Query(default=None, ge=2, le=50),
    db: AsyncSession = Depends(get_db),
):
    """对文档进行聚类"""
    result = await clustering_service.cluster_documents(
        db, method=method, n_clusters=n_clusters
    )
    return result


@router.get("/clusters/{cluster_id}")
async def get_cluster_details(
    cluster_id: int,
    document_ids: str = Query(..., description="逗号分隔的文档ID列表"),
    db: AsyncSession = Depends(get_db),
):
    """获取聚类详细信息"""
    doc_ids = [int(id.strip()) for id in document_ids.split(",") if id.strip()]
    details = await clustering_service.get_cluster_details(
        db, cluster_id=cluster_id, document_ids=doc_ids
    )
    return details


@router.get("/clusters/suggest/{document_id}")
async def suggest_cluster_for_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
):
    """为新文档推荐最合适的聚类"""
    # 先获取现有聚类
    clustering_result = await clustering_service.cluster_documents(db)
    
    suggestion = await clustering_service.suggest_document_cluster(
        db, document_id=document_id, existing_clusters=clustering_result["clusters"]
    )
    
    if suggestion:
        return suggestion
    return {"message": "无法找到合适的聚类，建议创建新聚类"}


# ==================== 趋势分析 API ====================

class TrendItem(BaseModel):
    """趋势项"""
    topic: str
    direction: str  # rising, stable, declining
    change_rate: float
    document_count: int
    timeline: List[Dict[str, Any]]


class TrendsResponse(BaseModel):
    """趋势分析响应"""
    time_range: str
    total_documents: int
    trends: List[TrendItem]
    hot_topics: List[str]
    emerging_topics: List[str]
    declining_topics: List[str]


@router.get("/trends", response_model=TrendsResponse)
async def analyze_trends(
    time_range: str = Query(default="month", regex="^(week|month|quarter|year)$"),
    topic: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """分析趋势"""
    result = await trends_service.analyze_trends(
        db, time_range=time_range, topic=topic
    )
    return result


@router.get("/trends/topic/{topic}")
async def get_topic_evolution(
    topic: str,
    time_range: str = Query(default="quarter", regex="^(week|month|quarter|year)$"),
    db: AsyncSession = Depends(get_db),
):
    """获取特定主题的演变历史"""
    result = await trends_service.get_topic_evolution(
        db, topic=topic, time_range=time_range
    )
    return result


@router.get("/trends/heatmap")
async def get_activity_heatmap(
    time_range: str = Query(default="year", regex="^(week|month|quarter|year)$"),
    db: AsyncSession = Depends(get_db),
):
    """获取活动热力图数据"""
    result = await trends_service.get_activity_heatmap(db, time_range=time_range)
    return result


class PeriodCompareRequest(BaseModel):
    """时间段对比请求"""
    period1_start: datetime
    period1_end: datetime
    period2_start: datetime
    period2_end: datetime


@router.post("/trends/compare")
async def compare_periods(
    request: PeriodCompareRequest,
    db: AsyncSession = Depends(get_db),
):
    """比较两个时间段的主题分布"""
    result = await trends_service.compare_periods(
        db,
        period1_start=request.period1_start,
        period1_end=request.period1_end,
        period2_start=request.period2_start,
        period2_end=request.period2_end,
    )
    return result


# ==================== 研究报告 API ====================

class ReportRequest(BaseModel):
    """报告生成请求"""
    title: str
    document_ids: Optional[List[int]] = None
    topic: Optional[str] = None
    report_type: str = Field(default="overview", pattern="^(overview|comparison|analysis)$")
    include_citations: bool = True


class ReportSectionResponse(BaseModel):
    """报告章节响应"""
    title: str
    content: str
    citations: List[Dict[str, Any]] = []


class ReportResponse(BaseModel):
    """报告响应"""
    title: str
    generated_at: str
    report_type: str
    abstract: Optional[str] = None
    sections: List[ReportSectionResponse]
    conclusion: Optional[str] = None
    sources: List[Dict[str, Any]]
    metadata: Dict[str, Any]


@router.post("/reports/generate", response_model=ReportResponse)
async def generate_report(
    request: ReportRequest,
    db: AsyncSession = Depends(get_db),
):
    """生成研究报告"""
    if not request.document_ids and not request.topic:
        raise HTTPException(status_code=400, detail="必须提供 document_ids 或 topic")
    
    result = await report_service.generate_report(
        db,
        title=request.title,
        document_ids=request.document_ids,
        topic=request.topic,
        report_type=request.report_type,
        include_citations=request.include_citations,
    )
    return result


class QuickSummaryRequest(BaseModel):
    """快速摘要请求"""
    document_ids: List[int]


@router.post("/reports/quick-summary")
async def generate_quick_summary(
    request: QuickSummaryRequest,
    db: AsyncSession = Depends(get_db),
):
    """快速生成多文档摘要"""
    result = await report_service.generate_quick_summary(db, request.document_ids)
    return result


class OutlineRequest(BaseModel):
    """大纲生成请求"""
    title: str
    document_ids: List[int]
    depth: int = Field(default=2, ge=1, le=4)


@router.post("/reports/outline")
async def generate_outline(
    request: OutlineRequest,
    db: AsyncSession = Depends(get_db),
):
    """生成报告大纲"""
    result = await report_service.generate_outline(
        db,
        title=request.title,
        document_ids=request.document_ids,
        depth=request.depth,
    )
    return result


@router.post("/reports/export/{format}")
async def export_report(
    format: str,
    report: ReportResponse,
):
    """导出报告"""
    if format not in ["markdown", "html"]:
        raise HTTPException(status_code=400, detail="不支持的格式，支持 markdown 或 html")
    
    content = await report_service.export_report(report.dict(), format=format)
    
    media_type = "text/markdown" if format == "markdown" else "text/html"
    filename = f"report.{'md' if format == 'markdown' else 'html'}"
    
    return StreamingResponse(
        iter([content]),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ==================== 知识空白分析 API ====================

class CoverageResponse(BaseModel):
    """覆盖度分析响应"""
    overall_coverage: float
    domain_coverage: Dict[str, Any]
    gaps: List[Dict[str, Any]]
    strengths: List[str]
    recommendations: List[str]
    total_documents: int


@router.get("/gaps/coverage", response_model=CoverageResponse)
async def analyze_coverage(
    db: AsyncSession = Depends(get_db),
):
    """分析知识库的覆盖度"""
    result = await knowledge_gaps_service.analyze_coverage(db)
    return result


@router.get("/gaps/missing/{topic}")
async def find_missing_topics(
    topic: str,
    db: AsyncSession = Depends(get_db),
):
    """基于参考主题找出缺失的相关内容"""
    result = await knowledge_gaps_service.find_missing_topics(db, topic)
    return result


@router.get("/gaps/learning-path/{topic}")
async def suggest_learning_path(
    topic: str,
    db: AsyncSession = Depends(get_db),
):
    """基于知识空白建议学习路径"""
    result = await knowledge_gaps_service.suggest_learning_path(db, topic)
    return result


@router.get("/gaps/details")
async def get_gap_details(
    domain: str,
    subdomain: str,
    db: AsyncSession = Depends(get_db),
):
    """获取特定空白的详细信息"""
    result = await knowledge_gaps_service.get_gap_details(db, domain, subdomain)
    return result


@router.get("/gaps/compare/{role}")
async def compare_with_ideal(
    role: str,
    db: AsyncSession = Depends(get_db),
):
    """与理想知识结构对比"""
    result = await knowledge_gaps_service.compare_with_ideal(db, role)
    return result


# ==================== 综合分析 API ====================

@router.get("/analysis/overview")
async def get_analysis_overview(
    db: AsyncSession = Depends(get_db),
):
    """获取综合分析概览"""
    # 并行获取各项分析
    import asyncio
    
    coverage_task = knowledge_gaps_service.analyze_coverage(db)
    trends_task = trends_service.analyze_trends(db, time_range="month")
    clustering_task = clustering_service.cluster_documents(db)
    
    coverage, trends, clusters = await asyncio.gather(
        coverage_task, trends_task, clustering_task
    )
    
    return {
        "coverage": {
            "overall": coverage["overall_coverage"],
            "strengths": coverage["strengths"][:5],
            "top_gaps": [g["subdomain"] for g in coverage["gaps"][:3]]
        },
        "trends": {
            "hot_topics": trends["hot_topics"][:5],
            "emerging": trends["emerging_topics"][:3],
            "declining": trends["declining_topics"][:3]
        },
        "clusters": {
            "total": clusters["stats"]["total_clusters"],
            "largest": clusters["clusters"][0] if clusters["clusters"] else None
        },
        "recommendations": coverage["recommendations"][:3]
    }
