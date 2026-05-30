import type { Profile, ServiceConfig } from './types.js';

// ── Log source definitions ────────────────────────────────────────────────────

export interface LogSource {
  label: string;
  command: string;       // remote command that produces log output
  fileName: string;      // local save filename (without timestamp prefix)
  serviceType?: string;  // tied to a service type, or undefined = system
}

export function getSystemLogSources(): LogSource[] {
  return [
    { label: 'System log (syslog)',    command: 'sudo tail -n 1000 /var/log/syslog 2>/dev/null || sudo journalctl -n 1000 --no-pager',            fileName: 'syslog.log' },
    { label: 'Auth log',               command: 'sudo tail -n 500 /var/log/auth.log 2>/dev/null || sudo journalctl -u ssh -n 500 --no-pager',      fileName: 'auth.log' },
    { label: 'Kernel log',             command: 'sudo dmesg --time-format iso | tail -n 500',                                                       fileName: 'kern.log' },
    { label: 'System journal (1h)',    command: 'sudo journalctl --since "1 hour ago" --no-pager',                                                  fileName: 'journal.log' },
    { label: 'Failed units',           command: 'sudo systemctl --failed --no-pager',                                                               fileName: 'failed-units.log' },
    { label: 'Last logins',            command: 'last -n 50',                                                                                       fileName: 'last-logins.log' },
    { label: 'Cron log',               command: 'sudo grep -i cron /var/log/syslog 2>/dev/null | tail -n 200 || sudo journalctl -u cron -n 200 --no-pager', fileName: 'cron.log' },
  ];
}

export function getServiceLogSources(service: ServiceConfig): LogSource[] {
  switch (service.type) {
    case 'postgres':
      return [
        { label: 'PostgreSQL log (latest)',  command: 'sudo find /var/log/postgresql -name "*.log" | sort | tail -1 | xargs sudo tail -n 500 2>/dev/null || sudo journalctl -u postgresql -n 500 --no-pager', fileName: 'postgresql.log', serviceType: 'postgres' },
        { label: 'PostgreSQL errors only',   command: 'sudo find /var/log/postgresql -name "*.log" | sort | tail -1 | xargs sudo grep -i "error\\|fatal\\|panic" 2>/dev/null | tail -n 200',                  fileName: 'postgresql-errors.log', serviceType: 'postgres' },
        { label: 'PgBouncer log',            command: 'sudo tail -n 500 /var/log/pgbouncer/pgbouncer.log 2>/dev/null || sudo journalctl -u pgbouncer -n 500 --no-pager',                                       fileName: 'pgbouncer.log', serviceType: 'postgres' },
      ];

    case 'mysql':
      return [
        { label: 'MySQL error log',          command: 'sudo tail -n 500 /var/log/mysql/error.log 2>/dev/null || sudo journalctl -u mysql -n 500 --no-pager', fileName: 'mysql-error.log', serviceType: 'mysql' },
        { label: 'MySQL slow query log',     command: 'sudo tail -n 300 /var/log/mysql/mysql-slow.log 2>/dev/null',                                          fileName: 'mysql-slow.log', serviceType: 'mysql' },
      ];

    case 'nginx':
      return [
        { label: 'Nginx access log',         command: 'sudo tail -n 500 /var/log/nginx/access.log 2>/dev/null',     fileName: 'nginx-access.log', serviceType: 'nginx' },
        { label: 'Nginx error log',          command: 'sudo tail -n 300 /var/log/nginx/error.log 2>/dev/null',      fileName: 'nginx-error.log',  serviceType: 'nginx' },
      ];

    case 'redis':
      return [
        { label: 'Redis log',                command: 'sudo tail -n 500 /var/log/redis/redis-server.log 2>/dev/null || sudo journalctl -u redis -n 500 --no-pager', fileName: 'redis.log', serviceType: 'redis' },
      ];

    case 'docker':
      return [
        { label: 'Docker daemon log',        command: 'sudo journalctl -u docker -n 300 --no-pager',                                                            fileName: 'docker-daemon.log', serviceType: 'docker' },
        { label: `Container: ${service.containerName ?? 'select below'}`, command: `sudo docker logs --tail 500 ${service.containerName ?? 'CONTAINER_NAME'} 2>&1`, fileName: `docker-${service.containerName ?? 'container'}.log`, serviceType: 'docker' },
      ];

    default:
      return [];
  }
}
