"""Crawl request/response schemas."""

import uuid

from pydantic import BaseModel


class CrawlRequest(BaseModel):
    """Single crawl request."""

    url: str
    group: str | None = None
    target_user_id: uuid.UUID | None = None
    item_id: uuid.UUID | None = None


class CrawlBatchRequest(BaseModel):
    """Batch crawl request."""

    urls: list[str]
    group: str | None = None
    target_user_id: uuid.UUID | None = None
    item_ids: list[uuid.UUID | None] | None = None


class CrawlResponse(BaseModel):
    """Crawl job created response."""

    job_id: str | None = None
    item_id: str | None = None
    status: str = "pending"
    skipped_duplicate: bool = False
    message: str = "Crawl job created"


class CrawlBatchResponse(BaseModel):
    """Batch crawl response."""

    job_ids: list[str]
    count: int
    accepted_indices: list[int] = []
    skipped_duplicates: int = 0
    message: str = "Batch crawl jobs created"
