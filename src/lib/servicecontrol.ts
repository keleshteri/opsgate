import type { ServiceConfig } from './types.js';

// ── Service control action definitions ───────────────────────────────────────

export interface ServiceAction {
  label: string;
  command: string;
  dangerous?: boolean;  // prompts for confirmation before running
}

export function getServiceActions(service: ServiceConfig): ServiceAction[] {
  switch (service.type) {
    case 'postgres':
      return [
        { label: 'Status',                command: 'sudo systemctl status postgresql --no-pager' },
        { label: 'Restart',               command: 'sudo systemctl restart postgresql',   dangerous: true },
        { label: 'Reload config',         command: 'sudo systemctl reload postgresql' },
        { label: 'Stop',                  command: 'sudo systemctl stop postgresql',      dangerous: true },
        { label: 'Start',                 command: 'sudo systemctl start postgresql' },
        { label: 'PgBouncer status',      command: 'sudo systemctl status pgbouncer --no-pager' },
        { label: 'PgBouncer restart',     command: 'sudo systemctl restart pgbouncer',   dangerous: true },
        { label: 'PgBouncer reload',      command: 'sudo systemctl reload pgbouncer' },
        { label: 'Show pg_hba.conf',      command: 'sudo cat /etc/postgresql/*/main/pg_hba.conf 2>/dev/null' },
        { label: 'Show postgresql.conf',  command: 'sudo cat /etc/postgresql/*/main/postgresql.conf 2>/dev/null | grep -v "^#" | grep -v "^$"' },
        { label: 'Show pgbouncer.ini',    command: 'sudo cat /etc/pgbouncer/pgbouncer.ini 2>/dev/null | grep -v "^#" | grep -v "^$"' },
      ];

    case 'mysql':
      return [
        { label: 'Status',                command: 'sudo systemctl status mysql --no-pager' },
        { label: 'Restart',               command: 'sudo systemctl restart mysql',       dangerous: true },
        { label: 'Reload',                command: 'sudo systemctl reload mysql' },
        { label: 'Stop',                  command: 'sudo systemctl stop mysql',          dangerous: true },
        { label: 'Start',                 command: 'sudo systemctl start mysql' },
        { label: 'Show my.cnf',           command: 'sudo cat /etc/mysql/my.cnf 2>/dev/null' },
      ];

    case 'redis':
      return [
        { label: 'Status',                command: 'sudo systemctl status redis --no-pager' },
        { label: 'Restart',               command: 'sudo systemctl restart redis',       dangerous: true },
        { label: 'Stop',                  command: 'sudo systemctl stop redis',          dangerous: true },
        { label: 'Start',                 command: 'sudo systemctl start redis' },
        { label: 'Redis info',            command: 'redis-cli INFO server' },
        { label: 'Flush cache (DANGER)',  command: 'redis-cli FLUSHALL',                dangerous: true },
        { label: 'Show redis.conf',       command: 'sudo cat /etc/redis/redis.conf 2>/dev/null | grep -v "^#" | grep -v "^$"' },
      ];

    case 'nginx':
      return [
        { label: 'Status',                command: 'sudo systemctl status nginx --no-pager' },
        { label: 'Restart',               command: 'sudo systemctl restart nginx',       dangerous: true },
        { label: 'Reload config',         command: 'sudo systemctl reload nginx' },
        { label: 'Stop',                  command: 'sudo systemctl stop nginx',          dangerous: true },
        { label: 'Start',                 command: 'sudo systemctl start nginx' },
        { label: 'Test config',           command: 'sudo nginx -t' },
        { label: 'Show enabled sites',    command: 'ls -la /etc/nginx/sites-enabled/' },
        { label: 'Show nginx.conf',       command: 'sudo cat /etc/nginx/nginx.conf' },
      ];

    case 'docker':
      return [
        { label: 'All containers (ps)',       command: 'sudo docker ps -a' },
        { label: 'Container stats',           command: 'sudo docker stats --no-stream' },
        { label: 'Images',                    command: 'sudo docker images' },
        { label: 'Disk usage',                command: 'sudo docker system df' },
        { label: 'Networks',                  command: 'sudo docker network ls' },
        { label: 'Volumes',                   command: 'sudo docker volume ls' },
        { label: 'Compose status',            command: 'sudo docker compose ps 2>/dev/null || sudo docker-compose ps' },
        { label: 'Compose up',                command: 'sudo docker compose up -d 2>/dev/null || sudo docker-compose up -d' },
        { label: 'Compose down',              command: 'sudo docker compose down 2>/dev/null || sudo docker-compose down', dangerous: true },
        { label: 'Compose restart',           command: 'sudo docker compose restart 2>/dev/null || sudo docker-compose restart', dangerous: true },
        { label: 'Prune unused (DANGER)',     command: 'sudo docker system prune -f',    dangerous: true },
        ...(service.containerName ? [
          { label: `Restart: ${service.containerName}`, command: `sudo docker restart ${service.containerName}`, dangerous: true },
          { label: `Stop: ${service.containerName}`,    command: `sudo docker stop ${service.containerName}`,    dangerous: true },
        ] : []),
      ];

    default:
      return [
        { label: 'Service status',  command: `sudo systemctl status ${service.name} --no-pager` },
        { label: 'Restart',         command: `sudo systemctl restart ${service.name}`,  dangerous: true },
        { label: 'Reload',          command: `sudo systemctl reload ${service.name}` },
        { label: 'Stop',            command: `sudo systemctl stop ${service.name}`,     dangerous: true },
        { label: 'Start',           command: `sudo systemctl start ${service.name}` },
      ];
  }
}

// ── Input validation for DB management ───────────────────────────────────────

export const SAFE_DB_NAME   = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
export const SAFE_DB_USER   = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

export function buildCreateDatabase(service: ServiceConfig, dbName: string): string {
  if (service.type === 'postgres') {
    const u = service.dbUser ?? 'postgres';
    const p = service.dbPort ? `-p ${service.dbPort}` : '';
    return `psql -U ${u} ${p} -c "CREATE DATABASE \\"${dbName}\\""`;
  }
  return `mysql -u ${service.dbUser ?? 'root'} -e "CREATE DATABASE \`${dbName}\`;"`;
}

export function buildDropDatabase(service: ServiceConfig, dbName: string): string {
  if (service.type === 'postgres') {
    const u = service.dbUser ?? 'postgres';
    const p = service.dbPort ? `-p ${service.dbPort}` : '';
    return `psql -U ${u} ${p} -c "DROP DATABASE \\"${dbName}\\""`;
  }
  return `mysql -u ${service.dbUser ?? 'root'} -e "DROP DATABASE \`${dbName}\`;"`;
}

export function buildCreateUser(service: ServiceConfig, userName: string, password: string): string {
  if (service.type === 'postgres') {
    const u = service.dbUser ?? 'postgres';
    const p = service.dbPort ? `-p ${service.dbPort}` : '';
    return `psql -U ${u} ${p} -c "CREATE USER \\"${userName}\\" WITH PASSWORD '${password.replace(/'/g, "\\'")}'"`;
  }
  return `mysql -u ${service.dbUser ?? 'root'} -e "CREATE USER '${userName}'@'%' IDENTIFIED BY '${password.replace(/'/g, "\\'")}';"`;
}

export function buildGrantPrivileges(service: ServiceConfig, userName: string, dbName: string): string {
  if (service.type === 'postgres') {
    const u = service.dbUser ?? 'postgres';
    const p = service.dbPort ? `-p ${service.dbPort}` : '';
    return `psql -U ${u} ${p} -c "GRANT ALL PRIVILEGES ON DATABASE \\"${dbName}\\" TO \\"${userName}\\""`;
  }
  return `mysql -u ${service.dbUser ?? 'root'} -e "GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${userName}'@'%'; FLUSH PRIVILEGES;"`;
}

export function buildListUsers(service: ServiceConfig): string {
  if (service.type === 'postgres') {
    const u = service.dbUser ?? 'postgres';
    const p = service.dbPort ? `-p ${service.dbPort}` : '';
    return `psql -U ${u} ${p} -c "\\du"`;
  }
  return `mysql -u ${service.dbUser ?? 'root'} -e "SELECT User, Host, plugin FROM mysql.user;"`;
}

export function buildChangePassword(service: ServiceConfig, userName: string, password: string): string {
  if (service.type === 'postgres') {
    const u = service.dbUser ?? 'postgres';
    const p = service.dbPort ? `-p ${service.dbPort}` : '';
    return `psql -U ${u} ${p} -c "ALTER USER \\"${userName}\\" WITH PASSWORD '${password.replace(/'/g, "\\'")}';"`;
  }
  return `mysql -u ${service.dbUser ?? 'root'} -e "ALTER USER '${userName}'@'%' IDENTIFIED BY '${password.replace(/'/g, "\\'")}'; FLUSH PRIVILEGES;"`;
}
