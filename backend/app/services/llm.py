"""
Atlas MVP - LLM Service (Local MLX & Transformers)
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
        """同步执行 MLX Embedding 计算"""
        with self._embedding_lock:
            model, tokenizer = model_manager.get_embedding_model()
            
            embeddings = []
            embedding_dim = None
            
            for text in texts:
                tokens = tokenizer.encode(text)
                input_ids = mx.array([tokens])
                
                try:
                    outputs = model.model(input_ids)
                    
                    if isinstance(outputs, tuple):
                        hidden_states = outputs[0]
                    else:
                        hidden_states = outputs

                    embedding = mx.mean(hidden_states, axis=1)
                    
                    if embedding_dim is None:
                        embedding_dim = embedding.shape[-1]
                    
                    norm = mx.linalg.norm(embedding, axis=1, keepdims=True)
                    embedding = embedding / (norm + 1e-6)
                    
                    embeddings.append(embedding[0].tolist())
                    
                except Exception as e:
                    logger.error(f"Embedding computation failed: {e}")
                    if embedding_dim is None:
                        try:
                            embedding_dim = model.model.embed_tokens.weight.shape[-1]
                        except Exception:
                            embedding_dim = 1024
                    embeddings.append([0.0] * embedding_dim)
                    
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

    async def describe_image(self, image_data: str) -> str:
        """Describe an image using Vision LLM."""
        return await asyncio.to_thread(self._describe_image_sync, image_data)

    def _describe_image_sync(self, image_data: str) -> str:
        """同步执行图像描述推理"""
        import base64
        import tempfile
        import os
        from io import BytesIO
        from PIL import Image
        
        temp_image_path = None
        
        try:
            # 解码图片
            image_bytes = base64.b64decode(image_data)
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            
            with self._vision_lock:
                # 获取模型
                model, processor, is_mlx = model_manager.get_vision_model()
                
                prompt_text = "详细描述这张图片的内容，包括其中的文字、图表或关键信息。"
                
                if not is_mlx:
                    # HunyuanOCR (Transformers) 流程
                    import torch
                    
                    # HunyuanOCR 模板构造
                    messages = [
                        {
                            "role": "user", 
                            "content": [
                                {"type": "image", "image": image},
                                {"type": "text", "text": prompt_text}
                            ]
                        }
                    ]
                    
                    try:
                        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
                    except Exception:
                        text = "USER: [IMAGE] " + prompt_text + "\nASSISTANT: "

                    inputs = processor(
                        text=[text],
                        images=image,
                        padding=True,
                        return_tensors="pt"
                    )
                    
                    device = next(model.parameters()).device
                    inputs = {k: v.to(device) for k, v in inputs.items()}
                    
                    with torch.no_grad():
                        generated_ids = model.generate(
                            **inputs, 
                            max_new_tokens=1024, 
                            do_sample=False
                        )
                        
                    generated_text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
                    if prompt_text in generated_text:
                        generated_text = generated_text.split(prompt_text)[-1].strip()
                        
                    return generated_text
                    
                else:
                    # MLX-VLM 流程
                    from mlx_vlm import generate
                    
                    # MLX VLM 需要图片保存为临时文件
                    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_file:
                        temp_image_path = tmp_file.name
                        image.save(tmp_file, format='PNG')
                    
                    # 构建带图片标记的 prompt
                    formatted_prompt = processor.apply_chat_template(
                        [{"role": "user", "content": f"<|vision_start|><|image_pad|><|vision_end|>{prompt_text}"}],
                        tokenize=False,
                        add_generation_prompt=True
                    )
                    
                    response = generate(
                        model, 
                        processor, 
                        formatted_prompt,
                        image=temp_image_path,
                        max_tokens=1024,
                        temperature=0.3
                    )
                    
                    # 提取文本结果
                    if hasattr(response, 'text'):
                        return response.text
                    return str(response)

        except Exception as e:
            logger.error(f"Image description failed: {e}")
            return f"[Image description failed: {e}]"
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
        if len(content) > 3000:
            sample = content[:1500] + "\n...\n" + content[len(content)//2:len(content)//2+500]
        else:
            sample = content[:2000]
        
        prompt = f"""根据以下文档内容，生成一个简洁准确的中文标题。

要求：
- 标题长度在5-30字之间
- 准确概括文档主题
- 避免使用"文档"、"内容"等无意义词汇
- 直接输出标题，不要有任何解释

文档内容：
{sample}

标题："""

        try:
            response = await self.chat([
                {"role": "user", "content": prompt}
            ], temperature=0.3, max_tokens=60)
            
            title = response.strip().strip('"\'').strip()
            
            if title and 3 <= len(title) <= 50:
                return title
            
            if filename:
                import re
                clean_name = re.sub(r'[_\-\d]+', ' ', filename.rsplit('.', 1)[0]).strip()
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
