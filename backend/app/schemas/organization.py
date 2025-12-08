from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# --- Folder Schemas ---

class FolderBase(BaseModel):
    name: str
    parent_id: Optional[int] = None
    color: Optional[str] = "#6366f1"
    icon: Optional[str] = None

class FolderCreate(FolderBase):
    pass

class FolderUpdate(FolderBase):
    name: Optional[str] = None
    parent_id: Optional[int] = None
    color: Optional[str] = None
    icon: Optional[str] = None

class FolderResponse(FolderBase):
    id: int
    created_at: datetime
    children: List["FolderResponse"] = []

    class Config:
        from_attributes = True

# --- Tag Schemas ---

class TagBase(BaseModel):
    name: str
    color: Optional[str] = "#10b981"

class TagCreate(TagBase):
    pass

class TagResponse(TagBase):
    id: int
    created_at: datetime
    document_count: Optional[int] = 0

    class Config:
        from_attributes = True

# Resolve forward reference
FolderResponse.model_rebuild()
