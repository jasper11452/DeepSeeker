"""
DeepSeeker - 知识空白分析服务
识别知识库中的盲区和缺失
"""
import logging
from typing import List, Dict, Any, Optional, Set
from collections import defaultdict
import asyncio
import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..models import Document
from .llm import llm_service
from .clustering import clustering_service

logger = logging.getLogger(__name__)


# 预定义的知识领域分类
KNOWLEDGE_DOMAINS = {
    "技术": {
        "AI/机器学习": ["AI", "人工智能", "机器学习", "深度学习", "神经网络", "LLM", "大模型"],
        "编程开发": ["编程", "代码", "Python", "JavaScript", "开发", "框架", "API"],
        "数据科学": ["数据分析", "数据挖掘", "统计", "可视化", "数据库"],
        "云计算": ["云", "AWS", "Azure", "容器", "Docker", "Kubernetes"],
        "网络安全": ["安全", "加密", "漏洞", "防护", "网络攻击"],
    },
    "商业": {
        "市场营销": ["营销", "推广", "品牌", "广告", "SEO", "社交媒体"],
        "产品管理": ["产品", "需求", "用户体验", "MVP", "迭代"],
        "商业模式": ["商业模式", "盈利", "变现", "融资", "投资"],
        "管理领导": ["管理", "领导力", "团队", "组织", "战略"],
    },
    "科学": {
        "物理学": ["物理", "量子", "力学", "相对论", "粒子"],
        "生物学": ["生物", "基因", "细胞", "进化", "生态"],
        "化学": ["化学", "分子", "反应", "材料"],
        "数学": ["数学", "算法", "概率", "统计", "优化"],
    },
    "人文社科": {
        "心理学": ["心理", "认知", "行为", "情绪", "动机"],
        "经济学": ["经济", "市场", "金融", "货币", "贸易"],
        "历史": ["历史", "文明", "朝代", "战争", "革命"],
        "哲学": ["哲学", "思想", "伦理", "逻辑", "存在"],
    },
}


class KnowledgeGapsService:
    """知识空白分析服务"""
    
    def __init__(self):
        self.min_coverage_threshold = 0.3  # 最低覆盖度阈值
        self.significant_gap_threshold = 0.2  # 显著空白阈值
        
    async def analyze_coverage(
        self,
        db: AsyncSession,
        custom_domains: Optional[Dict[str, List[str]]] = None
    ) -> Dict[str, Any]:
        """
        分析知识库的覆盖度
        
        返回格式:
        {
            "overall_coverage": 0.65,  # 总体覆盖度
            "domain_coverage": {
                "技术": {
                    "coverage": 0.8,
                    "subdomains": {
                        "AI/机器学习": {"coverage": 0.95, "document_count": 15},
                        "编程开发": {"coverage": 0.7, "document_count": 8},
                        ...
                    }
                },
                ...
            },
            "gaps": [
                {
                    "domain": "商业",
                    "subdomain": "商业模式",
                    "severity": "high",
                    "suggestion": "建议补充商业模式相关资料"
                }
            ],
            "strengths": ["AI/机器学习", "编程开发"],
            "recommendations": ["建议补充 X 方面的内容"]
        }
        """
        # 获取所有文档
        stmt = select(Document).where(Document.status == "completed")
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        if not documents:
            return {
                "overall_coverage": 0,
                "domain_coverage": {},
                "gaps": [],
                "strengths": [],
                "recommendations": ["知识库为空,建议开始添加文档"]
            }
        
        # 使用自定义或默认领域
        domains = custom_domains or KNOWLEDGE_DOMAINS
        
        # 分析每个领域的覆盖度
        domain_coverage = {}
        all_doc_contents = self._get_all_contents(documents)
        
        for domain_name, subdomains in domains.items():
            subdomain_coverages = {}
            
            for subdomain_name, keywords in subdomains.items():
                # 计算该子领域的文档数量
                matching_docs = self._count_matching_documents(
                    documents, keywords
                )
                coverage = min(1.0, matching_docs / max(5, len(documents) * 0.1))
                
                subdomain_coverages[subdomain_name] = {
                    "coverage": coverage,
                    "document_count": matching_docs,
                    "keywords": keywords[:5]
                }
            
            # 计算领域平均覆盖度
            avg_coverage = np.mean([s["coverage"] for s in subdomain_coverages.values()])
            
            domain_coverage[domain_name] = {
                "coverage": float(avg_coverage),
                "subdomains": subdomain_coverages
            }
        
        # 识别空白
        gaps = self._identify_gaps(domain_coverage)
        
        # 识别优势
        strengths = self._identify_strengths(domain_coverage)
        
        # 生成建议
        recommendations = await self._generate_recommendations(
            domain_coverage, gaps, documents
        )
        
        # 计算总体覆盖度
        overall_coverage = np.mean([d["coverage"] for d in domain_coverage.values()])
        
        return {
            "overall_coverage": float(overall_coverage),
            "domain_coverage": domain_coverage,
            "gaps": gaps,
            "strengths": strengths,
            "recommendations": recommendations,
            "total_documents": len(documents)
        }
    
    async def find_missing_topics(
        self,
        db: AsyncSession,
        reference_topic: str
    ) -> Dict[str, Any]:
        """
        基于参考主题找出缺失的相关内容
        
        例如: 用户收集了很多 AI 内容,但缺少 AI 伦理、AI 安全等方面
        """
        # 获取所有文档
        stmt = select(Document).where(Document.status == "completed")
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        # 找出与参考主题相关的文档
        related_docs = []
        for doc in documents:
            content = (doc.title or "") + " " + (doc.content or "")
            if reference_topic.lower() in content.lower():
                related_docs.append(doc)
        
        if not related_docs:
            return {
                "reference_topic": reference_topic,
                "related_document_count": 0,
                "missing_aspects": [],
                "suggestion": f"没有找到与 '{reference_topic}' 相关的文档"
            }
        
        # 分析现有内容涵盖的方面
        covered_aspects = await self._extract_covered_aspects(related_docs, reference_topic)
        
        # 使用 LLM 推断可能缺失的方面
        missing_aspects = await self._infer_missing_aspects(
            reference_topic, covered_aspects
        )
        
        return {
            "reference_topic": reference_topic,
            "related_document_count": len(related_docs),
            "covered_aspects": covered_aspects,
            "missing_aspects": missing_aspects,
            "coverage_analysis": {
                "total_aspects_expected": len(covered_aspects) + len(missing_aspects),
                "covered_count": len(covered_aspects),
                "missing_count": len(missing_aspects),
                "coverage_rate": len(covered_aspects) / (len(covered_aspects) + len(missing_aspects)) if missing_aspects else 1.0
            }
        }
    
    async def suggest_learning_path(
        self,
        db: AsyncSession,
        target_topic: str
    ) -> Dict[str, Any]:
        """
        基于知识空白建议学习路径
        """
        # 分析当前覆盖度
        coverage = await self.analyze_coverage(db)
        
        # 找出与目标主题相关的空白
        related_gaps = []
        for gap in coverage["gaps"]:
            if target_topic.lower() in gap["subdomain"].lower() or \
               target_topic.lower() in gap["domain"].lower():
                related_gaps.append(gap)
        
        # 使用 LLM 生成学习路径建议
        prompt = f"""基于以下知识空白分析,为学习"{target_topic}"生成一个学习路径建议:

当前优势领域: {', '.join(coverage['strengths'][:5])}
知识空白: {', '.join([g['subdomain'] for g in coverage['gaps'][:5]])}
目标主题相关空白: {', '.join([g['subdomain'] for g in related_gaps[:3]])}

请生成一个分阶段的学习路径,包括:
1. 基础准备（需要先了解的内容）
2. 核心学习（主要学习内容）
3. 进阶拓展（深入学习方向）

每个阶段列出2-3个具体主题。

/no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=500)
            
            path = self._parse_learning_path(response.strip())
            
            return {
                "target_topic": target_topic,
                "current_strengths": coverage["strengths"][:5],
                "related_gaps": [g["subdomain"] for g in related_gaps],
                "learning_path": path,
                "estimated_resources_needed": len(related_gaps) * 3
            }
            
        except Exception as e:
            logger.error(f"Failed to generate learning path: {e}")
            return {
                "target_topic": target_topic,
                "error": str(e)
            }
    
    async def get_gap_details(
        self,
        db: AsyncSession,
        domain: str,
        subdomain: str
    ) -> Dict[str, Any]:
        """获取特定空白的详细信息和建议"""
        # 获取该子领域的关键词
        keywords = []
        if domain in KNOWLEDGE_DOMAINS:
            keywords = KNOWLEDGE_DOMAINS[domain].get(subdomain, [])
        
        # 搜索建议的学习资源
        search_suggestions = await self._generate_search_suggestions(
            domain, subdomain, keywords
        )
        
        # 分析为什么这个领域重要
        importance = await self._analyze_gap_importance(domain, subdomain)
        
        return {
            "domain": domain,
            "subdomain": subdomain,
            "keywords": keywords,
            "importance": importance,
            "search_suggestions": search_suggestions,
            "recommended_actions": [
                f"搜索关键词: {', '.join(keywords[:3])}",
                f"关注 {subdomain} 领域的最新动态",
                f"收集 {subdomain} 的入门教程和案例"
            ]
        }
    
    async def compare_with_ideal(
        self,
        db: AsyncSession,
        role: str  # e.g., "AI研究员", "产品经理", "数据分析师"
    ) -> Dict[str, Any]:
        """
        与理想知识结构对比
        """
        # 定义不同角色的理想知识结构
        role_requirements = {
            "AI研究员": {
                "必备": ["AI/机器学习", "数学", "编程开发"],
                "重要": ["数据科学", "论文写作"],
                "了解": ["产品管理", "云计算"]
            },
            "产品经理": {
                "必备": ["产品管理", "市场营销", "用户研究"],
                "重要": ["数据科学", "项目管理"],
                "了解": ["编程开发", "AI/机器学习"]
            },
            "数据分析师": {
                "必备": ["数据科学", "统计学", "编程开发"],
                "重要": ["商业理解", "可视化"],
                "了解": ["AI/机器学习", "产品管理"]
            }
        }
        
        requirements = role_requirements.get(role, role_requirements["AI研究员"])
        
        # 获取当前覆盖度
        coverage = await self.analyze_coverage(db)
        
        # 对比分析
        comparison = {
            "role": role,
            "requirements": requirements,
            "current_status": {
                "必备": [],
                "重要": [],
                "了解": []
            },
            "gaps_by_priority": {
                "urgent": [],  # 必备但缺失
                "important": [],  # 重要但缺失
                "optional": []  # 了解但缺失
            }
        }
        
        for priority, domains in requirements.items():
            for domain in domains:
                # 检查是否已覆盖
                is_covered = domain in coverage["strengths"]
                
                comparison["current_status"][priority].append({
                    "domain": domain,
                    "covered": is_covered
                })
                
                if not is_covered:
                    if priority == "必备":
                        comparison["gaps_by_priority"]["urgent"].append(domain)
                    elif priority == "重要":
                        comparison["gaps_by_priority"]["important"].append(domain)
                    else:
                        comparison["gaps_by_priority"]["optional"].append(domain)
        
        # 计算匹配度
        total_required = sum(len(domains) for domains in requirements.values())
        total_covered = sum(
            1 for items in comparison["current_status"].values()
            for item in items if item["covered"]
        )
        comparison["match_rate"] = total_covered / total_required if total_required > 0 else 0
        
        return comparison
    
    def _get_all_contents(self, documents: List[Document]) -> List[str]:
        """获取所有文档内容"""
        return [
            (doc.title or "") + " " + (doc.content or "")
            for doc in documents
        ]
    
    def _count_matching_documents(
        self,
        documents: List[Document],
        keywords: List[str]
    ) -> int:
        """统计匹配关键词的文档数量"""
        count = 0
        for doc in documents:
            content = ((doc.title or "") + " " + (doc.content or "")).lower()
            if any(kw.lower() in content for kw in keywords):
                count += 1
        return count
    
    def _identify_gaps(
        self,
        domain_coverage: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """识别知识空白"""
        gaps = []
        
        for domain_name, domain_data in domain_coverage.items():
            for subdomain_name, subdomain_data in domain_data["subdomains"].items():
                coverage = subdomain_data["coverage"]
                
                if coverage < self.significant_gap_threshold:
                    severity = "high" if coverage < 0.1 else "medium"
                    gaps.append({
                        "domain": domain_name,
                        "subdomain": subdomain_name,
                        "coverage": coverage,
                        "severity": severity,
                        "document_count": subdomain_data["document_count"],
                        "suggestion": f"建议补充 {subdomain_name} 相关资料"
                    })
        
        # 按严重程度排序
        gaps.sort(key=lambda x: (0 if x["severity"] == "high" else 1, x["coverage"]))
        
        return gaps
    
    def _identify_strengths(
        self,
        domain_coverage: Dict[str, Any]
    ) -> List[str]:
        """识别知识优势"""
        strengths = []
        
        for domain_name, domain_data in domain_coverage.items():
            for subdomain_name, subdomain_data in domain_data["subdomains"].items():
                if subdomain_data["coverage"] > 0.6 and subdomain_data["document_count"] >= 3:
                    strengths.append(subdomain_name)
        
        return strengths
    
    async def _generate_recommendations(
        self,
        domain_coverage: Dict[str, Any],
        gaps: List[Dict[str, Any]],
        documents: List[Document]
    ) -> List[str]:
        """生成改进建议"""
        recommendations = []
        
        # 基于最严重的空白生成建议
        high_priority_gaps = [g for g in gaps if g["severity"] == "high"][:3]
        
        for gap in high_priority_gaps:
            recommendations.append(
                f"你收集了较多内容，但缺少 {gap['subdomain']} 方面的资料，"
                f"建议补充相关文档"
            )
        
        # 基于整体分析生成建议
        low_coverage_domains = [
            d for d, data in domain_coverage.items()
            if data["coverage"] < self.min_coverage_threshold
        ]
        
        if low_coverage_domains:
            recommendations.append(
                f"以下领域覆盖度较低: {', '.join(low_coverage_domains[:3])}，"
                f"考虑是否需要拓展这些方向"
            )
        
        return recommendations
    
    async def _extract_covered_aspects(
        self,
        documents: List[Document],
        topic: str
    ) -> List[str]:
        """提取已覆盖的方面"""
        # 收集文档内容
        contents = []
        for doc in documents[:10]:
            content = doc.content[:500] if doc.content else ""
            contents.append(content)
        
        prompt = f"""分析以下关于"{topic}"的文档内容,列出已涵盖的主要方面:

{chr(10).join(contents[:5])}

请列出3-8个已涵盖的方面,每行一个: /no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=200)
            
            aspects = [
                line.strip().lstrip("-").lstrip("•").lstrip("0123456789.").strip()
                for line in response.strip().split("\n")
                if line.strip()
            ]
            return aspects[:8]
        except Exception:
            return []
    
    async def _infer_missing_aspects(
        self,
        topic: str,
        covered_aspects: List[str]
    ) -> List[Dict[str, Any]]:
        """推断缺失的方面"""
        prompt = f""""{topic}"这个主题通常包含以下方面:
{chr(10).join([f"- {a}" for a in covered_aspects])}

请列出该主题中可能还缺失的3-5个重要方面,并说明重要性:
格式: 方面名称 - 重要性说明

/no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.4, max_tokens=300)
            
            missing = []
            for line in response.strip().split("\n"):
                if " - " in line:
                    parts = line.split(" - ", 1)
                    name = parts[0].strip().lstrip("-").lstrip("•").strip()
                    importance = parts[1].strip() if len(parts) > 1 else ""
                    
                    if name and name not in covered_aspects:
                        missing.append({
                            "aspect": name,
                            "importance": importance,
                            "priority": "high" if len(missing) < 2 else "medium"
                        })
            
            return missing[:5]
        except Exception:
            return []
    
    def _parse_learning_path(self, text: str) -> List[Dict[str, Any]]:
        """解析学习路径"""
        path = []
        current_stage = None
        current_topics = []
        
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            
            # 检测阶段标题
            if any(kw in line for kw in ["基础", "核心", "进阶"]):
                if current_stage:
                    path.append({
                        "stage": current_stage,
                        "topics": current_topics
                    })
                current_stage = line.lstrip("0123456789.").strip()
                current_topics = []
            elif line.startswith("-") or line.startswith("•"):
                topic = line.lstrip("-").lstrip("•").strip()
                if topic:
                    current_topics.append(topic)
        
        if current_stage:
            path.append({
                "stage": current_stage,
                "topics": current_topics
            })
        
        return path
    
    async def _generate_search_suggestions(
        self,
        domain: str,
        subdomain: str,
        keywords: List[str]
    ) -> List[str]:
        """生成搜索建议"""
        suggestions = [
            f"{subdomain} 入门教程",
            f"{subdomain} 最佳实践",
            f"{subdomain} 案例分析"
        ]
        
        if keywords:
            suggestions.extend([
                f"{kw} 详解" for kw in keywords[:2]
            ])
        
        return suggestions
    
    async def _analyze_gap_importance(
        self,
        domain: str,
        subdomain: str
    ) -> str:
        """分析空白的重要性"""
        prompt = f"""简要说明为什么"{subdomain}"(属于{domain}领域)对于知识积累很重要(50字以内): /no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=100)
            return response.strip()
        except Exception:
            return f"{subdomain}是{domain}领域的重要组成部分"


# 单例实例
knowledge_gaps_service = KnowledgeGapsService()
