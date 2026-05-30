import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { SSHConfigHost } from './types.js';

const SSH_CONFIG_PATH = join(homedir(), '.ssh', 'config');

/**
 * Parse ~/.ssh/config into a list of host entries.
 * Only reads Host entries that have a HostName or are usable aliases.
 * Skips wildcard entries (Host * / Host !*).
 */
export function parseSSHConfig(): SSHConfigHost[] {
  if (!existsSync(SSH_CONFIG_PATH)) return [];

  const content = readFileSync(SSH_CONFIG_PATH, 'utf8');
  const hosts: SSHConfigHost[] = [];
  let current: SSHConfigHost | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const [key, ...rest] = line.split(/\s+/);
    const value = rest.join(' ').replace(/^["']|["']$/g, '').trim();

    if (!key || !value) continue;

    switch (key.toLowerCase()) {
      case 'host': {
        // Save previous block
        if (current) hosts.push(current);

        // Skip wildcards
        if (value.includes('*') || value.includes('!')) {
          current = null;
          break;
        }

        current = { alias: value };
        break;
      }
      case 'hostname':
        if (current) current.hostname = value;
        break;
      case 'user':
        if (current) current.user = value;
        break;
      case 'port':
        if (current) current.port = parseInt(value, 10);
        break;
      case 'identityfile':
        if (current) current.identityFile = value.replace('~', homedir());
        break;
      case 'proxyjump':
        if (current) current.proxyJump = value;
        break;
      case 'proxycommand':
        if (current) current.proxyCommand = value;
        break;
    }
  }

  if (current) hosts.push(current);
  return hosts.filter(h => h.alias);
}

export function sshConfigExists(): boolean {
  return existsSync(SSH_CONFIG_PATH);
}

export const sshConfigPath = SSH_CONFIG_PATH;
