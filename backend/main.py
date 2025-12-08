"""
Atlas MVP - Main Application Entry Point
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    tags_router
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
    print("✅ Database initialized")
    
    yield
    # Shutdown
    print("👋 Shutting down...")


# Create FastAPI app
app = FastAPI(
    title="Atlas",
    description="智能个人知识管理系统",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(documents_router, prefix="/api/documents", tags=["documents"])
app.include_router(search_router, prefix="/api/search", tags=["search"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])
app.include_router(graph_router, prefix="/api/graph", tags=["graph"])
app.include_router(conversations_router, prefix="/api/conversations", tags=["conversations"])
app.include_router(insights_router, prefix="/api/insights", tags=["insights"])
app.include_router(folders_router, prefix="/api/folders", tags=["folders"])
app.include_router(tags_router, prefix="/api/tags", tags=["tags"])


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    from app.services import llm_service

    llm_status = "connected" if await llm_service.check_connection() else "disconnected"

    return {
        "status": "healthy",
        "llm_service": llm_status,
        "version": "0.1.0",
    }


@app.get("/api/health")
async def api_health_check():
    """API health check endpoint."""
    return await health_check()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )