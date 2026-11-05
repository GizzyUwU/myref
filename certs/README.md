# TLS certificates

`cert.pem` / `key.pem` are a self-signed placeholder valid only for
`localhost` / `127.0.0.1` / `::1`, so that `docker compose up` serves HTTPS
out of the box for local use. Browsers will show a trust warning for them.

Production: replace these files with a real certificate and key (same file
names), keeping this directory mounted read-only at `/certs`.

Reverse-proxy alternative: terminate TLS at the proxy (Caddy, nginx,
Traefik, …) instead. In that case these files are not needed: remove the
`TLS_*` lines and the `./certs` mount from the backend service in
`docker-compose.yml` and set `TRUST_PROXY=true`. The proxy must:

- listen on 443 (and redirect port 80 to HTTPS),
- forward to `http://backend:3000` (plain HTTP over the internal network),
- send `X-Forwarded-Proto: https` and `X-Forwarded-For`,
- and `APP_ORIGIN` must be set to the public `https://` origin so CORS and
  the `Secure` session cookies work.
