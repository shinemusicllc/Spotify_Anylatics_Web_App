"""
Crawler Service - orchestrates crawl jobs.

Runs as background tasks via event-loop tasks.
"""

import asyncio
import logging
from datetime import datetime

from sqlalchemy import select

from app.database import async_session
from app.models.item import Item
from app.models.crawl_job import CrawlJob
from app.models.raw_response import RawResponse
from app.services import spotify_client
from app.config import settings

logger = logging.getLogger(__name__)

# Dispatch table: type -> fetch function
FETCHERS = {
    "artist": spotify_client.query_artist,
    "track": spotify_client.get_track,
    "playlist": spotify_client.fetch_playlist,
    "album": spotify_client.fetch_album,
}


async def crawl_item_task(job_id: str, spotify_id: str, item_type: str):
    """
    Background task: crawl a single Spotify item.

    1. Update job status to 'crawling'
    2. Call the appropriate Spotify client function
    3. Update Item with real data
    4. Save raw response
    5. Update job status to 'completed' or 'error'
    """
    async with async_session() as db:
        try:
            # 1. Mark job as crawling
            job_result = await db.execute(select(CrawlJob).where(CrawlJob.id == job_id))
            job = job_result.scalar_one_or_none()
            if not job:
                logger.error(f"Job {job_id} not found")
                return

            job.status = "crawling"
            job.started_at = datetime.utcnow()
            await db.commit()

            # 2. Fetch data from Spotify
            fetcher = FETCHERS.get(item_type)
            if not fetcher:
                raise ValueError(f"Unknown item type: {item_type}")

            # Retry logic with exponential backoff
            data = None
            for attempt in range(settings.MAX_RETRIES):
                try:
                    data = await fetcher(spotify_id)
                    if data is not None:
                        break
                except Exception as e:
                    logger.warning(
                        f"Attempt {attempt + 1} failed for {spotify_id}: {e}"
                    )
                    if attempt < settings.MAX_RETRIES - 1:
                        wait = (2**attempt) + (asyncio.get_event_loop().time() % 1)
                        await asyncio.sleep(wait)

            if data is None:
                raise Exception("All retry attempts failed - no data returned")

            # 3. Check if response indicates an error
            if data.get("error"):
                item_result = await db.execute(
                    select(Item).where(Item.spotify_id == spotify_id)
                )
                item = item_result.scalar_one_or_none()
                if item:
                    item.status = "error"
                    item.error_code = data.get("error_code")
                    item.error_message = data.get("error_message")
                    item.last_checked = datetime.utcnow()

                job.status = "error"
                job.error = data.get("error_message", "Unknown error")
                job.completed_at = datetime.utcnow()
                await db.commit()
                return

            # 4. Update Item with real data
            item_result = await db.execute(
                select(Item).where(Item.spotify_id == spotify_id)
            )
            item = item_result.scalar_one_or_none()
            if item:
                item.name = data.get("name", item.name)
                item.image = data.get("image", item.image)
                item.owner_name = data.get("owner_name", item.owner_name)
                item.owner_image = data.get("owner_image", item.owner_image)
                item.followers = data.get("followers", item.followers)
                item.monthly_listeners = data.get(
                    "monthly_listeners",
                    data.get("monthly_plays", item.monthly_listeners),
                )
                item.playcount = data.get("playcount", item.playcount)
                item.track_count = data.get("track_count", item.track_count)
                item.album_count = data.get("album_count", item.album_count)
                item.duration_ms = data.get("duration_ms", item.duration_ms)
                item.release_date = data.get("release_date", item.release_date)
                item.status = "active"
                item.error_code = None
                item.error_message = None
                item.last_checked = datetime.utcnow()

            # 5. Save raw response for debugging
            raw = RawResponse(
                spotify_id=spotify_id,
                operation=f"fetch_{item_type}",
                response_data=data,
            )
            db.add(raw)

            # 6. Mark job completed
            job.status = "completed"
            job.result = data
            job.completed_at = datetime.utcnow()

            await db.commit()
            logger.info(
                f"Crawl completed: {item_type}:{spotify_id} - {data.get('name', '?')}"
            )

        except Exception as e:
            logger.error(f"Crawl failed for {spotify_id}: {e}")
            # Update job as error
            try:
                job_result = await db.execute(
                    select(CrawlJob).where(CrawlJob.id == job_id)
                )
                job = job_result.scalar_one_or_none()
                if job:
                    job.status = "error"
                    job.error = str(e)
                    job.completed_at = datetime.utcnow()
                    job.retry_count += 1

                item_result = await db.execute(
                    select(Item).where(Item.spotify_id == spotify_id)
                )
                item = item_result.scalar_one_or_none()
                if item:
                    item.status = "error"
                    item.error_message = str(e)
                    item.last_checked = datetime.utcnow()

                await db.commit()
            except Exception:
                await db.rollback()
