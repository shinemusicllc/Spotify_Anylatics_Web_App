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
from app.services import spotify_web_scraper
from app.config import settings

logger = logging.getLogger(__name__)

# Dispatch table: type -> fetch function
FETCHERS = {
    "artist": spotify_client.query_artist,
    "track": spotify_client.get_track,
    "playlist": spotify_client.fetch_playlist,
    "album": spotify_client.fetch_album,
}


def _append_crawl_mode(base_mode: str | None, suffix: str) -> str:
    if not base_mode:
        return suffix
    if suffix in base_mode:
        return base_mode
    return f"{base_mode}+{suffix}"


async def _apply_direct_playwright_fallback(
    item_type: str,
    spotify_id: str,
    data: dict,
    existing: dict | None = None,
) -> dict:
    """
    Force a last-mile Playwright enrichment when core fields are still missing.

    This runs at crawler level so it still works even if upstream API flow
    returns partial payloads.
    """
    if data is None:
        merged: dict = {}
    elif not isinstance(data, dict):
        return data
    else:
        merged = dict(data)

    had_error = bool(merged.get("error"))
    existing = existing or {}

    def _clear_error_state() -> None:
        merged.pop("error", None)
        merged.pop("error_code", None)
        merged.pop("error_message", None)

    try:
        if item_type == "track":
            existing_has_core = (
                existing.get("playcount") is not None
                or existing.get("duration_ms") is not None
            )
            if had_error and settings.PLAYWRIGHT_FAST_FAIL_ERRORS and not existing_has_core:
                return merged
            if existing_has_core:
                # Fast path: keep trusted existing values and avoid slow Playwright fallback.
                merged["playcount"] = _prefer_existing_on_none(existing.get("playcount"), merged.get("playcount"))
                merged["duration_ms"] = _prefer_existing_on_none(existing.get("duration_ms"), merged.get("duration_ms"))
                merged["name"] = _prefer_existing_on_none(existing.get("name"), merged.get("name"))
                if had_error:
                    _clear_error_state()
                return merged

            needs = had_error or merged.get("playcount") is None or merged.get("duration_ms") is None
            if not needs:
                return merged
            scraped = await spotify_web_scraper.scrape_track_stats(spotify_id)
            if not scraped:
                return merged
            recovered = False
            if merged.get("name") in (None, "") and scraped.get("name"):
                merged["name"] = scraped.get("name")
                recovered = True
            if merged.get("duration_ms") is None and scraped.get("duration_ms") is not None:
                merged["duration_ms"] = scraped.get("duration_ms")
                recovered = True
            if scraped.get("playcount") is not None:
                merged["playcount"] = scraped.get("playcount")
                recovered = True
            if scraped.get("playcount") is not None or scraped.get("duration_ms") is not None or scraped.get("name"):
                merged["crawl_mode"] = _append_crawl_mode(merged.get("crawl_mode"), "playwright")
            if recovered:
                _clear_error_state()
            return merged

        if item_type == "artist":
            existing_has_core = (
                existing.get("monthly_listeners") is not None
                or existing.get("followers") is not None
            )
            if had_error and settings.PLAYWRIGHT_FAST_FAIL_ERRORS and not existing_has_core:
                return merged
            if existing_has_core:
                merged["monthly_listeners"] = _prefer_existing_on_none(
                    existing.get("monthly_listeners"),
                    merged.get("monthly_listeners"),
                )
                merged["followers"] = _prefer_existing_on_none(existing.get("followers"), merged.get("followers"))
                merged["name"] = _prefer_existing_on_none(existing.get("name"), merged.get("name"))
                merged["owner_name"] = _prefer_existing_on_none(existing.get("owner_name"), merged.get("owner_name"))
                if had_error:
                    _clear_error_state()
                return merged

            needs = (
                had_error
                or merged.get("name") in (None, "")
                or merged.get("owner_name") in (None, "")
                or
                merged.get("monthly_listeners") is None
                or merged.get("followers") is None
            )
            if not needs:
                return merged
            scraped = await spotify_web_scraper.scrape_artist_stats(spotify_id)
            if not scraped:
                return merged
            recovered = False
            if merged.get("name") in (None, "") and scraped.get("name"):
                merged["name"] = scraped.get("name")
                recovered = True
            if merged.get("owner_name") in (None, "") and scraped.get("owner_name"):
                merged["owner_name"] = scraped.get("owner_name")
                recovered = True
            if merged.get("monthly_listeners") is None and scraped.get("monthly_listeners") is not None:
                merged["monthly_listeners"] = scraped.get("monthly_listeners")
                recovered = True
            if merged.get("followers") is None and scraped.get("followers") is not None:
                merged["followers"] = scraped.get("followers")
                recovered = True
            if (
                scraped.get("monthly_listeners") is not None
                or scraped.get("followers") is not None
                or scraped.get("name")
            ):
                merged["crawl_mode"] = _append_crawl_mode(merged.get("crawl_mode"), "playwright")
            if recovered:
                _clear_error_state()
            return merged

        if item_type == "album":
            existing_has_core = existing.get("playcount") is not None
            if had_error and settings.PLAYWRIGHT_FAST_FAIL_ERRORS and not existing_has_core:
                return merged
            if existing_has_core:
                merged["playcount"] = _prefer_existing_on_none(existing.get("playcount"), merged.get("playcount"))
                merged["total_plays"] = _prefer_existing_on_none(existing.get("playcount"), merged.get("total_plays"))
                merged["track_count"] = _prefer_existing_on_none(existing.get("track_count"), merged.get("track_count"))
                merged["name"] = _prefer_existing_on_none(existing.get("name"), merged.get("name"))
                merged["owner_name"] = _prefer_existing_on_none(existing.get("owner_name"), merged.get("owner_name"))
                if had_error:
                    _clear_error_state()
                return merged

            needs = (
                had_error
                or merged.get("name") in (None, "")
                or merged.get("owner_name") in (None, "")
                or (merged.get("playcount") is None and merged.get("total_plays") is None)
            )
            if not needs:
                return merged
            expected_tracks = merged.get("track_count")
            if not isinstance(expected_tracks, int):
                expected_tracks = None
            seed_track_ids: list[str] | None = None
            track_rows = merged.get("tracks")
            if isinstance(track_rows, list):
                seed_track_ids = [
                    row.get("spotify_id")
                    for row in track_rows
                    if isinstance(row, dict) and isinstance(row.get("spotify_id"), str)
                ]
            scraped = await spotify_web_scraper.scrape_album_stats(
                spotify_id,
                expected_tracks=expected_tracks,
                seed_track_ids=seed_track_ids,
            )
            if not scraped:
                return merged
            recovered = False
            if merged.get("name") in (None, "") and scraped.get("name"):
                merged["name"] = scraped.get("name")
                recovered = True
            if merged.get("owner_name") in (None, "") and scraped.get("owner_name"):
                merged["owner_name"] = scraped.get("owner_name")
                recovered = True
            if merged.get("track_count") is None and scraped.get("track_count") is not None:
                merged["track_count"] = scraped.get("track_count")
                recovered = True
            if scraped.get("playcount") is not None:
                merged["playcount"] = scraped.get("playcount")
                merged["total_plays"] = scraped.get("playcount")
                recovered = True
            if scraped.get("tracks_crawled") is not None:
                merged["tracks_crawled"] = scraped.get("tracks_crawled")
            if scraped.get("tracks_expected") is not None:
                merged["tracks_expected"] = scraped.get("tracks_expected")
            if scraped.get("tracks_with_playcount") is not None:
                merged["tracks_with_playcount"] = scraped.get("tracks_with_playcount")
            merged["crawl_mode"] = _append_crawl_mode(merged.get("crawl_mode"), "playwright")
            if recovered:
                _clear_error_state()
            return merged
    except Exception as ex:
        logger.warning(
            "Direct Playwright fallback failed for %s:%s - %s",
            item_type,
            spotify_id,
            ex,
        )

    return merged


def _has_meaningful_data(data: dict) -> bool:
    """Return True when payload contains any usable field from API/Playwright."""
    keys = (
        "name",
        "image",
        "owner_name",
        "owner_image",
        "followers",
        "monthly_listeners",
        "monthly_plays",
        "playcount",
        "total_plays",
        "track_count",
        "album_count",
        "duration_ms",
        "release_date",
    )
    for key in keys:
        value = data.get(key)
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, (list, dict)) and not value:
            continue
        return True
    return False


def _prefer_existing_on_none(current, incoming):
    """Keep current value when incoming is None/empty-string."""
    if incoming is None:
        return current
    if isinstance(incoming, str) and not incoming.strip():
        return current
    return incoming


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

            existing_item_result = await db.execute(
                select(Item).where(Item.spotify_id == spotify_id)
            )
            existing_item = existing_item_result.scalar_one_or_none()
            existing_data = {}
            if existing_item is not None:
                existing_data = {
                    "name": existing_item.name,
                    "owner_name": existing_item.owner_name,
                    "playcount": existing_item.playcount,
                    "monthly_listeners": existing_item.monthly_listeners,
                    "followers": existing_item.followers,
                    "duration_ms": existing_item.duration_ms,
                    "track_count": existing_item.track_count,
                }

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
                if settings.PLAYWRIGHT_FAST_FAIL_ERRORS and not _has_meaningful_data(existing_data):
                    raise Exception("No data returned (fast-fail)")
                data = await _apply_direct_playwright_fallback(
                    item_type,
                    spotify_id,
                    {},
                    existing=existing_data,
                )
                if not _has_meaningful_data(data):
                    raise Exception("All retry attempts failed - no data returned")

            # Last-mile enrichment for track/album/artist if key fields are still missing.
            data = await _apply_direct_playwright_fallback(
                item_type,
                spotify_id,
                data,
                existing=existing_data,
            )

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

            if not _has_meaningful_data(data):
                raise Exception("No usable data from API/Playwright")

            # 4. Update Item with real data
            item_result = await db.execute(
                select(Item).where(Item.spotify_id == spotify_id)
            )
            item = item_result.scalar_one_or_none()
            if item:
                item.name = _prefer_existing_on_none(item.name, data.get("name"))
                item.image = _prefer_existing_on_none(item.image, data.get("image"))
                item.owner_name = _prefer_existing_on_none(item.owner_name, data.get("owner_name"))
                item.owner_image = _prefer_existing_on_none(item.owner_image, data.get("owner_image"))
                item.followers = _prefer_existing_on_none(item.followers, data.get("followers"))

                monthly_value = data.get("monthly_listeners")
                if monthly_value is None:
                    monthly_value = data.get("monthly_plays")
                item.monthly_listeners = _prefer_existing_on_none(
                    item.monthly_listeners,
                    monthly_value,
                )

                item.playcount = _prefer_existing_on_none(item.playcount, data.get("playcount"))
                item.track_count = _prefer_existing_on_none(item.track_count, data.get("track_count"))
                item.album_count = _prefer_existing_on_none(item.album_count, data.get("album_count"))
                item.duration_ms = _prefer_existing_on_none(item.duration_ms, data.get("duration_ms"))
                item.release_date = _prefer_existing_on_none(item.release_date, data.get("release_date"))
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
