"""AuthSession model — stores Spotify auth tokens."""

import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AuthSession(Base):
    """Spotify authentication session with tokens and cookies."""

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # ── Tokens ──
    authorization: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    cookies: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Status ──
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # ── Metadata ──
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_used: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
