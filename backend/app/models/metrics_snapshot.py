"""MetricsSnapshot model — time-series data for tracking trends."""

import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MetricsSnapshot(Base):
    """Point-in-time metrics capture for trend analysis."""

    __tablename__ = "metrics_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id"), nullable=False
    )
    spotify_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # ── Metrics at capture time ──
    followers: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    monthly_listeners: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    playcount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    captured_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, index=True
    )
