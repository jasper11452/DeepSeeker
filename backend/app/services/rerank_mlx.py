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

    def predict(self, query: str, documents: List[str]) -> List[float]:
        """
        Rerank documents based on query.
        Returns a list of scores corresponding to the documents.
        """
        if not self.initialized:
            self.initialize()
        
        if not self.model:
            # Fallback if model failed to load
            return [0.0] * len(documents)
            
        scores = []
        for doc in documents:
            # 使用更精确的提示词
            prompt = f"""判断以下文档内容是否与查询相关。

查询：{query}

文档内容：{doc[:800]}

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
                 text = f"Query: {query}\nDocument: {doc[:500]}\nIs this relevant? Answer:"

            # Encode and forward pass
            input_ids = mx.array(self.tokenizer.encode(text))
            
            # Run model
            # Note: We assume batch size 1 for simplicity and safety on memory
            with self._lock:
                logits = self.model(input_ids[None])
            
            # Extract logits for the last token position
            # We are interested in the probability of generating "Yes" vs "No"
            last_token_logits = logits[0, -1, :]
            
            yes_score = last_token_logits[self.yes_token].item()
            no_score = last_token_logits[self.no_token].item()
            
            # Softmax calculation
            # score = P(Yes) / (P(Yes) + P(No))
            # optimization: use log-sum-exp trick or just exp since just 2 values
            # Using simple exp for clarity
            try:
                exp_yes = math.exp(yes_score)
                exp_no = math.exp(no_score)
                score = exp_yes / (exp_yes + exp_no)
            except OverflowError:
                # Handle potential overflow
                score = 1.0 if yes_score > no_score else 0.0
                
            scores.append(score)
            
        return scores

# Singleton instance
reranker_service = MLXRerankerService()
