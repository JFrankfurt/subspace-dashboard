import { useEffect, useState, useCallback } from "react";

// ── types ─────────────────────────────────────────────────────────────────────

interface Service {
  name: string;
  description: string;
  url: string | null;
  icon: string;
  accent: string;
  tag: string;
  port: number | null;
}

interface ServiceStatus {
  name: string;
  up: boolean;
}

interface TailscalePeer {
  name: string;
  dns: string;
  os: string;
  online: boolean;
  active: boolean;
  rxBytes: number;
  txBytes: number;
  tailscaleIPs: string[];
}

interface TailscaleData {
  self: { name: string; dns: string; tailscaleIPs: string[] };
  peers: TailscalePeer[];
}

interface MemInfo { total: number; used: number; percent: number; }
interface DiskInfo { total: number; used: number; avail: number; percent: number; }
interface Metrics {
  cpu: number;
  mem: MemInfo;
  uptime: { seconds: number; display: string };
  load: { one: number; five: number; fifteen: number };
  disk: DiskInfo | null;
}

// ── data (fetched from /api/services) ─────────────────────────────────────────
// Services are derived server-side from ss + haproxy.cfg + services.config.js

// ── utils ─────────────────────────────────────────────────────────────────────

function fmt(bytes: number) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  return (bytes / 1e3).toFixed(0) + " KB";
}

function osIcon(os: string) {
  const o = os.toLowerCase();
  if (o.includes("ios") || o.includes("iphone")) return "iOS";
  if (o.includes("mac")) return "macOS";
  if (o.includes("linux")) return "linux";
  if (o.includes("windows")) return "win";
  return os;
}

function Bar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="relative h-1 w-full bg-[#1a1d2e] overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 transition-all duration-700"
        style={{ width: `${percent}%`, background: color }}
      />
    </div>
  );
}

// ── service card ──────────────────────────────────────────────────────────────

function ServiceCard({ svc, up }: { svc: Service; up: boolean | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(`ssh ${svc.description}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isStatic = !svc.url;

  const inner = (
    <div className="relative flex flex-col gap-3 p-5 h-full">
      <div className="flex items-center justify-between">
        <span
          className="font-bold text-xs tracking-widest px-2 py-0.5 border"
          style={{ color: svc.accent, borderColor: svc.accent + "55", background: svc.accent + "11" }}
        >
          {svc.icon}
        </span>
        <div className="flex items-center gap-2">
          {/* status dot */}
          {!isStatic && (
            <span className="flex items-center gap-1 text-[10px] tracking-widest" style={{ color: up === null ? "#4a5068" : up ? "#00ff88" : "#ff3355" }}>
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  background: up === null ? "#2a2d4a" : up ? "#00ff88" : "#ff3355",
                  boxShadow: up ? `0 0 6px #00ff88` : up === false ? `0 0 6px #ff3355` : "none",
                }}
              />
              {up === null ? "..." : up ? "up" : "down"}
            </span>
          )}
          <span className="text-[10px] tracking-widest uppercase" style={{ color: svc.accent + "88" }}>
            [{svc.tag}]
          </span>
        </div>
      </div>

      <div className="mt-1">
        <span className="font-bold text-base tracking-tight" style={{ color: svc.accent }}>
          {svc.name}
        </span>
      </div>

      <p className="text-xs text-[#4a5068] font-mono leading-relaxed flex-1 truncate">
        {isStatic && copied
          ? <span style={{ color: svc.accent }}>// copied to clipboard</span>
          : <span>// {svc.description}</span>
        }
      </p>

      <div className="flex items-center justify-between pt-2 border-t border-[#1a1d2e]">
        <span className="text-[10px] tracking-widest text-[#2a2d4a] uppercase">
          {isStatic ? "$ ssh" : "$ open"}
        </span>
        <div className="flex items-center gap-2">
          {svc.port !== null && (
            <span className="text-[10px] font-mono" style={{ color: svc.accent + "66" }}>
              :{svc.port}
            </span>
          )}
          <span className="text-xs" style={{ color: svc.accent + "bb" }}>
            {isStatic ? "⌘ copy" : "↗"}
          </span>
        </div>
      </div>
    </div>
  );

  const sharedStyle = { borderColor: svc.accent + "33", "--glow": svc.accent } as React.CSSProperties;
  const hoverOverlay = (
    <>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" style={{ background: svc.accent + "08" }} />
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" style={{ boxShadow: `inset 0 0 20px ${svc.accent}18` }} />
    </>
  );

  if (isStatic) {
    return (
      <div className="relative block border overflow-hidden transition-all duration-200 bg-[#0a0b0f] group cursor-copy hover:border-opacity-80"
        style={{ ...sharedStyle, borderColor: svc.accent + "44" }}
        onClick={handleCopy} title="Click to copy SSH command">
        {hoverOverlay}
        {inner}
      </div>
    );
  }

  return (
    <a href={svc.url!} target="_blank" rel="noopener noreferrer"
      className="relative block border overflow-hidden transition-all duration-200 bg-[#0a0b0f] group hover:border-opacity-80"
      style={{ ...sharedStyle, borderColor: svc.accent + "44" }}>
      {hoverOverlay}
      {inner}
    </a>
  );
}

// ── tailscale peers ───────────────────────────────────────────────────────────

function PeersPanel({ data }: { data: TailscaleData | null }) {
  if (!data) {
    return (
      <div className="border border-[#1a1d2e] bg-[#0a0b0f] p-5">
        <div className="text-[10px] tracking-widest text-[#2a2d4a] uppercase mb-3">// tailscale peers</div>
        <div className="text-xs text-[#2a2d4a] animate-pulse">fetching...</div>
      </div>
    );
  }

  return (
    <div className="border border-[#1a1d2e] bg-[#0a0b0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] tracking-widest text-[#4a5068] uppercase">// tailscale peers</div>
        <div className="text-[10px] text-[#00f5ff] tracking-widest">{data.peers.filter(p => p.online).length}/{data.peers.length} online</div>
      </div>
      <div className="flex flex-col gap-2">
        {data.peers.map((peer) => (
          <div key={peer.name} className="flex items-center gap-3 text-xs">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background: peer.online ? "#00ff88" : "#2a2d4a",
                boxShadow: peer.online ? "0 0 6px #00ff88" : "none",
              }}
            />
            <span className="text-[#c8d0e0] font-bold w-24 truncate">{peer.name}</span>
            <span className="text-[#2a2d4a] text-[10px] tracking-widest w-14">{osIcon(peer.os)}</span>
            <span className="text-[#4a5068] text-[10px] ml-auto">
              {peer.active ? (
                <span className="text-[#00ff88]">direct</span>
              ) : peer.online ? (
                <span className="text-[#4a5068]">relay</span>
              ) : (
                <span className="text-[#2a2d4a]">offline</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── metrics panel ─────────────────────────────────────────────────────────────

function MetricsPanel({ data }: { data: Metrics | null }) {
  if (!data) {
    return (
      <div className="border border-[#1a1d2e] bg-[#0a0b0f] p-5">
        <div className="text-[10px] tracking-widest text-[#2a2d4a] uppercase mb-3">// system</div>
        <div className="text-xs text-[#2a2d4a] animate-pulse">fetching...</div>
      </div>
    );
  }

  const cpuColor = data.cpu > 80 ? "#ff3355" : data.cpu > 50 ? "#ffe600" : "#00ff88";
  const memColor = data.mem.percent > 80 ? "#ff3355" : data.mem.percent > 60 ? "#ffe600" : "#00f5ff";
  const diskColor = data.disk && data.disk.percent > 85 ? "#ff3355" : data.disk && data.disk.percent > 70 ? "#ffe600" : "#c084fc";

  return (
    <div className="border border-[#1a1d2e] bg-[#0a0b0f] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] tracking-widest text-[#4a5068] uppercase">// system</div>
        <div className="text-[10px] text-[#4a5068] tracking-widest">up {data.uptime.display}</div>
      </div>

      <div className="flex flex-col gap-4">
        {/* CPU */}
        <div>
          <div className="flex justify-between text-[10px] tracking-widest mb-1.5">
            <span className="text-[#4a5068] uppercase">cpu</span>
            <span style={{ color: cpuColor }}>{data.cpu}%</span>
          </div>
          <Bar percent={data.cpu} color={cpuColor} />
          <div className="text-[10px] text-[#2a2d4a] mt-1">
            load {data.load.one.toFixed(2)} · {data.load.five.toFixed(2)} · {data.load.fifteen.toFixed(2)}
          </div>
        </div>

        {/* RAM */}
        <div>
          <div className="flex justify-between text-[10px] tracking-widest mb-1.5">
            <span className="text-[#4a5068] uppercase">mem</span>
            <span style={{ color: memColor }}>{data.mem.percent}%</span>
          </div>
          <Bar percent={data.mem.percent} color={memColor} />
          <div className="text-[10px] text-[#2a2d4a] mt-1">
            {fmt(data.mem.used)} / {fmt(data.mem.total)}
          </div>
        </div>

        {/* Disk */}
        {data.disk && (
          <div>
            <div className="flex justify-between text-[10px] tracking-widest mb-1.5">
              <span className="text-[#4a5068] uppercase">disk /</span>
              <span style={{ color: diskColor }}>{data.disk.percent}%</span>
            </div>
            <Bar percent={data.disk.percent} color={diskColor} />
            <div className="text-[10px] text-[#2a2d4a] mt-1">
              {fmt(data.disk.used)} used · {fmt(data.disk.avail)} free
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── clock ─────────────────────────────────────────────────────────────────────

function Clock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono tabular-nums text-[#4a5068] text-[10px] tracking-widest">
      {time.toLocaleTimeString("en-US", { hour12: false })}
    </span>
  );
}

// ── app ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [statuses, setStatuses] = useState<ServiceStatus[] | null>(null);
  const [tsData, setTsData] = useState<TailscaleData | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const fetchAll = useCallback(async () => {
    const [svc, s, t, m] = await Promise.allSettled([
      fetch("/api/services").then(r => r.json()),
      fetch("/api/status").then(r => r.json()),
      fetch("/api/tailscale").then(r => r.json()),
      fetch("/api/metrics").then(r => r.json()),
    ]);
    if (svc.status === "fulfilled") setServices(svc.value);
    if (s.status === "fulfilled") setStatuses(s.value);
    if (t.status === "fulfilled") setTsData(t.value);
    if (m.status === "fulfilled") setMetrics(m.value);
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 15000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const getStatus = (name: string) => {
    if (!statuses) return null;
    return statuses.find(s => s.name === name)?.up ?? null;
  };

  return (
    <div className="min-h-svh max-w-5xl mx-auto px-6 py-12 flex flex-col gap-10">

      {/* header */}
      <header>
        <div className="flex items-center gap-3 text-[10px] tracking-widest text-[#2a2d4a] uppercase mb-4 font-mono">
          <span className="text-[#00f5ff44]">▸</span>
          <span>sys/init</span>
          <span className="text-[#1a1d2e]">·</span>
          <span>tailb937d0.ts.net</span>
          <span className="text-[#1a1d2e]">·</span>
          <span>100.106.96.73</span>
          <span className="flex-1" />
          <Clock />
        </div>

        <h1 className="glitch text-5xl font-bold tracking-tight text-white mb-2 leading-none" data-text="subspace">
          subspace
        </h1>

        <div className="flex items-center gap-3 mt-4">
          <span className="text-[10px] tracking-[0.3em] uppercase text-[#4a5068]">service index</span>
          <span className="flex-1 h-px bg-gradient-to-r from-[#1a1d2e] to-transparent" />
          <span className="flex items-center gap-1.5 text-[10px] text-[#00ff88] tracking-widest cursor-blink">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00ff88]" style={{ boxShadow: "0 0 6px #00ff88" }} />
            online
          </span>
        </div>
      </header>

      {/* service grid */}
      <section>
        <div className="text-[10px] tracking-widest text-[#2a2d4a] uppercase mb-3">// services</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {services === null
            ? <div className="text-xs text-[#2a2d4a] animate-pulse col-span-full">fetching...</div>
            : services.map((svc) => (
                <ServiceCard key={svc.name} svc={svc} up={getStatus(svc.name)} />
              ))
          }
        </div>
      </section>

      {/* bottom panels */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MetricsPanel data={metrics} />
        <PeersPanel data={tsData} />
      </section>

      {/* footer */}
      <footer className="pt-4 border-t border-[#1a1d2e]">
        <div className="flex items-center justify-between text-[10px] tracking-widest uppercase text-[#2a2d4a] font-mono">
          <span>subspace · {services?.length ?? "..."} services</span>
          <span>refresh 15s</span>
          <span>{new Date().toISOString().slice(0, 10)}</span>
        </div>
      </footer>

    </div>
  );
}
