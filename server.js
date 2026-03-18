import express from "express";
import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SERVICE_META, STATIC_SERVICES } from "./services.config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 4000;

// Serve built frontend (disable index fallback so API routes take priority)
app.use(express.static(join(__dirname, "dist"), { index: false }));

// ── helpers ──────────────────────────────────────────────────────────────────

function run(cmd, args = [], timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function checkHttp(url, timeout = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

// ── /api/services ─────────────────────────────────────────────────────────────
// Derives service list dynamically from ss (ports) and haproxy.cfg (hostnames),
// merged with static display metadata from services.config.js.

const HAPROXY_CFG = "/etc/haproxy/haproxy.cfg";

// Port→URL path overrides (for services that need a subpath)
const PORT_PATH_OVERRIDES = {
  8081: "/admin/",
};

let cachedServices = null;

async function parseHaproxy() {
  // Returns Map<backendName, { port, hostname }> by parsing haproxy.cfg
  const raw = await readFile(HAPROXY_CFG, "utf8");

  // ACL name → hostname
  const aclHostnames = new Map();
  for (const m of raw.matchAll(/acl\s+(host_\S+)\s+hdr\(host\)\s+-i\s+(\S+)/g)) {
    aclHostnames.set(m[1], m[2]);
  }

  // backend name → hostname (via use_backend → acl)
  const backendHostnames = new Map();
  for (const m of raw.matchAll(/use_backend\s+(\S+)\s+if\s+(host_\S+)/g)) {
    const hostname = aclHostnames.get(m[2]);
    if (hostname) backendHostnames.set(m[1], hostname);
  }

  // backend name → port (from server lines)
  const result = new Map();
  const backendBlocks = raw.split(/^backend\s+/m).slice(1);
  for (const block of backendBlocks) {
    const backendName = block.match(/^(\S+)/)?.[1];
    const serverMatch = block.match(/server\s+\S+\s+127\.0\.0\.1:(\d+)/);
    if (!backendName || !serverMatch) continue;
    const port = parseInt(serverMatch[1]);
    const hostname = backendHostnames.get(backendName);
    if (hostname) result.set(backendName, { port, hostname });
  }
  return result;
}

async function buildServices() {
  const backends = await parseHaproxy();
  const services = [];

  for (const [backendName, meta] of Object.entries(SERVICE_META)) {
    const backend = backends.get(backendName);
    const port = backend?.port ?? null;
    const hostname = backend?.hostname ?? null;
    const path = (port && PORT_PATH_OVERRIDES[port]) || "/";
    const url = hostname ? `https://${hostname}${path === "/" ? "" : path}` : null;

    services.push({ ...meta, port, url });
  }

  // Append static entries (SSH etc.)
  services.push(...STATIC_SERVICES);

  cachedServices = services;
  return services;
}

app.get("/api/services", async (_req, res) => {
  try {
    const services = await buildServices();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── /api/status ───────────────────────────────────────────────────────────────
// Health check each service from the server side (avoids CORS, more reliable)

app.get("/api/status", async (_req, res) => {
  try {
    // Use cached services if available, otherwise build fresh
    const services = cachedServices ?? await buildServices();
    const checkable = services.filter((s) => s.url && s.port);
    const results = await Promise.all(
      checkable.map(async ({ name, port }) => {
        // Health-check directly on localhost to avoid TLS/HAProxy overhead
        const path = PORT_PATH_OVERRIDES[port] || "/";
        const up = await checkHttp(`http://127.0.0.1:${port}${path}`);
        return { name, up };
      })
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── /api/tailscale ────────────────────────────────────────────────────────────

app.get("/api/tailscale", async (_req, res) => {
  try {
    const raw = await run("/usr/bin/tailscale", ["status", "--json"]);
    const data = JSON.parse(raw);

    const self = data.Self;
    const peers = Object.values(data.Peer || {}).map((p) => ({
      name: p.HostName,
      dns: p.DNSName?.replace(/\.$/, ""),
      os: p.OS,
      online: p.Online,
      active: !!p.Active,
      rxBytes: p.RxBytes ?? 0,
      txBytes: p.TxBytes ?? 0,
      tailscaleIPs: p.TailscaleIPs ?? [],
    }));

    res.json({
      self: {
        name: self.HostName,
        dns: self.DNSName?.replace(/\.$/, ""),
        tailscaleIPs: self.TailscaleIPs ?? [],
      },
      peers,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── /api/metrics ──────────────────────────────────────────────────────────────

async function getCpuPercent() {
  // Read /proc/stat twice 500ms apart to get a real delta
  const read = async () => {
    const raw = await readFile("/proc/stat", "utf8");
    const line = raw.split("\n")[0]; // cpu  ...
    const vals = line.split(/\s+/).slice(1).map(Number);
    const idle = vals[3] + vals[4]; // idle + iowait
    const total = vals.reduce((a, b) => a + b, 0);
    return { idle, total };
  };
  const a = await read();
  await new Promise((r) => setTimeout(r, 500));
  const b = await read();
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

async function getMemInfo() {
  const raw = await readFile("/proc/meminfo", "utf8");
  const get = (key) => {
    const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return m ? parseInt(m[1]) * 1024 : 0; // kB → bytes
  };
  const total = get("MemTotal");
  const available = get("MemAvailable");
  const used = total - available;
  return { total, used, percent: Math.round((used / total) * 100) };
}

async function getUptime() {
  const raw = await readFile("/proc/uptime", "utf8");
  const seconds = Math.floor(parseFloat(raw.split(" ")[0]));
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return { seconds, display: d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m` };
}

async function getLoadAvg() {
  const raw = await readFile("/proc/loadavg", "utf8");
  const [one, five, fifteen] = raw.split(" ").map(parseFloat);
  return { one, five, fifteen };
}

async function getDiskInfo() {
  try {
    const raw = await run("df", ["-BK", "--output=size,used,avail,pcent", "/"]);
    const line = raw.split("\n")[1].trim().split(/\s+/);
    const parse = (s) => parseInt(s) * 1024; // KB → bytes
    return {
      total: parse(line[0]),
      used: parse(line[1]),
      avail: parse(line[2]),
      percent: parseInt(line[3]),
    };
  } catch {
    return null;
  }
}

app.get("/api/metrics", async (_req, res) => {
  try {
    const [cpu, mem, uptime, load, disk] = await Promise.all([
      getCpuPercent(),
      getMemInfo(),
      getUptime(),
      getLoadAvg(),
      getDiskInfo(),
    ]);
    res.json({ cpu, mem, uptime, load, disk });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── fallback → SPA ────────────────────────────────────────────────────────────

app.get("*splat", (_req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`subspace running on http://127.0.0.1:${PORT}`);
});
