import logging
import math
import os
from typing import List
from ..config import get_settings

logger = logging.getLogger(__name__)

# Lazy import mechanism or check
try:
    import mlx.core as mx
    from mlx_lm import load
    HAS_MLX = True
except ImportError:
    HAS_MLX = False

settings = get_settings()

class MLXRerankerService:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.yes_token = None
        self.no_token = None
        self.initialized = False
        
        import threading
        self._lock = threading.Lock()

    def initialize(self):
        """Initialize the model if MLX is available."""
        if self.initialized:
            return

        if not HAS_MLX:
            logger.warning("MLX not installed. Reranker disabled.")
            return

        try:
            path = settings.rerank_model_path
            # Check if model exists, if not download it
            if not os.path.exists(path) or not os.listdir(path):
                logger.info(f"Rerank model not found at {path}. Downloading from {settings.rerank_model_id}...")
                from huggingface_hub import snapshot_download
                snapshot_download(
                    repo_id=settings.rerank_model_id,
                    local_dir=path,
                    local_dir_use_symlinks=False
                )
                logger.info("Rerank model downloaded.")

            logger.info(f"Loading MLX Rerank model from {path}...")
            self.model, self.tokenizer = load(path)
            
            # Get token IDs for strictly "Yes" and "No"
            # Note: We assume standard English Yes/No works for this model
            # For Qwen, space padding might matter, but tokenizer.encode usually handles it
            self.yes_token = self.tokenizer.encode("Yes")[0]
            self.no_token = self.tokenizer.encode("No")[0]
            
            self.initialized = True
            logger.info("MLX Rerank model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load MLX reranker: {e}")

    
    def _compute_cache_key(self, query: str, doc: str) -> str:
        """Generate cache key from query and doc content."""
        import hashlib
        # Combine query and first/last part of doc to ensure uniqueness but handle long docs
        # Using smart truncate logic for the key calculation if doc is very long
        key_content = f"{query}|||{doc[:500]}|||{doc[-200:] if len(doc) > 500 else ''}"
        return hashlib.md5(key_content.encode()).hexdigest()

    def _smart_truncate(self, text: str, max_len: int) -> str:
        """Smart truncation: keep head and tail."""
        if len(text) <= max_len:
            return text
        head = text[:max_len * 2 // 3]
        tail = text[-(max_len // 3):]
        return head + "..." + tail

    def predict(self, query: str, documents: List[str]) -> List[float]:
        """
        Rerank documents based on query with Caching.
        """
        if not self.initialized:
            self.initialize()
        
        if not self.model:
             return [0.0] * len(documents)

        # Initialize cache if not exists
        if not hasattr(self, "_cache"):
            self._cache = {}
            self._cache_max_size = 1000

        scores = [None] * len(documents)
        uncached_indices = []
        uncached_docs = []

        # Step 1: Check cache
        for i, doc in enumerate(documents):
            key = self._compute_cache_key(query, doc)
            if key in self._cache:
                scores[i] = self._cache[key]
            else:
                uncached_indices.append(i)
                uncached_docs.append(doc)

        # Step 2: Process uncached documents
        if uncached_docs:
            for idx, doc in zip(uncached_indices, uncached_docs):
                # Smart truncate
                doc_text = self._smart_truncate(doc, max_len=600)
                
                prompt = f"""判断以下文档内容是否与查询相关。

查询：{query}

文档内容：{doc_text}

相关性标准：
- 文档直接回答了查询问题 → 高度相关
- 文档包含相关背景信息 → 部分相关
- 文档与查询无关 → 不相关

请只回答 Yes（相关）或 No（不相关）："""

                try:
                    if hasattr(self.tokenizer, "apply_chat_template") and self.tokenizer.chat_template:
                        messages = [{"role": "user", "content": prompt}]
                        text = self.tokenizer.apply_chat_template(
                            messages, 
                            tokenize=False, 
                            add_generation_prompt=True
                        )
                    else:
                        text = f"<|im_start|>user\n{prompt}\n<|im_end|>\n<|im_start|>assistant\n"
                except Exception:
                     text = f"Query: {query}\nDocument: {doc_text}\nIs this relevant? Answer:"

                try:
                    # Encode and forward pass
                    input_ids = mx.array(self.tokenizer.encode(text))
                    
                    with self._lock:
                        logits = self.model(input_ids[None])
                    
                    # Extract logits for the last token position
                    last_token_logits = logits[0, -1, :]
                    
                    yes_score = last_token_logits[self.yes_token].item()
                    no_score = last_token_logits[self.no_token].item()
                    
                    try:
                        exp_yes = math.exp(yes_score)
                        exp_no = math.exp(no_score)
                        score = exp_yes / (exp_yes + exp_no)
                    except OverflowError:
                        score = 1.0 if yes_score > no_score else 0.0
                except Exception as e:
                    logger.error(f"Rerank inference failed: {e}")
                    score = 0.0

                # Update result and cache
                scores[idx] = score
                key = self._compute_cache_key(query, uncached_docs[uncached_indices.index(idx)])
                self._cache[key] = score

        # Step 3: Cache cleanup (LRU-like simple random eviction)
        if len(self._cache) > self._cache_max_size:
            # Delete 20% of keys
            keys = list(self._cache.keys())
            del_count = int(self._cache_max_size * 0.2)
            for k in keys[:del_count]:
                del self._cache[k]

        return scores

# Singleton instance
reranker_service = MLXRerankerService()
