import { execFileSync, spawn } from 'child_process';

// ── Input sanitization ────────────────────────────────────────────────────────
// Blocks shell metacharacters that could be used for command injection.
// All user-supplied strings pass through here before being used in SSH args.

const SAFE_HOSTNAME   = /^[a-zA-Z0-9._%-]+$/;
const SAFE_USER       = /^[a-zA-Z0-9._-]+$/;
const SAFE_PATH       = /^[^\0;|&`$<>]+$/;       // no shell operators, no null bytes
const SAFE_PORT       = /^\d{1,5}$/;
const SAFE_JUMP       = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9._%-]+(:\d{1,5})?$/;

export function validateProfile(profile) {
  const errors = [];

  if (!SAFE_HOSTNAME.test(profile.host))
    errors.push(`Invalid hostname: "${profile.host}"`);

  if (!SAFE_USER.test(profile.user))
    errors.push(`Invalid username: "${profile.user}"`);

  if (!SAFE_PORT.test(String(profile.port)) || profile.port < 1 || profile.port > 65535)
    errors.push(`Invalid port: "${profile.port}"`);

  if (profile.keyPath && !SAFE_PATH.test(profile.keyPath))
    errors.push(`Unsafe key path: "${profile.keyPath}"`);

  if (profile.jumpHost && !SAFE_JUMP.test(profile.jumpHost))
    errors.push(`Invalid jump host format: "${profile.jumpHost}" (expected user@host or user@host:port)`);

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

// ── SSH arg builder ───────────────────────────────────────────────────────────

export function buildSSHArgs(profile) {
  const errors = validateProfile(profile);
  if (errors.length > 0) {
    throw new Error(`Profile validation failed:\n  ${errors.join('\n  ')}`);
  }

  const args = [];

  if (profile.port && profile.port !== 22) {
    args.push('-p', String(profile.port));
  }
  if (profile.keyPath) {
    args.push('-i', profile.keyPath);
  }
  if (profile.jumpHost) {
    args.push('-J', profile.jumpHost);
  }
  for (const t of (profile.tunnels || [])) {
    if (t.type === 'local') {
      args.push('-L', `${t.localPort}:${t.remoteHost}:${t.remotePort}`);
    } else if (t.type === 'remote') {
      args.push('-R', `${t.localPort}:${t.remoteHost}:${t.remotePort}`);
    } else if (t.type === 'dynamic') {
      args.push('-D', String(t.localPort));
    }
  }

  args.push(`${profile.user}@${profile.host}`);
  return args;
}

export function buildSSHCommand(profile) {
  return `ssh ${buildSSHArgs(profile).join(' ')}`;
}

// ── Connections — always use spawn/execFile (never shell: true) ───────────────
// spawn() and execFileSync() pass args as an array directly to the OS,
// bypassing the shell entirely. This prevents any shell injection.

export function connect(profile) {
  const args = buildSSHArgs(profile);
  // stdio: inherit so the user gets a real interactive terminal
  const child = spawn('ssh', args, { stdio: 'inherit', shell: false });
  child.on('exit', code => process.exit(code ?? 0));
}

export function copySSHKey(profile, keyPath) {
  if (!SAFE_PATH.test(keyPath)) {
    return { success: false, error: 'Unsafe key path — contains shell special characters.' };
  }

  const args = [];
  if (profile.port && profile.port !== 22) args.push('-p', String(profile.port));
  args.push('-i', keyPath, `${profile.user}@${profile.host}`);

  try {
    // execFileSync — no shell, args passed as array
    execFileSync('ssh-copy-id', args, { stdio: 'inherit' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function testConnection(profile) {
  try {
    const args = [
      '-o', 'ConnectTimeout=5',
      '-o', 'BatchMode=yes',
      ...buildSSHArgs(profile),
      'exit',
    ];
    execFileSync('ssh', args, { timeout: 6000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
