import { execFileSync, spawnSync } from 'child_process';
import type { Profile, ConnectMethod, ConnectMethodOption } from './types.js';

// ── Input validation ──────────────────────────────────────────────────────────

const SAFE_HOSTNAME  = /^[a-zA-Z0-9._%-]+$/;
const SAFE_USER      = /^[a-zA-Z0-9._-]+$/;
const SAFE_PATH      = /^[^\0;|&`$<>]+$/;
const SAFE_PORT      = /^\d{1,5}$/;
const SAFE_JUMP      = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9._%-]+(:\d{1,5})?$/;
const SAFE_CF_HOST   = /^[a-zA-Z0-9._%-]+$/;
const SAFE_PROXY_CMD = /^[^\0]+$/;
// SSH config alias: allows colons and slashes (e.g. vm:us-db-prod)
const SAFE_ALIAS     = /^[a-zA-Z0-9._:/-]+$/;

export function validateProfile(profile: Profile): string[] {
  const errors: string[] = [];

  if (profile.sshConfigAlias) {
    // Alias mode — only validate the alias itself
    if (!SAFE_ALIAS.test(profile.sshConfigAlias))
      errors.push(`Invalid SSH config alias: "${profile.sshConfigAlias}"`);
    return errors;
  }

  if (!SAFE_HOSTNAME.test(profile.host))
    errors.push(`Invalid hostname: "${profile.host}"`);

  if (profile.hostPrivate && !SAFE_HOSTNAME.test(profile.hostPrivate))
    errors.push(`Invalid private IP/hostname: "${profile.hostPrivate}"`);

  if (!SAFE_USER.test(profile.user))
    errors.push(`Invalid username: "${profile.user}"`);

  if (!SAFE_PORT.test(String(profile.port)) || profile.port < 1 || profile.port > 65535)
    errors.push(`Invalid port: "${profile.port}"`);

  if (profile.keyPath && !SAFE_PATH.test(profile.keyPath))
    errors.push(`Unsafe key path: "${profile.keyPath}"`);

  if (profile.jumpHost && !SAFE_JUMP.test(profile.jumpHost))
    errors.push(`Invalid jump host: "${profile.jumpHost}" (expected user@host or user@host:port)`);

  if (profile.cloudflaredHostname && !SAFE_CF_HOST.test(profile.cloudflaredHostname))
    errors.push(`Invalid Cloudflare tunnel hostname: "${profile.cloudflaredHostname}"`);

  if (profile.proxyCommand && !SAFE_PROXY_CMD.test(profile.proxyCommand))
    errors.push('ProxyCommand contains null bytes — rejected.');

  for (const t of profile.tunnels) {
    if (!SAFE_PORT.test(String(t.localPort)))
      errors.push(`Invalid tunnel local port: "${t.localPort}"`);
    if (t.remoteHost && !SAFE_HOSTNAME.test(t.remoteHost))
      errors.push(`Invalid tunnel remote host: "${t.remoteHost}"`);
    if (t.remotePort && !SAFE_PORT.test(String(t.remotePort)))
      errors.push(`Invalid tunnel remote port: "${t.remotePort}"`);
  }

  return errors;
}

// ── Connection methods ────────────────────────────────────────────────────────

export function getConnectMethods(profile: Profile): ConnectMethodOption[] {
  // If profile has an SSH config alias, that's the primary method
  if (profile.sshConfigAlias) {
    const methods: ConnectMethodOption[] = [
      { value: 'alias', name: `SSH config alias       (~/.ssh/config → ${profile.sshConfigAlias})` },
    ];
    // Still allow direct public IP if host looks like a real IP/hostname
    if (profile.host && profile.host !== profile.sshConfigAlias) {
      methods.push({ value: 'public', name: `Public IP / hostname   (${profile.host})` });
    }
    if (profile.hostPrivate) {
      methods.push({ value: 'private', name: `Private / internal IP  (${profile.hostPrivate})` });
    }
    return methods;
  }

  const methods: ConnectMethodOption[] = [
    { value: 'public', name: `Public IP / hostname   (${profile.host})` },
  ];

  if (profile.hostPrivate) {
    methods.push({ value: 'private', name: `Private / internal IP  (${profile.hostPrivate})` });
  }
  if (profile.cloudflaredHostname) {
    methods.push({ value: 'cloudflared', name: `Cloudflare Tunnel      (${profile.cloudflaredHostname})` });
  }
  if (profile.proxyCommand) {
    const preview = profile.proxyCommand.length > 50
      ? `${profile.proxyCommand.slice(0, 50)}…`
      : profile.proxyCommand;
    methods.push({ value: 'proxy', name: `ProxyCommand           (${preview})` });
  }

  return methods;
}

// ── SSH arg builder ───────────────────────────────────────────────────────────

export function buildSSHArgs(profile: Profile, method: ConnectMethod = 'public'): string[] {
  const errors = validateProfile(profile);
  if (errors.length > 0) {
    throw new Error(`Profile validation failed:\n  ${errors.join('\n  ')}`);
  }

  // ── Alias mode: delegate entirely to ~/.ssh/config ──
  if (method === 'alias' && profile.sshConfigAlias) {
    // SSH reads ~/.ssh/config and resolves all routing from the alias.
    // Only add key override if specified (SSH config IdentityFile takes
    // precedence anyway, but explicit -i lets the user override it).
    const args: string[] = [];
    if (profile.keyPath) args.push('-i', profile.keyPath);
    args.push(profile.sshConfigAlias);
    return args;
  }

  const args: string[] = [];

  if (profile.port !== 22) {
    args.push('-p', String(profile.port));
  }
  if (profile.keyPath) {
    args.push('-i', profile.keyPath);
  }

  if (method === 'cloudflared') {
    // Direct Cloudflare Tunnel connection (VM is the CF tunnel endpoint)
    args.push('-o', `ProxyCommand=cloudflared access ssh --hostname ${profile.cloudflaredHostname}`);
  } else if (method === 'proxy') {
    args.push('-o', `ProxyCommand=${profile.proxyCommand}`);
  } else {
    // Jump host only for direct IP connections
    if (profile.jumpHost) {
      args.push('-J', profile.jumpHost);
    }
  }

  for (const t of profile.tunnels) {
    if (t.type === 'local') {
      args.push('-L', `${t.localPort}:${t.remoteHost}:${t.remotePort}`);
    } else if (t.type === 'remote') {
      args.push('-R', `${t.localPort}:${t.remoteHost}:${t.remotePort}`);
    } else if (t.type === 'dynamic') {
      args.push('-D', String(t.localPort));
    }
  }

  const host =
    method === 'private'     ? profile.hostPrivate! :
    method === 'cloudflared' ? profile.cloudflaredHostname! :
    profile.host;

  args.push(`${profile.user}@${host}`);
  return args;
}

export function buildSSHCommand(profile: Profile, method: ConnectMethod = 'public'): string {
  if (method === 'alias' && profile.sshConfigAlias) {
    const key = profile.keyPath ? `-i ${profile.keyPath} ` : '';
    return `ssh ${key}${profile.sshConfigAlias}`;
  }
  return `ssh ${buildSSHArgs(profile, method).join(' ')}`;
}

// ── Connections — spawnSync blocks Node while SSH runs ────────────────────────

export function connect(profile: Profile, method: ConnectMethod = 'public'): void {
  const args = buildSSHArgs(profile, method);
  const result = spawnSync('ssh', args, { stdio: 'inherit', shell: false });
  process.exit(result.status ?? 0);
}

export function copySSHKey(
  profile: Profile,
  keyPath: string,
  method: ConnectMethod = 'public',
): { success: boolean; error?: string } {
  if (!SAFE_PATH.test(keyPath)) {
    return { success: false, error: 'Unsafe key path — contains shell special characters.' };
  }

  const host = method === 'private' ? profile.hostPrivate! : profile.host;
  const args: string[] = [];
  if (profile.port !== 22) args.push('-p', String(profile.port));
  args.push('-i', keyPath, `${profile.user}@${host}`);

  try {
    execFileSync('ssh-copy-id', args, { stdio: 'inherit' });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function testConnection(profile: Profile, method: ConnectMethod = 'public'): boolean {
  try {
    const args = [
      '-o', 'ConnectTimeout=5',
      '-o', 'BatchMode=yes',
      ...buildSSHArgs(profile, method),
      'exit',
    ];
    execFileSync('ssh', args, { timeout: 6000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
