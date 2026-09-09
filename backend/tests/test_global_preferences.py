from app.api import auth as auth_api


def test_playlist_clipboard_line_limit_defaults_and_clamps():
    assert auth_api._normalize_playlist_clipboard_line_limit(None) == 100
    assert auth_api._normalize_playlist_clipboard_line_limit("50") == 50
    assert auth_api._normalize_playlist_clipboard_line_limit(0) == 1
    assert auth_api._normalize_playlist_clipboard_line_limit(2500) == 2000
    assert auth_api._normalize_playlist_clipboard_line_limit(True) == 100
