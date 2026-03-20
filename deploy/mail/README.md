# Self-Hosted Mail Stack

This folder contains the VPS mail stack for `congmail.top`.

Current design:

- `docker-mailserver` handles SMTP/Submission/IMAP on the VPS.
- The shared Caddy stack keeps `80/443` and provisions the certificate for `mail.congmail.top`.
- Mail initially boots with a local self-signed certificate.
- After DNS `A mail.congmail.top -> 82.197.71.6` is live and Caddy has issued a cert, run `mailops use-caddy-cert` to copy the Caddy fullchain into `docker-data/dms/custom-certs/` and switch SMTP/IMAP to the real Let's Encrypt certificate.

Important prerequisites:

1. `mail.congmail.top` must point to `82.197.71.6` as `DNS only`.
2. `PTR/rDNS` for `82.197.71.6` should be changed at the VPS provider to `mail.congmail.top`.
3. Ensure public DNS no longer points `mail.congmail.top` to an old server IP before switching TLS from self-signed to the Caddy certificate.

Recommended DNS after cutover:

- `mail` `A` -> `82.197.71.6` (`DNS only`)
- `@` `MX` -> `mail.congmail.top`
- `@` `TXT` -> `v=spf1 mx a -all`
- `_dmarc` `TXT` -> `v=DMARC1; p=none; rua=mailto:dmarc@congmail.top; pct=100`
- `mail._domainkey` `TXT` -> value returned by `mailops dkim-show`

You can print the exact record set from the live VPS with:

```bash
mailops dns-records
```

Day-to-day commands:

```bash
cd /opt/spoticheck/app/deploy/mail
mailops up
mailops status
mailops logs
mailops dns-records
mailops add-account contact@congmail.top
mailops update-account contact@congmail.top
mailops delete-account old-user@example.com
mailops list-accounts
mailops add-alias dmarc@congmail.top contact@congmail.top
mailops delete-alias old-alias@example.com target@example.com
mailops list-aliases
mailops dkim-generate
mailops dkim-show
mailops use-caddy-cert
```

Mail client quick setup lives in:

```text
deploy/mail/CLIENT_SETUP.md
```
