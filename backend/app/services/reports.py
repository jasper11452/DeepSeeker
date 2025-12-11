"""
DeepSeeker - 研究报告生成服务
基于多文档自动生成综述
"""
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..models import Document
from .llm import llm_service
from .rag import rag_service
from .clustering import clustering_service

logger = logging.getLogger(__name__)


class ReportService:
    """研究报告生成服务"""
    
    def __init__(self):
        self.max_sources = 20  # 最多引用的来源数
        self.max_content_per_doc = 2000  # 每个文档最大内容长度
        
    async def generate_report(
        self,
        db: AsyncSession,
        title: str,
        document_ids: Optional[List[int]] = None,
        topic: Optional[str] = None,
        report_type: str = "overview",  # overview, comparison, analysis
        include_citations: bool = True
    ) -> Dict[str, Any]:
        """
        生成研究报告
        
        report_type:
        - overview: 综述报告,概述主题的各个方面
        - comparison: 对比报告,比较不同观点或方案
        - analysis: 深度分析报告,深入分析某个问题
        
        返回格式:
        {
            "title": "报告标题",
            "generated_at": "2024-01-01T00:00:00",
            "report_type": "overview",
            "abstract": "摘要...",
            "sections": [
                {
                    "title": "章节标题",
                    "content": "章节内容...",
                    "citations": [{"doc_id": 1, "text": "引用文本"}]
                }
            ],
            "conclusion": "结论...",
            "sources": [
                {"id": 1, "title": "文档标题", "contribution": "高"}
            ],
            "metadata": {
                "word_count": 2000,
                "source_count": 10
            }
        }
        """
        # 获取相关文档
        if document_ids:
            stmt = select(Document).where(Document.id.in_(document_ids))
        elif topic:
            # 通过搜索获取相关文档
            stmt = select(Document).where(Document.status == "completed")
        else:
            raise ValueError("必须提供 document_ids 或 topic")
        
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        if not documents:
            return {
                "title": title,
                "generated_at": datetime.now().isoformat(),
                "error": "没有找到相关文档"
            }
        
        # 如果提供了 topic，过滤相关文档
        if topic and not document_ids:
            documents = await self._filter_relevant_documents(documents, topic)
        
        # 限制文档数量
        documents = documents[:self.max_sources]
        
        # 根据报告类型生成
        if report_type == "overview":
            report = await self._generate_overview_report(title, documents, topic)
        elif report_type == "comparison":
            report = await self._generate_comparison_report(title, documents, topic)
        elif report_type == "analysis":
            report = await self._generate_analysis_report(title, documents, topic)
        else:
            report = await self._generate_overview_report(title, documents, topic)
        
        # 添加元数据
        report["generated_at"] = datetime.now().isoformat()
        report["report_type"] = report_type
        report["metadata"] = {
            "word_count": self._count_words(report),
            "source_count": len(documents)
        }
        
        return report
    
    async def generate_quick_summary(
        self,
        db: AsyncSession,
        document_ids: List[int]
    ) -> Dict[str, Any]:
        """快速生成多文档摘要"""
        stmt = select(Document).where(Document.id.in_(document_ids))
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        if not documents:
            return {"summary": "没有找到相关文档"}
        
        # 收集文档内容
        doc_contents = []
        for doc in documents[:10]:
            content = doc.content[:1500] if doc.content else ""
            doc_contents.append(f"【{doc.title or doc.filename}】\n{content}")
        
        prompt = f"""请对以下{len(documents)}篇文档进行综合摘要,提炼核心要点:

{chr(10).join(doc_contents)}

请生成一个200-400字的综合摘要,要点包括:
1. 文档的共同主题
2. 核心观点和发现
3. 主要差异或补充点

摘要: /no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=600)
            
            return {
                "summary": response.strip(),
                "document_count": len(documents),
                "documents": [
                    {"id": d.id, "title": d.title or d.filename}
                    for d in documents
                ]
            }
        except Exception as e:
            logger.error(f"Failed to generate quick summary: {e}")
            return {"summary": "摘要生成失败", "error": str(e)}
    
    async def generate_outline(
        self,
        db: AsyncSession,
        title: str,
        document_ids: List[int],
        depth: int = 2  # 大纲深度
    ) -> Dict[str, Any]:
        """生成报告大纲"""
        stmt = select(Document).where(Document.id.in_(document_ids))
        result = await db.execute(stmt)
        documents = result.scalars().all()
        
        if not documents:
            return {"outline": []}
        
        # 收集文档信息
        doc_info = []
        for doc in documents[:15]:
            content = doc.content[:800] if doc.content else ""
            doc_info.append(f"- {doc.title or doc.filename}: {content[:200]}")
        
        prompt = f"""基于以下文档,为题为"{title}"的研究报告生成一个详细大纲:

文档列表:
{chr(10).join(doc_info)}

请生成一个{depth}级大纲,格式如下:
1. 一级标题
   1.1 二级标题
   1.2 二级标题
2. 一级标题
...

大纲: /no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=500)
            
            # 解析大纲
            outline = self._parse_outline(response.strip())
            
            return {
                "title": title,
                "outline": outline,
                "suggested_structure": self._suggest_report_structure(outline)
            }
        except Exception as e:
            logger.error(f"Failed to generate outline: {e}")
            return {"outline": [], "error": str(e)}
    
    async def export_report(
        self,
        report: Dict[str, Any],
        format: str = "markdown"  # markdown, html
    ) -> str:
        """导出报告"""
        if format == "html":
            return self._export_html(report)
        else:
            return self._export_markdown(report)
    
    async def _generate_overview_report(
        self,
        title: str,
        documents: List[Document],
        topic: Optional[str]
    ) -> Dict[str, Any]:
        """生成综述报告"""
        # 第一步：生成大纲
        doc_summaries = []
        for doc in documents[:10]:
            content = doc.content[:1000] if doc.content else ""
            doc_summaries.append(f"【{doc.title}】{content}")
        
        outline_prompt = f"""为题为"{title}"的综述报告设计章节结构。

参考文档:
{chr(10).join(doc_summaries[:5])}

请设计3-5个主要章节,每个章节包含标题和简要说明。
格式: 章节标题 - 简要说明

/no_think"""

        try:
            outline_response = await llm_service.chat([
                {"role": "user", "content": outline_prompt}
            ], temperature=0.3, max_tokens=300)
            
            # 解析章节
            sections_outline = []
            for line in outline_response.strip().split("\n"):
                if " - " in line:
                    parts = line.split(" - ", 1)
                    sections_outline.append({
                        "title": parts[0].strip().lstrip("0123456789.").strip(),
                        "description": parts[1].strip() if len(parts) > 1 else ""
                    })
            
            if not sections_outline:
                sections_outline = [
                    {"title": "背景介绍", "description": ""},
                    {"title": "主要内容", "description": ""},
                    {"title": "总结展望", "description": ""}
                ]
            
            # 第二步：为每个章节生成内容
            sections = []
            for section_info in sections_outline:
                section_content = await self._generate_section_content(
                    section_info["title"],
                    section_info["description"],
                    documents,
                    topic
                )
                sections.append(section_content)
            
            # 第三步：生成摘要
            abstract = await self._generate_abstract(title, sections)
            
            # 第四步：生成结论
            conclusion = await self._generate_conclusion(title, sections)
            
            return {
                "title": title,
                "abstract": abstract,
                "sections": sections,
                "conclusion": conclusion,
                "sources": [
                    {
                        "id": doc.id,
                        "title": doc.title or doc.filename,
                        "filename": doc.filename
                    }
                    for doc in documents
                ]
            }
            
        except Exception as e:
            logger.error(f"Failed to generate overview report: {e}")
            return {
                "title": title,
                "error": str(e),
                "sections": []
            }
    
    async def _generate_comparison_report(
        self,
        title: str,
        documents: List[Document],
        topic: Optional[str]
    ) -> Dict[str, Any]:
        """生成对比报告"""
        # 提取各文档的核心观点
        viewpoints = []
        for doc in documents[:10]:
            content = doc.content[:1500] if doc.content else ""
            
            prompt = f"""从以下文档中提取核心观点:

文档: {doc.title or doc.filename}
内容: {content}

请用2-3句话总结其核心观点: /no_think"""

            try:
                response = await llm_service.chat([
                    {"role": "user", "content": prompt}
                ], temperature=0.3, max_tokens=200)
                
                viewpoints.append({
                    "doc_id": doc.id,
                    "doc_title": doc.title or doc.filename,
                    "viewpoint": response.strip()
                })
            except Exception:
                continue
        
        # 生成对比分析
        comparison_prompt = f"""基于以下不同文档的观点,生成一个对比分析:

{chr(10).join([f"【{v['doc_title']}】: {v['viewpoint']}" for v in viewpoints])}

请从以下角度进行对比:
1. 共同点
2. 主要分歧
3. 各自优势
4. 综合评价

/no_think"""

        try:
            comparison = await llm_service.chat([
                {"role": "user", "content": comparison_prompt}
            ], temperature=0.3, max_tokens=800)
            
            sections = [
                {
                    "title": "各方观点概述",
                    "content": "\n\n".join([
                        f"**{v['doc_title']}**: {v['viewpoint']}"
                        for v in viewpoints
                    ]),
                    "citations": []
                },
                {
                    "title": "对比分析",
                    "content": comparison.strip(),
                    "citations": []
                }
            ]
            
            abstract = f"本报告对比分析了{len(viewpoints)}个来源关于{topic or title}的不同观点。"
            
            return {
                "title": title,
                "abstract": abstract,
                "sections": sections,
                "conclusion": "各来源在核心问题上既有共识也有分歧,需要根据具体场景选择合适的方案。",
                "sources": [
                    {"id": doc.id, "title": doc.title or doc.filename}
                    for doc in documents
                ]
            }
            
        except Exception as e:
            logger.error(f"Failed to generate comparison report: {e}")
            return {"title": title, "error": str(e), "sections": []}
    
    async def _generate_analysis_report(
        self,
        title: str,
        documents: List[Document],
        topic: Optional[str]
    ) -> Dict[str, Any]:
        """生成深度分析报告"""
        # 收集所有相关内容
        all_content = []
        for doc in documents[:15]:
            content = doc.content[:self.max_content_per_doc] if doc.content else ""
            all_content.append(f"【来源: {doc.title or doc.filename}】\n{content}")
        
        # 深度分析 prompt
        analysis_prompt = f"""请基于以下文档内容,对"{topic or title}"进行深度分析:

{chr(10).join(all_content[:5])}

请从以下维度进行分析:
1. 问题背景与现状
2. 关键因素分析
3. 潜在风险与机遇
4. 建议与展望

每个部分请提供详细论述(200-400字),并引用相关来源。

/no_think"""

        try:
            analysis = await llm_service.chat([
                {"role": "user", "content": analysis_prompt}
            ], temperature=0.4, max_tokens=2000)
            
            # 解析分析结果为章节
            sections = self._parse_analysis_sections(analysis)
            
            # 生成摘要
            abstract = await self._generate_abstract(title, sections)
            
            return {
                "title": title,
                "abstract": abstract,
                "sections": sections,
                "conclusion": sections[-1]["content"] if sections else "",
                "sources": [
                    {"id": doc.id, "title": doc.title or doc.filename}
                    for doc in documents
                ]
            }
            
        except Exception as e:
            logger.error(f"Failed to generate analysis report: {e}")
            return {"title": title, "error": str(e), "sections": []}
    
    async def _generate_section_content(
        self,
        section_title: str,
        section_description: str,
        documents: List[Document],
        topic: Optional[str]
    ) -> Dict[str, Any]:
        """生成章节内容"""
        # 收集相关内容
        relevant_content = []
        for doc in documents[:8]:
            content = doc.content[:1000] if doc.content else ""
            relevant_content.append(f"[{doc.title or doc.filename}]: {content}")
        
        prompt = f"""为"{section_title}"章节撰写内容。

章节说明: {section_description}
主题: {topic or '综合分析'}

参考资料:
{chr(10).join(relevant_content[:4])}

请撰写200-400字的章节内容,要求:
1. 内容充实,论述清晰
2. 适当引用参考资料
3. 保持客观专业的语调

/no_think"""

        try:
            content = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.4, max_tokens=600)
            
            return {
                "title": section_title,
                "content": content.strip(),
                "citations": []  # 可以进一步实现引用提取
            }
        except Exception as e:
            logger.error(f"Failed to generate section content: {e}")
            return {
                "title": section_title,
                "content": f"[内容生成失败: {e}]",
                "citations": []
            }
    
    async def _generate_abstract(
        self,
        title: str,
        sections: List[Dict[str, Any]]
    ) -> str:
        """生成报告摘要"""
        section_summaries = [f"- {s['title']}: {s['content'][:100]}..." for s in sections]
        
        prompt = f"""为题为"{title}"的报告生成一个100-150字的摘要。

报告章节:
{chr(10).join(section_summaries)}

摘要: /no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=200)
            return response.strip()
        except Exception:
            return f"本报告对{title}进行了系统性分析。"
    
    async def _generate_conclusion(
        self,
        title: str,
        sections: List[Dict[str, Any]]
    ) -> str:
        """生成报告结论"""
        key_points = [s['content'][:200] for s in sections]
        
        prompt = f"""基于以下报告内容,生成一个简洁有力的结论(100-150字):

主要内容:
{chr(10).join(key_points)}

结论: /no_think"""

        try:
            response = await llm_service.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=200)
            return response.strip()
        except Exception:
            return "综上所述,本报告对相关问题进行了全面分析,为后续研究和决策提供了参考。"
    
    async def _filter_relevant_documents(
        self,
        documents: List[Document],
        topic: str
    ) -> List[Document]:
        """过滤与主题相关的文档"""
        relevant = []
        for doc in documents:
            content = (doc.title or "") + " " + (doc.content or "")
            if topic.lower() in content.lower():
                relevant.append(doc)
        
        # 如果过滤后太少，返回所有文档
        if len(relevant) < 3:
            return documents
        return relevant
    
    def _parse_outline(self, text: str) -> List[Dict[str, Any]]:
        """解析大纲文本"""
        outline = []
        current_section = None
        
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            
            # 判断级别
            if line[0].isdigit() and "." in line[:4]:
                parts = line.split(".", 1)
                if len(parts[0]) == 1:  # 一级标题
                    if current_section:
                        outline.append(current_section)
                    current_section = {
                        "title": parts[1].strip().lstrip(".").strip() if len(parts) > 1 else line,
                        "children": []
                    }
                else:  # 二级标题
                    if current_section:
                        current_section["children"].append({
                            "title": parts[1].strip().lstrip(".").strip() if len(parts) > 1 else line
                        })
        
        if current_section:
            outline.append(current_section)
        
        return outline
    
    def _suggest_report_structure(self, outline: List[Dict]) -> Dict[str, Any]:
        """建议报告结构"""
        return {
            "estimated_length": f"{len(outline) * 500}-{len(outline) * 800}字",
            "sections": len(outline),
            "depth": max(len(s.get("children", [])) for s in outline) if outline else 0
        }
    
    def _parse_analysis_sections(self, text: str) -> List[Dict[str, Any]]:
        """解析分析文本为章节"""
        sections = []
        current_title = None
        current_content = []
        
        for line in text.split("\n"):
            # 检测章节标题（以数字开头或包含特定关键词）
            if any(line.strip().startswith(f"{i}.") for i in range(1, 10)):
                if current_title:
                    sections.append({
                        "title": current_title,
                        "content": "\n".join(current_content).strip(),
                        "citations": []
                    })
                current_title = line.strip().lstrip("0123456789.").strip()
                current_content = []
            else:
                current_content.append(line)
        
        if current_title:
            sections.append({
                "title": current_title,
                "content": "\n".join(current_content).strip(),
                "citations": []
            })
        
        # 如果没有解析到章节，将整个文本作为一个章节
        if not sections:
            sections.append({
                "title": "分析内容",
                "content": text.strip(),
                "citations": []
            })
        
        return sections
    
    def _count_words(self, report: Dict[str, Any]) -> int:
        """统计报告字数"""
        total = 0
        if report.get("abstract"):
            total += len(report["abstract"])
        for section in report.get("sections", []):
            total += len(section.get("content", ""))
        if report.get("conclusion"):
            total += len(report["conclusion"])
        return total
    
    def _export_markdown(self, report: Dict[str, Any]) -> str:
        """导出为 Markdown"""
        lines = [f"# {report.get('title', '研究报告')}\n"]
        
        if report.get("abstract"):
            lines.append("## 摘要\n")
            lines.append(report["abstract"])
            lines.append("")
        
        for section in report.get("sections", []):
            lines.append(f"## {section['title']}\n")
            lines.append(section.get("content", ""))
            lines.append("")
        
        if report.get("conclusion"):
            lines.append("## 结论\n")
            lines.append(report["conclusion"])
            lines.append("")
        
        if report.get("sources"):
            lines.append("## 参考来源\n")
            for i, source in enumerate(report["sources"], 1):
                lines.append(f"{i}. {source.get('title', '未知来源')}")
        
        return "\n".join(lines)
    
    def _export_html(self, report: Dict[str, Any]) -> str:
        """导出为 HTML"""
        html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{report.get('title', '研究报告')}</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }}
        h1 {{ border-bottom: 2px solid #333; padding-bottom: 10px; }}
        h2 {{ color: #444; margin-top: 30px; }}
        .abstract {{ background: #f5f5f5; padding: 15px; border-radius: 5px; }}
        .sources {{ font-size: 0.9em; color: #666; }}
    </style>
</head>
<body>
    <h1>{report.get('title', '研究报告')}</h1>
"""
        
        if report.get("abstract"):
            html += f'    <div class="abstract"><h2>摘要</h2><p>{report["abstract"]}</p></div>\n'
        
        for section in report.get("sections", []):
            html += f'    <h2>{section["title"]}</h2>\n'
            html += f'    <p>{section.get("content", "").replace(chr(10), "<br>")}</p>\n'
        
        if report.get("conclusion"):
            html += f'    <h2>结论</h2>\n    <p>{report["conclusion"]}</p>\n'
        
        if report.get("sources"):
            html += '    <div class="sources"><h2>参考来源</h2><ol>\n'
            for source in report["sources"]:
                html += f'        <li>{source.get("title", "未知来源")}</li>\n'
            html += '    </ol></div>\n'
        
        html += "</body></html>"
        return html


# 单例实例
report_service = ReportService()
