"""Spotify API client with resilient public-data fallbacks."""

import logging
from datetime import datetime
from typing import Any

import httpx

from app.config import settings
from app.services.auth_manager import get_auth_headers, invalidate_tokens
from app.services.rate_limiter import rate_limit

logger = logging.getLogger(__name__)
SPOTIFY_WEB_API = "https://api.spotify.com/v1"
SPOTIFY_PATHFINDER_API = "https://api-partner.spotify.com/pathfinder/v1/query"
SPOTIFY_OPEN = "https://open.spotify.com"
_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
_PLAYLIST_TRACK_FIELDS = (
    "items(added_at,track(id,name,duration_ms,popularity,preview_url,explicit,track_number,"
    "artists(id,name),album(id,name,release_date,images),external_urls(spotify))),"
    "total,limit,offset,next"
)
_PATHFINDER_QUERY_PLAYLIST_HASH = "2888863ae48f035d0177d73c88f389e7946a95d49a8883a26e86aebd02f2ed24"
_PATHFINDER_QUERY_TRACK_HASH = "cc31bfe16d74df1e9f6f880a908bb3880674deca34c8b67576ecbf8246e967ba"
_PATHFINDER_QUERY_ALBUM_HASH = "ce390dbf7ca6b61a23aec210619e1094fe9d23d7f101ff773ce1146f84d4dd10"
_PATHFINDER_QUERY_ARTIST_HASH = "a55d895740a6ea09d6f34a39ee6a1e8a4c66c6889361710bd01560d1c314f1f4"


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _spotify_uri_to_id(uri: str | None) -> str | None:
    if not uri or not isinstance(uri, str):
        return None
    parts = uri.split(":")
    if len(parts) >= 3:
        return parts[-1]
    return None


def _first_image_from_sources(sources: list[dict[str, Any]] | None) -> str | None:
    if not sources:
        return None
    first = sources[0] or {}
    return first.get("url")


async def _get_json(path: str, params: dict[str, Any] | None = None) -> tuple[int, dict[str, Any] | None]:
    try:
        headers = await get_auth_headers()
    except Exception as ex:
        logger.warning("Auth headers unavailable for %s: %s", path, ex)
        return 0, None

    await rate_limit()
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.get(f"{SPOTIFY_WEB_API}{path}", headers=headers, params=params)

    if res.status_code == 401:
        await invalidate_tokens()
        return 401, None

    if res.status_code in (403, 404):
        return res.status_code, None

    if res.status_code == 429:
        retry_after = res.headers.get("Retry-After")
        logger.warning("Spotify Web API rate-limited for %s (Retry-After=%s)", path, retry_after)
        return 429, None

    if res.status_code != 200:
        logger.warning("Spotify request failed: %s %s", path, res.status_code)
        return res.status_code, None

    try:
        return 200, res.json()
    except Exception as ex:
        logger.warning("Invalid JSON from Spotify for %s: %s", path, ex)
        return 502, None


async def _get_pathfinder_json(payload: dict[str, Any]) -> tuple[int, dict[str, Any] | None]:
    try:
        headers = await get_auth_headers()
    except Exception as ex:
        logger.warning("Auth headers unavailable for Pathfinder request: %s", ex)
        return 0, None

    req_headers = {
        "Authorization": headers.get("Authorization", ""),
        "User-Agent": headers.get("User-Agent", _DEFAULT_UA),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if settings.SPOTIFY_CLIENT_TOKEN:
        req_headers["client-token"] = settings.SPOTIFY_CLIENT_TOKEN

    await rate_limit()
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(SPOTIFY_PATHFINDER_API, headers=req_headers, json=payload)

    if res.status_code == 401:
        await invalidate_tokens()
        return 401, None

    if res.status_code in (403, 404):
        return res.status_code, None

    if res.status_code == 429:
        retry_after = res.headers.get("Retry-After")
        logger.warning("Spotify Pathfinder rate-limited (Retry-After=%s)", retry_after)
        return 429, None

    if res.status_code != 200:
        logger.warning("Spotify Pathfinder request failed: %s", res.status_code)
        return res.status_code, None

    try:
        return 200, res.json()
    except Exception as ex:
        logger.warning("Invalid JSON from Spotify Pathfinder: %s", ex)
        return 502, None


async def _pathfinder_query(
    operation_name: str,
    query_hash: str,
    variables: dict[str, Any],
) -> tuple[int, dict[str, Any] | None]:
    payload = {
        "operationName": operation_name,
        "variables": variables,
        "extensions": {
            "persistedQuery": {
                "version": 1,
                "sha256Hash": query_hash,
            }
        },
    }
    return await _get_pathfinder_json(payload)


async def _fallback_oembed(item_type: str, spotify_id: str) -> dict[str, Any] | None:
    url = f"{SPOTIFY_OPEN}/{item_type}/{spotify_id}"
    headers = {"User-Agent": _DEFAULT_UA, "Accept": "application/json"}
    params = {"url": url}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(f"{SPOTIFY_OPEN}/oembed", params=params, headers=headers)
        if res.status_code != 200:
            return None

        data = res.json()
        return {
            "name": data.get("title"),
            "image": data.get("thumbnail_url"),
            "owner_name": data.get("author_name"),
        }
    except Exception as ex:
        logger.warning("oEmbed fallback failed for %s:%s - %s", item_type, spotify_id, ex)
        return None


def _estimate_track_playcount(popularity: int | None) -> int | None:
    if popularity is None:
        return None
    try:
        return int(popularity) * 10000
    except (TypeError, ValueError):
        return None


def _normalize_playlist_track(item: dict[str, Any]) -> dict[str, Any] | None:
    track = item.get("track") or {}
    if not isinstance(track, dict):
        return None

    track_id = track.get("id")
    if not track_id:
        return None

    album = track.get("album") or {}
    artists = track.get("artists") or []
    images = album.get("images") or []
    popularity = track.get("popularity")
    playcount_estimate = _estimate_track_playcount(popularity)

    return {
        "spotify_id": track_id,
        "name": track.get("name"),
        "artist_names": [a.get("name") for a in artists if a.get("name")],
        "artists": [
            {"spotify_id": a.get("id"), "name": a.get("name")}
            for a in artists
            if a.get("name")
        ],
        "album_name": album.get("name"),
        "album_id": album.get("id"),
        "album_release_date": album.get("release_date"),
        "image": images[0].get("url") if images else None,
        "duration_ms": track.get("duration_ms"),
        "explicit": track.get("explicit"),
        "track_number": track.get("track_number"),
        "preview_url": track.get("preview_url"),
        "spotify_url": (track.get("external_urls") or {}).get("spotify"),
        "popularity": popularity,
        "playcount_estimate": playcount_estimate,
        "added_at": item.get("added_at"),
    }


def _normalize_pathfinder_track(item: dict[str, Any]) -> dict[str, Any] | None:
    wrapper = item.get("itemV2") or {}
    data = wrapper.get("data") or {}
    if not isinstance(data, dict):
        return None

    track_uri = data.get("uri")
    track_id = _spotify_uri_to_id(track_uri)
    if not track_id:
        return None

    album = data.get("albumOfTrack") or {}
    album_uri = album.get("uri")
    album_id = _spotify_uri_to_id(album_uri)
    album_cover_sources = (album.get("coverArt") or {}).get("sources") or []

    artists_items = (data.get("artists") or {}).get("items") or []
    artists: list[dict[str, Any]] = []
    artist_names: list[str] = []
    for artist in artists_items:
        profile = artist.get("profile") or {}
        name = profile.get("name")
        artist_uri = artist.get("uri")
        artist_id = _spotify_uri_to_id(artist_uri)
        if name:
            artist_names.append(name)
            artists.append({"spotify_id": artist_id, "name": name})

    preview_items = (((data.get("previews") or {}).get("audioPreviews") or {}).get("items") or [])
    preview_url = preview_items[0].get("url") if preview_items else None

    duration_ms = _safe_int((data.get("duration") or {}).get("totalMilliseconds"))
    track_number = _safe_int(data.get("trackNumber"))
    playcount = _safe_int(data.get("playcount"))
    content_rating = (data.get("contentRating") or {}).get("label")

    return {
        "spotify_id": track_id,
        "name": data.get("name"),
        "artist_names": artist_names,
        "artists": artists,
        "album_name": album.get("name"),
        "album_id": album_id,
        "album_release_date": None,
        "image": _first_image_from_sources(album_cover_sources),
        "duration_ms": duration_ms,
        "explicit": content_rating == "EXPLICIT",
        "track_number": track_number,
        "preview_url": preview_url,
        "spotify_url": f"https://open.spotify.com/track/{track_id}",
        "popularity": None,
        "playcount_estimate": playcount,
        "added_at": item.get("addedAt"),
    }


async def _fetch_playlist_tracks_paginated(
    playlist_id: str,
    total_tracks_hint: int | None,
) -> tuple[list[dict[str, Any]], int | None, int]:
    page_size = max(1, min(settings.PLAYLIST_PAGE_SIZE, 100))
    max_tracks = max(page_size, settings.PLAYLIST_MAX_TRACKS)

    tracks: list[dict[str, Any]] = []
    total_tracks = total_tracks_hint
    offset = 0
    pages_fetched = 0

    while offset < max_tracks:
        status, payload = await _get_json(
            f"/playlists/{playlist_id}/items",
            params={
                "limit": page_size,
                "offset": offset,
                "fields": _PLAYLIST_TRACK_FIELDS,
            },
        )
        if status != 200 or not payload:
            break

        pages_fetched += 1
        total_tracks = payload.get("total", total_tracks)
        items = payload.get("items") or []
        if not items:
            break

        for raw_item in items:
            normalized = _normalize_playlist_track(raw_item)
            if normalized:
                tracks.append(normalized)
                if len(tracks) >= max_tracks:
                    break

        fetched_count = len(items)
        offset += fetched_count

        if len(tracks) >= max_tracks:
            break
        if total_tracks is not None and offset >= int(total_tracks):
            break
        if fetched_count < page_size:
            break

    return tracks, total_tracks, pages_fetched


async def _fetch_playlist_pathfinder_page(
    playlist_id: str,
    offset: int,
    limit: int,
) -> tuple[int, dict[str, Any] | None]:
    payload = {
        "operationName": "queryPlaylist",
        "variables": {
            "uri": f"spotify:playlist:{playlist_id}",
            "offset": offset,
            "limit": limit,
        },
        "extensions": {
            "persistedQuery": {
                "version": 1,
                "sha256Hash": _PATHFINDER_QUERY_PLAYLIST_HASH,
            }
        },
    }

    status, data = await _get_pathfinder_json(payload)
    if status != 200 or not data:
        return status, None

    playlist = (data.get("data") or {}).get("playlistV2")
    if not isinstance(playlist, dict):
        return 502, None

    typename = playlist.get("__typename")
    if typename == "NotFound":
        return 404, None
    if typename == "GenericError":
        return 403, None
    if typename != "Playlist":
        return 502, None

    return 200, playlist


async def _fetch_playlist_via_pathfinder(playlist_id: str) -> dict[str, Any] | None:
    page_size = max(1, min(settings.PLAYLIST_PAGE_SIZE, 100))
    max_tracks = max(page_size, settings.PLAYLIST_MAX_TRACKS)

    tracks: list[dict[str, Any]] = []
    pages_fetched = 0
    total_tracks: int | None = None

    name: str | None = None
    image: str | None = None
    owner_name: str | None = None
    owner_image: str | None = None
    followers: int | None = None

    offset = 0
    while offset < max_tracks:
        current_offset = offset
        status, playlist = await _fetch_playlist_pathfinder_page(playlist_id, current_offset, page_size)
        if status != 200 or not playlist:
            if pages_fetched == 0:
                return None
            break

        if pages_fetched == 0:
            name = playlist.get("name")
            images_items = (playlist.get("images") or {}).get("items") or []
            image_sources = (images_items[0] or {}).get("sources") if images_items else []
            image = _first_image_from_sources(image_sources)

            owner_data = ((playlist.get("ownerV2") or {}).get("data") or {})
            owner_name = owner_data.get("name") or owner_data.get("username")
            owner_image = _first_image_from_sources((owner_data.get("avatar") or {}).get("sources") or [])
            followers = _safe_int(playlist.get("followers"))

        content = playlist.get("content") or {}
        total_tracks = _safe_int(content.get("totalCount")) or total_tracks
        items = content.get("items") or []
        if not items:
            break

        for raw_item in items:
            normalized = _normalize_pathfinder_track(raw_item)
            if normalized:
                tracks.append(normalized)
                if len(tracks) >= max_tracks:
                    break

        pages_fetched += 1

        if len(tracks) >= max_tracks:
            break
        if total_tracks is not None and len(tracks) >= total_tracks:
            break

        next_offset = _safe_int((content.get("pagingInfo") or {}).get("nextOffset"))
        if next_offset is None or next_offset <= current_offset:
            break

        offset = next_offset

    if pages_fetched == 0:
        return None

    expected = total_tracks if total_tracks is not None else len(tracks)
    play_values = [t.get("playcount_estimate") for t in tracks if t.get("playcount_estimate") is not None]
    total_plays = sum(play_values) if play_values else None

    return {
        "name": name,
        "image": image,
        "owner_name": owner_name,
        "owner_image": owner_image,
        "followers": followers,
        "track_count": expected,
        "tracks": tracks,
        "tracks_crawled": len(tracks),
        "tracks_expected": expected,
        "deep_crawl_pages": pages_fetched,
        "deep_crawl_complete": bool(expected == 0 or len(tracks) >= expected),
        "total_plays": total_plays,
        "playcount": total_plays,
        "crawl_mode": "deep_pathfinder",
    }


async def query_artist(artist_id: str) -> dict[str, Any] | None:
    """Query artist data from Spotify Web API, fallback to oEmbed."""
    pathfinder = await _fetch_artist_via_pathfinder(artist_id)
    if pathfinder is not None:
        return pathfinder

    status, data = await _get_json(f"/artists/{artist_id}")
    if status == 200 and data:
        images = data.get("images") or []
        followers = (data.get("followers") or {}).get("total")
        return {
            "name": data.get("name"),
            "image": images[0]["url"] if images else None,
            "followers": followers,
            "monthly_listeners": None,
            "owner_name": data.get("name"),
        }

    fallback = await _fallback_oembed("artist", artist_id)
    if fallback:
        fallback["monthly_listeners"] = None
        return fallback

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Artist not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Artist forbidden"}
    return None


async def get_track(track_id: str) -> dict[str, Any] | None:
    """Get track data from Spotify Web API, fallback to oEmbed."""
    pathfinder = await _fetch_track_via_pathfinder(track_id)

    status, data = await _get_json(f"/tracks/{track_id}")
    if status == 200 and data:
        album = data.get("album") or {}
        images = album.get("images") or []
        artists = data.get("artists") or []
        primary_artist = artists[0]["name"] if artists else None

        popularity = data.get("popularity")
        pseudo_playcount = _estimate_track_playcount(popularity)

        webapi_result = {
            "name": data.get("name"),
            "image": images[0]["url"] if images else None,
            "owner_name": primary_artist,
            "duration_ms": data.get("duration_ms"),
            "release_date": album.get("release_date"),
            "playcount": pseudo_playcount,
            "monthly_plays": pseudo_playcount,
            "monthly_listeners": pseudo_playcount,
            "crawl_mode": "webapi_track",
        }

        if pathfinder is not None:
            merged = dict(pathfinder)
            for key, value in webapi_result.items():
                if merged.get(key) in (None, "") and value is not None:
                    merged[key] = value
            if pathfinder.get("playcount") is None and webapi_result.get("playcount") is not None:
                merged["playcount"] = webapi_result["playcount"]
                merged["monthly_plays"] = webapi_result["playcount"]
                merged["monthly_listeners"] = webapi_result["playcount"]
                merged["crawl_mode"] = "pathfinder_track+webapi"
            return merged

        return webapi_result

    if pathfinder is not None:
        return pathfinder

    fallback = await _fallback_oembed("track", track_id)
    if fallback:
        fallback["crawl_mode"] = "oembed"
        return fallback

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Track not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Track forbidden"}
    return None


async def fetch_playlist(playlist_id: str) -> dict[str, Any] | None:
    """Fetch playlist metadata and deep-crawl all tracks (Pathfinder first)."""
    # 1) Preferred flow: Pathfinder pagination with playcount-rich track payload.
    pathfinder_result = await _fetch_playlist_via_pathfinder(playlist_id)
    if pathfinder_result:
        return pathfinder_result

    # 2) Fallback to Spotify Web API v1.
    status, data = await _get_json(
        f"/playlists/{playlist_id}",
        params={"fields": "name,images,owner(display_name),followers(total),tracks(total),items(total)"},
    )
    if status == 200 and data:
        images = data.get("images") or []
        owner = data.get("owner") or {}
        followers = (data.get("followers") or {}).get("total")
        tracks_meta = data.get("tracks") or {}
        items_meta = data.get("items") or {}
        total_tracks_hint = items_meta.get("total")
        if total_tracks_hint is None:
            total_tracks_hint = tracks_meta.get("total")

        result: dict[str, Any] = {
            "name": data.get("name"),
            "image": images[0]["url"] if images else None,
            "owner_name": owner.get("display_name"),
            "followers": followers,
            "track_count": total_tracks_hint,
        }

        if total_tracks_hint == 0:
            result.update(
                {
                    "tracks": [],
                    "tracks_crawled": 0,
                    "tracks_expected": 0,
                    "deep_crawl_complete": True,
                    "total_plays": 0,
                    "playcount": 0,
                    "crawl_mode": "deep_webapi",
                }
            )
            return result

        playlist_tracks, total_tracks, pages_fetched = await _fetch_playlist_tracks_paginated(
            playlist_id, total_tracks_hint
        )

        if playlist_tracks:
            total_plays = sum(t.get("playcount_estimate") or 0 for t in playlist_tracks)
            expected = total_tracks if total_tracks is not None else len(playlist_tracks)
            deep_complete = len(playlist_tracks) >= expected
            result.update(
                {
                    "track_count": expected,
                    "tracks": playlist_tracks,
                    "tracks_crawled": len(playlist_tracks),
                    "tracks_expected": expected,
                    "deep_crawl_pages": pages_fetched,
                    "deep_crawl_complete": deep_complete,
                    "total_plays": total_plays,
                    "playcount": total_plays,
                    "crawl_mode": "deep_webapi",
                }
            )
            return result

        result.update(
            {
                "tracks": [],
                "tracks_crawled": 0,
                "tracks_expected": total_tracks_hint,
                "deep_crawl_pages": pages_fetched,
                "deep_crawl_complete": False,
                "total_plays": None,
                "playcount": None,
                "crawl_mode": "metadata_only",
            }
        )
        return result

    # 3) Lowest fallback: oEmbed metadata only.
    fallback = await _fallback_oembed("playlist", playlist_id)
    if fallback:
        fallback.update(
            {
                "tracks": [],
                "tracks_crawled": 0,
                "tracks_expected": None,
                "deep_crawl_complete": False,
                "total_plays": None,
                "playcount": None,
                "crawl_mode": "oembed",
            }
        )
        return fallback

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Playlist not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Playlist forbidden"}
    return None


async def fetch_album(album_id: str) -> dict[str, Any] | None:
    """Fetch album metadata from Spotify Web API, fallback to oEmbed."""
    pathfinder = await _fetch_album_via_pathfinder(album_id)
    if pathfinder is not None:
        return pathfinder

    status, data = await _get_json(f"/albums/{album_id}")
    if status == 200 and data:
        images = data.get("images") or []
        artists = data.get("artists") or []
        return {
            "name": data.get("name"),
            "image": images[0]["url"] if images else None,
            "owner_name": artists[0]["name"] if artists else None,
            "track_count": data.get("total_tracks"),
            "release_date": data.get("release_date"),
        }

    fallback = await _fallback_oembed("album", album_id)
    if fallback:
        return fallback

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Album not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Album forbidden"}
    return None



def _pathfinder_date_to_iso(date_obj: dict[str, Any] | None) -> str | None:
    if not date_obj:
        return None
    iso = date_obj.get("isoString")
    if isinstance(iso, str) and iso:
        return iso[:10]
    year = _safe_int(date_obj.get("year"))
    month = _safe_int(date_obj.get("month"))
    day = _safe_int(date_obj.get("day"))
    if year and month and day:
        return f"{year:04d}-{month:02d}-{day:02d}"
    if year and month:
        return f"{year:04d}-{month:02d}"
    if year:
        return f"{year:04d}"
    return None


def _estimate_months_since_release(release_date: str | None) -> int:
    if not release_date:
        return 12

    formats = ["%Y-%m-%d", "%Y-%m", "%Y"]
    parsed = None
    for fmt in formats:
        try:
            parsed = datetime.strptime(release_date, fmt)
            break
        except ValueError:
            continue

    if parsed is None:
        return 12

    now = datetime.utcnow()
    months = (now.year - parsed.year) * 12 + (now.month - parsed.month)
    if months < 1:
        return 1
    return min(months, 120)


def _estimate_track_playcount_from_artist_monthly(
    monthly_listeners: int | None,
    release_date: str | None,
    track_count_divisor: int = 1,
) -> tuple[int | None, int | None]:
    if monthly_listeners is None or monthly_listeners <= 0:
        return None, None

    divisor = max(1, track_count_divisor)
    months_alive = _estimate_months_since_release(release_date)

    # Heuristic: 15% monthly listeners for single-track focus; divide by track count for album context.
    monthly_est = int((monthly_listeners * 0.15) / divisor)
    monthly_est = max(1000, monthly_est)

    lifespan_factor = max(1, min(36, months_alive))
    playcount_est = int(monthly_est * lifespan_factor)
    return playcount_est, monthly_est


def _pathfinder_extract_artists(artists_container: Any) -> tuple[list[dict[str, Any]], list[str]]:
    if isinstance(artists_container, dict):
        raw_items = artists_container.get("items") or []
    elif isinstance(artists_container, list):
        raw_items = artists_container
    else:
        raw_items = []

    artists: list[dict[str, Any]] = []
    names: list[str] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        profile = raw.get("profile") or {}
        name = profile.get("name") or raw.get("name")
        artist_uri = raw.get("uri")
        artist_id = raw.get("id") or _spotify_uri_to_id(artist_uri)
        if name:
            names.append(name)
            artists.append({"spotify_id": artist_id, "name": name})

    return artists, names


def _pathfinder_extract_preview_url(previews_container: Any) -> str | None:
    items = (((previews_container or {}).get("audioPreviews") or {}).get("items") or [])
    if items:
        first = items[0] or {}
        return first.get("url")
    return None


def _extract_top_track_playcounts_from_discography(discography: dict[str, Any] | None) -> dict[str, int]:
    if not isinstance(discography, dict):
        return {}

    result: dict[str, int] = {}
    top_items = ((discography.get("topTracks") or {}).get("items") or [])
    for row in top_items:
        track = row.get("track") or {}
        track_id = track.get("id") or _spotify_uri_to_id(track.get("uri"))
        playcount = _safe_int(track.get("playcount"))
        if track_id and playcount is not None:
            result[track_id] = playcount
    return result


async def _fetch_artist_top_tracks_playcount_map(artist_id: str) -> dict[str, int]:
    status, payload = await _pathfinder_query(
        operation_name="queryArtist",
        query_hash=_PATHFINDER_QUERY_ARTIST_HASH,
        variables={"uri": f"spotify:artist:{artist_id}"},
    )
    if status != 200 or not payload:
        return {}

    artist_union = (payload.get("data") or {}).get("artistUnion")
    if not isinstance(artist_union, dict):
        return {}
    if artist_union.get("__typename") != "Artist":
        return {}

    discography = artist_union.get("discography") or {}
    return _extract_top_track_playcounts_from_discography(discography)


async def _fetch_track_via_pathfinder(track_id: str) -> dict[str, Any] | None:
    status, payload = await _pathfinder_query(
        operation_name="queryTrack",
        query_hash=_PATHFINDER_QUERY_TRACK_HASH,
        variables={"uri": f"spotify:track:{track_id}"},
    )
    if status != 200 or not payload:
        return None

    track_union = (payload.get("data") or {}).get("trackUnion")
    if not isinstance(track_union, dict):
        return None

    typename = track_union.get("__typename")
    if typename == "NotFound":
        return {"error": True, "error_code": 404, "error_message": "Track not found"}
    if typename != "Track":
        return None

    album = track_union.get("albumOfTrack") or {}
    album_cover_sources = (album.get("coverArt") or {}).get("sources") or []
    release_date = _pathfinder_date_to_iso(album.get("date"))

    first_artist_items = ((track_union.get("firstArtist") or {}).get("items") or [])
    primary_artist = first_artist_items[0] if first_artist_items else {}
    owner_name = ((primary_artist.get("profile") or {}).get("name"))
    owner_image = _first_image_from_sources(
        ((primary_artist.get("visuals") or {}).get("avatarImage") or {}).get("sources") or []
    )

    duration_ms = _safe_int((track_union.get("duration") or {}).get("totalMilliseconds"))
    track_uri = track_union.get("uri")
    track_entity_id = track_union.get("id") or _spotify_uri_to_id(track_uri)
    playcount = _safe_int(track_union.get("playcount"))

    if playcount is None and track_entity_id:
        embedded_map = _extract_top_track_playcounts_from_discography(
            primary_artist.get("discography") or {}
        )
        playcount = embedded_map.get(track_entity_id)

    primary_artist_monthly = _safe_int((primary_artist.get("stats") or {}).get("monthlyListeners"))

    if playcount is None and track_entity_id:
        primary_artist_id = primary_artist.get("id") or _spotify_uri_to_id(primary_artist.get("uri"))
        if primary_artist_id:
            top_map = await _fetch_artist_top_tracks_playcount_map(primary_artist_id)
            playcount = top_map.get(track_entity_id)

    monthly_est = None
    if playcount is None:
        playcount, monthly_est = _estimate_track_playcount_from_artist_monthly(
            primary_artist_monthly,
            release_date,
            track_count_divisor=1,
        )

    if monthly_est is None and playcount is not None:
        months_alive = max(1, _estimate_months_since_release(release_date))
        monthly_est = int(playcount / months_alive)

    source = "pathfinder_track"
    if playcount is not None and _safe_int(track_union.get("playcount")) is None:
        source = "pathfinder_track_enriched"

    return {
        "name": track_union.get("name"),
        "image": _first_image_from_sources(album_cover_sources),
        "owner_name": owner_name,
        "owner_image": owner_image,
        "duration_ms": duration_ms,
        "release_date": release_date,
        "playcount": playcount,
        "monthly_plays": monthly_est,
        "monthly_listeners": monthly_est,
        "playcount_estimated": _safe_int(track_union.get("playcount")) is None and playcount is not None,
        "crawl_mode": source,
    }


async def _fetch_artist_via_pathfinder(artist_id: str) -> dict[str, Any] | None:
    status, payload = await _pathfinder_query(
        operation_name="queryArtist",
        query_hash=_PATHFINDER_QUERY_ARTIST_HASH,
        variables={"uri": f"spotify:artist:{artist_id}"},
    )
    if status != 200 or not payload:
        return None

    artist_union = (payload.get("data") or {}).get("artistUnion")
    if not isinstance(artist_union, dict):
        return None

    typename = artist_union.get("__typename")
    if typename == "NotFound":
        return {"error": True, "error_code": 404, "error_message": "Artist not found"}
    if typename != "Artist":
        return None

    profile = artist_union.get("profile") or {}
    visuals = artist_union.get("visuals") or {}
    stats = artist_union.get("stats") or {}

    albums_items = (((artist_union.get("discography") or {}).get("albums") or {}).get("items") or [])
    album_count = 0
    for bucket in albums_items:
        releases = ((bucket.get("releases") or {}).get("items") or [])
        album_count += len(releases)

    avatar_sources = ((visuals.get("avatarImage") or {}).get("sources") or [])
    avatar = _first_image_from_sources(avatar_sources)

    return {
        "name": profile.get("name"),
        "image": avatar,
        "owner_name": profile.get("name"),
        "owner_image": avatar,
        "followers": _safe_int(stats.get("followers")),
        "monthly_listeners": _safe_int(stats.get("monthlyListeners")),
        "album_count": album_count or None,
        "crawl_mode": "pathfinder_artist",
    }



def _normalize_pathfinder_album_track(track_data: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(track_data, dict):
        return None

    track_id = track_data.get("id") or _spotify_uri_to_id(track_data.get("uri"))
    if not track_id:
        return None

    artists, artist_names = _pathfinder_extract_artists(track_data.get("artists"))
    preview_url = _pathfinder_extract_preview_url(track_data.get("previews"))
    duration_ms = _safe_int((track_data.get("duration") or {}).get("totalMilliseconds"))
    track_number = _safe_int(track_data.get("trackNumber"))
    playcount = _safe_int(track_data.get("playcount"))
    content_rating = (track_data.get("contentRating") or {}).get("label")

    return {
        "spotify_id": track_id,
        "name": track_data.get("name"),
        "artist_names": artist_names,
        "artists": artists,
        "duration_ms": duration_ms,
        "explicit": content_rating == "EXPLICIT",
        "track_number": track_number,
        "preview_url": preview_url,
        "spotify_url": f"https://open.spotify.com/track/{track_id}",
        "playcount_estimate": playcount,
    }


async def _fetch_album_via_pathfinder(album_id: str) -> dict[str, Any] | None:
    page_size = max(1, min(settings.PLAYLIST_PAGE_SIZE, 100))
    max_tracks = max(page_size, settings.PLAYLIST_MAX_TRACKS)

    tracks: list[dict[str, Any]] = []
    pages_fetched = 0
    total_tracks: int | None = None

    name: str | None = None
    image: str | None = None
    owner_name: str | None = None
    owner_image: str | None = None
    release_date: str | None = None
    owner_monthly_listeners: int | None = None

    offset = 0
    artist_top_cache: dict[str, dict[str, int]] = {}
    while offset < max_tracks:
        current_offset = offset
        status, payload = await _pathfinder_query(
            operation_name="queryAlbum",
            query_hash=_PATHFINDER_QUERY_ALBUM_HASH,
            variables={
                "uri": f"spotify:album:{album_id}",
                "offset": current_offset,
                "limit": page_size,
            },
        )
        if status != 200 or not payload:
            if pages_fetched == 0:
                return None
            break

        album_union = (payload.get("data") or {}).get("albumUnion")
        if not isinstance(album_union, dict):
            if pages_fetched == 0:
                return None
            break

        typename = album_union.get("__typename")
        if typename == "NotFound":
            return {"error": True, "error_code": 404, "error_message": "Album not found"}
        if typename != "Album":
            if pages_fetched == 0:
                return None
            break

        if pages_fetched == 0:
            name = album_union.get("name")
            image = _first_image_from_sources((album_union.get("coverArt") or {}).get("sources") or [])
            release_date = _pathfinder_date_to_iso(album_union.get("date"))
            artist_items = ((album_union.get("artists") or {}).get("items") or [])
            main_artist = artist_items[0] if artist_items else {}
            owner_name = ((main_artist.get("profile") or {}).get("name"))
            owner_image = _first_image_from_sources(
                ((main_artist.get("visuals") or {}).get("avatarImage") or {}).get("sources") or []
            )
            owner_monthly_listeners = _safe_int((main_artist.get("stats") or {}).get("monthlyListeners"))

        tracks_v2 = album_union.get("tracksV2") or {}
        total_tracks = _safe_int(tracks_v2.get("totalCount")) or total_tracks
        rows = tracks_v2.get("items") or []

        for row in rows:
            track_data = row.get("track") or {}
            normalized = _normalize_pathfinder_album_track(track_data)
            if normalized:
                normalized["album_name"] = name
                normalized["album_id"] = album_id
                normalized["album_release_date"] = release_date
                normalized["image"] = normalized.get("image") or image

                if normalized.get("playcount_estimate") is None:
                    artists_list = normalized.get("artists") or []
                    primary_artist_ref = artists_list[0] if artists_list else {}
                    primary_artist_id = primary_artist_ref.get("spotify_id")
                    track_ref_id = normalized.get("spotify_id")
                    if primary_artist_id and track_ref_id:
                        if primary_artist_id not in artist_top_cache:
                            artist_top_cache[primary_artist_id] = await _fetch_artist_top_tracks_playcount_map(primary_artist_id)
                        normalized["playcount_estimate"] = artist_top_cache[primary_artist_id].get(track_ref_id)

                if normalized.get("playcount_estimate") is None:
                    expected_tracks = _safe_int(total_tracks) or max(1, len(rows))
                    estimated_playcount, _ = _estimate_track_playcount_from_artist_monthly(
                        owner_monthly_listeners,
                        release_date,
                        track_count_divisor=expected_tracks,
                    )
                    normalized["playcount_estimate"] = estimated_playcount
                    normalized["playcount_estimated"] = estimated_playcount is not None

                tracks.append(normalized)
                if len(tracks) >= max_tracks:
                    break

        pages_fetched += 1

        if len(tracks) >= max_tracks:
            break
        if total_tracks is not None and len(tracks) >= total_tracks:
            break

        next_offset = _safe_int((tracks_v2.get("pagingInfo") or {}).get("nextOffset"))
        if next_offset is None or next_offset <= current_offset:
            break
        offset = next_offset

    if pages_fetched == 0:
        return None

    expected = total_tracks if total_tracks is not None else len(tracks)
    play_values = [t.get("playcount_estimate") for t in tracks if t.get("playcount_estimate") is not None]
    total_plays = sum(play_values) if play_values else None

    return {
        "name": name,
        "image": image,
        "owner_name": owner_name,
        "owner_image": owner_image,
        "track_count": expected,
        "release_date": release_date,
        "tracks": tracks,
        "tracks_crawled": len(tracks),
        "tracks_expected": expected,
        "deep_crawl_pages": pages_fetched,
        "deep_crawl_complete": bool(expected == 0 or len(tracks) >= expected),
        "total_plays": total_plays,
        "playcount": total_plays,
        "crawl_mode": "pathfinder_album",
    }
