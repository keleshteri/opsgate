import { spawnSync, execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import type { Profile, ConnectMethod, ServiceConfig } from './types.js';
import { buildSSHArgs } from './ssh.js';

// ── Run a command interactively (output shown in terminal, blocks) ─────────────

export function runCommand(
  profile: Profile,
  method: ConnectMethod,
  command: string,
): number {
  const args = [...buildSSHArgs(profile, method), command];
  const result = spawnSync('ssh', args, { stdio: 'inherit', shell: false });
  return result.status ?? 1;
}

// ── Run a command and capture stdout as a string ──────────────────────────────

export function captureCommand(
  profile: Profile,
  method: ConnectMethod,
  command: string,
): { success: boolean; output: string; error: string } {
  try {
    const args = [...buildSSHArgs(profile, method), command];
    const output = execFileSync('ssh', args, {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { success: true, output: output.trim(), error: '' };
  } catch (err: any) {
    return {
      success: false,
      output: '',
      error: (err.stderr as string ?? err.message ?? 'Unknown error').trim(),
    };
  }
}

// ── Stream remote command stdout to a local file (for backups/logs) ───────────

export function streamToFile(
  profile: Profile,
  method: ConnectMethod,
  remoteCommand: string,
  localPath: string,
): { success: boolean; fileSizeBytes: number; error?: string } {
  try {
    const args = [...buildSSHArgs(profile, method), remoteCommand];
    const result = spawnSync('ssh', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 500 * 1024 * 1024, // 500 MB
    });

    if (result.status !== 0) {
      const errMsg = result.stderr?.toString().trim() ?? 'SSH command failed';
      return { success: false, fileSizeBytes: 0, error: errMsg };
    }

    if (!result.stdout || result.stdout.length === 0) {
      return { success: false, fileSizeBytes: 0, error: 'No data received from remote command' };
    }

    writeFileSync(localPath, result.stdout);
    return { success: true, fileSizeBytes: result.stdout.length };
  } catch (err: any) {
    return { success: false, fileSizeBytes: 0, error: err.message };
  }
}

// ── PostgreSQL backup via pg_dump ─────────────────────────────────────────────

export function backupPostgres(
  profile: Profile,
  method: ConnectMethod,
  service: ServiceConfig,
  localPath: string,
): { success: boolean; fileSizeBytes: number; error?: string } {
  const port = service.dbPort ?? 5432;
  const user = service.dbUser ?? profile.user;
  const db   = service.dbName ?? 'postgres';

  // -h 127.0.0.1 forces TCP connection (avoids peer auth on Unix socket)
  const cmd = `pg_dump -U ${user} -h 127.0.0.1 -p ${port} -d ${db} --no-password | gzip`;
  return streamToFile(profile, method, cmd, localPath);
}

// ── MySQL / MariaDB backup via mysqldump ──────────────────────────────────────

export function backupMySQL(
  profile: Profile,
  method: ConnectMethod,
  service: ServiceConfig,
  localPath: string,
): { success: boolean; fileSizeBytes: number; error?: string } {
  const port = service.dbPort ?? 3306;
  const user = service.dbUser ?? 'root';
  const db   = service.dbName ?? '';

  const cmd = `mysqldump -u ${user} -P ${port} ${db} | gzip`;
  return streamToFile(profile, method, cmd, localPath);
}

// ── Pull a log file from the remote VM ───────────────────────────────────────

export function pullLog(
  profile: Profile,
  method: ConnectMethod,
  remotePath: string,
  localPath: string,
  lines?: number,
): { success: boolean; fileSizeBytes: number; error?: string } {
  const cmd = lines
    ? `sudo tail -n ${lines} ${remotePath} 2>/dev/null || sudo cat ${remotePath} 2>/dev/null`
    : `sudo cat ${remotePath} 2>/dev/null`;
  return streamToFile(profile, method, cmd, localPath);
}

// ── Built-in global snippet commands ─────────────────────────────────────────

export const GLOBAL_SNIPPETS = [
  { name: 'System update',       command: 'sudo apt update && sudo apt upgrade -y',                    description: 'Update all packages' },
  { name: 'System info',         command: 'uname -a && uptime && echo "" && free -h && echo "" && df -h', description: 'OS, uptime, memory, disk' },
  { name: 'Disk usage',          command: 'df -h && echo "" && du -sh /* 2>/dev/null | sort -rh | head -20', description: 'Disk space by directory' },
  { name: 'Memory usage',        command: 'free -h && echo "" && ps aux --sort=-%mem | head -15',      description: 'RAM usage and top processes' },
  { name: 'CPU usage',           command: 'top -bn1 | head -25',                                        description: 'CPU snapshot' },
  { name: 'Running processes',   command: 'ps aux --sort=-%cpu | head -20',                             description: 'Top CPU processes' },
  { name: 'Open ports',          command: 'ss -tlnp',                                                   description: 'All listening ports' },
  { name: 'Recent system logs',  command: 'sudo journalctl -n 100 --no-pager',                          description: 'Last 100 system log lines' },
  { name: 'Failed services',     command: 'sudo systemctl --failed',                                    description: 'Services that failed to start' },
  { name: 'Docker containers',   command: 'sudo docker ps -a',                                          description: 'All Docker containers' },
  { name: 'Docker images',       command: 'sudo docker images',                                         description: 'All Docker images' },
  { name: 'Docker disk usage',   command: 'sudo docker system df',                                      description: 'Docker disk usage' },
  { name: 'Last logins',         command: 'last -n 20',                                                 description: 'Recent SSH logins' },
  { name: 'Firewall rules',      command: 'sudo ufw status verbose 2>/dev/null || sudo iptables -L -n', description: 'Active firewall rules' },
  { name: 'Environment vars',    command: 'env | sort',                                                  description: 'All environment variables' },
] as const;

// ── Service-specific snippet commands ─────────────────────────────────────────

export function getServiceSnippets(service: ServiceConfig): { name: string; command: string }[] {
  const port = service.dbPort;
  const user = service.dbUser;
  const db   = service.dbName;

  switch (service.type) {
    case 'postgres': {
      // Always use -h 127.0.0.1 to force TCP (avoids peer auth on Unix socket)
      const u = user ?? 'postgres';
      const h = '-h 127.0.0.1';
      const p = port ? `-p ${port}` : '';
      return [
        { name: 'PostgreSQL status',  command: 'sudo systemctl status postgresql --no-pager' },
        { name: 'List databases',     command: `psql -U ${u} ${h} ${p} -c "\\l"` },
        { name: 'List connections',   command: `psql -U ${u} ${h} ${p} -c "SELECT pid,usename,application_name,client_addr,state FROM pg_stat_activity;"` },
        { name: 'Database size',      command: `psql -U ${u} ${h} ${p} -c "SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size FROM pg_database ORDER BY pg_database_size(datname) DESC;"` },
        { name: 'Slow queries',       command: `psql -U ${u} ${h} ${p} ${db ? `-d ${db}` : ''} -c "SELECT pid, now()-query_start AS duration, query, state FROM pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC LIMIT 10;"` },
        { name: 'PostgreSQL logs',    command: 'sudo tail -n 100 /var/log/postgresql/*.log 2>/dev/null || sudo journalctl -u postgresql -n 100 --no-pager' },
      ];
    }

    case 'mysql':
      return [
        { name: 'MySQL status',          command: 'sudo systemctl status mysql' },
        { name: 'List databases',        command: `mysql -u ${user ?? 'root'} -e "SHOW DATABASES;"` },
        { name: 'Show processlist',      command: `mysql -u ${user ?? 'root'} -e "SHOW PROCESSLIST;"` },
        { name: 'MySQL logs',            command: 'sudo tail -n 100 /var/log/mysql/error.log 2>/dev/null' },
      ];

    case 'redis':
      return [
        { name: 'Redis status',          command: 'sudo systemctl status redis' },
        { name: 'Redis info',            command: `redis-cli ${port ? `-p ${port}` : ''} INFO server` },
        { name: 'Redis memory',          command: `redis-cli ${port ? `-p ${port}` : ''} INFO memory` },
        { name: 'Redis clients',         command: `redis-cli ${port ? `-p ${port}` : ''} CLIENT LIST` },
        { name: 'Redis slow log',        command: `redis-cli ${port ? `-p ${port}` : ''} SLOWLOG GET 10` },
      ];

    case 'docker':
      return [
        { name: 'All containers',        command: 'sudo docker ps -a' },
        { name: 'Container logs',        command: `sudo docker logs --tail 100 ${service.containerName ?? '$(sudo docker ps -q | head -1)'}` },
        { name: 'Container stats',       command: 'sudo docker stats --no-stream' },
        { name: 'Networks',              command: 'sudo docker network ls' },
        { name: 'Volumes',               command: 'sudo docker volume ls' },
        { name: 'Compose status',        command: 'sudo docker compose ps 2>/dev/null || sudo docker-compose ps' },
      ];

    case 'nginx':
      return [
        { name: 'Nginx status',          command: 'sudo systemctl status nginx' },
        { name: 'Nginx config test',     command: 'sudo nginx -t' },
        { name: 'Access logs',           command: 'sudo tail -n 100 /var/log/nginx/access.log' },
        { name: 'Error logs',            command: 'sudo tail -n 100 /var/log/nginx/error.log' },
        { name: 'Reload nginx',          command: 'sudo systemctl reload nginx' },
      ];

    default:
      return [];
  }
}
