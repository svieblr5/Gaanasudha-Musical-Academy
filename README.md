# Gaanasudha Musical Academy — Music Library Portal

A self-hosted web application for storing, streaming, and sharing the academy's
music library. Built to run on a single Windows PC (or any machine with Node.js)
with no external database or build step.

## Features

- **Streaming player** — browse, search, and play songs in the browser with
  album art, seeking, shuffle, repeat, and playlists (Amazon Music–style).
  Supports lock-screen / hardware media keys (Media Session API) and keyboard
  shortcuts (Space = play/pause, ←/→ = seek, Shift+←/→ = prev/next track).
- **Browse by Album & Artist** — cover-art grids that drill into track lists,
  built to scale to a large library.
- **Favorites, Recently Played & Most Played** — per-user likes and listening
  history, plus academy-wide play counts.
- **Per-song download** — grab any track as a file.
- **Public share links** — generate a link for any song or playlist and send it
  via WhatsApp or email. Recipients listen in their browser, no account needed.
  Links support optional passwords and expiry dates.
- **Accounts & roles** — administrators manage the library and user accounts;
  regular users browse, play, build playlists, and create share links.
- **Admin tools** — upload audio from the browser, or drop 10,000+ files into
  the `music` folder and rescan. Metadata and album art are read from tags.
- **Local & private** — all data stays on your machine. Nothing is uploaded to
  a third-party cloud.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (tested on Node 24).

## Setup

```bash
npm install      # install dependencies (already done if node_modules exists)
npm start        # start the server
```

Then open **http://localhost:3000** in a browser.

On first launch a default administrator account (`admin`) is created. Its
password is taken from the `ADMIN_PASSWORD` environment variable if set;
otherwise a strong random password is generated and **printed once to the
console at startup** — copy it from there to log in.

**Log in and change this password immediately** (My Account → Change password).

## Run automatically at boot (Windows service)

To keep the portal running in the background and start it every time the PC boots
(no console window, auto-restarts if it crashes), install it as a Windows service.

Open an **Administrator** PowerShell in this folder and run:

```powershell
npm run service:install
```

This registers a service named **"Gaanasudha Music Portal"** (start type *Automatic*,
running as *LocalSystem*). Manage it any time from `services.msc`, or:

```powershell
Get-Service 'gaanasudhamusicportal.exe'          # check status
Restart-Service 'gaanasudhamusicportal.exe'      # restart
npm run service:uninstall                         # remove (music/data untouched)
```

**Port:** the service listens on **http://localhost:3080** on this machine, because
port 3000 is already in use by another app (pm2). To choose a different port, set
`PORT` before installing:

```powershell
$env:PORT = "3080"; npm run service:install
```

Service logs are written to the `daemon\` folder
(`*.out.log`, `*.err.log`, `*.wrapper.log`).

> Do **not** also run `npm start` while the service is running — they would fight
> over the same port. Use one or the other.

## Adding music

Two ways:

1. **Web upload** — sign in as admin → *Upload Music* → drag & drop files.
2. **Bulk (recommended for large libraries)** — copy files into the `music`
   folder with File Explorer, then run `npm run scan` (or click *Rescan library*
   in the app). Subfolders are scanned recursively.

Supported formats: mp3, flac, m4a, aac, ogg, opus, wav, wma, aiff, alac.

## Configuration

Environment variables (all optional):

| Variable         | Default            | Purpose                                  |
|------------------|--------------------|------------------------------------------|
| `PORT`           | `3000`             | Web server port                          |
| `MUSIC_DIR`      | `./music`          | Where audio files live                   |
| `DATA_DIR`       | `./data`           | Where the app stores users/playlists/etc |
| `SESSION_SECRET` | (dev default)      | Set a random value in production          |

Example (PowerShell):

```powershell
$env:PORT = "8080"; $env:SESSION_SECRET = "some-long-random-string"; npm start
```

## How data is stored

- `music/` — your audio files (never modified by the app).
- `data/library.json` — the scanned index (title, artist, album, duration…).
- `data/art/` — album art extracted from tags.
- `data/users.json`, `data/playlists.json`, `data/shares.json` — app data.

Everything under `data/` is regenerated or app-managed; back it up along with
your `music` folder.

## Sharing outside your network

By default the app is reachable only on the local machine/LAN. To let staff or
students reach it (and open share links) from elsewhere, put it behind your
Synology's reverse proxy or a tunnel and use HTTPS. Ask your administrator
before exposing it to the internet.

## Project layout

```
server.js            Express server + all API routes
src/
  config.js          Paths, ports, supported formats
  store.js           Small JSON file persistence
  auth.js            Password hashing, users, session middleware
  library.js         Folder scan, metadata + album art, search
  playlists.js       Playlist CRUD
  shares.js          Public share links
public/              Front-end (no build step — plain HTML/CSS/JS)
scripts/scan.js      Command-line library scan (npm run scan)
```
