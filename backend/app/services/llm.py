"""
DeepSeeker MVP - LLM Service (Local MLX & Transformers)
"""
import logging
import asyncio
from typing import List, Optional, Dict, Any, Generator
import mlx.core as mx
import numpy as np

from ..config import get_settings
from .model_manager import model_manager

settings = get_settings()
logger = logging.getLogger(__name__)


class LLMService:
    """LLM service for chat, embeddings, and vision using local models."""

    def __init__(self):
        # 参数配置
        self.max_tokens = 2000
        self.temperature = 0.7
        
        # Locks for thread safety (MLX models inference serialization)
        import threading
        self._llm_lock = threading.Lock()
        self._embedding_lock = threading.Lock()
        self._vision_lock = threading.Lock()

    async def check_connection(self) -> bool:
        """Check if models are ready."""
        # 本地模式下，只要 ModelManager 能工作就算连接正常
        return True

    async def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> str:
        """Send chat completion request."""
        try:
            # 运行在线程中以避免阻塞 asyncio 事件循环
            return await asyncio.to_thread(
                self._chat_sync, messages, temperature, max_tokens
            )
        except Exception as e:
            logger.error(f"LLM chat error: {e}")
            raise

    def _chat_sync(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ) -> str:
        """同步执行 MLX LLM 推理"""
        from mlx_lm import generate
        
        with self._llm_lock:
            model, tokenizer = model_manager.get_llm()
            
            # 应用聊天模板
            if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
                prompt = tokenizer.apply_chat_template(
                    messages, 
                    tokenize=False, 
                    add_generation_prompt=True
                )
            else:
                # Fallback template
                prompt = ""
                for m in messages:
                    prompt += f"<|im_start|>{m['role']}\n{m['content']}\n<|im_end|>\n"
                prompt += "<|im_start|>assistant\n"

            # 生成
            response = generate(
                model, 
                tokenizer, 
                prompt=prompt, 
                max_tokens=max_tokens, 
                verbose=False
            )
            
            return response

    async def chat_stream(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ):
        """Send streaming chat completion request."""
        import queue
        from mlx_lm import stream_generate
        
        q = queue.Queue()
        sentinel = object()
        
        def producer():
            try:
                # Acquire lock for the duration of streaming
                with self._llm_lock:
                    model, tokenizer = model_manager.get_llm()
                    
                    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
                        prompt = tokenizer.apply_chat_template(
                            messages, 
                            tokenize=False, 
                            add_generation_prompt=True
                        )
                    else:
                        prompt = ""
                        for m in messages:
                            prompt += f"<|im_start|>{m['role']}\n{m['content']}\n<|im_end|>\n"
                        prompt += "<|im_start|>assistant\n"

                    for response in stream_generate(
                        model, 
                        tokenizer, 
                        prompt=prompt, 
                        max_tokens=max_tokens
                    ):
                        q.put(response.text)
                
            except Exception as e:
                logger.error(f"Stream generation error: {e}")
            finally:
                q.put(sentinel)

        # 在单独线程中启动生产者
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, producer)
        
        # 消费者（当前协程）
        in_thinking = False
        
        while True:
            try:
                token = await loop.run_in_executor(None, q.get)
                
                if token is sentinel:
                    break
                
                # 处理 <think> 标签 (如果是 Qwen3)
                if "<think>" in token:
                    in_thinking = True
                    yield "<think>\n"
                    token = token.replace("<think>", "")
                
                if "</think>" in token:
                    in_thinking = False
                    yield token.replace("</think>", "")
                    yield "</think>\n\n"
                    continue

                yield token
                
            except Exception as e:
                logger.error(f"Stream consumption error: {e}")
                break

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """Get embeddings for texts using MLX."""
        if not texts:
            return []

        return await asyncio.to_thread(self._embed_sync, texts)

    def _embed_sync(self, texts: List[str]) -> List[List[float]]:
        """Sync Execution for MLX Embedding Computation (Batch Processing)."""
        if not texts:
            return []

        with self._embedding_lock:
            model, tokenizer = model_manager.get_embedding_model()
            
            embeddings = []
            embedding_dim = None # Will determine from first successful output
            
            BATCH_SIZE = 8
            
            # Helper to pad list of tokens
            def pad_batch(batch_tokens, pad_token_id=0):
                max_len = max(len(t) for t in batch_tokens)
                padded = []
                for t in batch_tokens:
                    pad_len = max_len - len(t)
                    padded.append(t + [pad_token_id] * pad_len)
                return padded

            for i in range(0, len(texts), BATCH_SIZE):
                batch_texts = texts[i : i + BATCH_SIZE]
                batch_tokens = []
                
                # 1. Tokenize batch
                for text in batch_texts:
                    try:
                        # Ensure we don't exceed model context limit (e.g. 512 or 8192)
                        # Truncate if necessary (naive truncation)
                        tokens = tokenizer.encode(text)
                        if len(tokens) > 2048:
                            tokens = tokens[:2048]
                        batch_tokens.append(tokens)
                    except Exception:
                        batch_tokens.append([])

                if not batch_tokens:
                    embeddings.extend([[]] * len(batch_texts))
                    continue

                # 2. Pad batch
                # Assuming pad_token_id=0 if not found, usually strict usually model.config.pad_token_id
                pad_id = getattr(tokenizer, "pad_token_id", 0)
                if pad_id is None: pad_id = 0
                
                padded_tokens = pad_batch(batch_tokens, pad_id)
                input_ids = mx.array(padded_tokens)
                
                # 3. Inference
                try:
                    outputs = model.model(input_ids)
                    
                    if isinstance(outputs, tuple):
                        hidden_states = outputs[0]
                    else:
                        hidden_states = outputs
                    
                    # 4. Pooling (Mean Pooling)
                    # We need to ignore padding tokens in the mean calculation
                    # Mask: 1 for real tokens, 0 for padding
                    # Since we did manual padding, we can reconstruct mask
                    mask = input_ids != pad_id
                    mask = mask.astype(hidden_states.dtype).reshape(hidden_states.shape[0], hidden_states.shape[1], 1)
                    
                    # Sum(hidden * mask) / Sum(mask)
                    masked_hidden = hidden_states * mask
                    sum_hidden = mx.sum(masked_hidden, axis=1)
                    sum_mask = mx.sum(mask, axis=1)
                    
                    # Avoid division by zero
                    embedding_batch = sum_hidden / (sum_mask + 1e-9)
                    
                    # 5. Normalize
                    norm = mx.linalg.norm(embedding_batch, axis=1, keepdims=True)
                    embedding_batch = embedding_batch / (norm + 1e-6)
                    
                    batch_results = embedding_batch.tolist()
                    embeddings.extend(batch_results)
                    
                    # Capture dim for fallback logic
                    if embedding_dim is None and batch_results:
                        embedding_dim = len(batch_results[0])
                        
                except Exception as e:
                    logger.error(f"Batch embedding computation failed: {e}")
                    # Fallback or zeros
                    if embedding_dim is None:
                         # Try to guess dim from model
                        try:
                             embedding_dim = model.model.embed_tokens.weight.shape[-1]
                        except:
                             embedding_dim = 1024
                    embeddings.extend([[0.0] * embedding_dim] * len(batch_texts))

            return embeddings

    async def embed_single(self, text: str) -> List[float]:
        """Get embedding for a single text."""
        embeddings = await self.embed([text])
        return embeddings[0] if embeddings else []

    def _smart_sample_text(self, text: str, max_chars: int = 800) -> str:
        """智能采样：取开头、中间、结尾部分"""
        if len(text) <= max_chars:
            return text
        
        head_size = int(max_chars * 0.4)
        mid_size = int(max_chars * 0.3)
        tail_size = max_chars - head_size - mid_size
        
        head = text[:head_size]
        mid_start = (len(text) - mid_size) // 2
        mid = text[mid_start:mid_start + mid_size]
        tail = text[-tail_size:]
        
        return f"{head}\n...\n{mid}\n...\n{tail}"

    async def warmup(self):
        """预热模型"""
        try:
            await asyncio.to_thread(model_manager.get_llm)
            logger.info("LLM warmup completed")
        except Exception as e:
            logger.error(f"LLM warmup failed: {e}")

    async def extract_concepts(self, text: str) -> List[str]:
        """Extract key concepts from text."""
        truncated = text[:2000] if len(text) > 2000 else text
        prompt = f"提取以下文本的3个关键词，每行一个：\n{truncated}\n关键词： /no_think"

        try:
            response = await self.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=200)

            concepts = [
                line.strip().lstrip("-").lstrip("•").lstrip("0123456789.").strip()
                for line in response.strip().split("\n")
                if line.strip() and len(line.strip()) > 1
            ]
            return concepts[:5]
        except Exception:
            return []

    async def generate_summary(self, text: str, max_length: int = 150) -> str:
        """Generate a summary."""
        truncated = text[:2000] if len(text) > 2000 else text
        prompt = f"一句话总结：{truncated}\n总结： /no_think"

        try:
            response = await self.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=300)
            return response.strip()
        except Exception:
            return text[:max_length] + "..."

    async def describe_image(self, image_data: str, mode: str = "describe") -> str:
        """
        使用 VLM 描述图片内容
        
        注意：这不是 OCR！OCR 请使用 OCREngine
        
        模式：
        - "describe": 详细描述图片内容（默认）
        - "figure": 解释图表/图形的含义
        """
        return await asyncio.to_thread(self._describe_image_sync, image_data, mode)

    def _describe_image_sync(self, image_data: str, mode: str = "describe") -> str:
        """同步执行图片描述"""
        import base64
        import tempfile
        import os
        from io import BytesIO
        from PIL import Image
        
        PROMPTS = {
            "describe": "Describe this image in detail, including scene, objects, and visible elements.",
            "figure": "Explain what this chart or diagram shows. Describe its structure and meaning.",
        }
        
        prompt_text = PROMPTS.get(mode, PROMPTS["describe"])
        
        temp_image_path = None
        
        try:
            # 解码图片
            image_bytes = base64.b64decode(image_data)
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            
            # Note: We skipped resizing here as it might be better to let VLM handle it or do it if memory is an issue.
            # But the original code had `_resize_for_ocr`.
            # I will omit it for now as per plan's simplification.
            
            with self._vision_lock:
                # 获取 Qwen3-VL 模型
                model, processor = model_manager.get_vision_model()
                
                # MLX VLM 需要图片保存为临时文件
                from mlx_vlm import generate
                from mlx_vlm.prompt_utils import apply_chat_template
                
                with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_file:
                    temp_image_path = tmp_file.name
                    image.save(tmp_file, format='PNG')
                
                # 获取模型配置
                config = model.config if hasattr(model, 'config') else {}
                
                # 使用 apply_chat_template 正确格式化 prompt
                # 这会自动插入图像 token
                formatted_prompt = apply_chat_template(
                    processor,
                    config,
                    prompt_text,
                    num_images=1,
                )
                
                # 使用 mlx_vlm.generate 进行推理
                response = generate(
                    model, 
                    processor, 
                    formatted_prompt,
                    image=temp_image_path,
                    max_tokens=2048,
                    temperature=0.3,
                )
                
                # 提取文本结果
                if hasattr(response, 'text'):
                    result = response.text
                else:
                    result = str(response)
                
                # 注意：不再需要复杂的后处理
                # VLM 用于描述时输出稳定性好很多
                return result.strip()

        except Exception as e:
            logger.error(f"Image description failed (mode={mode}): {e}")
            return f"[Description failed: {e}]"
        finally:
            # 清理临时文件
            if temp_image_path and os.path.exists(temp_image_path):
                try:
                    os.unlink(temp_image_path)
                except Exception:
                    pass

    async def generate_conversation_title(self, messages: List[Dict[str, str]]) -> str:
        """生成标题"""
        context_messages = messages[:6]
        conversation_text = "\n".join([
            f"{'用户' if m['role'] == 'user' else '助手'}: {m['content'][:200]}"
            for m in context_messages
        ])
        
        prompt = f"给这个对话起个短标题（<15字）：\n{conversation_text}\n标题："

        try:
            response = await self.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=50)
            return response.strip().strip('"\'').strip()
        except Exception:
            return "新对话"

    async def generate_document_title(self, content: str, filename: str = "") -> str:
        """根据文档内容智能生成标题"""
        import re
        
        if len(content) > 3000:
            # 只取内容的开头和中间部分
            sample = content[:1500] + "\n...\n" + content[len(content)//2:len(content)//2+500]
        else:
            sample = content[:2000]
        
        # 使用更简洁直接的 prompt
        prompt = f"""
为这个文档生成一个简短的标题（5-20字）。

要求：
- 直接输出标题，不加任何解释
- 必须是完整的主题描述
- 中文文档用中文标题，英文文档用英文标题

文档内容：
{sample[:1500]}

标题：/no_think"""

        try:
            response = await self.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.2, max_tokens=50)
            
            title = response.strip()
            
            # 移除可能的思考过程
            if '</think>' in title:
                title = title.split('</think>')[-1].strip()
            if '<think>' in title:
                title = title.split('<think>')[0].strip()
            
            # 移除引号
            title = title.strip('"\'"\'「」『』')
            
            # 提取第一行（如果有多行）
            title = title.split('\n')[0].strip()
            
            # 清理：移除开头的各种无效字符
            # 包括标点、连接词、格式标记等
            bad_starts = [
                r'^[,，。.、;；:：!！?？\-\s#*[\]【】]+',  # 标点和格式符号
                r'^(but|and|or|with|the|a|an|including|also|however|therefore|thus|hence|so|yet|for|to|of|in|on|at|by|as|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|must|shall|can)\s+',
                r'^(make|making|made|it|this|that|these|those|there|here|which|what|who|how|when|where|why)\s+',
            ]
            for pattern in bad_starts:
                title = re.sub(pattern, '', title, flags=re.IGNORECASE)
            
            title = title.strip()
            
            # 如果标题包含 "#"（Markdown 标题标记），提取其后的内容
            if '#' in title:
                # 找到最后一个 # 后的内容
                parts = title.split('#')
                for part in reversed(parts):
                    cleaned = part.strip()
                    if cleaned and len(cleaned) >= 3:
                        title = cleaned
                        break
            
            # 移除结尾的冒号和标点
            title = re.sub(r'[:：,，。.]+$', '', title).strip()
            
            # 最终验证
            if title and 3 <= len(title) <= 80:
                # 必须包含有意义的字符（中文或英文字母）
                if re.search(r'[a-zA-Z\u4e00-\u9fa5]', title):
                    # 不能以常见的无意义片段开头
                    if not re.match(r'^(more|less|better|worse|new|old|first|last|next|other|same|different)\s+', title, re.IGNORECASE):
                        return title
            
            # 回退：尝试从文件名提取有意义的标题
            if filename:
                clean_name = re.sub(r'[_\-\d]+', ' ', filename.rsplit('.', 1)[0]).strip()
                clean_name = ' '.join(clean_name.split())  # 合并多个空格
                if clean_name and len(clean_name) >= 3:
                    return clean_name
            
            return "未命名文档"
        except Exception as e:
            logger.error(f"Generate document title failed: {e}")
            return "未命名文档"

    async def rerank(
        self,
        query: str,
        documents: List[str],
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """重排序"""
        try:
            from .rerank_mlx import reranker_service
            scores = await asyncio.to_thread(reranker_service.predict, query, documents)
            
            results = []
            for i, score in enumerate(scores):
                results.append({"index": i, "score": score})
            
            results.sort(key=lambda x: x["score"], reverse=True)
            return results[:top_k]
        except Exception as e:
            logger.error(f"Rerank failed: {e}")
            return await self._rerank_by_embedding(query, documents, top_k)

    async def _rerank_by_embedding(self, query: str, documents: List[str], top_k: int) -> List[Dict[str, Any]]:
        """基于 Embedding 相似度的重排序"""
        try:
            all_texts = [query] + documents
            embeddings = await self.embed(all_texts)
            
            if len(embeddings) < 2:
                return []
            
            query_emb = np.array(embeddings[0])
            doc_embs = np.array(embeddings[1:])
            
            scores = np.dot(doc_embs, query_emb) / (
                np.linalg.norm(doc_embs, axis=1) * np.linalg.norm(query_emb)
            )
            
            results = [{"index": i, "score": float(s)} for i, s in enumerate(scores)]
            results.sort(key=lambda x: x["score"], reverse=True)
            return results[:top_k]
        except Exception:
            return [{"index": i, "score": 0.0} for i in range(len(documents))][:top_k]

    async def format_document_content(self, content: str) -> str:
        """整理文档格式"""
        if not content or len(content) < 100:
            return content
            
        prompt = f"整理格式，修复换行，保留Markdown结构：\n{content[:4000]}"
        try:
            return await self.chat([{"role": "user", "content": prompt}])
        except Exception:
            return content


# Singleton instance
llm_service = LLMService()