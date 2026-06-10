"""Spotify API client with resilient public-data fallbacks."""

import asyncio
import logging
from typing import Any

import httpx

from app.config import settings
from app.services.auth_manager import get_auth_headers, invalidate_tokens
from app.services.rate_limiter import rate_limit

logger = logging.getLogger(__name__)
SPOTIFY_WEB_API = "https://api.spotify.com/v1"
SPOTIFY_PATHFINDER_API = "https://api-partner.spotify.com/pathfinder/v1/query"
SPOTIFY_PATHFINDER_V2_API = "https://api-partner.spotify.com/pathfinder/v2/query"
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
_PATHFINDER_QUERY_PLAYLIST_HASH = "346811f856fb0b7e4f6c59f8ebea78dd081c6e2fb01b77c954b26259d5fc6763"
_PATHFINDER_QUERY_TRACK_HASH = "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294"
_PATHFINDER_QUERY_ALBUM_HASH = "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10"
_PATHFINDER_QUERY_ARTIST_HASH = "5b9e64f43843fa3a9b6a98543600299b0a2cbbbccfdcdcef2402eb9c1017ca4c"


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
    async with httpx.AsyncClient(timeout=settings.SPOTIFY_HTTP_TIMEOUT_SECONDS) as client:
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


async def _get_pathfinder_json(
    payload: dict[str, Any],
    endpoint: str = SPOTIFY_PATHFINDER_API,
) -> tuple[int, dict[str, Any] | None]:
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
    async with httpx.AsyncClient(timeout=settings.SPOTIFY_HTTP_TIMEOUT_SECONDS) as client:
        res = await client.post(endpoint, headers=req_headers, json=payload)

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
    endpoint: str = SPOTIFY_PATHFINDER_API,
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
    return await _get_pathfinder_json(payload, endpoint=endpoint)


async def _fallback_oembed(item_type: str, spotify_id: str) -> dict[str, Any] | None:
    url = f"{SPOTIFY_OPEN}/{item_type}/{spotify_id}"
    headers = {"User-Agent": _DEFAULT_UA, "Accept": "application/json"}
    params = {"url": url}
    try:
        async with httpx.AsyncClient(timeout=settings.SPOTIFY_HTTP_TIMEOUT_SECONDS) as client:
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
        # Web API track item does not provide exact playcount.
        "playcount_estimate": None,
        "added_at": item.get("added_at"),
    }


def _normalize_pathfinder_track(item: dict[str, Any]) -> dict[str, Any] | None:
    wrapper = item.get("itemV2") or {}
    data = wrapper.get("data") if isinstance(wrapper, dict) and wrapper else item
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

    duration_source = data.get("trackDuration") or data.get("duration") or {}
    duration_ms = _safe_int((duration_source or {}).get("totalMilliseconds"))
    track_number = _safe_int(data.get("trackNumber"))
    playcount = _safe_int(data.get("playcount"))
    content_rating = (data.get("contentRating") or {}).get("label")

    added_at = item.get("addedAt")
    if isinstance(added_at, dict):
        added_at = added_at.get("isoString")

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
        "added_at": added_at,
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
    status, data = await _pathfinder_query(
        operation_name="fetchPlaylist",
        query_hash=_PATHFINDER_QUERY_PLAYLIST_HASH,
        variables={
            "uri": f"spotify:playlist:{playlist_id}",
            "offset": offset,
            "limit": limit,
            "enableWatchFeedEntrypoint": False,
        },
        endpoint=SPOTIFY_PATHFINDER_V2_API,
    )
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
    owner_url: str | None = None
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
            owner_uri = owner_data.get("uri")
            owner_id = _spotify_uri_to_id(owner_uri)
            owner_url = f"https://open.spotify.com/user/{owner_id}" if owner_id else None
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
    deep_complete = bool(expected == 0 or len(tracks) >= expected)
    play_values = [t.get("playcount_estimate") for t in tracks if t.get("playcount_estimate") is not None]
    total_plays = sum(play_values) if deep_complete and len(play_values) >= expected else None

    return {
        "name": name,
        "image": image,
        "owner_name": owner_name,
        "owner_image": owner_image,
        "owner_url": owner_url,
        "followers": followers,
        "track_count": expected,
        "tracks": tracks,
        "tracks_crawled": len(tracks),
        "tracks_expected": expected,
        "tracks_with_playcount": len(play_values),
        "deep_crawl_pages": pages_fetched,
        "deep_crawl_complete": deep_complete,
        "total_plays": total_plays,
        "playcount": total_plays,
        "crawl_mode": "pathfinder_playlist",
    }


async def query_artist(artist_id: str) -> dict[str, Any] | None:
    """Query artist data from Spotify APIs with non-browser fallbacks only."""
    pathfinder = await _fetch_artist_via_pathfinder(artist_id)
    if pathfinder is not None:
        return pathfinder

    status, data = await _get_json(f"/artists/{artist_id}")
    if status == 200 and data:
        images = data.get("images") or []
        followers = (data.get("followers") or {}).get("total")
        result = {
            "name": data.get("name"),
            "image": images[0]["url"] if images else None,
            "followers": followers,
            "monthly_listeners": None,
            "owner_name": data.get("name"),
            "owner_url": f"https://open.spotify.com/artist/{artist_id}",
            "playcount": None,
            "total_plays": None,
            "crawl_mode": "webapi_artist",
        }
        return result

    fallback = await _fallback_oembed("artist", artist_id)
    if fallback:
        fallback["monthly_listeners"] = None
        fallback["playcount"] = None
        fallback["total_plays"] = None
        fallback["crawl_mode"] = "oembed"
        return fallback

    if status == 404:
        return {"error": True, "error_code": 404, "error_message": "Artist not found"}
    if status == 403:
        return {"error": True, "error_code": 403, "error_message": "Artist forbidden"}
    return None


async def get_track(track_id: str) -> dict[str, Any] | None:
    """Get track data from Spotify APIs with non-browser fallbacks only."""
    pathfinder = await _fetch_track_via_pathfinder(track_id)
    if pathfinder is not None:
        return pathfinder

    status, data = await _get_json(f"/tracks/{track_id}")
    if status == 200 and data:
        album = data.get("album") or {}
        images = album.get("images") or []
        artists = data.get("artists") or []
        primary_artist = artists[0]["name"] if artists else None

        webapi_result = {
            "name": data.get("name"),
            "artist_names": [artist.get("name") for artist in artists if artist.get("name")],
            "artists": [
                {"spotify_id": artist.get("id"), "name": artist.get("name")}
                for artist in artists
                if artist.get("name")
            ],
            "image": images[0]["url"] if images else None,
            "owner_name": primary_artist,
            "owner_url": f"https://open.spotify.com/artist/{artists[0]['id']}" if artists and artists[0].get("id") else None,
            "duration_ms": data.get("duration_ms"),
            "release_date": album.get("release_date"),
            "playcount": None,
            "monthly_plays": None,
            "monthly_listeners": None,
            "crawl_mode": "webapi_track",
        }
        return webapi_result

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
            expected = total_tracks if total_tracks is not None else len(playlist_tracks)
            deep_complete = len(playlist_tracks) >= expected
            exact_track_plays = [
                t.get("playcount_estimate")
                for t in playlist_tracks
                if t.get("playcount_estimate") is not None
            ]
            total_plays = sum(exact_track_plays) if deep_complete and len(exact_track_plays) >= expected else None
            result.update(
                {
                    "track_count": expected,
                    "tracks": playlist_tracks,
                    "tracks_crawled": len(playlist_tracks),
                    "tracks_expected": expected,
                    "tracks_with_playcount": len(exact_track_plays),
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
    """Fetch album metadata from Spotify APIs with non-browser fallbacks only."""
    pathfinder = await _fetch_album_via_pathfinder(album_id)
    if pathfinder is not None:
        return pathfinder

    status, data = await _get_json(f"/albums/{album_id}")
    if status == 200 and data:
        images = data.get("images") or []
        artists = data.get("artists") or []
        result = {
            "name": data.get("name"),
            "image": images[0]["url"] if images else None,
            "owner_name": artists[0]["name"] if artists else None,
            "owner_url": f"https://open.spotify.com/artist/{artists[0]['id']}" if artists and artists[0].get("id") else None,
            "track_count": data.get("total_tracks"),
            "release_date": data.get("release_date"),
            "playcount": None,
            "total_plays": None,
            "crawl_mode": "webapi_album",
        }
        return result

    fallback = await _fallback_oembed("album", album_id)
    if fallback:
        fallback["crawl_mode"] = "oembed"
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


async def _fetch_track_via_pathfinder(track_id: str) -> dict[str, Any] | None:
    status, payload = await _pathfinder_query(
        operation_name="getTrack",
        query_hash=_PATHFINDER_QUERY_TRACK_HASH,
        variables={"uri": f"spotify:track:{track_id}"},
        endpoint=SPOTIFY_PATHFINDER_V2_API,
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
    artists, artist_names = _pathfinder_extract_artists(track_union.get("artists"))

    first_artist_items = ((track_union.get("firstArtist") or {}).get("items") or [])
    primary_artist = first_artist_items[0] if first_artist_items else {}
    owner_name = ((primary_artist.get("profile") or {}).get("name"))
    owner_artist_id = _spotify_uri_to_id(primary_artist.get("uri"))
    owner_image = _first_image_from_sources(
        ((primary_artist.get("visuals") or {}).get("avatarImage") or {}).get("sources") or []
    )

    duration_ms = _safe_int((track_union.get("duration") or {}).get("totalMilliseconds"))
    playcount = _safe_int(track_union.get("playcount"))

    source = "pathfinder_track"

    return {
        "name": track_union.get("name"),
        "artist_names": artist_names or ([owner_name] if owner_name else []),
        "artists": artists or (
            [{"spotify_id": owner_artist_id, "name": owner_name}]
            if owner_artist_id or owner_name
            else []
        ),
        "image": _first_image_from_sources(album_cover_sources),
        "owner_name": owner_name,
        "owner_image": owner_image,
        "owner_url": f"https://open.spotify.com/artist/{owner_artist_id}" if owner_artist_id else None,
        "duration_ms": duration_ms,
        "release_date": release_date,
        "playcount": playcount,
        "monthly_plays": None,
        "monthly_listeners": None,
        "playcount_estimated": False,
        "crawl_mode": source,
    }


async def _fetch_artist_via_pathfinder(artist_id: str) -> dict[str, Any] | None:
    status, payload = await _pathfinder_query(
        operation_name="queryArtistOverview",
        query_hash=_PATHFINDER_QUERY_ARTIST_HASH,
        variables={
            "uri": f"spotify:artist:{artist_id}",
            "locale": "",
            "includePrerelease": True,
        },
        endpoint=SPOTIFY_PATHFINDER_V2_API,
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
        "owner_url": f"https://open.spotify.com/artist/{artist_id}",
        "followers": _safe_int(stats.get("followers")),
        "monthly_listeners": _safe_int(stats.get("monthlyListeners")),
        "playcount": None,
        "total_plays": None,
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


async def _hydrate_album_track_playcounts_via_pathfinder(tracks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], bool]:
    if not isinstance(tracks, list) or not tracks:
        return tracks, False

    missing_ids: list[str] = []
    for track in tracks:
        if not isinstance(track, dict):
            continue
        if track.get("playcount_estimate") is not None:
            continue
        track_id = track.get("spotify_id")
        if isinstance(track_id, str) and track_id.strip():
            missing_ids.append(track_id.strip())

    if not missing_ids:
        return tracks, False

    semaphore = asyncio.Semaphore(12)

    async def fetch_one(track_id: str) -> tuple[str, dict[str, Any] | None]:
        async with semaphore:
            data = await _fetch_track_via_pathfinder(track_id)
            return track_id, data if isinstance(data, dict) and not data.get("error") else None

    fetched = await asyncio.gather(*(fetch_one(track_id) for track_id in missing_ids), return_exceptions=True)
    track_map: dict[str, dict[str, Any]] = {}
    for row in fetched:
        if isinstance(row, Exception):
            continue
        track_id, payload = row
        if payload:
            track_map[track_id] = payload

    hydrated = False
    for track in tracks:
        if not isinstance(track, dict):
            continue
        track_id = track.get("spotify_id")
        if not isinstance(track_id, str):
            continue
        payload = track_map.get(track_id)
        if not payload:
            continue
        if track.get("playcount_estimate") is None and payload.get("playcount") is not None:
            track["playcount_estimate"] = payload.get("playcount")
            hydrated = True
        if not track.get("artist_names") and payload.get("artist_names"):
            track["artist_names"] = payload.get("artist_names")
        if not track.get("artists") and payload.get("artists"):
            track["artists"] = payload.get("artists")
        if not track.get("spotify_url") and track_id:
            track["spotify_url"] = f"https://open.spotify.com/track/{track_id}"

    return tracks, hydrated


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
    owner_url: str | None = None
    release_date: str | None = None

    offset = 0
    while offset < max_tracks:
        current_offset = offset
        status, payload = await _pathfinder_query(
            operation_name="getAlbum",
            query_hash=_PATHFINDER_QUERY_ALBUM_HASH,
            variables={
                "uri": f"spotify:album:{album_id}",
                "locale": "",
                "offset": current_offset,
                "limit": page_size,
            },
            endpoint=SPOTIFY_PATHFINDER_V2_API,
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
            owner_artist_id = _spotify_uri_to_id(main_artist.get("uri"))
            owner_url = f"https://open.spotify.com/artist/{owner_artist_id}" if owner_artist_id else None
            owner_image = _first_image_from_sources(
                ((main_artist.get("visuals") or {}).get("avatarImage") or {}).get("sources") or []
            )

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

                tracks.append(normalized)
                if len(tracks) >= max_tracks:
                    break

        pages_fetched += 1

        if len(tracks) >= max_tracks:
            break
        if total_tracks is not None and len(tracks) >= total_tracks:
            break

        next_offset = _safe_int((tracks_v2.get("pagingInfo") or {}).get("nextOffset"))
        if next_offset is None and rows:
            next_offset = current_offset + len(rows)
        if next_offset is None or next_offset <= current_offset:
            break
        offset = next_offset

    if pages_fetched == 0:
        return None

    tracks, hydrated_track_playcounts = await _hydrate_album_track_playcounts_via_pathfinder(tracks)
    album_artists, album_artist_names = _pathfinder_extract_artists((album_union.get("artists") or {}))
    expected = total_tracks if total_tracks is not None else len(tracks)
    deep_complete = bool(expected == 0 or len(tracks) >= expected)
    play_values = [t.get("playcount_estimate") for t in tracks if t.get("playcount_estimate") is not None]
    total_plays = sum(play_values) if deep_complete and len(play_values) >= expected else None

    return {
        "name": name,
        "image": image,
        "owner_name": owner_name,
        "owner_image": owner_image,
        "owner_url": owner_url,
        "artist_names": album_artist_names,
        "artists": album_artists,
        "track_count": expected,
        "release_date": release_date,
        "tracks": tracks,
        "tracks_crawled": len(tracks),
        "tracks_expected": expected,
        "tracks_with_playcount": len(play_values),
        "deep_crawl_pages": pages_fetched,
        "deep_crawl_complete": deep_complete,
        "total_plays": total_plays,
        "playcount": total_plays,
        "crawl_mode": "pathfinder_album+pathfinder_track" if hydrated_track_playcounts else "pathfinder_album",
    }
