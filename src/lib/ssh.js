import { execSync, spawn } from 'child_process';

export function buildSSHArgs(profile) {
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

export function connect(profile) {
  const args = buildSSHArgs(profile);
  const child = spawn('ssh', args, { stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 0));
}

export function copySSHKey(profile, keyPath) {
  const portFlag = profile.port && profile.port !== 22 ? `-p ${profile.port} ` : '';
  const cmd = `ssh-copy-id ${portFlag}-i "${keyPath}" ${profile.user}@${profile.host}`;
  try {
    execSync(cmd, { stdio: 'inherit' });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function testConnection(profile) {
  try {
    const args = ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', ...buildSSHArgs(profile), 'exit'];
    execSync(`ssh ${args.join(' ')}`, { timeout: 6000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
