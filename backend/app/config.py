"""
Atlas MVP - Configuration
"""
import os
from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic import Field


# 获取 backend 目录的绝对路径
# config.py -> app -> backend
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # LLM Configuration (Local MLX Models)
    llm_model_id: str = Field(default="mlx-community/Qwen3-4B-Instruct-2507-4bit")
    embedding_model_id: str = Field(default="mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ")
    # 视觉模型：主选 HunyuanOCR (transformers)，备选 Qwen3-VL (MLX)
    vision_model_id: str = Field(default="tencent/HunyuanOCR")
    vision_model_backup_id: str = Field(default="lmstudio-community/Qwen3-VL-4B-Instruct-MLX-4bit")
    # Rerank 模型
    rerank_model_id: str = Field(default="mlx-community/Qwen3-Reranker-0.6B-4bit")
    rerank_model_path: str = Field(
        default=os.path.join(BACKEND_DIR, "ml_models", "Qwen3-Reranker-0.6B-mlx-4Bit")
    )
    # 模型缓存路径
    model_cache_dir: str = Field(
        default=os.path.join(BACKEND_DIR, "ml_models")
    )

    # Server Configuration
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    debug: bool = Field(default=True)

    # Database
    database_url: str = Field(default="sqlite+aiosqlite:///./atlas.db")

    # Vector Store
    chroma_persist_dir: str = Field(default="./chroma_db")

    # Document Settings
    chunk_size: int = Field(default=800)
    chunk_overlap: int = Field(default=150)
    max_upload_size: int = Field(default=52428800)  # 50MB

    # Search Settings
    top_k_retrieval: int = Field(default=20)
    top_k_rerank: int = Field(default=5)
    bm25_weight: float = Field(default=0.3)
    vector_weight: float = Field(default=0.7)

    # Upload directory
    upload_dir: str = Field(default="./uploads")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
