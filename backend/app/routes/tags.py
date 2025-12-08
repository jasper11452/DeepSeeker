from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List

from ..database import get_db
from ..models.organization import Tag, DocumentTag
from ..schemas.organization import TagCreate, TagResponse

router = APIRouter()

@router.get("/", response_model=List[TagResponse])
async def get_tags(db: AsyncSession = Depends(get_db)):
    # Get tags with document count
    # equivalent to: SELECT t.*, count(dt.document_id) ... GROUP BY t.id
    
    stmt = (
        select(Tag, func.count(DocumentTag.document_id).label("document_count"))
        .outerjoin(DocumentTag, Tag.id == DocumentTag.tag_id)
        .group_by(Tag.id)
        .order_by(Tag.name)
    )
    
    result = await db.execute(stmt)
    tags_with_counts = result.all()
    
    response = []
    for tag, count in tags_with_counts:
        # Pydantic's from_attributes handles the mapping if we construct a dict or object
        # We need to manually set document_count because it's not on the Tag model directly
        tag.document_count = count
        response.append(tag)
        
    return response

@router.post("/", response_model=TagResponse)
async def create_tag(tag: TagCreate, db: AsyncSession = Depends(get_db)):
    # Check if tag exists
    result = await db.execute(select(Tag).where(Tag.name == tag.name))
    existing = result.scalar_one_or_none()
    if existing:
        return existing
        
    db_tag = Tag(name=tag.name, color=tag.color)
    db.add(db_tag)
    await db.commit()
    await db.refresh(db_tag)
    db_tag.document_count = 0
    return db_tag

@router.delete("/{id}")
async def delete_tag(id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Tag).where(Tag.id == id))
    db_tag = result.scalar_one_or_none()
    
    if not db_tag:
        raise HTTPException(status_code=404, detail="Tag not found")
        
    await db.delete(db_tag)
    await db.commit()
    return {"status": "success"}
