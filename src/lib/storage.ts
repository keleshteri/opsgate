import { mkdirSync, readdirSync, statSync, existsSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

const BASE_DIR = join(homedir(), '.local', 'share', 'opsgate');

export const DIRS = {
  base:    BASE_DIR,
  backups: join(BASE_DIR, 'backups'),
  logs:    join(BASE_DIR, 'logs'),
  files:   join(BASE_DIR, 'files'),
};

// Create all storage directories on first use
export function ensureStorageDirs(): void {
  for (const dir of Object.values(DIRS)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function getBackupDir(profileId: string): string {
  const dir = join(DIRS.backups, profileId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogDir(profileId: string): string {
  const dir = join(DIRS.logs, profileId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getFilesDir(profileId: string): string {
  const dir = join(DIRS.files, profileId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

// ── Generic local file listing (backups, logs, pulled files) ──────────────────

export interface LocalFile {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  mtime: Date;
}

function listDir(dir: string, extensions?: string[]): LocalFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => !extensions || extensions.some(ext => f.endsWith(ext)))
    .map(f => {
      const filePath = join(dir, f);
      const stat = statSync(filePath);
      return { fileName: f, filePath, fileSizeBytes: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()); // newest first
}

export function listLocalBackups(profileId: string): LocalFile[] {
  return listDir(join(DIRS.backups, profileId), ['.sql.gz', '.sql', '.gz']);
}

export function listLocalLogs(profileId: string): LocalFile[] {
  return listDir(join(DIRS.logs, profileId), ['.log', '.log.gz']);
}

export function listLocalFiles(profileId: string): LocalFile[] {
  return listDir(join(DIRS.files, profileId));
}

export function deleteLocalFile(filePath: string): void {
  if (existsSync(filePath)) unlinkSync(filePath);
}

// ── Sanitize a remote path to a safe local filename ──────────────────────────

export function remotePathToFileName(remotePath: string): string {
  // e.g. /etc/nginx/nginx.conf → etc_nginx_nginx.conf
  return remotePath.replace(/^\//, '').replace(/\//g, '_');
}
