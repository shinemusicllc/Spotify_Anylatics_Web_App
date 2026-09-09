import asyncio

from app.services import spotify_client


def test_pathfinder_playlist_paginates_without_next_offset(monkeypatch):
    async def run():
        page_calls = []

        async def fake_page(playlist_id, offset, limit):
            page_calls.append((playlist_id, offset, limit))
            total = 250
            size = min(limit, total - offset)
            items = [{"id": f"track-{offset + index}"} for index in range(size)]
            return 200, {
                "name": "Paged playlist",
                "images": {"items": []},
                "ownerV2": {"data": {}},
                "followers": 10,
                "content": {
                    "totalCount": total,
                    "items": items,
                    "pagingInfo": {"offset": offset, "limit": limit},
                },
            }

        monkeypatch.setattr(spotify_client, "_fetch_playlist_pathfinder_page", fake_page)
        monkeypatch.setattr(
            spotify_client,
            "_normalize_pathfinder_track",
            lambda item: item,
        )

        result = await spotify_client._fetch_playlist_via_pathfinder("playlist123")

        assert len(result["tracks"]) == 250
        assert result["tracks_expected"] == 250
        assert result["tracks_crawled"] == 250
        assert result["deep_crawl_pages"] == 3
        assert result["deep_crawl_complete"] is True
        assert page_calls == [
            ("playlist123", 0, 100),
            ("playlist123", 100, 100),
            ("playlist123", 200, 100),
        ]

    asyncio.run(run())
