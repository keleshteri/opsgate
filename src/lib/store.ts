import Conf from 'conf';
import { chmodSync, existsSync } from 'fs';
import type { Profile, StoreSchema } from './types.js';

const store = new Conf<StoreSchema>({
  projectName: 'opsgate',
  defaults: { profiles: [] },
});

// Lock config file to owner-only (600) on startup
try {
  if (existsSync(store.path)) {
    chmodSync(store.path, 0o600);
  }
} catch {
  // Non-fatal: Windows or restricted env
}

export function getProfiles(): Profile[] {
  return store.get('profiles');
}

export function getProfile(id: string): Profile | undefined {
  return getProfiles().find(p => p.id === id);
}

export function saveProfile(profile: Profile): void {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  store.set('profiles', profiles);

  // Re-lock after every write
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

export const storePath: string = store.path;
