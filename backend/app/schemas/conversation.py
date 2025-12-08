from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Dict, Any

class ConversationCreate(BaseModel):
    pass

class ConversationUpdate(BaseModel):
    title: str

class MessageCreate(BaseModel):
    message: str

class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    timestamp: datetime
    sources: Optional[List[Dict[str, Any]]] = None

    class Config:
        from_attributes = True

class ConversationResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: Optional[int] = 0

    class Config:
        from_attributes = True

class ConversationDetailResponse(ConversationResponse):
    messages: List[MessageResponse]
