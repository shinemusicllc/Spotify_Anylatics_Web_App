# SpotiCheck Decisions Index

Canonical detail lives in `docs/DECISIONS.md`. This file lists active decisions worth checking first.

| Area | Active decision | Detail source |
| --- | --- | --- |
| UI source | Preserve Shine dashboard layout and do targeted changes only. | `docs/DECISIONS.md` |
| User scope | Admin filtering must inspect one real account scope at a time, not silently aggregate all users. | `docs/DECISIONS.md` |
| Link ownership | Deduplicate Spotify links per user, not globally. | `docs/DECISIONS.md` |
| Group labels | Admin group labels should stay clean visually while ownership remains enforced internally. | `docs/DECISIONS.md` |
| VPS deploy | Docker Compose + Caddy + PostgreSQL is the production path. | `docs/DECISIONS.md` |
| Performance | Large list views must prefer set-based backend queries and incremental frontend rendering. | `docs/CHANGELOG.md` |
