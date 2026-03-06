"""Authentication helper for Spotify Web API."""

import asyncio
import base64
import hashlib
import hmac
import logging
import struct
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_OPEN_SPOTIFY_TOKEN_URL = "https://open.spotify.com/api/token"
_OPEN_SPOTIFY_SERVER_TIME_URL = "https://open.spotify.com/api/server-time"
_OPEN_SPOTIFY_LEGACY_TOKEN_URL = (
    "https://open.spotify.com/get_access_token?reason=transport&productType=web_player"
)
_SPOTIFY_ACCOUNTS_TOKEN_URL = "https://accounts.spotify.com/api/token"
_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Extracted from current open.spotify web-player bundle (versioned secrets).
# Keep multiple versions for rollover safety.
_TOTP_SECRET_CANDIDATES: tuple[tuple[int, str], ...] = (
    (61, ',7/*F("rLJ2oxaKL^f+E1xvP@N'),
    (60, 'OmE{ZA.J^":0FG\\Uz?[@WW'),
    (59, '{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH'),
)

_token_cache: dict[str, object | None] = {
    "authorization": None,
    "expires_at": None,
    "user_agent": _DEFAULT_UA,
}
_lock = asyncio.Lock()


async def get_auth_headers() -> dict[str, str]:
    """Return Authorization headers for Spotify Web API."""
    async with _lock:
        if _is_expired():
            await _refresh_access_token()

    token = _token_cache["authorization"]
    if not token:
        raise RuntimeError("Spotify access token unavailable")

    return {
        "Authorization": f"Bearer {token}",
        "User-Agent": str(_token_cache.get("user_agent") or _DEFAULT_UA),
        "Accept": "application/json",
    }


def _is_expired() -> bool:
    token = _token_cache.get("authorization")
    expires_at = _token_cache.get("expires_at")
    if not token:
        return True
    if isinstance(expires_at, datetime):
        return datetime.now(timezone.utc) >= expires_at
    return False


async def _refresh_access_token() -> None:
    """Refresh token using client credentials first, then open.spotify token flows."""
    # 1) Optional: official client-credentials flow if env vars are provided.
    client_id = getattr(settings, "SPOTIFY_CLIENT_ID", "") or ""
    client_secret = getattr(settings, "SPOTIFY_CLIENT_SECRET", "") or ""
    if client_id and client_secret:
        token = await _fetch_client_credentials_token(client_id, client_secret)
        if token:
            logger.info("Using Spotify client-credentials token")
            return

    # 2) Fallback: anonymous web-player token endpoint(s).
    token = await _fetch_open_spotify_token()
    if token:
        logger.info("Using open.spotify anonymous token")
        return

    raise RuntimeError("Failed to acquire Spotify access token")


async def _fetch_client_credentials_token(client_id: str, client_secret: str) -> bool:
    auth_raw = f"{client_id}:{client_secret}".encode("utf-8")
    basic = base64.b64encode(auth_raw).decode("ascii")
    headers = {
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": _DEFAULT_UA,
    }
    data = "grant_type=client_credentials"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(_SPOTIFY_ACCOUNTS_TOKEN_URL, headers=headers, content=data)
        if res.status_code != 200:
            logger.warning("Client-credentials token failed: %s", res.status_code)
            return False

        payload = res.json()
        access_token = payload.get("access_token")
        expires_in = payload.get("expires_in", 3600)
        if not access_token:
            return False

        _token_cache["authorization"] = access_token
        _token_cache["expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in) - 30)
        _token_cache["user_agent"] = _DEFAULT_UA
        return True
    except Exception as ex:
        logger.warning("Client-credentials token error: %s", ex)
        return False


def _decode_totp_secret(secret_obfuscated: str) -> bytes:
    numbers = [ord(ch) ^ ((idx % 33) + 9) for idx, ch in enumerate(secret_obfuscated)]
    return "".join(str(n) for n in numbers).encode("utf-8")


def _generate_totp(secret_bytes: bytes, timestamp_seconds: float) -> str:
    counter = int(timestamp_seconds // 30)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(secret_bytes, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (
        ((digest[offset] & 0x7F) << 24)
        | ((digest[offset + 1] & 0xFF) << 16)
        | ((digest[offset + 2] & 0xFF) << 8)
        | (digest[offset + 3] & 0xFF)
    )
    return f"{code % 1000000:06d}"


async def _fetch_server_time_seconds() -> int | None:
    headers = {"User-Agent": _DEFAULT_UA, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(_OPEN_SPOTIFY_SERVER_TIME_URL, headers=headers)
        if res.status_code != 200:
            return None
        payload = res.json()
        server_time = payload.get("serverTime")
        if isinstance(server_time, (int, float)):
            return int(server_time)
    except Exception as ex:
        logger.warning("open.spotify server-time error: %s", ex)
    return None


async def _try_open_spotify_totp_token() -> bool:
    headers = {"User-Agent": _DEFAULT_UA, "Accept": "application/json"}
    now_seconds = time.time()
    server_time = await _fetch_server_time_seconds()

    async with httpx.AsyncClient(timeout=15) as client:
        for version, obf_secret in _TOTP_SECRET_CANDIDATES:
            secret_bytes = _decode_totp_secret(obf_secret)
            params = {
                "reason": "init",
                "productType": "web_player",
                "totp": _generate_totp(secret_bytes, now_seconds),
                "totpVer": str(version),
                "totpServer": (
                    _generate_totp(secret_bytes, server_time)
                    if server_time is not None
                    else "unavailable"
                ),
            }
            try:
                res = await client.get(_OPEN_SPOTIFY_TOKEN_URL, params=params, headers=headers)
            except Exception as ex:
                logger.warning("open.spotify /api/token request error: %s", ex)
                continue

            if res.status_code != 200:
                logger.info("open.spotify /api/token failed ver=%s status=%s", version, res.status_code)
                continue

            payload = res.json()
            access_token = payload.get("accessToken")
            expires_ms = payload.get("accessTokenExpirationTimestampMs")
            if not access_token:
                continue

            if expires_ms:
                expires_at = datetime.fromtimestamp(int(expires_ms) / 1000, tz=timezone.utc) - timedelta(seconds=30)
            else:
                expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)

            _token_cache["authorization"] = access_token
            _token_cache["expires_at"] = expires_at
            _token_cache["user_agent"] = _DEFAULT_UA
            return True

    return False


async def _fetch_open_spotify_token() -> bool:
    # Preferred: current endpoint requiring TOTP parameters.
    try:
        if await _try_open_spotify_totp_token():
            return True
    except Exception as ex:
        logger.warning("open.spotify totp token flow error: %s", ex)

    # Legacy fallback kept for compatibility.
    headers = {"User-Agent": _DEFAULT_UA, "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(_OPEN_SPOTIFY_LEGACY_TOKEN_URL, headers=headers)
        if res.status_code != 200:
            logger.warning("open.spotify legacy token endpoint failed: %s", res.status_code)
            return False

        payload = res.json()
        access_token = payload.get("accessToken")
        expires_ms = payload.get("accessTokenExpirationTimestampMs")
        if not access_token:
            return False

        if expires_ms:
            expires_at = datetime.fromtimestamp(int(expires_ms) / 1000, tz=timezone.utc) - timedelta(seconds=30)
        else:
            expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)

        _token_cache["authorization"] = access_token
        _token_cache["expires_at"] = expires_at
        _token_cache["user_agent"] = _DEFAULT_UA
        return True
    except Exception as ex:
        logger.warning("open.spotify legacy token error: %s", ex)
        return False


async def invalidate_tokens() -> None:
    """Force token refresh on next request."""
    async with _lock:
        _token_cache["authorization"] = None
        _token_cache["expires_at"] = None
