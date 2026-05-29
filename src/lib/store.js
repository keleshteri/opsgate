import Conf from 'conf';

const store = new Conf({
  projectName: 'opsgate',
  defaults: { profiles: [] },
});

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
