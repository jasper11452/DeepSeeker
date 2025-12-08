"""
Atlas MVP - Model Manager Service
负责模型下载、缓存和加载管理
"""
import os
import logging
from typing import Optional, Tuple, Any
from functools import lru_cache

from huggingface_hub import snapshot_download
import mlx.core as mx

from ..config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class ModelManager:
    """统一管理所有本地模型的下载和加载"""

    def __init__(self):
        self.cache_dir = settings.model_cache_dir
        os.makedirs(self.cache_dir, exist_ok=True)

        # 模型实例缓存
        self._llm_model = None
        self._llm_tokenizer = None
        self._embedding_model = None
        self._embedding_tokenizer = None
        self._vision_model = None
        self._vision_processor = None
        
        # 线程锁 - 防止并发加载
        import threading
        self._llm_lock = threading.Lock()
        self._embedding_lock = threading.Lock()
        self._vision_lock = threading.Lock()

    def _download_model(self, model_id: str) -> str:
        """下载模型到本地缓存目录，返回本地路径"""
        local_dir = os.path.join(self.cache_dir, model_id.replace("/", "_"))
        
        if os.path.exists(local_dir) and os.listdir(local_dir):
            logger.info(f"Model already cached: {model_id}")
            return local_dir
        
        logger.info(f"Downloading model: {model_id}...")
        try:
            snapshot_download(
                repo_id=model_id,
                local_dir=local_dir,
                local_dir_use_symlinks=False,
            )
            logger.info(f"Model downloaded: {model_id}")
        except Exception as e:
            logger.error(f"Failed to download model {model_id}: {e}")
            raise
        
        return local_dir

    def get_llm(self) -> Tuple[Any, Any]:
        """获取 LLM 模型和 tokenizer（线程安全）"""
        # 快速路径：已加载直接返回
        if self._llm_model is not None:
            return self._llm_model, self._llm_tokenizer

        # 双重检查锁定
        with self._llm_lock:
            if self._llm_model is not None:
                return self._llm_model, self._llm_tokenizer
                
            from mlx_lm import load

            model_path = self._download_model(settings.llm_model_id)
            logger.info(f"Loading LLM from {model_path}...")
            
            self._llm_model, self._llm_tokenizer = load(model_path)
            logger.info("LLM loaded successfully")
            
            return self._llm_model, self._llm_tokenizer

    def get_embedding_model(self) -> Tuple[Any, Any]:
        """获取 Embedding 模型和 tokenizer（线程安全）"""
        # 快速路径：已加载直接返回
        if self._embedding_model is not None:
            return self._embedding_model, self._embedding_tokenizer

        # 双重检查锁定
        with self._embedding_lock:
            if self._embedding_model is not None:
                return self._embedding_model, self._embedding_tokenizer
                
            from mlx_lm import load

            model_path = self._download_model(settings.embedding_model_id)
            logger.info(f"Loading Embedding model from {model_path}...")
            
            self._embedding_model, self._embedding_tokenizer = load(model_path)
            logger.info("Embedding model loaded successfully")
            
            return self._embedding_model, self._embedding_tokenizer

    def get_vision_model(self) -> Tuple[Any, Any]:
        """
        获取视觉模型和 processor（线程安全）
        返回: (model, processor) - 使用 Qwen3-VL MLX 模型进行 OCR
        """
        # 快速路径：已加载直接返回
        if self._vision_model is not None:
            return self._vision_model, self._vision_processor

        # 双重检查锁定
        with self._vision_lock:
            if self._vision_model is not None:
                return self._vision_model, self._vision_processor

            self._load_vision_model()

            return self._vision_model, self._vision_processor

    def _load_vision_model(self):
        """加载 Qwen3-VL MLX 视觉模型"""
        try:
            from mlx_vlm import load as vlm_load
            
            model_id = settings.vision_model_id  # lmstudio-community/Qwen3-VL-4B-Instruct-MLX-4bit
            model_path = self._download_model(model_id)
            logger.info(f"Loading Qwen3-VL vision model from {model_path}...")
            
            self._vision_model, self._vision_processor = vlm_load(model_path)
            logger.info("Qwen3-VL vision model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load Qwen3-VL vision model: {e}")
            raise

    def ensure_models_downloaded(self):
        """确保所有模型都已下载"""
        logger.info("Ensuring all models are downloaded...")
        
        try:
            self._download_model(settings.llm_model_id)
            logger.info(f"✓ LLM model ready: {settings.llm_model_id}")
        except Exception as e:
            logger.error(f"✗ LLM model failed: {e}")
        
        try:
            self._download_model(settings.embedding_model_id)
            logger.info(f"✓ Embedding model ready: {settings.embedding_model_id}")
        except Exception as e:
            logger.error(f"✗ Embedding model failed: {e}")
        
        # 视觉模型 DeepSeek-OCR
        try:
            self._download_model(settings.vision_model_id)
            logger.info(f"✓ Vision model ready: {settings.vision_model_id}")
        except Exception as e:
            logger.error(f"✗ Vision model failed: {e}")

    def unload_all(self):
        """卸载所有模型，释放内存"""
        self._llm_model = None
        self._llm_tokenizer = None
        self._embedding_model = None
        self._embedding_tokenizer = None
        self._vision_model = None
        self._vision_processor = None
        
        # 清理 MLX 缓存
        mx.metal.clear_cache()
        
        import gc
        gc.collect()
        
        logger.info("All models unloaded")


# 单例实例
model_manager = ModelManager()
