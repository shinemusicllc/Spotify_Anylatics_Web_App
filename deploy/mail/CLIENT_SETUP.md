# Mail Client Quick Setup

Use these settings for mailboxes on `congmail.top`.

## Incoming mail (IMAP)

- Server: `mail.congmail.top`
- Port: `993`
- Security: `SSL/TLS`
- Username: full email address, for example `contact@congmail.top`
- Password: mailbox password

## Outgoing mail (SMTP)

- Server: `mail.congmail.top`
- Port: `465`
- Security: `SSL/TLS`
- Authentication: required
- Username: full email address
- Password: mailbox password

Alternative SMTP:

- Port: `587`
- Security: `STARTTLS`

## Existing bootstrap mailboxes

- `contact@congmail.top`
- `postmaster@congmail.top`

Aliases:

- `admin@congmail.top` -> `contact@congmail.top`
- `dmarc@congmail.top` -> `contact@congmail.top`

## VPS commands

```bash
ssh deploy@82.197.71.6
cd /opt/spoticheck/app/deploy/mail

mailops status
mailops dns-records
mailops list-accounts
mailops list-aliases
mailops update-account contact@congmail.top
mailops update-account postmaster@congmail.top
```
