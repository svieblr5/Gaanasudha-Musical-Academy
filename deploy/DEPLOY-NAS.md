# Run the portal on your Synology NAS (always-on, PC can be off)

Running on the NAS means the app is up 24/7 on low power, with a **fixed public
URL** — even when this PC is shut down.

```
Visitor ──https──► ngrok fixed URL ──► NAS container "app" (port 3080)
                                        (music + data on NAS volumes)
```

## Requirements
- A Synology NAS that supports **Container Manager** (DSM 7) — or the older
  **Docker** package (DSM 6). Most x86 (Intel/AMD) Synology models with ≥2 GB RAM
  do. (Low-end ARM models may not — if so, we use the Node.js package instead;
  tell me your model.)
- The NAS powered on and on the network.

## Step 1 — Copy the project to the NAS
1. In **File Station**, create a folder, e.g. `docker/gaanasudha`.
2. Copy the whole project folder into it **except** `node_modules`, `data`
   (those are rebuilt/mounted). Include `Dockerfile`, `docker-compose.yml`,
   `server.js`, `src/`, `public/`, `scripts/`, `package.json`,
   `package-lock.json`.
3. Put your audio into the `music/` subfolder — **or** skip that and point the
   music volume at your existing NAS music share (see Step 3).
4. To keep your current users/library, also copy your existing `data/` folder
   in (optional). If you don't, a fresh admin is created on first run.

## Step 2 — Create the .env
Copy `.env.example` to `.env` in that folder and set:
- `SESSION_SECRET` — a long random string.
- `NGROK_AUTHTOKEN` and `NGROK_DOMAIN` — from Step 4 (leave blank for LAN-only first).

## Step 3 — (Optional) use your real music library
In `docker-compose.yml`, change the music volume line to point at your existing
share, for example:
```yaml
    volumes:
      - /volume1/music:/app/music      # your real music folder (read-only ok)
      - ./data:/app/data
```

## Step 4 — Get a free fixed public URL (ngrok)
1. Sign up free at https://ngrok.com
2. Dashboard → **Your Authtoken** → copy it → put in `.env` as `NGROK_AUTHTOKEN`.
3. Dashboard → **Domains** → create your **free static domain**
   (e.g. `gaanasudha-music.ngrok-free.app`) → put in `.env` as `NGROK_DOMAIN`.

This URL stays the same and works whenever the NAS is on. (No custom domain
needed. When `gaanasudhamusic.com` is registered later, we can switch to it.)

## Step 5 — Build & run
**Container Manager (GUI):** Container Manager → **Project** → **Create** →
select the folder (it finds `docker-compose.yml`) → Build → Run.

**Or via SSH:**
```bash
cd /volume1/docker/gaanasudha
sudo docker compose up -d --build
```

## Step 6 — Use it
- On the LAN: `http://<NAS-IP>:3080`
- Public: `https://<your-domain>.ngrok-free.app`
- Login: `admin` / `admin123` on a fresh install (change it immediately), or your
  existing password if you copied `data/`.

## Managing it
```bash
docker compose ps                 # status
docker compose logs -f app        # app logs
docker compose logs -f tunnel     # tunnel logs (shows the public URL)
docker compose restart            # restart
docker compose down               # stop
docker compose up -d --build      # after code changes
```

## Notes
- **Back up** the `data/` folder (users, playlists, shares, library index, art)
  and your `music/` folder.
- Both containers use `restart: unless-stopped`, so they come back automatically
  after a NAS reboot.
- The Windows service on the PC and this NAS deployment are independent — once
  the NAS version works, you can stop/remove the PC service if you like.
