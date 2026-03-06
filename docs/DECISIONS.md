# SpotiCheck Analytics — Decisions Log

| Decision                          | Reason                                                                    | Impact                                     | Date       |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | ---------- |
| Chọn FastAPI + Playwright + httpx | Combo phổ biến nhất cho scraping Spotify internal API                     | High — quyết định toàn bộ stack            | 2026-03-06 |
| Không dùng Redis ở MVP            | Giữ đơn giản, dùng asyncio BackgroundTasks thay thế                       | Medium — dễ thêm sau                       | 2026-03-06 |
| Phương án A (Hybrid auth)         | 2-layer token: Playwright cold → httpx hot, proactive refresh             | High — giảm RAM, tăng tốc                  | 2026-03-06 |
| Giữ nguyên layout UI              | User yêu cầu không thay đổi layout, chỉ bổ sung tính năng                 | Medium — ít rework                         | 2026-03-06 |
| Tách final3.html thành 3 file     | Cần tách concerns (HTML/CSS/JS) để maintain và kết nối API                | Medium                                     | 2026-03-06 |
| Dynamic column labels theo type   | Monthly Listeners cho Artist, Playcount cho Track, Followers cho Playlist | Medium — UX rõ ràng hơn                    | 2026-03-06 |
| Đổi "Owner" → "Artist / Owner"    | Track/Album owner thực chất là artist, cần label phản ánh đúng            | Low                                        | 2026-03-06 |
| Click row mở popup window         | User muốn check nhanh trên Spotify mà vẫn thấy list, không mở tab mới     | Medium — cần window.open() với size params | 2026-03-06 |
