"""RawResponse model — stores raw API responses for debugging/re-parsing."""

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RawResponse(Base):
    """Raw JSON response from Spotify internal API."""

    __tablename__ = "raw_responses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    spotify_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    operation: Mapped[str] = mapped_column(
        String(64), nullable=False
    )  # e.g. queryArtistOverview
    response_data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
