# Deployment

The demo runs at <https://demo.vu.place> on the team VPS (netcup), behind a password.

```text
browser ── HTTPS ──> Caddy on the host ── 127.0.0.1:3001 ──> container "app" ──> SQLite in volume "data"
                     TLS, password,                          Node: /api, /health
                     compression                             and the built frontend
```

- **Image.** [`Dockerfile`](../Dockerfile) in the repository root. The backend serves the built
  frontend itself, so there is one container and one port; the Vite dev server (5173) is for local
  development only.
- **Build.** [`docker.yml`](../.github/workflows/docker.yml) builds the image on every pull request
  and publishes it on merge to `main` as `ghcr.io/vu-mif-tldr/mifplace:main` and
  `:sha-<commit>`. The server only pulls images, it never builds them.
- **Database.** The SQLite file lives in the named volume `data`. The container creates it on the
  first start and applies pending migrations on every start.
- **Caddy** runs on the host as a system service, the same one that serves `vu.place`.

Files in this directory: [`compose.yaml`](compose.yaml) (the app container),
[`Caddyfile`](Caddyfile) (security headers and the site block for Caddy).

## First setup

Needs SSH access to the server with `sudo`.

1. **DNS.** At Spaceship: Domain Manager → `vu.place` → Advanced DNS, add `CNAME`, host `demo`,
   value `vu.place`. Check: `dig +short demo.vu.place` prints the server address.

2. **Firewall.** Only SSH, HTTP and HTTPS are open:

   ```sh
   sudo ufw allow OpenSSH
   sudo ufw allow 80,443/tcp
   sudo ufw allow 443/udp   # HTTP/3, browsers fall back to HTTP/2 without it
   sudo ufw enable
   ```

   Docker writes its own iptables rules and bypasses ufw: a port published as `3001:3000` would be
   open to the internet. That is why `compose.yaml` publishes it on `127.0.0.1` only.

3. **Docker.** Install Docker Engine with the Compose plugin following
   <https://docs.docker.com/engine/install/> (the page for the server's distribution).
   Check: `docker compose version`.

4. **The app.**

   ```sh
   sudo mkdir -p /srv/mifplace-demo && cd /srv/mifplace-demo
   sudo curl -fsSLo compose.yaml https://raw.githubusercontent.com/vu-mif-tldr/mifplace/main/deploy/compose.yaml
   sudo docker compose up -d
   curl -s http://127.0.0.1:3001/health   # {"status":"ok",...}
   ```

   If the pull fails with `denied` or `unauthorized`, the package is private: make it public in
   GitHub → organization `vu-mif-tldr` → Packages → `mifplace` → Package settings → Change
   visibility. The repository is public, so there is nothing secret in the image.

5. **Caddy.** Make a password hash, then edit `/etc/caddy/Caddyfile` following
   [`Caddyfile`](Caddyfile): the `(security)` snippet at the top, `import security` as the first
   line of the existing `vu.place` block, and the `demo.vu.place` block with the hash instead of
   the placeholder:

   ```sh
   caddy hash-password             # asks for the password, prints the hash
   sudo nano /etc/caddy/Caddyfile
   caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

   Share the password with the team outside the repository.

6. **Check.** <https://demo.vu.place> asks for the password and shows the canvas. If the page does
   not open, `sudo journalctl -u caddy -n 50` shows whether the certificate was issued.

## Update

After a merge to `main` and a green "Docker image" run:

```sh
cd /srv/mifplace-demo
sudo docker compose pull
sudo docker compose up -d
```

The old container is stopped before the new one starts, so the demo is down for a few seconds.
Never run two containers on the same database file.

## Rollback

Every image is also tagged with its commit: `sha-` and the first 7 characters of the hash
(GitHub → repository → Packages → `mifplace` lists them). Pin the version in `.env` next to
`compose.yaml`, so that a later `up -d` keeps it:

```sh
cd /srv/mifplace-demo
echo MIFPLACE_TAG=sha-1a2b3c4 | sudo tee .env
sudo docker compose up -d
```

Back to the latest `main`: delete `.env`, then `pull` and `up -d`.

Migrations only go forward. If the newer version has already applied a migration, the older image
refuses to start with "Database schema version N is newer than the code supports": restore a
backup made before the update, or reset the database (below).

## Operations

```sh
cd /srv/mifplace-demo
sudo docker compose ps          # state and health
sudo docker compose logs -f     # app logs (rotated, at most 30 MB)
sudo docker compose down -v     # stop and DELETE the database: an empty canvas on the next up -d
```

Backups are not set up yet (MP-73).
