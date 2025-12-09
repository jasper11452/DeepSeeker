"""
DeepSeeker MVP - Documents API Routes
"""
import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query, Body, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db
from ..models import Document, Chunk
from ..models.organization import Folder, Tag, DocumentTag
from ..services import parser, indexing_service
from sqlalchemy.orm import selectinload, joinedload

settings = get_settings()
router = APIRouter()

# Supported file types - grouped by category
SUPPORTED_FILE_TYPES = {
    # Text formats (native parsing)
    "txt": "Plain Text",
    "md": "Markdown",
    # PDF (MarkItDown + Vision LLM for images)
    "pdf": "PDF Document",
    # Office documents (MarkItDown)
    "docx": "Word Document",
    "pptx": "PowerPoint Presentation",
    "xlsx": "Excel Spreadsheet",
    "xls": "Excel Spreadsheet (Legacy)",
    # Web/Data formats (MarkItDown)
    "html": "HTML Document",
    "htm": "HTML Document",
    "json": "JSON Data",
    "xml": "XML Document",
    "csv": "CSV Data",
    # Archives (MarkItDown - extracts and processes contents)
    "zip": "ZIP Archive",
    # Ebooks (MarkItDown)
    "epub": "EPUB Ebook",
}

# Get list of supported extensions
SUPPORTED_EXTENSIONS = list(SUPPORTED_FILE_TYPES.keys())


# Request models
class CreateNoteRequest(BaseModel):
    title: str
    content: str = ""


class UpdateDocumentRequest(BaseModel):
    title: str | None = None
    content: str | None = None


@router.get("/supported-types")
async def get_supported_file_types():
    """Get list of supported file types for upload."""
    return {
        "types": SUPPORTED_FILE_TYPES,
        "extensions": SUPPORTED_EXTENSIONS,
        "accept_string": ",".join(f".{ext}" for ext in SUPPORTED_EXTENSIONS),
    }


@router.get("")
async def list_documents(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    folder_id: Optional[int] = None,
    tag_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
):
    """List all documents."""
    # Get total count
    count_result = await db.execute(select(func.count(Document.id)))
    total = count_result.scalar()

    # Get documents with chunk counts
    query = select(Document).options(
        selectinload(Document.tags)
    ).order_by(Document.created_at.desc())
    
    if folder_id is not None:
        query = query.where(Document.folder_id == folder_id)
        
    if tag_id is not None:
        query = query.join(Document.tags).where(Tag.id == tag_id)

    result = await db.execute(
        query.offset(offset).limit(limit)
    )
    documents = result.scalars().all()

    # Get chunk counts
    doc_ids = [d.id for d in documents]
    if doc_ids:
        chunk_counts_result = await db.execute(
            select(Chunk.document_id, func.count(Chunk.id))
            .where(Chunk.document_id.in_(doc_ids))
            .group_by(Chunk.document_id)
        )
        chunk_counts = dict(chunk_counts_result.all())
    else:
        chunk_counts = {}

    return {
        "documents": [
            {
                "id": doc.id,
                "filename": doc.filename,
                "title": doc.title,
                "file_type": doc.file_type,
                "file_size": doc.file_size,
                "created_at": doc.created_at.isoformat(),
                "updated_at": doc.updated_at.isoformat(),
                "chunk_count": chunk_counts.get(doc.id, 0),
                "status": doc.status,
                "processing_message": doc.processing_message,
                "processing_progress": doc.processing_progress or 0,
                "folder_id": doc.folder_id,
                "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in doc.tags],
            }
            for doc in documents
        ],
        "total": total,
    }


@router.get("/{document_id}")
async def get_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get a single document."""
    result = await db.execute(
        select(Document)
        .options(selectinload(Document.tags), joinedload(Document.folder))
        .where(Document.id == document_id)
    )
    document = result.scalar_one_or_none()

    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    # Get chunk count
    chunk_count_result = await db.execute(
        select(func.count(Chunk.id)).where(Chunk.document_id == document_id)
    )
    chunk_count = chunk_count_result.scalar()

    # Check if source file exists
    file_exists = False
    file_path = document.file_path or ""
    if file_path and not file_path.startswith("note://"):
        file_exists = os.path.exists(file_path)

    return {
        "id": document.id,
        "filename": document.filename,
        "title": document.title,
        "file_type": document.file_type,
        "file_size": document.file_size,
        "content": document.content,
        "metadata": document.meta_data,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
        "chunk_count": chunk_count,
        "status": document.status,
        "processing_message": document.processing_message,
        "processing_progress": document.processing_progress or 0,
        "folder_id": document.folder_id,
        "folder": {"id": document.folder.id, "name": document.folder.name} if document.folder else None,
        "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in document.tags],
        "file_path": file_path,
        "file_exists": file_exists,
    }


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload and process a document (Async)."""
    # Validate file type
    filename = file.filename or "untitled"
    file_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if file_ext not in SUPPORTED_EXTENSIONS:
        supported_list = ", ".join(SUPPORTED_EXTENSIONS)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file_ext}. Supported: {supported_list}"
        )

    # Check file size (approximate, since we might streamsave)
    # file.file.seek(0, 2)
    # file_size = file.file.tell()
    # file.file.seek(0)

    if settings.max_upload_size and file.size and file.size > settings.max_upload_size:
         raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {settings.max_upload_size // 1024 // 1024}MB"
        )

    # Save file
    os.makedirs(settings.upload_dir, exist_ok=True)
    file_path = os.path.join(settings.upload_dir, filename)

    # Handle duplicate filenames
    base_name, ext = os.path.splitext(filename)
    counter = 1
    while os.path.exists(file_path):
        file_path = os.path.join(settings.upload_dir, f"{base_name}_{counter}{ext}")
        counter += 1

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
        
    file_size = os.path.getsize(file_path)

    try:
        # Create document record with pending status
        document = Document(
            filename=os.path.basename(file_path),
            title=base_name,  # Temporary title
            file_type=file_ext,
            file_path=file_path,
            file_size=file_size,
            content="",  # Content will be filled later
            status="pending",
            processing_message="Queued for processing",
            processing_progress=0.0
        )
        db.add(document)
        await db.flush()
        
        # Trigger background task
        from ..services.background import background_processor
        await background_processor.add_document_task(document.id)

        await db.commit()

        return {
            "id": document.id,
            "filename": document.filename,
            "status": "pending",
            "message": "Upload successful, processing started.",
        }

    except Exception as e:
        # Clean up file on error
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Error processing document: {str(e)}")


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Delete a document."""
    result = await db.execute(
        select(Document).where(Document.id == document_id)
    )
    document = result.scalar_one_or_none()

    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove from indexes
    await indexing_service.remove_document(document_id)

    # Delete file
    if document.file_path and os.path.exists(document.file_path):
        os.remove(document.file_path)

    # Delete from database (cascades to chunks)
    await db.delete(document)
    await db.commit()

    return {"message": "Document deleted successfully"}


@router.post("/create")
async def create_note(
    request: CreateNoteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a new note document."""
    from datetime import datetime
    
    # Generate filename from title
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{request.title}_{timestamp}.md"
    
    # Create document record - use placeholder path since notes don't have actual files
    # but the database requires a non-null file_path
    note_path = f"note://internal/{filename}"
    
    document = Document(
        filename=filename,
        title=request.title,
        file_type="md",
        file_path=note_path,  # Placeholder path for notes
        file_size=len(request.content.encode('utf-8')),
        content=request.content,
        meta_data={"is_note": True, "created_manually": True},
        status="completed",  # Notes are created directly, no background processing needed
        processing_message=None,
        processing_progress=100.0,
    )
    db.add(document)
    await db.flush()
    
    # Index if there's content
    chunk_count = 0
    if request.content.strip():
        chunk_count = await indexing_service.sync_document(
            document=document,
            content=request.content,
            db=db,
        )
    
    await db.commit()
    
    return {
        "id": document.id,
        "filename": document.filename,
        "title": document.title,
        "file_type": document.file_type,
        "file_size": document.file_size,
        "chunk_count": chunk_count,
        "message": "Note created successfully",
    }


@router.patch("/{document_id}")
async def update_document(
    document_id: int,
    request: UpdateDocumentRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update a document's title and/or content. Re-indexes on content change."""
    result = await db.execute(
        select(Document).where(Document.id == document_id)
    )
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    chunk_count = None
    
    # Update title if provided
    if request.title is not None:
        document.title = request.title
    
    # Update content if provided
    if request.content is not None:
        document.content = request.content
        document.file_size = len(request.content.encode('utf-8'))
        
        # Remove old indexes
        await indexing_service.remove_document(document_id)
        
        # Delete old chunks
        await db.execute(delete(Chunk).where(Chunk.document_id == document_id))
        
        # Re-index if there's content
        if request.content.strip():
            chunk_count = await indexing_service.sync_document(
                document=document,
                content=request.content,
                db=db,
            )
        else:
            chunk_count = 0
    
    await db.commit()
    
    return {
        "id": document.id,
        "filename": document.filename,
        "title": document.title,
        "file_type": document.file_type,
        "file_size": document.file_size,
        "chunk_count": chunk_count,
        "message": "Document updated successfully",
    }


@router.get("/{document_id}/chunks")
async def get_document_chunks(
    document_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Get all chunks for a document."""
    result = await db.execute(
        select(Chunk)
        .where(Chunk.document_id == document_id)
        .order_by(Chunk.chunk_index)
    )
    chunks = result.scalars().all()

    return {
        "chunks": [
            {
                "id": chunk.id,
                "content": chunk.content,
                "chunk_index": chunk.chunk_index,
                "start_char": chunk.start_char,
                "end_char": chunk.end_char,
            }
            for chunk in chunks
        ],
        "total": len(chunks),
    }

class MoveDocumentRequest(BaseModel):
    folder_id: Optional[int]

class UpdateTagsRequest(BaseModel):
    tag_ids: list[int]

@router.post("/{document_id}/move")
async def move_document(
    document_id: int,
    request: MoveDocumentRequest,
    db: AsyncSession = Depends(get_db),
):
    """Move document to a folder (or root if folder_id is None)."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
        
    if request.folder_id is not None:
        # Verify folder exists
        f_result = await db.execute(select(Folder).where(Folder.id == request.folder_id))
        if not f_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Folder not found")
            
    document.folder_id = request.folder_id
    await db.commit()
    
    return {"status": "success", "folder_id": request.folder_id}

@router.post("/{document_id}/tags")
async def update_document_tags(
    document_id: int,
    request: UpdateTagsRequest,
    db: AsyncSession = Depends(get_db),
):
    """Update document tags (replace all)."""
    result = await db.execute(
        select(Document).options(selectinload(Document.tags)).where(Document.id == document_id)
    )
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Get tags to set
    if request.tag_ids:
        t_result = await db.execute(select(Tag).where(Tag.id.in_(request.tag_ids)))
        tags_to_set = t_result.scalars().all()
    else:
        tags_to_set = []
        
    document.tags = tags_to_set
    await db.commit()
    
    return {
        "status": "success", 
        "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in tags_to_set]
    }
