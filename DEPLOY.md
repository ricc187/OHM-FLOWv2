# Deploy

## HTTPS / domain (Caddy)

Caddy terminates HTTPS and auto-provisions a Let's Encrypt certificate for
the domain configured in `Caddyfile`. Before deploying on the VPS:

1. Point the domain's DNS A (and AAAA, if using IPv6) record to the VPS's
   public IP.
2. Edit `Caddyfile` and replace `your-domain.example` with the real domain:
   ```
   yourrealdomain.com {
   	reverse_proxy web:5000
   }
   ```
   Caddy needs no separate cert/key config — it requests and renews the
   Let's Encrypt certificate automatically as long as ports 80/443 are
   reachable from the internet and the domain resolves to this VPS.
3. Make sure ports 80 and 443 are open on the VPS firewall.
4. `cloudflared` has been removed — Caddy is now the only public entrypoint.
   `web` and `backup` are no longer reachable from outside the host, only
   over the internal Docker network.

## `docker-compose.override.yml`

This file exposes `web` directly on `5000:5000` for local development.
**Do not use it on the VPS** — it would re-expose `web` publicly alongside
Caddy, bypassing HTTPS entirely. Either:
- don't copy it to the VPS, or
- run compose there with an explicit file list that excludes it:
  ```
  docker compose -f docker-compose.yml up -d
  ```

## Volta sync queue worker

`process_volta_sync_queue` runs automatically — no system cron, no external
scheduler needed. It's an internal daemon thread started inside the Flask
process at boot (`_start_volta_sync_cron`, `backend/app.py`), ticking every
5 minutes. Set `OHM_DISABLE_VOLTA_CRON=1` to disable it (used by the test
suite only — don't set this on the VPS).

Since gunicorn runs `-w 4` (4 separate processes, each with its own thread),
an atomic DB-level guard (`VoltaSyncRun` row, conditional `UPDATE`) makes
only one of them actually run a given cycle — no manual coordination
needed, this is already handled.

Manual trigger (for testing / forcing a run): `POST /api/volta-sync/run`,
admin session required. Not meant to be relied on in production — the
internal cron above is the real mechanism.

## Certificates persistence

Caddy stores its certificates/state in the `caddy_data` named volume, so
they survive container restarts and redeploys — no re-issuance (and no
Let's Encrypt rate-limit risk) as long as that volume isn't removed
(`docker compose down -v` would delete it).
