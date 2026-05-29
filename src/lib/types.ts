// ── Profile schema ────────────────────────────────────────────────────────────

export type TunnelType = 'local' | 'remote' | 'dynamic';

export interface Tunnel {
  type: TunnelType;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
}

export interface Profile {
  id: string;
  name: string;

  // ── Connection targets ──────────────────────────────────────────────────
  host: string;              // public IP or hostname (required)
  hostPrivate?: string;      // private / internal IP (optional, e.g. GCP VPC)
  user: string;
  port: number;

  // ── Auth ───────────────────────────────────────────────────────────────
  keyPath?: string;

  // ── Routing ────────────────────────────────────────────────────────────
  jumpHost?: string;            // bastion: user@host:port
  cloudflaredHostname?: string; // cloudflare tunnel hostname
  proxyCommand?: string;        // custom ProxyCommand

  // ── Tunnels ────────────────────────────────────────────────────────────
  tunnels: Tunnel[];

  // ── Metadata ───────────────────────────────────────────────────────────
  group: string;
  tags: string[];
  notes?: string;
  lastConnected?: string;
  createdAt: string;
}

// ── Connect method ────────────────────────────────────────────────────────────

export type ConnectMethod = 'public' | 'private' | 'cloudflared' | 'proxy';

export interface ConnectMethodOption {
  value: ConnectMethod;
  name: string;
}

// ── Store schema ──────────────────────────────────────────────────────────────

export interface StoreSchema {
  profiles: Profile[];
}
