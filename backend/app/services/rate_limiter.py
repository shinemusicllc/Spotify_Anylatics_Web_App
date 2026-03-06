"""
Rate Limiter — configurable delay between requests.

Simple token bucket implementation for MVP.
"""

import asyncio
import time

from app.config import settings

_last_request_time = 0.0
_lock = asyncio.Lock()


async def rate_limit():
    """Wait if needed to respect rate limit. Thread-safe via asyncio.Lock."""
    global _last_request_time
    delay = settings.CRAWL_DELAY_SECONDS

    async with _lock:
        now = time.monotonic()
        elapsed = now - _last_request_time
        if elapsed < delay:
            await asyncio.sleep(delay - elapsed)
        _last_request_time = time.monotonic()
