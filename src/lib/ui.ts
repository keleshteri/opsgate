import chalk from 'chalk';
import type { Profile } from './types.js';

export const c = {
  primary:   chalk.hex('#00D4FF'),
  secondary: chalk.hex('#7C3AED'),
  success:   chalk.hex('#22C55E'),
  error:     chalk.hex('#EF4444'),
  warning:   chalk.hex('#F59E0B'),
  muted:     chalk.hex('#6B7280'),
  text:      chalk.white,
  bold:      chalk.bold,
};

const GROUP_COLORS: Record<string, ReturnType<typeof chalk.hex>> = {
  prod:       chalk.hex('#EF4444'),
  staging:    chalk.hex('#F59E0B'),
  dev:        chalk.hex('#22C55E'),
  database:   chalk.hex('#3B82F6'),
  monitoring: chalk.hex('#8B5CF6'),
  custom:     chalk.hex('#EC4899'),
};

export function groupColor(group: string): string {
  return (GROUP_COLORS[group] ?? GROUP_COLORS['custom']!)(group);
}

export function banner(): void {
  console.clear();
  console.log(c.primary.bold('╔══════════════════════════════════════════╗'));
  console.log(c.primary.bold('║') + c.secondary.bold('         ⚡  OpsGate — SSH Manager         ') + c.primary.bold('║'));
  console.log(c.primary.bold('║') + c.muted('       Smart DevOps SSH Gateway  v1.0     ') + c.primary.bold('║'));
  console.log(c.primary.bold('╚══════════════════════════════════════════╝'));
  console.log();
}

export function msg(text: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const icon  = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  const color = type === 'success' ? c.success : type === 'error' ? c.error : c.primary;
  console.log(color.bold(`\n ${icon}  ${text}`));
}

export function profileSummary(p: Profile): string {
  const tunnelInfo = p.tunnels.length   ? c.primary(` ⇄${p.tunnels.length}`) : '';
  const jumpInfo   = p.jumpHost         ? c.warning(' ⤷J') : '';
  const cfInfo     = p.cloudflaredHostname ? c.primary(' ☁CF') : '';
  const proxyInfo  = p.proxyCommand     ? c.muted(' ⇢P') : '';
  const privateInfo = p.hostPrivate     ? c.muted(' +priv') : '';
  const keyInfo    = p.keyPath          ? c.success(' 🔑') : '';
  const last       = p.lastConnected
    ? c.muted(` (${new Date(p.lastConnected).toLocaleDateString()})`)
    : c.muted(' (never)');

  return (
    c.bold(p.name) +
    c.muted('  ') + c.secondary(`${p.user}@${p.host}`) +
    (p.port !== 22 ? c.muted(`:${p.port}`) : '') +
    '  ' + groupColor(p.group) +
    tunnelInfo + jumpInfo + cfInfo + proxyInfo + privateInfo + keyInfo + last
  );
}
