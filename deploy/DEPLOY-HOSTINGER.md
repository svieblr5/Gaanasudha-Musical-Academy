# Publishing the portal at your Hostinger domain (no Cloudflare)

Goal: reach the app at `https://music.gaanasudhamusic.com` from anywhere, with the
app + music staying on this PC. Hostinger only provides the domain/DNS.

> **Current status (interim):** the portal is ALREADY public via an ngrok tunnel
> at `https://equinox-jittery-crabbing.ngrok-free.dev` (auto-starts with Windows).
> You can keep using that until you're ready to switch to the custom domain.
> ngrok's free tier has bandwidth limits, so the domain + Caddy path below is
> better for heavy streaming. **Blocker to start:** register/activate
> `gaanasudhamusic.com` (it was not registered yet). Everything on the PC is ready.

## Pre-flight (already done on this PC — verify, don't redo)
- App runs as a Windows service **"Gaanasudha Music Portal"** on **localhost:3080**
  (auto-start). Dependencies are installed; if you ever move/rebuild, run
  `npm ci` in the project folder (it now includes `compression`).
- **Caddy** is installed and `deploy\Caddyfile` is pre-set to
  `music.gaanasudhamusic.com` with HTTPS, HSTS and compression.
- Health check: `curl http://localhost:3080/healthz` → `{"ok":true,...}`.

```
Visitor ──https──► Hostinger DNS (A record) ──► your public IP 113.30.145.92
        ──► router(s) forward 80/443 ──► this PC 10.10.30.54
        ──► Caddy (auto HTTPS) ──► localhost:3080 (the app service)
```

Confirmed for your network:
- Public IP: **113.30.145.92** (NOT behind CGNAT — port forwarding works).
- This PC LAN IP: **10.10.30.54**, gateway **10.10.30.1**.
- There is a second router upstream (**10.10.10.254**) — so forwarding is
  likely **two-tier** (see Step 3).

---

## Step 1 — Give this PC a fixed LAN IP
DHCP may change `10.10.30.54` on reboot, which would break forwarding.
In router `10.10.30.1`, reserve/DHCP-bind `10.10.30.54` to this PC's MAC, or set
a static IP on the Ethernet adapter. (Get the MAC with `getmac /v`.)

## Step 2 — Open the Windows firewall for 80 + 443
Run in an **Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName 'Gaanasudha Web (HTTP)'  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80  -Profile Private,Domain
New-NetFirewallRule -DisplayName 'Gaanasudha Web (HTTPS)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -Profile Private,Domain
```

## Step 3 — Port forwarding on the router(s)
Find which device holds the public IP: log into `10.10.10.254` and check its
WAN/Internet IP.

- **If `10.10.10.254` shows WAN = 113.30.145.92** (it's the internet gateway):
  1. On `10.10.10.254`: forward external TCP **80 → (WAN IP of 10.10.30.1)** and
     **443 → (WAN IP of 10.10.30.1)**.
  2. On `10.10.30.1`: forward TCP **80 → 10.10.30.54** and **443 → 10.10.30.54**.
- **If the public IP is on an ISP device beyond `10.10.10.254`:** ask the ISP to
  put that device in **bridge mode**, or forward 80/443 on it to `10.10.10.254`,
  then continue as above.

Tip: if the routers support it, reserve the intermediate WAN IPs so they don't
change.

## Step 4 — DNS at Hostinger (hPanel)
1. hPanel → **Domains → DNS / Nameservers → Manage DNS Records**.
2. Add an **A record**:
   - Type: `A`
   - Name/Host: `music`   (creates `music.YOURDOMAIN.com`)
   - Points to: `113.30.145.92`
   - TTL: `300` (low, so changes propagate fast)
3. Leave your existing website records (`@`, `www`) untouched.

Wait a few minutes, then verify from this PC:
```powershell
Resolve-DnsName music.YOURDOMAIN.com
```
It should return `113.30.145.92`.

## Step 5 — Run Caddy (already pointed at your domain)
`deploy\Caddyfile` is already set to `music.gaanasudhamusic.com` (edit it only if
your subdomain differs), then test-run:

```powershell
caddy run --config "G:\Gaanasudha Musical Academy\deploy\Caddyfile"
```

Caddy will fetch a Let's Encrypt certificate automatically (this only succeeds
once Steps 3–4 are done and ports 80/443 reach this PC). Watch for a line like
`certificate obtained successfully`. Then open `https://music.gaanasudhamusic.com`.

## Step 6 — Run Caddy automatically at boot
Once the test run works, install Caddy as a Windows service so it starts with
the PC (like the app service). See `deploy\install-caddy-service.ps1`.

---

## Go-live checklist (when the domain is registered)
1. ☐ Register / activate **gaanasudhamusic.com** in Hostinger hPanel.
2. ☐ Step 1 — reserve this PC's LAN IP (`10.10.30.54`).
3. ☐ Step 2 — open Windows firewall 80/443.
4. ☐ Step 3 — forward 80/443 through both routers to this PC.
5. ☐ Step 4 — add the `music` A record → `113.30.145.92`; confirm with `Resolve-DnsName`.
6. ☐ Step 5 — `caddy run …`; wait for "certificate obtained"; open `https://music.gaanasudhamusic.com`.
7. ☐ Step 6 — install Caddy as a Windows service (auto-start).
8. ☐ Verify: `https://music.gaanasudhamusic.com/healthz` returns `{"ok":true}` and login works.

## After go-live
- **QR poster / share links:** they currently point at the ngrok URL. To repoint
  them at the domain, edit the `URL` in `scripts/build-practice-qr.mjs` (and
  regenerate the standalone with `scripts/build-practice-html.mjs`), then rerun:
  `node scripts/build-practice-qr.mjs`.
- **ngrok:** you can keep it as a backup or stop it — `Stop-Service ngrok`
  (and set it to Manual start) once the domain is proven.
- **Secure cookies** switch on automatically over HTTPS (the app uses
  `cookie.secure:'auto'` behind `trust proxy`), so no change needed.

## Dynamic IP note
If your ISP changes `113.30.145.92` periodically, the A record will go stale.
Options: ask the ISP for a **static IP** (best for a server), or set up a
**DDNS updater** that pushes the new IP to Hostinger's DNS via their API. Ask me
to build the updater script if you need it.

## Security reminders
- The admin password has been changed off the default — keep it strong.
- Consider creating non-admin accounts for students/staff.
- Only ports 80/443 should be forwarded — nothing else.
