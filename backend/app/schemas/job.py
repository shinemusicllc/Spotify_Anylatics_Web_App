"""Job status schemas."""

from datetime import datetime
from pydantic import BaseModel


class JobResponse(BaseModel):
    """Job status response."""

    id: str
    item_id: str | None = None
    status: str  # pending|crawling|completed|error
    spotify_url: str
    item_type: str | None = None
    error: str | None = None
    result: dict | None = None
    created_at: datetime | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}
