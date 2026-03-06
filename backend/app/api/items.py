"""Items endpoints — query stored items."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import Item
from app.schemas.item import ItemResponse, ItemListResponse

router = APIRouter()


def _item_to_response(item: Item) -> ItemResponse:
    """Convert DB Item model to API response schema."""
    duration = None
    if item.duration_ms:
        mins, secs = divmod(item.duration_ms // 1000, 60)
        duration = f"{mins}:{secs:02d}"

    return ItemResponse(
        id=str(item.id),
        spotify_id=item.spotify_id,
        type=item.item_type,
        name=item.name,
        image=item.image,
        owner_name=item.owner_name,
        owner_image=item.owner_image,
        followers=item.followers,
        monthly_listeners=item.monthly_listeners,
        monthly_plays=item.monthly_listeners,  # Alias for frontend
        playcount=item.playcount,
        total_plays=item.playcount,  # Alias for frontend
        track_count=item.track_count,
        album_count=item.album_count,
        duration=duration,
        release_date=item.release_date,
        saves=item.followers,  # Playlist saves ≈ followers
        status=item.status,
        error_code=item.error_code,
        error_message=item.error_message,
        group=item.group,
        last_checked=item.last_checked,
        created_at=item.created_at,
    )


@router.get("/items", response_model=ItemListResponse)
async def list_items(
    type: str | None = Query(None, description="Filter by item type"),
    group: str | None = Query(None, description="Filter by group"),
    status: str | None = Query(None, description="Filter by status"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List all items with optional filters."""
    query = select(Item).order_by(Item.updated_at.desc())

    if type:
        query = query.where(Item.item_type == type)
    if group:
        query = query.where(Item.group == group)
    if status:
        query = query.where(Item.status == status)

    # Total count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginated results
    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    items = result.scalars().all()

    return ItemListResponse(
        items=[_item_to_response(i) for i in items],
        total=total,
    )


@router.get("/items/{item_type}/{spotify_id}", response_model=ItemResponse)
async def get_item(
    item_type: str,
    spotify_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a specific item by type and Spotify ID."""
    result = await db.execute(
        select(Item).where(
            Item.spotify_id == spotify_id,
            Item.item_type == item_type,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_response(item)
