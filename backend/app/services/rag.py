"""
Atlas MVP - RAG (Retrieval Augmented Generation) Service
"""
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from .search import hybrid_search, SearchResult
from .llm import llm_service


class RAGService:
    """RAG service for question answering."""

    def __init__(self):
        self.max_context_chunks = 8  # 最多检索数量（增加）
        self.max_context_length = 4000  # 增大上下文长度
        self.min_score_threshold = 0.01  # 最低相关度阈值
        self.score_drop_threshold = 0.4  # 分数下降阈值（放宽）
        self.max_chunks_per_doc = 3  # 同一文档最多保留的 chunk 数
        self.use_rerank = True  # 是否使用 rerank

    def _deduplicate_and_filter(self, results: List[SearchResult]) -> List[SearchResult]:
        """
        智能去重和过滤：
        1. 同一文档最多保留 max_chunks_per_doc 个 chunk
        2. 按内容相似度去重（避免内容几乎相同的 chunk）
        3. 过滤低相关度的结果
        4. 动态控制数量（根据分数差距）
        """
        if not results:
            return []

        # 按分数降序排列
        sorted_results = sorted(results, key=lambda x: x.score, reverse=True)
        
        # 最高分作为基准
        max_score = sorted_results[0].score
        
        filtered = []
        doc_chunk_count = {}  # 每个文档已选择的 chunk 数
        seen_content_hashes = set()
        
        for result in sorted_results:
            # 1. 过滤低于阈值的结果
            if result.score < self.min_score_threshold:
                continue
            
            # 2. 过滤分数远低于最高分的结果（动态截断）
            if max_score > 0 and result.score < max_score * self.score_drop_threshold:
                break  # 后续结果分数更低，直接停止
            
            # 3. 同一文档最多保留 max_chunks_per_doc 个 chunk
            doc_id = result.document_id
            current_count = doc_chunk_count.get(doc_id, 0)
            if current_count >= self.max_chunks_per_doc:
                continue
            
            # 4. 按内容去重（简单哈希）
            content_hash = hash(result.content[:200])  # 用前200字符做哈希
            if content_hash in seen_content_hashes:
                continue
            
            doc_chunk_count[doc_id] = current_count + 1
            seen_content_hashes.add(content_hash)
            filtered.append(result)
            
            # 最多保留 max_context_chunks 个高质量结果
            if len(filtered) >= self.max_context_chunks:
                break
        
        return filtered

    async def _rerank_results(self, query: str, results: List[SearchResult]) -> List[SearchResult]:
        """使用 rerank 模型对结果重新排序"""
        if not results or not self.use_rerank:
            return results
        
        try:
            documents = [r.content for r in results]
            rerank_results = await llm_service.rerank(query, documents, top_k=len(results))
            
            if rerank_results:
                # 按 rerank 分数重新排序
                reordered = []
                for item in rerank_results:
                    idx = item.get("index", 0)
                    if 0 <= idx < len(results):
                        result = results[idx]
                        # 融合原始分数和rerank分数 (0.1 * original + 0.9 * rerank)
                        # 提高 rerank 的权重，因为它是专门训练来判断相关性的
                        # 原始分数通常是 embedding 的余弦相似度，有时不够准确
                        original_score = result.score
                        rerank_score = item.get("score", 0)
                        
                        # 标准化 assuming original_score is roughly 0-1 (cosine sim)
                        # rerank_score is also 0-1 (probability)
                        final_score = 0.1 * original_score + 0.9 * rerank_score
                        
                        result.score = final_score
                        reordered.append(result)
                return reordered
        except Exception:
            pass  # 失败时返回原始结果
        
        return results


    async def answer(
        self,
        question: str,
        db: AsyncSession = None,
        conversation_id: str = None,
        document_id: Optional[int] = None,
        chat_history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """Answer a question using RAG."""
        
        # 1. Retrieve relevant chunks (多检索一些，用于后续过滤)
        search_results = await hybrid_search.search(
            query=question,
            top_k=self.max_context_chunks * 3,  # 检索更多，便于过滤和 rerank
            document_id=document_id,
        )

        # 2. 智能去重和过滤
        filtered_results = self._deduplicate_and_filter(search_results)

        # 3. Rerank 重排序
        reranked_results = await self._rerank_results(question, filtered_results)

        # 4. Build context
        context_parts = []
        total_length = 0
        used_sources = []

        for i, result in enumerate(reranked_results):
            if total_length + len(result.content) > self.max_context_length:
                break

            context_parts.append(f"[{i+1}] 来源: {result.filename or '文档'}\n{result.content}")
            total_length += len(result.content)
            used_sources.append(result)

        context = "\n\n---\n\n".join(context_parts)

        # 5. Build messages with improved prompt
        system_prompt = """你是 Atlas 智能知识助手，专门基于用户的知识库内容回答问题。

回答规则：
1. 仔细阅读所有提供的上下文，综合分析后给出准确答案
2. 如果不同来源有补充信息，整合起来提供完整回答
3. 如果上下文中确实没有相关信息，诚实告知"根据现有知识库，我没有找到相关信息"
4. 回答时引用来源编号，如"根据[1]..."
5. 回答应结构清晰，必要时使用列表或分点说明
6. 保持专业、准确、有帮助的语气"""

        messages = [{"role": "system", "content": system_prompt}]

        # Add chat history if provided
        if chat_history:
            for msg in chat_history[-8:]:  # 增加历史轮次
                messages.append(msg)

        # Add context and question
        user_message = f"""请基于以下知识库内容回答问题。

知识库内容：
{context if context else '（暂无相关内容）'}

用户问题：{question}"""

        messages.append({"role": "user", "content": user_message})

        # 5. Generate response
        try:
            response_text = await llm_service.chat(messages, temperature=0.7)
        except Exception as e:
            response_text = f"抱歉，生成回答时出现错误：{str(e)}"

        # 只返回实际使用的引用
        sources_data = [
            {
                "chunk_id": s.chunk_id,
                "document_id": s.document_id,
                "filename": s.filename,
                "preview": s.preview,
                "score": s.score,
            }
            for s in used_sources
        ]

        # 6. Save to Conversation History if db and conversation_id provided
        if db and conversation_id:
            from .conversation import ConversationService
            conv_service = ConversationService(db)
            
            await conv_service.add_message(
                conversation_id=conversation_id,
                role="assistant",
                content=response_text,
                sources=sources_data
            )

        return {
            "response": response_text,
            "sources": sources_data,
            "context_used": len(used_sources),
        }

    async def answer_stream(
        self,
        question: str,
        document_id: Optional[int] = None,
        chat_history: Optional[List[Dict[str, str]]] = None,
    ):
        """流式回答问题，yield SSE格式的数据"""
        import json
        
        # 1. Retrieve relevant chunks
        search_results = await hybrid_search.search(
            query=question,
            top_k=self.max_context_chunks * 3,
            document_id=document_id,
        )

        # 2. 智能去重和过滤
        filtered_results = self._deduplicate_and_filter(search_results)

        # 3. Rerank 重排序
        reranked_results = await self._rerank_results(question, filtered_results)

        # 4. Build context
        context_parts = []
        total_length = 0
        used_sources = []

        for i, result in enumerate(reranked_results):
            if total_length + len(result.content) > self.max_context_length:
                break
            context_parts.append(f"[{i+1}] 来源: {result.filename or '文档'}\n{result.content}")
            total_length += len(result.content)
            used_sources.append(result)

        context = "\n\n---\n\n".join(context_parts)

        # 5. Build messages with improved prompt
        system_prompt = """你是 Atlas 智能知识助手，专门基于用户的知识库内容回答问题。

回答规则：
1. 仔细阅读所有提供的上下文，综合分析后给出准确答案
2. 如果不同来源有补充信息，整合起来提供完整回答
3. 如果上下文中确实没有相关信息，诚实告知"根据现有知识库，我没有找到相关信息"
4. 回答时引用来源编号，如"根据[1]..."
5. 回答应结构清晰，必要时使用列表或分点说明
6. 保持专业、准确、有帮助的语气"""

        messages = [{"role": "system", "content": system_prompt}]

        if chat_history:
            for msg in chat_history[-16:]:  # 8轮 = 16条消息
                messages.append(msg)

        user_message = f"""请基于以下知识库内容回答问题。

知识库内容：
{context if context else '（暂无相关内容）'}

用户问题：{question}"""

        messages.append({"role": "user", "content": user_message})

        # 5. 先发送 sources
        sources_data = [
            {
                "chunk_id": s.chunk_id,
                "document_id": s.document_id,
                "filename": s.filename,
                "preview": s.preview,
                "score": s.score,
            }
            for s in used_sources
        ]
        yield f"data: {json.dumps({'type': 'sources', 'data': sources_data})}\n\n"

        # 6. 流式生成回复
        full_response = ""
        try:
            async for chunk in llm_service.chat_stream(messages, temperature=0.7):
                full_response += chunk
                yield f"data: {json.dumps({'type': 'content', 'data': chunk})}\n\n"
        except Exception as e:
            error_msg = f"抱歉，生成回答时出现错误：{str(e)}"
            yield f"data: {json.dumps({'type': 'content', 'data': error_msg})}\n\n"
            full_response = error_msg

        # 7. 发送完成信号，包含完整响应
        yield f"data: {json.dumps({'type': 'done', 'data': {'response': full_response, 'sources': sources_data}})}\n\n"

    async def summarize_document(self, content: str) -> str:
        """Generate a summary for a document."""
        return await llm_service.generate_summary(content)

    async def extract_keywords(self, content: str) -> List[str]:
        """Extract keywords from content."""
        return await llm_service.extract_concepts(content)


# Singleton instance
rag_service = RAGService()