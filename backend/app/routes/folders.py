from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List

from ..database import get_db
from ..models.organization import Folder
from ..schemas.organization import FolderCreate, FolderUpdate, FolderResponse

router = APIRouter()

@router.get("/", response_model=List[FolderResponse])
async def get_folders(db: AsyncSession = Depends(get_db)):
    """Get all folders as a flat list (frontend constructs tree) or top-level with children loaded."""
    # For simplicity and flexibility, we return all folders flat-ish, but if we use the schema 
    # with recursive children, we should only return root folders.
    # Let's return root folders (parent_id is None) and load children recursively.
    
    # Note: Recursive loading in async sqlalchemy can be tricky. 
    # Strategy: Return ALL folders as a flat list, let frontend build the tree.
    # This avoids N+1 query issues with deep trees.
    
    # We will use a modified schema for the list view if we want flat structure,
    # but the current schema has 'children'. 
    # Let's adjust the strategy: Return FLAT list of all folders. 
    # Frontend will map them.
    # To do this effectively, we should probably modify the schema to NOT include children by default 
    # or just ignore it in the flat return if they are empty.
    
    result = await db.execute(select(Folder).order_by(Folder.name))
    folders = result.scalars().all()
    return folders

@router.post("/", response_model=FolderResponse)
async def create_folder(folder: FolderCreate, db: AsyncSession = Depends(get_db)):
    db_folder = Folder(
        name=folder.name,
        parent_id=folder.parent_id,
        color=folder.color,
        icon=folder.icon
    )
    db.add(db_folder)
    await db.commit()
    await db.refresh(db_folder)
    return db_folder

@router.patch("/{id}", response_model=FolderResponse)
async def update_folder(id: int, folder_update: FolderUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Folder).where(Folder.id == id))
    db_folder = result.scalar_one_or_none()
    
    if not db_folder:
        raise HTTPException(status_code=404, detail="Folder not found")
        
    update_data = folder_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_folder, key, value)
        
    await db.commit()
    await db.refresh(db_folder)
    return db_folder

@router.delete("/{id}")
async def delete_folder(id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Folder).where(Folder.id == id))
    db_folder = result.scalar_one_or_none()
    
    if not db_folder:
        raise HTTPException(status_code=404, detail="Folder not found")
        
    await db.delete(db_folder)
    await db.commit()
    return {"status": "success"}
