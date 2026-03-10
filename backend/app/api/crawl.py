"""Crawl endpoints - trigger crawl jobs."""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.models.user import User
from app.schemas.crawl import (
    CrawlRequest,
    CrawlBatchRequest,
    CrawlResponse,
    CrawlBatchResponse,
)
from app.utils.spotify_urls import parse_spotify_url
from app.services.crawler import crawl_item_task
from app.services.auth import get_current_user

router = APIRouter()


async def _resolve_target_user_id(
    db: AsyncSession, current_user: User, requested_user_id: uuid.UUID | None
) -> uuid.UUID:
    if requested_user_id is None:
        return current_user.id

    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to set target user")

    user_result = await db.execute(select(User).where(User.id == requested_user_id))
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")

    return target_user.id


@router.post("/crawl", response_model=CrawlResponse)
async def crawl(
    req: CrawlRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start a crawl job for a single Spotify URL."""
    parsed = parse_spotify_url(req.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="Invalid Spotify URL or URI")

    item_type, spotify_id = parsed
    target_user_id = await _resolve_target_user_id(db, current_user, req.target_user_id)
    requested_group = (req.group or "").strip() or None

    # Check if item already exists for the selected owner only.
    existing = await db.execute(
        select(Item).where(
            Item.spotify_id == spotify_id,
            Item.item_type == item_type,
            Item.user_id == target_user_id,
        )
    )
    item = existing.scalar_one_or_none()

    if item:
        # Respect explicit group selection in add-link modal.
        if req.group is not None:
            item.group = requested_group

        item.status = "crawling"
        item.error_code = None
        item.error_message = None
    else:
        # Create placeholder item
        item = Item(
            spotify_id=spotify_id,
            item_type=item_type,
            status="crawling",
            group=requested_group,
            user_id=target_user_id,
        )
        db.add(item)
        await db.flush()

    # Create crawl job
    job = CrawlJob(
        item_id=item.id,
        spotify_url=req.url,
        item_type=item_type,
        status="pending",
        user_id=current_user.id,
    )
    db.add(job)
    await db.flush()

    job_id = str(job.id)

    # Persist before scheduling background work so task can always read the job row.
    await db.commit()

    # Run in event loop without request/response lifecycle coupling.
    asyncio.create_task(crawl_item_task(job_id, spotify_id, item_type))

    return CrawlResponse(job_id=job_id, status="pending")


@router.post("/crawl/batch", response_model=CrawlBatchResponse)
async def crawl_batch(
    req: CrawlBatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start crawl jobs for multiple Spotify URLs."""
    job_ids = []
    background_jobs: list[tuple[str, str, str]] = []
    target_user_id = await _resolve_target_user_id(db, current_user, req.target_user_id)
    requested_group = (req.group or "").strip() or None

    for url in req.urls:
        parsed = parse_spotify_url(url)
        if not parsed:
            continue  # Skip invalid URLs

        item_type, spotify_id = parsed

        # Check existing for the selected owner only.
        existing = await db.execute(
            select(Item).where(
                Item.spotify_id == spotify_id,
                Item.item_type == item_type,
                Item.user_id == target_user_id,
            )
        )
        item = existing.scalar_one_or_none()

        if item:
            if req.group is not None:
                item.group = requested_group

            item.status = "crawling"
            item.error_code = None
            item.error_message = None
        else:
            item = Item(
                spotify_id=spotify_id,
                item_type=item_type,
                status="crawling",
                group=requested_group,
                user_id=target_user_id,
            )
            db.add(item)
            await db.flush()

        job = CrawlJob(
            item_id=item.id,
            spotify_url=url,
            item_type=item_type,
            status="pending",
            user_id=current_user.id,
        )
        db.add(job)
        await db.flush()

        job_id = str(job.id)
        job_ids.append(job_id)
        background_jobs.append((job_id, spotify_id, item_type))

    # Persist all created jobs before scheduling any background task.
    await db.commit()

    for job_id, spotify_id, item_type in background_jobs:
        asyncio.create_task(crawl_item_task(job_id, spotify_id, item_type))

    return CrawlBatchResponse(job_ids=job_ids, count=len(job_ids))
