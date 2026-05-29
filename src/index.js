#!/usr/bin/env node
import inquirer from 'inquirer';
import { nanoid } from 'nanoid';
import Fuse from 'fuse.js';
import { c, banner, msg, profileSummary, groupColor } from './lib/ui.js';
import { getProfiles, saveProfile, deleteProfile, getGroups, touchProfile, storePath } from './lib/store.js';
import { connect, copySSHKey, buildSSHCommand, testConnection, getConnectMethods } from './lib/ssh.js';

// ─── Main loop ───────────────────────────────────────────────────────────────

async function main() {
  while (true) {
    banner();

    const profiles = getProfiles();
    console.log(c.muted(`  Profiles: ${profiles.length}  •  Config: ${storePath}\n`));

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: c.primary.bold('Main Menu'),
      choices: [
        { name: `${c.warning('⚡')} Connect to server`,      value: 'connect' },
        { name: `${c.primary('📋')} Manage profiles`,        value: 'manage' },
        { name: `${c.secondary('📁')} Browse by group`,      value: 'groups' },
        { name: `${c.primary('🔍')} Search profiles`,        value: 'search' },
        { name: `${c.success('🔑')} Copy SSH key to server`, value: 'copykey' },
        new inquirer.Separator(),
        { name: `${c.muted('✕')} Exit`,                      value: 'exit' },
      ],
      pageSize: 10,
    }]);

    if (action === 'exit') { console.log(c.muted('\nBye!\n')); process.exit(0); }
    if (action === 'connect')  await menuConnect();
    if (action === 'manage')   await menuManage();
    if (action === 'groups')   await menuGroups();
    if (action === 'search')   await menuSearch();
    if (action === 'copykey')  await menuCopyKey();
  }
}

// ─── Connect method picker ────────────────────────────────────────────────────
// If the profile only has one method (public IP) → connect directly.
// If it has 2+ options → show picker first.

async function pickConnectMethod(profile) {
  const methods = getConnectMethods(profile);
  if (methods.length === 1) return methods[0].value;

  const { method } = await inquirer.prompt([{
    type: 'list',
    name: 'method',
    message: c.primary('How do you want to connect?'),
    choices: methods.map(m => ({ name: m.name, value: m.value })),
  }]);

  return method;
}

// ─── Connect ─────────────────────────────────────────────────────────────────

async function menuConnect(prefilter = null) {
  let profiles = getProfiles();
  if (prefilter) profiles = profiles.filter(p => p.group === prefilter);

  if (profiles.length === 0) {
    msg('No profiles found. Add one first.', 'error');
    await pause();
    return;
  }

  banner();
  const { id } = await inquirer.prompt([{
    type: 'list',
    name: 'id',
    message: c.primary.bold('Select a server to connect:'),
    choices: [
      ...profiles.map(p => ({ name: profileSummary(p), value: p.id })),
      new inquirer.Separator(),
      { name: c.muted('← Back'), value: '__back__' },
    ],
    pageSize: 15,
  }]);

  if (id === '__back__') return;

  const profile = profiles.find(p => p.id === id);
  const method  = await pickConnectMethod(profile);

  banner();
  console.log(c.primary.bold(`  Connecting to: `) + c.secondary(profile.name));
  console.log(c.muted(`  Method:  `) + c.warning(method));
  console.log(c.muted(`  Command: `) + c.text(buildSSHCommand(profile, method)));

  printProfileDetail(profile);

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Connect now?',
    default: true,
  }]);

  if (confirm) {
    touchProfile(profile.id);
    console.log(c.success('\n  Launching SSH...\n'));
    connect(profile, method);
  }
}

// ─── Manage ──────────────────────────────────────────────────────────────────

async function menuManage() {
  while (true) {
    banner();
    const profiles = getProfiles();

    const choices = profiles.length > 0
      ? [
          ...profiles.map(p => ({ name: profileSummary(p), value: `view:${p.id}` })),
          new inquirer.Separator(),
        ]
      : [{ name: c.muted('(no profiles yet)'), value: '__none__', disabled: true }, new inquirer.Separator()];

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: c.primary.bold('Manage Profiles'),
      choices: [
        ...choices,
        { name: `${c.success('+')} Add new profile`, value: '__add__' },
        { name: c.muted('← Back'),                   value: '__back__' },
      ],
      pageSize: 15,
    }]);

    if (action === '__back__') return;
    if (action === '__add__')  { await formAddProfile(); continue; }
    if (action.startsWith('view:')) {
      await menuProfileActions(action.slice(5));
    }
  }
}

async function menuProfileActions(id) {
  const profile = getProfiles().find(p => p.id === id);
  if (!profile) return;

  banner();
  console.log(c.primary.bold(`  Profile: `) + c.secondary(profile.name));
  console.log(c.muted(`  Host:    `) + c.text(`${profile.user}@${profile.host}:${profile.port}`));
  if (profile.hostPrivate)         console.log(c.muted(`  Private: `) + c.text(profile.hostPrivate));
  if (profile.keyPath)             console.log(c.muted(`  Key:     `) + c.text(profile.keyPath));
  if (profile.jumpHost)            console.log(c.muted(`  Jump:    `) + c.text(profile.jumpHost));
  if (profile.cloudflaredHostname) console.log(c.muted(`  CF Tunnel: `) + c.primary(profile.cloudflaredHostname));
  if (profile.proxyCommand)        console.log(c.muted(`  Proxy:   `) + c.text(profile.proxyCommand));
  if (profile.notes)               console.log(c.muted(`  Notes:   `) + c.text(profile.notes));
  printProfileDetail(profile);
  console.log();

  const methods = getConnectMethods(profile);

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: 'Actions',
    choices: [
      { name: `${c.warning('⚡')} Connect`,         value: 'connect' },
      { name: `${c.primary('✏')}  Edit profile`,    value: 'edit' },
      { name: `${c.success('🔑')} Copy SSH key`,    value: 'copykey' },
      { name: `${c.primary('📡')} Test connection`, value: 'test' },
      { name: `${c.error('✗')}  Delete profile`,    value: 'delete' },
      new inquirer.Separator(),
      { name: c.muted('← Back'),                    value: 'back' },
    ],
  }]);

  if (action === 'back')    return;
  if (action === 'edit')    { await formEditProfile(profile); return; }
  if (action === 'delete')  { await confirmDelete(id); return; }
  if (action === 'copykey') { await menuCopyKey(profile); return; }

  if (action === 'connect') {
    const method = await pickConnectMethod(profile);
    touchProfile(id);
    console.log(c.success('\n  Launching SSH...\n'));
    connect(profile, method);
    return;
  }

  if (action === 'test') {
    const method = await pickConnectMethod(profile);
    console.log(c.muted(`\n  Testing ${method} connection (timeout 5s)...`));
    const ok = testConnection(profile, method);
    msg(ok ? 'Connection successful!' : 'Connection failed.', ok ? 'success' : 'error');
    await pause();
  }
}

async function confirmDelete(id) {
  const profile = getProfiles().find(p => p.id === id);
  const { yes } = await inquirer.prompt([{
    type: 'confirm',
    name: 'yes',
    message: c.error(`Delete profile "${profile?.name}"? This cannot be undone.`),
    default: false,
  }]);
  if (yes) { deleteProfile(id); msg('Profile deleted.', 'success'); await pause(); }
}

// ─── Add / Edit forms ────────────────────────────────────────────────────────

async function formAddProfile() {
  banner();
  console.log(c.primary.bold('  Add New Profile\n'));

  const answers = await askProfileFields({});
  const profile = { id: nanoid(), tunnels: [], ...answers, createdAt: new Date().toISOString() };

  if (answers.addTunnels) {
    profile.tunnels = await askTunnels();
  }
  delete profile.addTunnels;

  saveProfile(profile);
  msg(`Profile "${profile.name}" saved!`, 'success');
  await pause();
}

async function formEditProfile(profile) {
  banner();
  console.log(c.primary.bold(`  Edit Profile: ${profile.name}\n`));

  const answers = await askProfileFields(profile);
  const updated = { ...profile, ...answers };

  if (answers.addTunnels) {
    updated.tunnels = await askTunnels(profile.tunnels);
  }
  delete updated.addTunnels;

  saveProfile(updated);
  msg(`Profile "${updated.name}" updated!`, 'success');
  await pause();
}

async function askProfileFields(defaults = {}) {
  return inquirer.prompt([
    // ── Basic ──────────────────────────────────────────────────────────────
    {
      type: 'input', name: 'name',
      message: 'Profile name (alias):',
      default: defaults.name,
      validate: v => v.trim() ? true : 'Name is required',
    },
    {
      type: 'input', name: 'user',
      message: 'SSH user:',
      default: defaults.user ?? 'ubuntu',
      validate: v => v.trim() ? true : 'User is required',
    },
    {
      type: 'number', name: 'port',
      message: 'SSH port:',
      default: defaults.port ?? 22,
    },
    {
      type: 'input', name: 'keyPath',
      message: 'Path to SSH private key (leave blank to skip):',
      default: defaults.keyPath ?? '',
    },

    // ── IPs ────────────────────────────────────────────────────────────────
    {
      type: 'input', name: 'host',
      message: `Public IP or hostname ${c.muted('(required)')}:`,
      default: defaults.host,
      validate: v => v.trim() ? true : 'Public host is required',
    },
    {
      type: 'input', name: 'hostPrivate',
      message: `Private / internal IP ${c.muted('(optional — e.g. GCP internal IP)')}:`,
      default: defaults.hostPrivate ?? '',
    },

    // ── Connectivity options ───────────────────────────────────────────────
    {
      type: 'input', name: 'jumpHost',
      message: `Jump host / bastion ${c.muted('(user@host:port — optional)')}:`,
      default: defaults.jumpHost ?? '',
    },
    {
      type: 'input', name: 'cloudflaredHostname',
      message: `Cloudflare Tunnel hostname ${c.muted('(e.g. ssh.example.com — optional)')}:`,
      default: defaults.cloudflaredHostname ?? '',
    },
    {
      type: 'input', name: 'proxyCommand',
      message: `ProxyCommand ${c.muted('(custom proxy, e.g. nc %h %p — optional)')}:`,
      default: defaults.proxyCommand ?? '',
    },

    // ── Metadata ───────────────────────────────────────────────────────────
    {
      type: 'list', name: 'group',
      message: 'Environment group:',
      choices: ['dev', 'staging', 'prod', 'database', 'monitoring', 'custom'],
      default: defaults.group ?? 'dev',
    },
    {
      type: 'input', name: 'tags',
      message: `Tags ${c.muted('(comma-separated, e.g. k8s,web)')}:`,
      default: (defaults.tags ?? []).join(','),
      filter: v => v.split(',').map(t => t.trim()).filter(Boolean),
    },
    {
      type: 'input', name: 'notes',
      message: 'Notes (optional):',
      default: defaults.notes ?? '',
    },
    {
      type: 'confirm', name: 'addTunnels',
      message: 'Configure SSH tunnels?',
      default: false,
    },
  ]);
}

// ─── Tunnel wizard ────────────────────────────────────────────────────────────

async function askTunnels(existing = []) {
  const tunnels = [...existing];

  while (true) {
    banner();
    if (tunnels.length > 0) {
      console.log(c.primary.bold('  Current tunnels:'));
      tunnels.forEach((t, i) => {
        if (t.type === 'local')   console.log(c.muted(`  ${i + 1}. L  localhost:${t.localPort} → ${t.remoteHost}:${t.remotePort}`));
        if (t.type === 'remote')  console.log(c.muted(`  ${i + 1}. R  remote:${t.localPort} → ${t.remoteHost}:${t.remotePort}`));
        if (t.type === 'dynamic') console.log(c.muted(`  ${i + 1}. D  SOCKS localhost:${t.localPort}`));
      });
      console.log();
    }

    const { action } = await inquirer.prompt([{
      type: 'list', name: 'action',
      message: 'Tunnels',
      choices: [
        { name: '+ Add local port forward (L)  — e.g. forward remote DB to localhost',  value: 'local' },
        { name: '+ Add remote port forward (R) — e.g. expose local port on server',      value: 'remote' },
        { name: '+ Add dynamic SOCKS proxy (D) — route traffic through server',          value: 'dynamic' },
        ...(tunnels.length > 0 ? [{ name: c.error('✗ Remove a tunnel'), value: 'remove' }] : []),
        new inquirer.Separator(),
        { name: c.success('✓ Done'), value: 'done' },
      ],
    }]);

    if (action === 'done') break;

    if (action === 'remove') {
      const { idx } = await inquirer.prompt([{
        type: 'list', name: 'idx',
        message: 'Which tunnel to remove?',
        choices: tunnels.map((t, i) => ({
          name: t.type === 'dynamic'
            ? `SOCKS :${t.localPort}`
            : `${t.type === 'local' ? 'L' : 'R'} :${t.localPort} → ${t.remoteHost}:${t.remotePort}`,
          value: i,
        })),
      }]);
      tunnels.splice(idx, 1);
      continue;
    }

    if (action === 'dynamic') {
      const { localPort } = await inquirer.prompt([
        { type: 'number', name: 'localPort', message: 'Local SOCKS port:', default: 1080 },
      ]);
      tunnels.push({ type: 'dynamic', localPort });
    } else {
      const t = await inquirer.prompt([
        { type: 'number', name: 'localPort',  message: 'Local port:',   default: 8080 },
        { type: 'input',  name: 'remoteHost', message: 'Remote host:',  default: 'localhost' },
        { type: 'number', name: 'remotePort', message: 'Remote port:',  default: 80 },
      ]);
      tunnels.push({ type: action, ...t });
    }
  }

  return tunnels;
}

// ─── Groups ──────────────────────────────────────────────────────────────────

async function menuGroups() {
  const groups = getGroups();

  if (groups.length === 0) {
    msg('No groups yet. Add some profiles first.', 'error');
    await pause();
    return;
  }

  banner();
  const { group } = await inquirer.prompt([{
    type: 'list',
    name: 'group',
    message: c.primary.bold('Browse by group:'),
    choices: [
      ...groups.map(g => {
        const count = getProfiles().filter(p => p.group === g).length;
        return { name: `${groupColor(g)}  ${c.muted(`(${count} server${count !== 1 ? 's' : ''})`)}`, value: g };
      }),
      new inquirer.Separator(),
      { name: c.muted('← Back'), value: '__back__' },
    ],
  }]);

  if (group !== '__back__') await menuConnect(group);
}

// ─── Search ──────────────────────────────────────────────────────────────────

async function menuSearch() {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    msg('No profiles to search.', 'error');
    await pause();
    return;
  }

  banner();
  const { query } = await inquirer.prompt([{
    type: 'input',
    name: 'query',
    message: c.primary('Search (name, host, private IP, user, tags, group):'),
  }]);

  if (!query.trim()) return;

  const fuse = new Fuse(profiles, {
    keys: ['name', 'host', 'hostPrivate', 'user', 'group', 'tags', 'notes', 'cloudflaredHostname'],
    threshold: 0.4,
  });

  const results = fuse.search(query).map(r => r.item);

  if (results.length === 0) {
    msg(`No profiles match "${query}"`, 'error');
    await pause();
    return;
  }

  const { id } = await inquirer.prompt([{
    type: 'list',
    name: 'id',
    message: c.primary(`Found ${results.length} result(s):`),
    choices: [
      ...results.map(p => ({ name: profileSummary(p), value: p.id })),
      new inquirer.Separator(),
      { name: c.muted('← Back'), value: '__back__' },
    ],
    pageSize: 15,
  }]);

  if (id !== '__back__') await menuProfileActions(id);
}

// ─── Copy SSH key ─────────────────────────────────────────────────────────────

async function menuCopyKey(preselect = null) {
  banner();
  console.log(c.primary.bold('  Copy SSH Key to Server\n'));
  console.log(c.muted('  This runs ssh-copy-id to push your public key to the remote server.\n'));

  let profile = preselect;

  if (!profile) {
    const profiles = getProfiles();
    if (profiles.length === 0) {
      msg('No profiles found. Add one first.', 'error');
      await pause();
      return;
    }
    const { id } = await inquirer.prompt([{
      type: 'list',
      name: 'id',
      message: 'Select target server:',
      choices: [
        ...profiles.map(p => ({ name: profileSummary(p), value: p.id })),
        new inquirer.Separator(),
        { name: c.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    }]);
    if (id === '__back__') return;
    profile = profiles.find(p => p.id === id);
  }

  // Pick IP if private is available
  const methods = getConnectMethods(profile).filter(m => m.value === 'public' || m.value === 'private');
  let method = 'public';
  if (methods.length > 1) {
    const { m } = await inquirer.prompt([{
      type: 'list', name: 'm',
      message: 'Copy key via which IP?',
      choices: methods.map(m => ({ name: m.name, value: m.value })),
    }]);
    method = m;
  }

  const { keyPath } = await inquirer.prompt([{
    type: 'input',
    name: 'keyPath',
    message: 'Path to your PUBLIC key (.pub):',
    default: '~/.ssh/id_rsa.pub',
  }]);

  const targetHost = method === 'private' ? profile.hostPrivate : profile.host;

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `Copy ${c.warning(keyPath)} to ${c.secondary(`${profile.user}@${targetHost}`)}?`,
    default: true,
  }]);

  if (confirm) {
    console.log(c.muted('\n  Running ssh-copy-id...\n'));
    const result = copySSHKey(profile, keyPath, method);
    if (result.success) {
      msg('SSH key copied successfully!', 'success');
    } else {
      msg(`Failed: ${result.error}`, 'error');
    }
    await pause();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printProfileDetail(profile) {
  if (profile.tunnels?.length) {
    console.log(c.warning(`  Tunnels:`));
    profile.tunnels.forEach(t => {
      if (t.type === 'local')   console.log(c.muted(`    L  localhost:${t.localPort} → ${t.remoteHost}:${t.remotePort}`));
      if (t.type === 'remote')  console.log(c.muted(`    R  remote:${t.localPort} → ${t.remoteHost}:${t.remotePort}`));
      if (t.type === 'dynamic') console.log(c.muted(`    D  SOCKS proxy on localhost:${t.localPort}`));
    });
  }
  if (profile.jumpHost) {
    console.log(c.warning(`  Jump host: `) + c.muted(profile.jumpHost));
  }
  if (profile.notes) {
    console.log(c.muted(`  Notes: `) + c.text(profile.notes));
  }
}

function pause() {
  return inquirer.prompt([{ type: 'input', name: '_', message: c.muted('Press Enter to continue...') }]);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(c.error('\nFatal error:'), err.message);
  process.exit(1);
});
