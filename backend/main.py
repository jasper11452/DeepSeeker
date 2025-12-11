"""
DeepSeeker - AI 研究助手
Main Application Entry Point
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database import init_db
from app.routes import (
    documents_router, 
    search_router, 
    chat_router, 
    graph_router,
    conversations_router,
    insights_router,
    folders_router,
    tags_router,
    research_router,
)

settings = get_settings()

# Ensure directories exist
os.makedirs(settings.upload_dir, exist_ok=True)
os.makedirs(settings.chroma_persist_dir, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    await init_db()
    
    from app.services.background import background_processor
    await background_processor.start()
    
    print("✅ DeepSeeker AI 研究助手启动完成")
    print("📚 数据库已初始化")
    print("🔄 后台处理器已启动")
    
    yield
    
    # Shutdown
    print("👋 正在关闭 DeepSeeker...")
    await background_processor.stop()


# Create FastAPI app
app = FastAPI(
    title="DeepSeeker",
    description="AI 研究助手 - 深度分析型知识管理系统",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS middleware - 支持更多来源用于 Electron
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "file://",  # Electron 文件协议
        "app://.",  # Electron 自定义协议
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers - 基础功能
app.include_router(documents_router, prefix="/api/documents", tags=["documents"])
app.include_router(search_router, prefix="/api/search", tags=["search"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])
app.include_router(graph_router, prefix="/api/graph", tags=["graph"])
app.include_router(conversations_router, prefix="/api/conversations", tags=["conversations"])
app.include_router(insights_router, prefix="/api/insights", tags=["insights"])
app.include_router(folders_router, prefix="/api/folders", tags=["folders"])
app.include_router(tags_router, prefix="/api/tags", tags=["tags"])

# Include routers - 研究助手功能
app.include_router(research_router, prefix="/api/research", tags=["research"])


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    from app.services import llm_service

    llm_status = "connected" if await llm_service.check_connection() else "disconnected"

    return {
        "status": "healthy",
        "llm_service": llm_status,
        "version": "0.2.0",
        "features": [
            "document_management",
            "rag_chat",
            "knowledge_graph",
            "knowledge_discovery",
            "topic_clustering",
            "trend_analysis",
            "report_generation",
            "knowledge_gaps",
        ]
    }


@app.get("/api/health")
async def api_health_check():
    """API health check endpoint."""
    return await health_check()


# 尝试挂载前端静态文件（用于 Electron 生产环境）
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
