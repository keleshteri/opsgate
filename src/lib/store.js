import Conf from 'conf';
import { chmodSync, existsSync } from 'fs';

const store = new Conf({
  projectName: 'opsgate',
  defaults: { profiles: [] },
});

// Lock config file to owner-only (600) on every startup
try {
  if (existsSync(store.path)) {
    chmodSync(store.path, 0o600);
  }
} catch {
  // Non-fatal: Windows or permission edge case
}

export function getProfiles() {
  return store.get('profiles');
}

export function getProfile(id) {
  return getProfiles().find(p => p.id === id);
}

export function saveProfile(profile) {
  const profiles = getProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  store.set('profiles', profiles);

  // Re-lock permissions after every write
  try { chmodSync(store.path, 0o600); } catch { /* non-fatal */ }
}

export function deleteProfile(id) {
  store.set('profiles', getProfiles().filter(p => p.id !== id));
}

export function getGroups() {
  const profiles = getProfiles();
  return [...new Set(profiles.map(p => p.group).filter(Boolean))].sort();
}

export function touchProfile(id) {
  const profile = getProfile(id);
  if (profile) {
    profile.lastConnected = new Date().toISOString();
    saveProfile(profile);
  }
}

export const storePath = store.path;
