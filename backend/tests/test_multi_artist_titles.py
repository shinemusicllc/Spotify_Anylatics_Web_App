from types import SimpleNamespace

from app.api import items as items_api
from app.models.item import Item


def _album_item(spotify_id: str, name: str, owner_name: str = ""):
    return SimpleNamespace(
        item_type="album",
        spotify_id=spotify_id,
        name=name,
        owner_name=owner_name,
        playcount=None,
    )


def test_build_export_track_title_replaces_stale_single_artist_prefix():
    result = items_api._build_export_track_title(
        "Jazzy Coffee, Cozy Coffee Shop, Relaxing Jazz Piano",
        "Jazzy Coffee - Standing in This Dream",
    )
    assert result == "Jazzy Coffee, Cozy Coffee Shop, Relaxing Jazz Piano - Standing in This Dream"


def test_build_item_display_title_uses_all_album_artists():
    item = _album_item("album-1", "Jazzy Coffee - Jazz Apartment", owner_name="Jazzy Coffee")

    result = items_api._build_item_display_title(
        item,
        {"artist_names": ["Jazzy Coffee", "Cozy Coffee Shop", "Relaxing Jazz Piano"]},
    )

    assert result == "Jazzy Coffee, Cozy Coffee Shop, Relaxing Jazz Piano - Jazz Apartment"


def test_build_track_offline_rows_uses_full_artist_list():
    track = Item(
        spotify_id="track-1",
        item_type="track",
        name="Jazzy Coffee - Standing in This Dream",
        owner_name="Jazzy Coffee",
        playcount=5534385,
        monthly_listeners=489885,
    )
    raw_map = {
        "track-1": {
            "artist_names": ["Jazzy Coffee", "Cozy Coffee Shop", "Relaxing Jazz Piano"],
        }
    }

    headers, rows, _ = items_api._build_track_offline_rows([track], raw_map)

    assert headers == []
    assert rows == [[
        "Jazzy Coffee, Cozy Coffee Shop, Relaxing Jazz Piano - Standing in This Dream",
        "https://open.spotify.com/track/track-1",
        "5534385",
        "489885",
    ]]


def test_build_album_type0_rows_uses_full_album_artist_list():
    album = _album_item("album-2", "Jazzy Coffee - Jazz Apartment", owner_name="Jazzy Coffee")
    raw_map = {
        "album-2": {
            "artist_names": ["Jazzy Coffee", "Cozy Coffee Shop", "Relaxing Jazz Piano"],
            "tracks": [
                {
                    "name": "Jazzy Coffee - Perfect Night",
                    "spotify_id": "track-1",
                    "playcount_estimate": 11,
                    "artist_names": ["Jazzy Coffee", "Cozy Coffee Shop", "Relaxing Jazz Piano"],
                },
            ],
        }
    }

    headers, rows, _ = items_api._build_album_type0_rows([album], raw_map)

    assert headers == []
    assert rows == [[
        "Jazzy Coffee, Cozy Coffee Shop, Relaxing Jazz Piano - Jazz Apartment",
        "1",
        "Jazzy Coffee, Cozy Coffee Shop, Relaxing Jazz Piano - Perfect Night",
        "https://open.spotify.com/track/track-1",
        "11",
    ]]
