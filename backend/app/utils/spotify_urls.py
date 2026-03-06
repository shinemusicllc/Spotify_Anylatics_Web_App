"""Spotify URL/URI parser utility."""

import re

# Supported patterns
_URI_PATTERN = re.compile(r"^spotify:(playlist|track|album|artist):([a-zA-Z0-9]+)")
_URL_PATTERN = re.compile(
    r"open\.spotify\.com/(playlist|track|album|artist)/([a-zA-Z0-9]+)"
)


def parse_spotify_url(input_str: str) -> tuple[str, str] | None:
    """
    Parse a Spotify URL or URI.

    Args:
        input_str: Spotify URL or URI string.

    Returns:
        Tuple of (item_type, spotify_id) or None if invalid.

    Examples:
        >>> parse_spotify_url("https://open.spotify.com/playlist/37i9dQZF1DX...")
        ("playlist", "37i9dQZF1DX")
        >>> parse_spotify_url("spotify:track:6rqhFg...")
        ("track", "6rqhFg")
    """
    input_str = input_str.strip()

    # Try URI format first
    match = _URI_PATTERN.match(input_str)
    if match:
        return match.group(1), match.group(2)

    # Try URL format
    match = _URL_PATTERN.search(input_str)
    if match:
        return match.group(1), match.group(2)

    return None


def build_spotify_url(item_type: str, spotify_id: str) -> str:
    """Build a Spotify URL from type and ID."""
    return f"https://open.spotify.com/{item_type}/{spotify_id}"


def build_spotify_uri(item_type: str, spotify_id: str) -> str:
    """Build a Spotify URI from type and ID."""
    return f"spotify:{item_type}:{spotify_id}"
