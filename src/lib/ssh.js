import { execFileSync, spawn } from 'child_process';

// ── Input sanitization ────────────────────────────────────────────────────────

const SAFE_HOSTNAME    = /^[a-zA-Z0-9._%-]+$/;
const SAFE_USER        = /^[a-zA-Z0-9._-]+$/;
const SAFE_PATH        = /^[^\0;|&`$<>]+$/;
const SAFE_PORT        = /^\d{1,5}$/;
const SAFE_JUMP        = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9._%-]+(:\d{1,5})?$/;
const SAFE_CF_HOST     = /^[a-zA-Z0-9._%-]+$/;  // cloudflare tunnel hostname
// ProxyCommand is intentionally not stripped — it is a shell command by design.
// We only block null bytes and warn the user during input.
const SAFE_PROXY_CMD   = /^[^\0]+$/;

export function validateProfile(profile) {
  const errors = [];

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
    errors.push(`Invalid jump host format: "${profile.jumpHost}" (expected user@host or user@host:port)`);

  if (profile.cloudflaredHostname && !SAFE_CF_HOST.test(profile.cloudflaredHostname))
    errors.push(`Invalid Cloudflare tunnel hostname: "${profile.cloudflaredHostname}"`);

  if (profile.proxyCommand && !SAFE_PROXY_CMD.test(profile.proxyCommand))
    errors.push('ProxyCommand contains null bytes — rejected.');

  for (const t of (profile.tunnels || [])) {
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
// Returns the list of available connect methods for a given profile.

export function getConnectMethods(profile) {
  const methods = [
    { value: 'public',  name: `Public IP / hostname  (${profile.host})` },
  ];

  if (profile.hostPrivate) {
    methods.push({ value: 'private', name: `Private / internal IP   (${profile.hostPrivate})` });
  }

  if (profile.cloudflaredHostname) {
    methods.push({ value: 'cloudflared', name: `Cloudflare Tunnel       (${profile.cloudflaredHostname})` });
  }

  if (profile.proxyCommand) {
    methods.push({ value: 'proxy', name: `ProxyCommand            (${profile.proxyCommand.slice(0, 50)}${profile.proxyCommand.length > 50 ? '…' : ''})` });
  }

  return methods;
}

// ── SSH arg builder ───────────────────────────────────────────────────────────
// method: 'public' | 'private' | 'cloudflared' | 'proxy'

export function buildSSHArgs(profile, method = 'public') {
  const errors = validateProfile(profile);
  if (errors.length > 0) {
    throw new Error(`Profile validation failed:\n  ${errors.join('\n  ')}`);
  }

  const args = [];

  // ── Port ──
  if (profile.port && profile.port !== 22) {
    args.push('-p', String(profile.port));
  }

  // ── Key ──
  if (profile.keyPath) {
    args.push('-i', profile.keyPath);
  }

  // ── ProxyCommand / Cloudflared ──
  // Note: ProxyCommand must be passed as a single -o option string.
  // We use spawn with shell:false so this string is handed directly
  // to ssh — ssh itself parses and invokes the ProxyCommand via sh.
  if (method === 'cloudflared') {
    const cfHost = profile.cloudflaredHostname;
    args.push('-o', `ProxyCommand=cloudflared access ssh --hostname ${cfHost}`);
    // Cloudflare tunnels handle auth — skip jump hosts to avoid conflicts
  } else if (method === 'proxy') {
    args.push('-o', `ProxyCommand=${profile.proxyCommand}`);
  } else {
    // Only use jump host for direct IP connections
    if (profile.jumpHost) {
      args.push('-J', profile.jumpHost);
    }
  }

  // ── Tunnels ──
  for (const t of (profile.tunnels || [])) {
    if (t.type === 'local') {
      args.push('-L', `${t.localPort}:${t.remoteHost}:${t.remotePort}`);
    } else if (t.type === 'remote') {
      args.push('-R', `${t.localPort}:${t.remoteHost}:${t.remotePort}`);
    } else if (t.type === 'dynamic') {
      args.push('-D', String(t.localPort));
    }
  }

  // ── Target host ──
  const host = method === 'private'
    ? profile.hostPrivate
    : method === 'cloudflared'
      ? profile.cloudflaredHostname
      : profile.host;

  args.push(`${profile.user}@${host}`);
  return args;
}

export function buildSSHCommand(profile, method = 'public') {
  return `ssh ${buildSSHArgs(profile, method).join(' ')}`;
}

// ── Connections — shell: false, args as array ─────────────────────────────────

export function connect(profile, method = 'public') {
  const args = buildSSHArgs(profile, method);
  const child = spawn('ssh', args, { stdio: 'inherit', shell: false });
  child.on('exit', code => process.exit(code ?? 0));
}

export function copySSHKey(profile, keyPath, method = 'public') {
  if (!SAFE_PATH.test(keyPath)) {
    return { success: false, error: 'Unsafe key path — contains shell special characters.' };
  }

  const host = method === 'private' ? profile.hostPrivate : profile.host;
  const args = [];
  if (profile.port && profile.port !== 22) args.push('-p', String(profile.port));
  args.push('-i', keyPath, `${profile.user}@${host}`);

  try {
    execFileSync('ssh-copy-id', args, { stdio: 'inherit' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function testConnection(profile, method = 'public') {
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
