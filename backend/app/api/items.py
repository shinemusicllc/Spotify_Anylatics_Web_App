"""Items endpoints — query stored items."""

from collections import defaultdict
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.crawl_job import CrawlJob
from app.models.item import Item
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.raw_response import RawResponse
from app.models.user import User
from app.schemas.item import ItemListResponse, ItemResponse
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


def _extract_artist_names(raw_data: dict | None) -> list[str]:
    if not isinstance(raw_data, dict):
        return []

    artist_names = raw_data.get("artist_names")
    if isinstance(artist_names, list):
        return [
            name.strip()
            for name in artist_names
            if isinstance(name, str) and name.strip()
        ]

    artists = raw_data.get("artists")
    if isinstance(artists, list):
        names: list[str] = []
        for artist in artists:
            if not isinstance(artist, dict):
                continue
            name = artist.get("name")
            if isinstance(name, str) and name.strip():
                names.append(name.strip())
        return names

    return []


def _build_album_export_tracks(raw_data: dict | None) -> list[dict]:
    if not isinstance(raw_data, dict):
        return []

    tracks = raw_data.get("tracks")
    if not isinstance(tracks, list):
        return []

    export_rows: list[dict] = []
    for track in tracks:
        if not isinstance(track, dict):
            continue

        track_name = track.get("name")
        if not isinstance(track_name, str) or not track_name.strip():
            continue

        artist_names = _extract_artist_names(track)
        spotify_url = track.get("spotify_url")
        if not isinstance(spotify_url, str) or not spotify_url.strip():
            spotify_id = track.get("spotify_id")
            spotify_url = (
                _spotify_url("track", spotify_id.strip())
                if isinstance(spotify_id, str) and spotify_id.strip()
                else None
            )

        export_rows.append(
            {
                "artist_names": ", ".join(artist_names) if artist_names else "-",
                "track_name": track_name.strip(),
                "spotify_url": spotify_url,
            }
        )

    return export_rows


def _format_added_date(value) -> str | None:
    if value is None:
        return None
    return value.strftime("%d/%m %H:%M")


def _compute_delta(current: int | None, previous: int | None) -> int | None:
    if current is None or previous is None:
        return None
    return current - previous


async def _load_latest_raw_data(db: AsyncSession, items: list[Item]) -> dict[str, dict]:
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
    return raw_map


async def _load_recent_snapshots(db: AsyncSession, items: list[Item]) -> dict:
    item_ids = [item.id for item in items if item.id]
    if not item_ids:
        return {}

    result = await db.execute(
        select(MetricsSnapshot)
        .where(MetricsSnapshot.item_id.in_(item_ids))
        .order_by(MetricsSnapshot.item_id, MetricsSnapshot.captured_at.desc())
    )
    rows = result.scalars().all()

    snapshot_map: dict = defaultdict(list)
    for row in rows:
        bucket = snapshot_map[row.item_id]
        if len(bucket) < 2:
            bucket.append(row)
    return snapshot_map


async def _load_item_users(db: AsyncSession, items: list[Item]) -> dict[str, User]:
    user_ids = [item.user_id for item in items if item.user_id]
    if not user_ids:
        return {}

    result = await db.execute(select(User).where(User.id.in_(user_ids)))
    users = result.scalars().all()
    return {str(user.id): user for user in users}


async def _delete_raw_if_unreferenced(
    db: AsyncSession,
    spotify_ids: list[str],
    excluded_item_ids: list[uuid.UUID] | None = None,
) -> None:
    unique_ids = [sid for sid in dict.fromkeys(spotify_ids) if sid]
    if not unique_ids:
        return

    query = select(Item.spotify_id).where(Item.spotify_id.in_(unique_ids))
    if excluded_item_ids:
        query = query.where(~Item.id.in_(excluded_item_ids))

    remaining_rows = (await db.execute(query)).all()
    remaining_ids = {row[0] for row in remaining_rows if row and row[0]}
    stale_ids = [sid for sid in unique_ids if sid not in remaining_ids]
    if stale_ids:
        await db.execute(delete(RawResponse).where(RawResponse.spotify_id.in_(stale_ids)))


def _item_to_response(
    item: Item,
    owner_url: str | None = None,
    raw_data: dict | None = None,
    snapshots: list[MetricsSnapshot] | None = None,
    item_user: User | None = None,
) -> ItemResponse:
    """Convert DB Item model to API response schema."""
    duration = None
    if item.duration_ms:
        mins, secs = divmod(item.duration_ms // 1000, 60)
        duration = f"{mins}:{secs:02d}"

    has_total_plays = item.item_type in {"track", "album", "playlist"}
    total_plays = item.playcount if has_total_plays else None
    artist_names = _extract_artist_names(raw_data)
    export_tracks = _build_album_export_tracks(raw_data) if item.item_type == "album" else None

    snapshots = snapshots or []
    latest_snapshot = snapshots[0] if len(snapshots) >= 1 else None
    previous_snapshot = snapshots[1] if len(snapshots) >= 2 else None

    delta_days = None
    if latest_snapshot and previous_snapshot:
        delta_days = max(
            0,
            int((latest_snapshot.captured_at - previous_snapshot.captured_at).total_seconds() // 86400),
        )

    return ItemResponse(
        id=str(item.id),
        spotify_id=item.spotify_id,
        type=item.item_type,
        name=item.name,
        spotify_url=_spotify_url(item.item_type, item.spotify_id),
        image=item.image,
        owner_name=item.owner_name,
        owner_image=item.owner_image,
        owner_url=owner_url,
        artist_names=artist_names or None,
        export_tracks=export_tracks or None,
        followers=item.followers,
        monthly_listeners=item.monthly_listeners,
        monthly_plays=item.monthly_listeners,
        playcount=item.playcount,
        total_plays=total_plays,
        track_count=item.track_count,
        album_count=item.album_count,
        duration=duration,
        release_date=item.release_date,
        saves=item.followers,
        followers_delta=_compute_delta(
            latest_snapshot.followers if latest_snapshot else item.followers,
            previous_snapshot.followers if previous_snapshot else None,
        ),
        monthly_listeners_delta=_compute_delta(
            latest_snapshot.monthly_listeners if latest_snapshot else item.monthly_listeners,
            previous_snapshot.monthly_listeners if previous_snapshot else None,
        ),
        playcount_delta=_compute_delta(
            latest_snapshot.playcount if latest_snapshot else item.playcount,
            previous_snapshot.playcount if previous_snapshot else None,
        ),
        track_count_delta=_compute_delta(
            latest_snapshot.track_count if latest_snapshot else item.track_count,
            previous_snapshot.track_count if previous_snapshot else None,
        ),
        delta_days=delta_days,
        status=item.status,
        error_code=item.error_code,
        error_message=item.error_message,
        group=item.group,
        user_id=str(item.user_id) if item.user_id else None,
        user_name=(item_user.display_name or item_user.username) if item_user else None,
        user_avatar=item_user.avatar if item_user else None,
        added_date=_format_added_date(item.created_at),
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

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.limit(limit).offset(offset)
    result = await db.execute(query)
    items = result.scalars().all()
    raw_map = await _load_latest_raw_data(db, items)
    snapshot_map = await _load_recent_snapshots(db, items)
    user_map = await _load_item_users(db, items)

    return ItemListResponse(
        items=[
            _item_to_response(
                item,
                _extract_owner_url(item, raw_map.get(item.spotify_id)),
                raw_map.get(item.spotify_id),
                snapshot_map.get(item.id),
                user_map.get(str(item.user_id)) if item.user_id else None,
            )
            for item in items
        ],
        total=total,
    )


@router.get("/items/{item_type}/{spotify_id}", response_model=ItemResponse)
async def get_item(
    item_type: str,
    spotify_id: str,
    user_id: str | None = Query(None, description="Target user (admin only)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific item by type and Spotify ID."""
    query = select(Item).where(
        Item.spotify_id == spotify_id,
        Item.item_type == item_type,
    )
    if current_user.role != "admin":
        query = query.where(Item.user_id == current_user.id)
    elif user_id:
        query = query.where(Item.user_id == user_id)

    result = await db.execute(query.order_by(Item.updated_at.desc()))
    rows = result.scalars().all()
    if current_user.role == "admin" and not user_id and len(rows) > 1:
        raise HTTPException(
            status_code=409,
            detail="Multiple users track this link. Specify user_id.",
        )
    item = rows[0] if rows else None
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if current_user.role != "admin" and item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this item")

    raw_map = await _load_latest_raw_data(db, [item])
    snapshot_map = await _load_recent_snapshots(db, [item])
    user_map = await _load_item_users(db, [item])
    return _item_to_response(
        item,
        _extract_owner_url(item, raw_map.get(item.spotify_id)),
        raw_map.get(item.spotify_id),
        snapshot_map.get(item.id),
        user_map.get(str(item.user_id)) if item.user_id else None,
    )


@router.patch("/items/group")
async def rename_group(
    old_group: str = Query(..., description="Current group name"),
    new_group: str | None = Query(None, description="New group name (empty = clear group)"),
    user_id: str | None = Query(None, description="Target user (admin only)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Rename or clear a group for one user and persist item.group in DB."""
    old_clean = old_group.strip()
    new_clean = (new_group or "").strip()
    if not old_clean:
        raise HTTPException(status_code=400, detail="old_group is required")
    next_group = new_clean or None

    target_user_id = current_user.id
    if current_user.role == "admin" and user_id:
        try:
            target_user_id = uuid.UUID(str(user_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid user_id") from exc

    stmt = (
        update(Item)
        .where(Item.user_id == target_user_id)
        .where(func.lower(Item.group) == old_clean.lower())
        .values(group=next_group)
    )
    result = await db.execute(stmt)
    await db.commit()

    return {
        "ok": True,
        "updated": int(result.rowcount or 0),
        "old_group": old_clean,
        "new_group": next_group,
    }


@router.delete("/items/{item_type}/{spotify_id}")
async def delete_item(
    item_type: str,
    spotify_id: str,
    user_id: str | None = Query(None, description="Target user (admin only)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a single item by type + Spotify ID."""
    query = select(Item).where(
        Item.spotify_id == spotify_id,
        Item.item_type == item_type,
    )
    if current_user.role != "admin":
        query = query.where(Item.user_id == current_user.id)
    elif user_id:
        query = query.where(Item.user_id == user_id)

    result = await db.execute(query.order_by(Item.updated_at.desc()))
    rows = result.scalars().all()
    if current_user.role == "admin" and not user_id and len(rows) > 1:
        raise HTTPException(
            status_code=409,
            detail="Multiple users track this link. Specify user_id.",
        )
    item = rows[0] if rows else None
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if current_user.role != "admin" and item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this item")

    await db.execute(delete(MetricsSnapshot).where(MetricsSnapshot.item_id == item.id))
    await db.execute(delete(CrawlJob).where(CrawlJob.item_id == item.id))
    await db.delete(item)
    await _delete_raw_if_unreferenced(db, [item.spotify_id], excluded_item_ids=[item.id])
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
    result = await db.execute(delete(Item).where(Item.id.in_(item_ids)))
    await _delete_raw_if_unreferenced(db, spotify_ids, excluded_item_ids=item_ids)
    await db.commit()
    return {"ok": True, "deleted": result.rowcount or 0, "group": group}
