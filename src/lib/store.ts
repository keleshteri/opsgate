import Conf from 'conf';
import { chmodSync, existsSync } from 'fs';
import type { Profile, StoreSchema, BackupRecord, CommandSnippet } from './types.js';

const store = new Conf<StoreSchema>({
  projectName: 'opsgate',
  defaults: { profiles: [], backups: [], globalSnippets: [] },
});

// Lock config file to owner-only (600) on startup
try {
  if (existsSync(store.path)) chmodSync(store.path, 0o600);
} catch { /* non-fatal on Windows */ }

// ── Profile normalization (backwards compat) ──────────────────────────────────

function normalize(profile: Partial<Profile>): Profile {
  return {
    tunnels:  [],
    services: [],
    snippets: [],
    tags:     [],
    group:    'dev',
    port:     22,
    ...profile,
  } as Profile;
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export function getProfiles(): Profile[] {
  return store.get('profiles').map(normalize);
}

export function getProfile(id: string): Profile | undefined {
  return getProfiles().find(p => p.id === id);
}

export function saveProfile(profile: Profile): void {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile; else profiles.push(profile);
  store.set('profiles', profiles);
  try { chmodSync(store.path, 0o600); } catch { /* non-fatal */ }
}

export function deleteProfile(id: string): void {
  store.set('profiles', getProfiles().filter(p => p.id !== id));
}

export function getGroups(): string[] {
  return [...new Set(getProfiles().map(p => p.group).filter(Boolean))].sort();
}

export function touchProfile(id: string): void {
  const profile = getProfile(id);
  if (profile) {
    profile.lastConnected = new Date().toISOString();
    saveProfile(profile);
  }
}

// ── Backup records ────────────────────────────────────────────────────────────

export function getBackups(profileId?: string): BackupRecord[] {
  const all = store.get('backups');
  return profileId ? all.filter(b => b.profileId === profileId) : all;
}

export function saveBackupRecord(record: BackupRecord): void {
  const records = store.get('backups');
  records.unshift(record); // newest first
  store.set('backups', records);
}

export function deleteBackupRecord(id: string): void {
  store.set('backups', store.get('backups').filter(b => b.id !== id));
}

// ── Global snippets ───────────────────────────────────────────────────────────

export function getGlobalSnippets(): CommandSnippet[] {
  return store.get('globalSnippets');
}

export function saveGlobalSnippet(snippet: CommandSnippet): void {
  const snippets = getGlobalSnippets();
  const idx = snippets.findIndex(s => s.id === snippet.id);
  if (idx >= 0) snippets[idx] = snippet; else snippets.push(snippet);
  store.set('globalSnippets', snippets);
}

export function deleteGlobalSnippet(id: string): void {
  store.set('globalSnippets', getGlobalSnippets().filter(s => s.id !== id));
}

export const storePath: string = store.path;
