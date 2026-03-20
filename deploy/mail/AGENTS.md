# Mail Stack Delta Rules

- Stack nay dung `docker-mailserver` sau shared VPS; uu tien helper scripts va `.env` thay vi sua tay trong container.
- Khi can chot DNS cutover, uu tien `mailops dns-records` de lay bo record live thay vi chep tay DKIM tu file.
- Khong bind `80/443` trong mail stack; Caddy o stack goc se giu web endpoint `mail.congmail.top` de cap cert.
- Moi record mail (`A mail`, `MX`, `TXT SPF/DKIM/DMARC`) phai de `DNS only`, khong duoc bat Cloudflare proxy.
- Truoc khi cutover MX, phai xac nhan `PTR/rDNS` cua IP da tro ve `mail.congmail.top`.
- Khi sua TLS mail, uu tien `mailops use-caddy-cert` thay vi mount file cert theo inode co dinh.
