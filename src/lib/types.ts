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
  hostPrivate?: string;      // private / internal IP (e.g. GCP VPC)
  user: string;
  port: number;

  // ── Auth ───────────────────────────────────────────────────────────────
  keyPath?: string;

  // ── Routing ────────────────────────────────────────────────────────────
  jumpHost?: string;            // bastion: user@host:port
  cloudflaredHostname?: string; // cloudflare tunnel entry hostname
  proxyCommand?: string;        // fully custom ProxyCommand
  sshConfigAlias?: string;      // delegate to ~/.ssh/config Host entry (e.g. vm:us-db-prod)

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

export type ConnectMethod = 'public' | 'private' | 'cloudflared' | 'proxy' | 'alias';

export interface ConnectMethodOption {
  value: ConnectMethod;
  name: string;
}

// ── Store schema ──────────────────────────────────────────────────────────────

export interface StoreSchema {
  profiles: Profile[];
}

// ── SSH config import ─────────────────────────────────────────────────────────

export interface SSHConfigHost {
  alias: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
  proxyCommand?: string;
}
