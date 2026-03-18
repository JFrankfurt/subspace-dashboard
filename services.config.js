// Static display metadata for services, keyed by the HAProxy backend name.
// The server derives ports and hostnames from haproxy.cfg at runtime and merges
// them with this metadata.
//
// To add a new service: add an entry here and add a backend to haproxy.cfg.
// Everything else (port, hostname, up/down status) is derived automatically.

export const SERVICE_META = {
  "home_assistant_backend": {
    name:        "home-assistant",
    description: "Home automation platform",
    icon:        "HA",
    accent:      "#18bcf2",
    tag:         "automation",
  },
  "music_assistant_backend": {
    name:        "music-assistant",
    description: "Music library manager",
    icon:        "MA",
    accent:      "#00ff88",
    tag:         "media",
  },
  "pihole_backend": {
    name:        "pi-hole",
    description: "Network-wide ad blocker",
    icon:        "PH",
    accent:      "#ff00aa",
    tag:         "network",
  },
  "kavita_backend": {
    name:        "kavita",
    description: "Manga & book reader",
    icon:        "KV",
    accent:      "#ffe600",
    tag:         "media",
  },
};

// Services that don't have a TCP listener to match against (e.g. SSH is handled
// by sshd but we represent it as a copy-to-clipboard card, not a URL).
export const STATIC_SERVICES = [
  {
    name:        "ssh",
    description: "jordan@subspace.tailb937d0.ts.net",
    url:         null,
    icon:        "SH",
    accent:      "#c084fc",
    tag:         "system",
    port:        22,
  },
];
