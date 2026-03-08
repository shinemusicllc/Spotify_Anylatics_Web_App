"""Item schemas — API response models."""

from datetime import datetime
from pydantic import BaseModel


class ItemResponse(BaseModel):
    """Single item response."""

    id: str
    spotify_id: str
    type: str
    name: str | None = None
    image: str | None = None

    # Owner / Artist
    owner_name: str | None = None
    owner_image: str | None = None

    # Metrics
    followers: int | None = None
    monthly_listeners: int | None = None
    monthly_plays: int | None = None
    playcount: int | None = None
    total_plays: int | None = None
    track_count: int | None = None
    album_count: int | None = None
    duration: str | None = None
    release_date: str | None = None
    saves: int | None = None

    # Status
    status: str = "pending"
    error_code: int | None = None
    error_message: str | None = None

    # Grouping
    group: str | None = None
    user_id: str | None = None
    added_date: str | None = None

    # Timestamps
    last_checked: datetime | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class ItemListResponse(BaseModel):
    """List of items response."""

    items: list[ItemResponse]
    total: int
