# Deployment

The demo runs at <https://demo.vu.place> on the team VPS (netcup), behind a password.
Before launch <https://vu.place> is a static landing page with the waitlist form; only
`/api/waitlist*` goes to a separate production container (see [Waitlist on vu.place](#waitlist-on-vuplace)).

```text
browser ── HTTPS ──> Caddy on the host ── 127.0.0.1:3001 ──> container "app" ──> SQLite in volume "data"
                     TLS, password,                          Node: /api, /health
                     compression                             and the built frontend
```

- **Image.** [`Dockerfile`](../Dockerfile) in the repository root. The backend serves the built
  frontend itself, so there is one container and one port; the Vite dev server (5173) is for local
  development only.
- **Build.** [`docker.yml`](../.github/workflows/docker.yml) publishes the image on every merge to
  `main` as `ghcr.io/vu-mif-tldr/mifplace:main` and `:sha-<commit>`. Pull requests only build it, and
  only when they change the Dockerfile or the dependencies. A rebuild by hand: Actions → "Docker
  image" → Run workflow on `main`. The server only pulls images, it never builds them.
- **Database.** The SQLite file lives in the named volume `data`. The container creates it on the
  first start and applies pending migrations on every start.
- **Caddy** runs on the host as a system service, the same one that serves `vu.place`.

Files in this directory: [`compose.yaml`](compose.yaml) (the demo container),
[`compose.prod.yaml`](compose.prod.yaml) (the production container, waitlist only for now),
[`Caddyfile`](Caddyfile) (security headers and the site blocks for Caddy),
[`landing/`](landing/) (the static pages of vu.place).

## First setup

Needs SSH access to the server with `sudo`.

1. **DNS.** The domain is registered at Spaceship, its DNS is on Cloudflare (Free plan). In
   Cloudflare: `vu.place` → DNS → Records, add `CNAME`, name `demo`, target `vu.place`, proxy
   status **DNS only** (grey cloud). Caddy gets the certificates itself, and behind the Cloudflare
   proxy the app would see Cloudflare addresses instead of the users' ones.
   Check: `dig +short demo.vu.place` prints the server address.

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

## Waitlist on vu.place

```text
browser ── HTTPS ──> Caddy ── /api/waitlist* ── 127.0.0.1:3002 ──> container "mifplace-prod" ──> SMTP (SendPulse)
                       └──── everything else ──> /var/www/vu.place (landing/)
```

The production app runs the same image as the demo with its own database. Caddy forwards only the
waitlist API to it: the app has no sign-in yet, so `/api/pixels` must not be reachable. At launch
the `vu.place` block becomes a full `reverse_proxy` and the waitlist is already in the right
database.

1. **Mail sender (do this first, DNS takes time).** SendPulse → SMTP → Settings: add the sender
   domain `vu.place` and the sender address (e.g. `noreply@vu.place`). Add the SPF and DKIM records
   SendPulse shows in Cloudflare → DNS, and a DMARC record: `TXT`, name `_dmarc`,
   `v=DMARC1; p=none`. Wait until SendPulse shows the domain as verified. Take the SMTP login and
   password from the same page. The free plan sends at most 50 emails per hour; the app stops at 40.
   Use port **2525** (STARTTLS): outgoing connections to 25, 465 and 587 are dropped outside the
   VPS, most likely by netcup (ufw allows all outgoing traffic, nftables has no rules for these
   ports), with any mail provider. Check from the server: `timeout 6 bash -c '</dev/tcp/smtp-pulse.com/2525' && echo open`.

2. **The app.**

   ```sh
   sudo mkdir -p /srv/mifplace-prod && cd /srv/mifplace-prod
   sudo curl -fsSLo compose.yaml https://raw.githubusercontent.com/vu-mif-tldr/mifplace/main/deploy/compose.prod.yaml
   sudo nano app.env               # SMTP_* and MAIL_FROM, see the comment in compose.yaml
   sudo chmod 600 app.env
   sudo docker compose up -d
   sudo docker compose logs | grep Waitlist   # "Waitlist: on, email links point to https://vu.place"
   ```

3. **Landing pages.** From a checkout of the repository:

   ```sh
   rsync -av --delete deploy/landing/ <user>@vu.place:/tmp/landing/
   ssh <user>@vu.place 'sudo rsync -a --delete /tmp/landing/ /var/www/vu.place/'
   ```

4. **Caddy.** Replace the `vu.place` block in `/etc/caddy/Caddyfile` with the one from
   [`Caddyfile`](Caddyfile) (it adds `import security` and the waitlist route; the server already
   has the `www.vu.place` redirect), then `caddy validate` and `sudo systemctl reload caddy` (as in First setup).

5. **Check.** Sign up on <https://vu.place> with your VU address: the email arrives in Inbox, not
   Junk, the confirm button answers "Done!", the unsubscribe link removes the address.
   `curl -si -X POST https://vu.place/api/pixels` must not reach the app (Caddy answers, not Express).
   Signups from two networks show two different addresses in
   `sudo docker compose logs | grep "Waitlist signup"`; one address for all means `TRUST_PROXY` is wrong.

**Reading the list** (read-only, safe while the app runs). How many:

```sh
cd /srv/mifplace-prod
sudo docker compose exec app node -e "
  const db = require('better-sqlite3')('/data/mifplace.db', { readonly: true });
  console.log(db.prepare('SELECT count(*) AS all_, count(confirmed_at) AS confirmed FROM waitlist').get());"
```

Who, with the times in UTC (`null` in `confirmed` is still pending):

```sh
cd /srv/mifplace-prod
sudo docker compose exec app node -e "
  const db = require('better-sqlite3')('/data/mifplace.db', { readonly: true });
  const sql = \"SELECT email, datetime(created_at/1000,'unixepoch') AS signed_up, \" +
    \"datetime(confirmed_at/1000,'unixepoch') AS confirmed FROM waitlist ORDER BY id\";
  console.table(db.prepare(sql).all());"
```

The list is personal data: export it only to send the launch email, and drop the table one month
after launch, as the landing page promises.
