// ── Profile schema ────────────────────────────────────────────────────────────

export type TunnelType = 'local' | 'remote' | 'dynamic';

export interface Tunnel {
  type: TunnelType;
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
}

export type ServiceType = 'postgres' | 'mysql' | 'redis' | 'docker' | 'nginx' | 'custom';

export interface ServiceConfig {
  id: string;
  type: ServiceType;
  name: string;           // display name, e.g. "fentu_prod"
  dbName?: string;        // postgres/mysql database name
  dbUser?: string;        // database user
  dbPort?: number;        // service port (default per type)
  containerName?: string; // docker container name
}

export interface CommandSnippet {
  id: string;
  name: string;
  command: string;
  description?: string;
}

export interface BackupRecord {
  id: string;
  profileId: string;
  profileName: string;
  serviceId: string;
  serviceName: string;
  dbName: string;
  filePath: string;
  fileSizeBytes?: number;
  createdAt: string;
}

export interface Profile {
  id: string;
  name: string;

  // ── Connection targets ──────────────────────────────────────────────────
  host: string;
  hostPrivate?: string;
  user: string;
  port: number;

  // ── Auth ───────────────────────────────────────────────────────────────
  keyPath?: string;

  // ── Routing ────────────────────────────────────────────────────────────
  jumpHost?: string;
  cloudflaredHostname?: string;
  proxyCommand?: string;
  sshConfigAlias?: string;

  // ── Tunnels ────────────────────────────────────────────────────────────
  tunnels: Tunnel[];

  // ── Services & tooling ─────────────────────────────────────────────────
  services: ServiceConfig[];
  snippets: CommandSnippet[];

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
  backups: BackupRecord[];
  globalSnippets: CommandSnippet[];
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

// ── Service defaults ──────────────────────────────────────────────────────────

export const SERVICE_DEFAULT_PORTS: Record<ServiceType, number> = {
  postgres: 5432,
  mysql:    3306,
  redis:    6379,
  docker:   0,
  nginx:    80,
  custom:   0,
};
