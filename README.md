# subspace

Personal homelab dashboard. A self-hosted SPA showing live status of all services, Tailscale peer info, and system metrics. Cyberpunk/terminal aesthetic.

## What it does

- **Service grid** — cards for each self-hosted service with live up/down status, pulled from HAProxy config
- **SSH shortcuts** — non-HTTP service cards that copy the SSH command to clipboard
- **Tailscale panel** — all tailnet peers with OS, online/offline status, and relay vs direct routing
- **System metrics** — real-time CPU, memory, disk usage, uptime, load averages
- Auto-refreshes every 15 seconds

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser                                        │
│  React SPA (src/App.tsx)                        │
│  polls /api/* every 15s                         │
└────────────────────┬────────────────────────────┘
                     │ HTTPS
┌────────────────────▼────────────────────────────┐
│  HAProxy (port 443)                             │
│  TLS termination, hostname-based routing        │
└────────────────────┬────────────────────────────┘
                     │ HTTP  127.0.0.1:4000
┌────────────────────▼────────────────────────────┐
│  Express server (server.js)                     │
│  - serves dist/ (static Vite build)             │
│  - /api/services  — parses HAProxy config       │
│  - /api/status    — health checks each service  │
│  - /api/tailscale — runs `tailscale status`     │
│  - /api/metrics   — reads /proc/*               │
└─────────────────────────────────────────────────┘
```

Network access is via **Tailscale** — the server is only reachable through the tailnet (`subspace.tailb937d0.ts.net`).

## Key files

| File | Purpose |
|---|---|
| `server.js` | Express backend. All API logic lives here. Listens on `127.0.0.1:4000`. |
| `services.config.js` | **Main config for adding/editing services.** Maps HAProxy backend names to display metadata (name, description, icon initials, accent color). Also defines `STATIC_SERVICES` for SSH-only entries. |
| `src/App.tsx` | Entire React frontend (~400 lines). All components are in this one file. |
| `src/index.css` | All styles. Tailwind v4 `@theme` block defines the color palette. Also defines all CSS animations (glitch, flicker, scanlines). |
| `vite.config.ts` | Vite build config. Dev proxy: `/api` → `localhost:4000`. |

## Adding a service

Two steps:

1. **HAProxy** (`/etc/haproxy/haproxy.cfg`) — add a `backend` block with the service hostname and port
2. **`services.config.js`** — add an entry keyed by the HAProxy backend name with display metadata

That's it. The API auto-discovers services by parsing the live HAProxy config on startup and caches them.

For non-HTTP services (SSH, etc.), add to the `STATIC_SERVICES` array in `services.config.js` instead.

## Deployment

The project runs directly on the Linux host (no Docker). The `dist/` directory is committed, so no build step is needed on the server.

**Setup:**
1. Clone the repo
2. `npm install --omit=dev`
3. Symlink the unit file and enable the service:
   ```bash
   ln -s /home/jordan/subspace/subspace.service ~/.config/systemd/user/subspace.service
   systemctl --user daemon-reload
   systemctl --user enable --now subspace
   ```
4. HAProxy config should already proxy the hostname to `127.0.0.1:4000`

The unit file is at `subspace.service` in the repo root (symlinked from `~/.config/systemd/user/subspace.service`). Note the `ExecStart` path has the nvm Node version hardcoded — update it after upgrading Node (`nvm which current` gives the new path, then `systemctl --user daemon-reload && systemctl --user restart subspace`).

**HAProxy** handles HTTPS and routes `subspace.tailb937d0.ts.net` to port 4000. Other services (Home Assistant, Music Assistant, Pi-hole, Kavita) each get their own HAProxy frontend with a different hostname.

**Tailscale** provides the private network — nothing is exposed to the public internet.

## Development

```bash
npm install

# Terminal 1: backend API
npm run serve       # node server.js → 127.0.0.1:4000

# Terminal 2: frontend dev server (proxies /api to :4000)
npm run dev         # Vite → :5173
```

Other scripts:
```bash
npm run build       # tsc + vite build → dist/
npm run lint        # ESLint
npm run preview     # serve dist/ via Vite preview
```

After building, commit `dist/` so the server always has a runnable build without needing dev tooling installed.

## Host dependencies

The API has hardcoded paths to host resources. These must exist:

| Resource | Used by |
|---|---|
| `/usr/bin/tailscale` | `/api/tailscale` endpoint |
| `/etc/haproxy/haproxy.cfg` | `/api/services` service discovery |
| `/proc/stat`, `/proc/meminfo`, `/proc/uptime`, `/proc/loadavg` | `/api/metrics` |

## Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Vite 8
- **Backend:** Node.js, Express 5
- **Fonts:** JetBrains Mono (Google Fonts CDN)
- **No database, no auth, no env vars** — everything is hardcoded for a single-user homelab context
