"""
DeepSeeker MVP - Routes Module
"""
from .documents import router as documents_router
from .search import router as search_router
from .chat import router as chat_router
from .graph import router as graph_router
from .conversations import router as conversations_router
from .insights import router as insights_router
from .folders import router as folders_router
from .tags import router as tags_router

__all__ = [
    "documents_router",
    "search_router",
    "chat_router",
    "graph_router",
    "conversations_router",
    "insights_router",
    "folders_router",
    "tags_router",
]