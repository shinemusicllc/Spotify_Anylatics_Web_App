"""Items endpoints — query stored items."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.raw_response import RawResponse
from app.models.user import User
from app.schemas.item import ItemResponse, ItemListResponse
from app.services.auth import get_current_user

router = APIRouter()


def _spotify_url(item_type: str, spotify_id: str) -> str:
    return f"https://open.spotify.com/{item_type}/{spotify_id}"


def _extract_owner_url(item: Item, raw_data: dict | None) -> str | None:
    if isinstance(raw_data, dict):
        owner_url = raw_data.get("owner_url")
        if isinstance(owner_url, str) and owner_url.strip():
            return owner_url.strip()

        if item.item_type == "track":
            artists = raw_data.get("artists") or []
            if isinstance(artists, list) and artists:
                first_artist = artists[0] or {}
                artist_id = first_artist.get("spotify_id") or first_artist.get("id")
                if artist_id:
                    return _spotify_url("artist", artist_id)

        if item.item_type == "album":
            artists = raw_data.get("artists") or []
            if isinstance(artists, list) and artists:
                first_artist = artists[0] or {}
                artist_id = first_artist.get("spotify_id") or first_artist.get("id")
                if artist_id:
                    return _spotify_url("artist", artist_id)

            tracks = raw_data.get("tracks") or []
            if isinstance(tracks, list) and tracks:
                first_track = tracks[0] or {}
                track_artists = first_track.get("artists") or []
                if isinstance(track_artists, list) and track_artists:
                    first_artist = track_artists[0] or {}
                    artist_id = first_artist.get("spotify_id") or first_artist.get("id")
                    if artist_id:
                        return _spotify_url("artist", artist_id)

    if item.item_type == "artist":
        return _spotify_url("artist", item.spotify_id)
    return None


async def _load_owner_urls(db: AsyncSession, items: list[Item]) -> dict[str, str | None]:
    spotify_ids = [item.spotify_id for item in items if item.spotify_id]
    if not spotify_ids:
        return {}

    result = await db.execute(
        select(RawResponse)
        .where(RawResponse.spotify_id.in_(spotify_ids))
        .order_by(RawResponse.captured_at.desc())
    )
    rows = result.scalars().all()
    raw_map: dict[str, dict] = {}
    for row in rows:
        if row.spotify_id not in raw_map and isinstance(row.response_data, dict):
            raw_map[row.spotify_id] = row.response_data

    return {
        item.spotify_id: _extract_owner_url(item, raw_map.get(item.spotify_id))
        for item in items
    }


def _item_to_response(item: Item, owner_url: str | None = None) -> ItemResponse:
    """Convert DB Item model to API response schema."""
    duration = None
    if item.duration_ms:
        mins, secs = divmod(item.duration_ms // 1000, 60)
        duration = f"{mins}:{secs:02d}"

    has_total_plays = item.item_type in {"track", "album", "playlist"}
    total_plays = item.playcount if has_total_plays else None

    return ItemResponse(
        id=str(item.id),
        spotify_id=item.spotify_id,
        type=item.item_type,
        name=item.name,
        image=item.image,
        owner_name=item.owner_name,
        owner_image=item.owner_image,
        owner_url=owner_url,
        followers=item.followers,
        monthly_listeners=item.monthly_listeners,
        monthly_plays=item.monthly_listeners,  # Alias for frontend
        playcount=item.playcount,
        total_plays=total_plays,
        track_count=item.track_count,
        album_count=item.album_count,
        duration=duration,
        release_date=item.release_date,
        saves=item.followers,  # Playlist saves ~ followers
        status=item.status,
        error_code=item.error_code,
        error_message=item.error_message,
        group=item.group,
        user_id=str(item.user_id) if item.user_id else None,
        last_checked=item.last_checked,
        created_at=item.created_at,
    )


@router.get("/items", response_model=ItemListResponse)
async def list_items(
    type: str | None = Query(None, description="Filter by item type"),
    group: str | None = Query(None, description="Filter by group"),
    status: str | None = Query(None, description="Filter by status"),
    user_id: str | None = Query(None, description="Filter by user (admin only)"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all items with optional filters."""
    query = select(Item).order_by(Item.updated_at.desc())

    # Non-admin users only see their own items; admin can filter by user_id
    if current_user.role != "admin":
        query = query.where(Item.user_id == current_user.id)
    elif user_id:
        query = query.where(Item.user_id == user_id)

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
    owner_url_map = await _load_owner_urls(db, items)

    return ItemListResponse(
        items=[_item_to_response(i, owner_url_map.get(i.spotify_id)) for i in items],
        total=total,
    )


@router.get("/items/{item_type}/{spotify_id}", response_model=ItemResponse)
async def get_item(
    item_type: str,
    spotify_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
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

    # Ownership check
    if current_user.role != "admin" and item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this item")

    owner_url_map = await _load_owner_urls(db, [item])
    return _item_to_response(item, owner_url_map.get(item.spotify_id))


@router.delete("/items/{item_type}/{spotify_id}")
async def delete_item(
    item_type: str,
    spotify_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single item by type + Spotify ID."""
    result = await db.execute(
        select(Item).where(
            Item.spotify_id == spotify_id,
            Item.item_type == item_type,
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Ownership check
    if current_user.role != "admin" and item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this item")

    await db.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id == item.id))
    await db.execute(delete(CrawlJob).where(CrawlJob.item_id == item.id))
    await db.execute(delete(RawResponse).where(RawResponse.spotify_id == item.spotify_id))
    await db.delete(item)
    await db.commit()
    return {"ok": True, "deleted": 1}


@router.delete("/items")
async def clear_items(
    group: str | None = Query(None, description="Optional group to clear"),
    user_id: str | None = Query(None, description="Filter by user (admin only)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear all items (or items in one group)."""
    selected_items = select(Item.id, Item.spotify_id)

    # Non-admin users only clear their own items; admin can filter by user_id
    if current_user.role != "admin":
        selected_items = selected_items.where(Item.user_id == current_user.id)
    elif user_id:
        selected_items = selected_items.where(Item.user_id == user_id)

    if group:
        selected_items = selected_items.where(Item.group == group)

    rows = (await db.execute(selected_items)).all()
    if not rows:
        return {"ok": True, "deleted": 0, "group": group}

    item_ids = [row[0] for row in rows]
    spotify_ids = [row[1] for row in rows]

    await db.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id.in_(item_ids)))
    await db.execute(delete(CrawlJob).where(CrawlJob.item_id.in_(item_ids)))
    await db.execute(delete(RawResponse).where(RawResponse.spotify_id.in_(spotify_ids)))
    result = await db.execute(delete(Item).where(Item.id.in_(item_ids)))
    await db.commit()
    return {"ok": True, "deleted": result.rowcount or 0, "group": group}
