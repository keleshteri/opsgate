#!/usr/bin/env node
import inquirer from 'inquirer';
import { nanoid } from 'nanoid';
import Fuse from 'fuse.js';
import { c, banner, msg, profileSummary, groupColor } from './lib/ui.js';
import { getProfiles, saveProfile, deleteProfile, getGroups, touchProfile, storePath, saveBackupRecord, getBackups, deleteBackupRecord, getGlobalSnippets, saveGlobalSnippet, deleteGlobalSnippet } from './lib/store.js';
import { connect, copySSHKey, buildSSHCommand, testConnection, getConnectMethods } from './lib/ssh.js';
import { parseSSHConfig, sshConfigExists, sshConfigPath } from './lib/sshconfig.js';
import { runCommand, captureCommand, backupPostgres, backupMySQL, GLOBAL_SNIPPETS, getServiceSnippets } from './lib/runner.js';
import { ensureStorageDirs, getBackupDir, getLogDir, getFilesDir, listLocalBackups, listLocalLogs, listLocalFiles, deleteLocalFile, timestamp, formatSize, formatDate, remotePathToFileName, type LocalFile } from './lib/storage.js';
import { getSystemLogSources, getServiceLogSources } from './lib/logger.js';
import { getServiceActions, buildCreateDatabase, buildDropDatabase, buildCreateUser, buildGrantPrivileges, buildListUsers, buildChangePassword, SAFE_DB_NAME, SAFE_DB_USER } from './lib/servicecontrol.js';
import type { Profile, Tunnel, ConnectMethod, ServiceConfig, CommandSnippet } from './lib/types.js';
import { SERVICE_DEFAULT_PORTS } from './lib/types.js';

ensureStorageDirs();

// ─── Main loop ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  while (true) {
    banner();

    const profiles = getProfiles();
    console.log(c.muted(`  Profiles: ${profiles.length}  •  Config: ${storePath}\n`));

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: c.primary.bold('Main Menu'),
      choices: [
        { name: `${c.warning('⚡')} Connect to server`,      value: 'connect' },
        { name: `${c.primary('📋')} Manage profiles`,        value: 'manage' },
        { name: `${c.secondary('📁')} Browse by group`,      value: 'groups' },
        { name: `${c.primary('🔍')} Search profiles`,        value: 'search' },
        { name: `${c.success('🔑')} Copy SSH key to server`, value: 'copykey' },
        { name: `${c.warning('📥')} Import from ~/.ssh/config`, value: 'import' },
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
    if (action === 'import')   await menuImportSSHConfig();
  }
}

// ─── Connect method picker ────────────────────────────────────────────────────

async function pickConnectMethod(profile: Profile): Promise<ConnectMethod> {
  const methods = getConnectMethods(profile);
  if (methods.length === 1) return methods[0]!.value;

  const { method } = await inquirer.prompt<{ method: ConnectMethod }>([{
    type: 'list',
    name: 'method',
    message: c.primary('How do you want to connect?'),
    choices: methods.map(m => ({ name: m.name, value: m.value })),
  }]);

  return method;
}

// ─── Connect ─────────────────────────────────────────────────────────────────

async function menuConnect(prefilter: string | null = null): Promise<void> {
  let profiles = getProfiles();
  if (prefilter) profiles = profiles.filter(p => p.group === prefilter);

  if (profiles.length === 0) {
    msg('No profiles found. Add one first.', 'error');
    await pause();
    return;
  }

  banner();
  const { id } = await inquirer.prompt<{ id: string }>([{
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

  const profile = profiles.find(p => p.id === id)!;
  const method  = await pickConnectMethod(profile);

  banner();
  console.log(c.primary.bold('  Connecting to: ') + c.secondary(profile.name));
  console.log(c.muted('  Method:  ') + c.warning(method));
  console.log(c.muted('  Command: ') + c.text(buildSSHCommand(profile, method)));
  printProfileDetail(profile);

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
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

async function menuManage(): Promise<void> {
  while (true) {
    banner();
    const profiles = getProfiles();

    const profileChoices = profiles.length > 0
      ? [
          ...profiles.map(p => ({ name: profileSummary(p), value: `view:${p.id}` })),
          new inquirer.Separator(),
        ]
      : [{ name: c.muted('(no profiles yet)'), value: '__none__', disabled: true }, new inquirer.Separator()];

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list',
      name: 'action',
      message: c.primary.bold('Manage Profiles'),
      choices: [
        ...profileChoices,
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

async function menuProfileActions(id: string): Promise<void> {
  const profile = getProfiles().find(p => p.id === id);
  if (!profile) return;

  banner();
  console.log(c.primary.bold('  Profile: ') + c.secondary(profile.name));
  console.log(c.muted('  Host:    ') + c.text(`${profile.user}@${profile.host}:${profile.port}`));
  if (profile.hostPrivate)         console.log(c.muted('  Private: ') + c.text(profile.hostPrivate));
  if (profile.keyPath)             console.log(c.muted('  Key:     ') + c.text(profile.keyPath));
  if (profile.jumpHost)            console.log(c.muted('  Jump:    ') + c.text(profile.jumpHost));
  if (profile.cloudflaredHostname) console.log(c.muted('  CF Tunnel: ') + c.primary(profile.cloudflaredHostname));
  if (profile.proxyCommand)        console.log(c.muted('  Proxy:   ') + c.text(profile.proxyCommand));
  if (profile.notes)               console.log(c.muted('  Notes:   ') + c.text(profile.notes));
  printProfileDetail(profile);
  console.log();

  const hasDB      = profile.services.some(s => ['postgres','mysql'].includes(s.type));
  const hasService = profile.services.length > 0;

  const { action } = await inquirer.prompt<{ action: string }>([{
    type: 'list',
    name: 'action',
    message: 'Actions',
    choices: [
      { name: `${c.warning('⚡')} Connect`,                             value: 'connect' },
      { name: `${c.primary('🚀')} Quick commands`,                      value: 'commands' },
      ...(hasDB      ? [{ name: `${c.secondary('🗄')}  Database operations`, value: 'database' }] : []),
      ...(hasService ? [{ name: `${c.warning('🔧')} Service control`,        value: 'services' }] : []),
      { name: `${c.primary('📋')} Pull logs`,                           value: 'logs' },
      { name: `${c.primary('📁')} Pull files`,                          value: 'files' },
      new inquirer.Separator(),
      { name: `${c.primary('✏')}  Edit profile`,                        value: 'edit' },
      { name: `${c.success('🔑')} Copy SSH key`,                        value: 'copykey' },
      { name: `${c.primary('📡')} Test connection`,                     value: 'test' },
      { name: `${c.error('✗')}  Delete profile`,                        value: 'delete' },
      new inquirer.Separator(),
      { name: c.muted('← Back'),                                         value: 'back' },
    ],
  }]);

  if (action === 'back')     return;
  if (action === 'edit')     { await formEditProfile(profile); return; }
  if (action === 'delete')   { await confirmDelete(id); return; }
  if (action === 'copykey')  { await menuCopyKey(profile); return; }
  if (action === 'commands') { await menuQuickCommands(profile); return; }
  if (action === 'database') { await menuDatabase(profile); return; }
  if (action === 'services') { await menuServiceControl(profile); return; }
  if (action === 'logs')     { await menuPullLogs(profile); return; }
  if (action === 'files')    { await menuPullFiles(profile); return; }

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

async function confirmDelete(id: string): Promise<void> {
  const profile = getProfiles().find(p => p.id === id);
  const { yes } = await inquirer.prompt<{ yes: boolean }>([{
    type: 'confirm',
    name: 'yes',
    message: c.error(`Delete profile "${profile?.name}"? This cannot be undone.`),
    default: false,
  }]);
  if (yes) { deleteProfile(id); msg('Profile deleted.', 'success'); await pause(); }
}

// ─── Add / Edit forms ────────────────────────────────────────────────────────

async function formAddProfile(): Promise<void> {
  banner();
  console.log(c.primary.bold('  Add New Profile\n'));

  const answers = await askProfileFields({});
  const profile: Profile = {
    ...answers,
    id: nanoid(),
    services: [],
    snippets: [],
    createdAt: new Date().toISOString(),
  };

  if (answers.addTunnels)   profile.tunnels  = await askTunnels();
  if (answers.addServices)  profile.services = await askServices();

  const { addTunnels: _t, addServices: _s, ...clean } = profile as Profile & { addTunnels?: boolean; addServices?: boolean };
  saveProfile(clean);
  msg(`Profile "${clean.name}" saved!`, 'success');
  await pause();
}

async function formEditProfile(profile: Profile): Promise<void> {
  banner();
  console.log(c.primary.bold(`  Edit Profile: ${profile.name}\n`));

  const answers = await askProfileFields(profile);
  const updated: Profile = { ...profile, ...answers };

  if (answers.addTunnels)  updated.tunnels  = await askTunnels(profile.tunnels);
  if (answers.addServices) updated.services = await askServices(profile.services);

  const { addTunnels: _t, addServices: _s, ...clean } = updated as Profile & { addTunnels?: boolean; addServices?: boolean };
  saveProfile(clean);
  msg(`Profile "${clean.name}" updated!`, 'success');
  await pause();
}

type ProfileFormAnswers = Omit<Profile, 'id' | 'createdAt' | 'lastConnected'> & { addTunnels: boolean; addServices: boolean };

async function askProfileFields(defaults: Partial<Profile>): Promise<ProfileFormAnswers> {
  return inquirer.prompt<ProfileFormAnswers>([
    // ── Basic ──────────────────────────────────────────────────────────────
    {
      type: 'input', name: 'name',
      message: 'Profile name (alias):',
      default: defaults.name,
      validate: (v: string) => v.trim() ? true : 'Name is required',
    },
    {
      type: 'input', name: 'user',
      message: 'SSH user:',
      default: defaults.user ?? 'ubuntu',
      validate: (v: string) => v.trim() ? true : 'User is required',
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
    // ── SSH Config Alias ───────────────────────────────────────────────────
    // If set, OpsGate delegates routing entirely to ~/.ssh/config.
    // Use this for complex setups like CF tunnel + ProxyJump chains.
    {
      type: 'input', name: 'sshConfigAlias',
      message: `SSH config alias ${c.muted('(e.g. vm:us-db-prod from ~/.ssh/config — optional)')}:`,
      default: defaults.sshConfigAlias ?? '',
    },

    // ── IPs ────────────────────────────────────────────────────────────────
    {
      type: 'input', name: 'host',
      message: `Public IP or hostname ${c.muted('(required — or CF tunnel hostname if alias not set)')}:`,
      default: defaults.host,
      validate: (v: string) => v.trim() ? true : 'Public host is required',
    },
    {
      type: 'input', name: 'hostPrivate',
      message: `Private / internal IP ${c.muted('(optional — e.g. GCP VPC IP 10.x.x.x)')}:`,
      default: defaults.hostPrivate ?? '',
    },

    // ── Routing ────────────────────────────────────────────────────────────
    {
      type: 'input', name: 'cloudflaredHostname',
      message: `Cloudflare Tunnel hostname ${c.muted('(e.g. ssh.fentufsm.com — optional)')}:`,
      default: defaults.cloudflaredHostname ?? '',
    },
    {
      type: 'input', name: 'jumpHost',
      message: `Jump host / bastion ${c.muted('(user@host:port — optional, for direct network access)')}:`,
      default: defaults.jumpHost ?? '',
    },
    {
      type: 'input', name: 'proxyCommand',
      message: `ProxyCommand ${c.muted('(optional — overrides all routing above)')}:`,
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
      filter: (v: string) => v.split(',').map((t: string) => t.trim()).filter(Boolean),
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
    {
      type: 'confirm', name: 'addServices',
      message: 'Configure services on this VM? (DB, Docker, Nginx...)',
      default: false,
    },
  ]);
}

// ─── Tunnel wizard ────────────────────────────────────────────────────────────

async function askTunnels(existing: Tunnel[] = []): Promise<Tunnel[]> {
  const tunnels: Tunnel[] = [...existing];

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

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list', name: 'action',
      message: 'Tunnels',
      choices: [
        { name: '+ Add local port forward (L)  — forward remote service to localhost', value: 'local' },
        { name: '+ Add remote port forward (R) — expose local port on server',          value: 'remote' },
        { name: '+ Add dynamic SOCKS proxy (D) — route traffic through server',         value: 'dynamic' },
        ...(tunnels.length > 0 ? [{ name: c.error('✗ Remove a tunnel'), value: 'remove' }] : []),
        new inquirer.Separator(),
        { name: c.success('✓ Done'), value: 'done' },
      ],
    }]);

    if (action === 'done') break;

    if (action === 'remove') {
      const { idx } = await inquirer.prompt<{ idx: number }>([{
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
      const { localPort } = await inquirer.prompt<{ localPort: number }>([
        { type: 'number', name: 'localPort', message: 'Local SOCKS port:', default: 1080 },
      ]);
      tunnels.push({ type: 'dynamic', localPort });
    } else {
      const t = await inquirer.prompt<{ localPort: number; remoteHost: string; remotePort: number }>([
        { type: 'number', name: 'localPort',  message: 'Local port:',   default: 8080 },
        { type: 'input',  name: 'remoteHost', message: 'Remote host:',  default: 'localhost' },
        { type: 'number', name: 'remotePort', message: 'Remote port:',  default: 80 },
      ]);
      tunnels.push({ type: action as 'local' | 'remote', ...t });
    }
  }

  return tunnels;
}

// ─── Groups ──────────────────────────────────────────────────────────────────

async function menuGroups(): Promise<void> {
  const groups = getGroups();

  if (groups.length === 0) {
    msg('No groups yet. Add some profiles first.', 'error');
    await pause();
    return;
  }

  banner();
  const { group } = await inquirer.prompt<{ group: string }>([{
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

async function menuSearch(): Promise<void> {
  const profiles = getProfiles();
  if (profiles.length === 0) {
    msg('No profiles to search.', 'error');
    await pause();
    return;
  }

  banner();
  const { query } = await inquirer.prompt<{ query: string }>([{
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

  const { id } = await inquirer.prompt<{ id: string }>([{
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

async function menuCopyKey(preselect: Profile | null = null): Promise<void> {
  banner();
  console.log(c.primary.bold('  Copy SSH Key to Server\n'));
  console.log(c.muted('  Runs ssh-copy-id to push your public key to the remote server.\n'));

  let profile = preselect;

  if (!profile) {
    const profiles = getProfiles();
    if (profiles.length === 0) {
      msg('No profiles found. Add one first.', 'error');
      await pause();
      return;
    }
    const { id } = await inquirer.prompt<{ id: string }>([{
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
    profile = profiles.find(p => p.id === id)!;
  }

  // Only show public/private for key copy (CF tunnel / ProxyCommand don't support it)
  const methods = getConnectMethods(profile).filter(m => m.value === 'public' || m.value === 'private');
  let method: ConnectMethod = 'public';
  if (methods.length > 1) {
    const { m } = await inquirer.prompt<{ m: ConnectMethod }>([{
      type: 'list', name: 'm',
      message: 'Copy key via which IP?',
      choices: methods.map(m => ({ name: m.name, value: m.value })),
    }]);
    method = m;
  }

  const { keyPath } = await inquirer.prompt<{ keyPath: string }>([{
    type: 'input',
    name: 'keyPath',
    message: 'Path to your PUBLIC key (.pub):',
    default: '~/.ssh/id_rsa.pub',
  }]);

  const targetHost = method === 'private' ? profile.hostPrivate : profile.host;

  const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
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

// ─── Services wizard ─────────────────────────────────────────────────────────

async function askServices(existing: ServiceConfig[] = []): Promise<ServiceConfig[]> {
  const services: ServiceConfig[] = [...existing];

  while (true) {
    banner();
    if (services.length > 0) {
      console.log(c.primary.bold('  Configured services:'));
      services.forEach((s, i) => {
        const details = [
          s.dbName ? `db: ${s.dbName}` : '',
          s.dbUser ? `user: ${s.dbUser}` : '',
          s.dbPort ? `port: ${s.dbPort}` : '',
          s.containerName ? `container: ${s.containerName}` : '',
        ].filter(Boolean).join('  ');
        console.log(c.muted(`  ${i + 1}. ${c.warning(s.type.padEnd(10))} ${c.text(s.name)}  ${c.muted(details)}`));
      });
      console.log();
    }

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list', name: 'action',
      message: 'Services',
      choices: [
        { name: '+ Add PostgreSQL',   value: 'postgres' },
        { name: '+ Add MySQL',        value: 'mysql' },
        { name: '+ Add Redis',        value: 'redis' },
        { name: '+ Add Docker',       value: 'docker' },
        { name: '+ Add Nginx',        value: 'nginx' },
        { name: '+ Add custom',       value: 'custom' },
        ...(services.length > 0 ? [{ name: c.error('✗ Remove a service'), value: 'remove' }] : []),
        new inquirer.Separator(),
        { name: c.success('✓ Done'), value: 'done' },
      ],
    }]);

    if (action === 'done') break;

    if (action === 'remove') {
      const { idx } = await inquirer.prompt<{ idx: number }>([{
        type: 'list', name: 'idx',
        message: 'Which service to remove?',
        choices: services.map((s, i) => ({ name: `${s.type} — ${s.name}`, value: i })),
      }]);
      services.splice(idx, 1);
      continue;
    }

    const defaultPort = SERVICE_DEFAULT_PORTS[action as keyof typeof SERVICE_DEFAULT_PORTS] ?? 0;
    const isDB = ['postgres', 'mysql'].includes(action);
    const isDocker = action === 'docker';

    const fields = await inquirer.prompt<{
      name: string; dbName?: string; dbUser?: string; dbPort?: number; containerName?: string;
    }>([
      {
        type: 'input', name: 'name',
        message: `Display name (e.g. fentu_prod):`,
        validate: (v: string) => v.trim() ? true : 'Required',
      },
      ...(isDB ? [
        { type: 'input',  name: 'dbName', message: 'Database name:', default: '' },
        { type: 'input',  name: 'dbUser', message: 'Database user:', default: '' },
        { type: 'number', name: 'dbPort', message: 'Port:', default: defaultPort },
      ] : []),
      ...(isDocker ? [
        { type: 'input', name: 'containerName', message: 'Container name (optional):', default: '' },
      ] : []),
      ...(!isDB && !isDocker && defaultPort > 0 ? [
        { type: 'number', name: 'dbPort', message: 'Port:', default: defaultPort },
      ] : []),
    ]);

    services.push({
      id: nanoid(),
      type: action as ServiceConfig['type'],
      name: fields.name,
      dbName: fields.dbName || undefined,
      dbUser: fields.dbUser || undefined,
      dbPort: fields.dbPort || undefined,
      containerName: fields.containerName || undefined,
    });
  }

  return services;
}

// ─── Quick Commands menu ──────────────────────────────────────────────────────

async function menuQuickCommands(profile: Profile): Promise<void> {
  while (true) {
    banner();
    console.log(c.primary.bold(`  Quick Commands — ${profile.name}\n`));

    const method = await pickConnectMethod(profile);

    // Build choices: global built-ins + service-specific + profile snippets + custom globals
    const builtInChoices = GLOBAL_SNIPPETS.map(s => ({
      name: `${c.muted('global')}  ${c.text(s.name.padEnd(25))} ${c.muted(s.description ?? '')}`,
      value: `builtin:${s.name}`,
    }));

    const serviceChoices: { name: string; value: string }[] = [];
    for (const svc of profile.services) {
      const cmds = getServiceSnippets(svc);
      for (const cmd of cmds) {
        serviceChoices.push({
          name: `${c.warning(svc.type.padEnd(10))} ${c.text(cmd.name)}`,
          value: `svc:${svc.id}:${cmd.name}`,
        });
      }
    }

    const profileSnippetChoices = profile.snippets.map(s => ({
      name: `${c.secondary('custom')}  ${c.text(s.name.padEnd(24))} ${c.muted(s.description ?? '')}`,
      value: `snippet:${s.id}`,
    }));

    const { choice } = await inquirer.prompt<{ choice: string }>([{
      type: 'list',
      name: 'choice',
      message: 'Select command to run:',
      choices: [
        ...(builtInChoices.length    ? [new inquirer.Separator('── Global ──'), ...builtInChoices]    : []),
        ...(serviceChoices.length    ? [new inquirer.Separator('── Services ──'), ...serviceChoices]  : []),
        ...(profileSnippetChoices.length ? [new inquirer.Separator('── Custom ──'), ...profileSnippetChoices] : []),
        new inquirer.Separator(),
        { name: `${c.success('+')} Add custom snippet to this profile`, value: '__add__' },
        { name: `${c.primary('✎')} Manage profile snippets`,           value: '__manage__' },
        { name: c.muted('← Back'),                                      value: '__back__' },
      ],
      pageSize: 20,
    }]);

    if (choice === '__back__') return;
    if (choice === '__add__')    { await addSnippetToProfile(profile); continue; }
    if (choice === '__manage__') { await manageProfileSnippets(profile); continue; }

    // Resolve the command string
    let command = '';
    if (choice.startsWith('builtin:')) {
      const name = choice.slice(8);
      command = GLOBAL_SNIPPETS.find(s => s.name === name)?.command ?? '';
    } else if (choice.startsWith('svc:')) {
      const [, svcId, cmdName] = choice.split(':');
      const svc = profile.services.find(s => s.id === svcId);
      if (svc) command = getServiceSnippets(svc).find(c => c.name === cmdName)?.command ?? '';
    } else if (choice.startsWith('snippet:')) {
      const id = choice.slice(8);
      command = profile.snippets.find(s => s.id === id)?.command ?? '';
    }

    if (!command) continue;

    banner();
    console.log(c.primary.bold(`  Running on: `) + c.secondary(profile.name));
    console.log(c.muted(`  $ `) + c.text(command));
    console.log();

    const code = runCommand(profile, method, command);
    console.log();
    if (code !== 0) msg(`Command exited with code ${code}`, 'error');
    await pause();
  }
}

async function addSnippetToProfile(profile: Profile): Promise<void> {
  const { name, command, description } = await inquirer.prompt<{
    name: string; command: string; description: string;
  }>([
    { type: 'input', name: 'name',        message: 'Snippet name:',        validate: (v: string) => v.trim() ? true : 'Required' },
    { type: 'input', name: 'command',     message: 'Command to run:',      validate: (v: string) => v.trim() ? true : 'Required' },
    { type: 'input', name: 'description', message: 'Description (optional):', default: '' },
  ]);

  profile.snippets.push({ id: nanoid(), name, command, description: description || undefined });
  saveProfile(profile);
  msg(`Snippet "${name}" added!`, 'success');
  await pause();
}

async function manageProfileSnippets(profile: Profile): Promise<void> {
  if (profile.snippets.length === 0) {
    msg('No custom snippets yet. Add one first.', 'info');
    await pause();
    return;
  }

  const { id } = await inquirer.prompt<{ id: string }>([{
    type: 'list', name: 'id',
    message: 'Select snippet to delete:',
    choices: [
      ...profile.snippets.map(s => ({ name: `${s.name}  ${c.muted(s.command.slice(0, 40))}`, value: s.id })),
      new inquirer.Separator(),
      { name: c.muted('← Back'), value: '__back__' },
    ],
  }]);

  if (id === '__back__') return;

  const { yes } = await inquirer.prompt<{ yes: boolean }>([{
    type: 'confirm', name: 'yes',
    message: c.error('Delete this snippet?'),
    default: false,
  }]);

  if (yes) {
    profile.snippets = profile.snippets.filter(s => s.id !== id);
    saveProfile(profile);
    msg('Snippet deleted.', 'success');
    await pause();
  }
}

// ─── Database Operations menu ─────────────────────────────────────────────────

async function menuDatabase(profile: Profile): Promise<void> {
  const dbServices = profile.services.filter(s => ['postgres', 'mysql'].includes(s.type));

  if (dbServices.length === 0) {
    msg('No database services configured. Edit this profile to add one.', 'error');
    await pause();
    return;
  }

  // If multiple DB services, pick one
  let service = dbServices[0]!;
  if (dbServices.length > 1) {
    const { svcId } = await inquirer.prompt<{ svcId: string }>([{
      type: 'list', name: 'svcId',
      message: 'Which database?',
      choices: dbServices.map(s => ({
        name: `${c.warning(s.type)}  ${s.name}${s.dbName ? `  (${s.dbName})` : ''}`,
        value: s.id,
      })),
    }]);
    service = dbServices.find(s => s.id === svcId)!;
  }

  while (true) {
    banner();
    console.log(c.primary.bold(`  Database — ${profile.name}`));
    console.log(c.muted(`  Service: ${service.type}  •  DB: ${service.dbName ?? '?'}  •  User: ${service.dbUser ?? '?'}  •  Port: ${service.dbPort ?? '?'}\n`));

    const backups = listLocalBackups(profile.id);

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list', name: 'action',
      message: 'Database Operations',
      choices: [
        { name: `${c.success('💾')} Backup now`,          value: 'backup' },
        { name: `${c.primary('📋')} List databases`,      value: 'listdbs' },
        { name: `${c.primary('📋')} List tables`,         value: 'listtables' },
        { name: `${c.primary('📊')} Database size`,       value: 'size' },
        { name: `${c.warning('📡')} Active connections`,        value: 'connections' },
        new inquirer.Separator(),
        { name: `${c.secondary('👤')} Manage users & databases`, value: 'manage' },
        ...(backups.length > 0 ? [
          new inquirer.Separator(),
          { name: `${c.secondary('🕐')} Backup history (${backups.length} backups)`, value: 'history' },
        ] : []),
        new inquirer.Separator(),
        { name: c.muted('← Back'), value: 'back' },
      ],
    }]);

    if (action === 'back') return;

    const method = await pickConnectMethod(profile);

    if (action === 'backup') {
      await doBackup(profile, service, method);
      continue;
    }

    if (action === 'history') {
      await menuBackupHistory(profile, service);
      continue;
    }

    if (action === 'manage') {
      await menuDBManagement(profile, service, method);
      continue;
    }

    // Run an info command
    const snippets = getServiceSnippets(service);
    const cmdMap: Record<string, string> = {
      listdbs:     snippets.find(s => s.name.includes('List databases'))?.command    ?? '',
      listtables:  service.type === 'postgres'
        ? `psql -U ${service.dbUser ?? 'postgres'} ${service.dbPort ? `-p ${service.dbPort}` : ''} ${service.dbName ? `-d ${service.dbName}` : ''} -c "\\dt"`
        : `mysql -u ${service.dbUser ?? 'root'} ${service.dbName ?? ''} -e "SHOW TABLES;"`,
      size:        snippets.find(s => s.name.includes('size'))?.command              ?? '',
      connections: snippets.find(s => s.name.includes('connections') || s.name.includes('Processlist'))?.command ?? '',
    };

    const command = cmdMap[action];
    if (!command) { msg('Command not available for this service type.', 'error'); await pause(); continue; }

    banner();
    console.log(c.primary.bold(`  Running: `) + c.muted(command));
    console.log();
    runCommand(profile, method, command);
    console.log();
    await pause();
  }
}

async function doBackup(profile: Profile, service: ServiceConfig, method: ConnectMethod): Promise<void> {
  banner();
  const ts      = timestamp();
  const dbLabel = service.dbName ?? service.name;
  const fileName = `${ts}_${dbLabel}.sql.gz`;
  const dir      = getBackupDir(profile.id);
  const filePath = `${dir}/${fileName}`;

  console.log(c.primary.bold(`  Backing up: `) + c.secondary(`${service.type} — ${dbLabel}`));
  console.log(c.muted(`  Saving to:  `) + c.text(filePath));
  console.log(c.muted(`\n  Running backup (streaming directly to local)...\n`));

  const result = service.type === 'postgres'
    ? backupPostgres(profile, method, service, filePath)
    : backupMySQL(profile, method, service, filePath);

  if (result.success) {
    saveBackupRecord({
      id: nanoid(),
      profileId:    profile.id,
      profileName:  profile.name,
      serviceId:    service.id,
      serviceName:  service.name,
      dbName:       dbLabel,
      filePath,
      fileSizeBytes: result.fileSizeBytes,
      createdAt:    new Date().toISOString(),
    });
    msg(`Backup complete! Size: ${formatSize(result.fileSizeBytes)}`, 'success');
  } else {
    msg(`Backup failed: ${result.error}`, 'error');
  }

  await pause();
}

async function menuBackupHistory(profile: Profile, service: ServiceConfig): Promise<void> {
  while (true) {
    banner();
    console.log(c.primary.bold(`  Backup History — ${profile.name} / ${service.name}\n`));

    const backups = listLocalBackups(profile.id);

    if (backups.length === 0) {
      msg('No backups found.', 'info');
      await pause();
      return;
    }

    const { choice } = await inquirer.prompt<{ choice: string }>([{
      type: 'list', name: 'choice',
      message: 'Select backup:',
      choices: [
        ...backups.map(b => ({
          name: [
            c.text(b.mtime.toLocaleString().padEnd(22)),
            c.primary(formatSize(b.fileSizeBytes).padEnd(10)),
            c.muted(b.fileName),
          ].join('  '),
          value: b.filePath,
        })),
        new inquirer.Separator(),
        { name: c.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    }]);

    if (choice === '__back__') return;

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list', name: 'action',
      message: 'What do you want to do?',
      choices: [
        { name: `${c.primary('📂')} Show file path`,  value: 'path' },
        { name: `${c.error('✗')}  Delete backup`,     value: 'delete' },
        { name: c.muted('← Back'),                    value: 'back' },
      ],
    }]);

    if (action === 'back') continue;
    if (action === 'path') {
      console.log(c.muted('\n  Path: ') + c.text(choice));
      await pause();
    }
    if (action === 'delete') {
      const { yes } = await inquirer.prompt<{ yes: boolean }>([{
        type: 'confirm', name: 'yes',
        message: c.error('Delete this backup file? Cannot be undone.'),
        default: false,
      }]);
      if (yes) {
        deleteLocalFile(choice);
        msg('Backup deleted.', 'success');
        await pause();
        return;
      }
    }
  }
}

// ─── DB Management (users & databases) ───────────────────────────────────────

async function menuDBManagement(profile: Profile, service: ServiceConfig, method: ConnectMethod): Promise<void> {
  while (true) {
    banner();
    console.log(c.primary.bold(`  DB Management — ${profile.name} / ${service.name}\n`));

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list', name: 'action',
      message: 'What do you want to do?',
      choices: [
        { name: `${c.primary('👥')} List users`,       value: 'listusers' },
        { name: `${c.success('+')} Create database`,   value: 'createdb' },
        { name: `${c.error('✗')}  Drop database`,      value: 'dropdb' },
        { name: `${c.success('+')} Create user`,       value: 'createuser' },
        { name: `${c.primary('🔐')} Grant privileges`, value: 'grant' },
        { name: `${c.warning('🔑')} Change password`,  value: 'chpasswd' },
        new inquirer.Separator(),
        { name: c.muted('← Back'),                     value: 'back' },
      ],
    }]);

    if (action === 'back') return;

    if (action === 'listusers') {
      banner();
      runCommand(profile, method, buildListUsers(service));
      console.log();
      await pause();
      continue;
    }

    if (action === 'createdb') {
      const { dbName } = await inquirer.prompt<{ dbName: string }>([{
        type: 'input', name: 'dbName',
        message: 'New database name:',
        validate: (v: string) => SAFE_DB_NAME.test(v) ? true : 'Alphanumeric and underscores only, must start with a letter',
      }]);
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'confirm', name: 'confirm',
        message: `Create database ${c.warning(dbName)}?`,
        default: true,
      }]);
      if (confirm) {
        banner();
        const code = runCommand(profile, method, buildCreateDatabase(service, dbName));
        code === 0 ? msg(`Database "${dbName}" created!`, 'success') : msg('Failed to create database.', 'error');
        await pause();
      }
      continue;
    }

    if (action === 'dropdb') {
      const { dbName } = await inquirer.prompt<{ dbName: string }>([{
        type: 'input', name: 'dbName',
        message: c.error('Database name to DROP (IRREVERSIBLE):'),
        validate: (v: string) => SAFE_DB_NAME.test(v) ? true : 'Alphanumeric and underscores only',
      }]);
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'confirm', name: 'confirm',
        message: c.error(`PERMANENTLY DROP database "${dbName}"? All data will be lost.`),
        default: false,
      }]);
      if (confirm) {
        banner();
        const code = runCommand(profile, method, buildDropDatabase(service, dbName));
        code === 0 ? msg(`Database "${dbName}" dropped.`, 'success') : msg('Failed to drop database.', 'error');
        await pause();
      }
      continue;
    }

    if (action === 'createuser') {
      const fields = await inquirer.prompt<{ userName: string; password: string; confirmPwd: string }>([
        { type: 'input',    name: 'userName',   message: 'New username:',        validate: (v: string) => SAFE_DB_USER.test(v) ? true : 'Alphanumeric and underscores only' },
        { type: 'password', name: 'password',   message: 'Password:',            validate: (v: string) => v.length >= 8 ? true : 'Minimum 8 characters' },
        { type: 'password', name: 'confirmPwd', message: 'Confirm password:' },
      ]);
      if (fields.password !== fields.confirmPwd) {
        msg('Passwords do not match.', 'error');
        await pause();
        continue;
      }
      banner();
      const code = runCommand(profile, method, buildCreateUser(service, fields.userName, fields.password));
      code === 0 ? msg(`User "${fields.userName}" created!`, 'success') : msg('Failed to create user.', 'error');
      await pause();
      continue;
    }

    if (action === 'grant') {
      const fields = await inquirer.prompt<{ userName: string; dbName: string }>([
        { type: 'input', name: 'userName', message: 'Username to grant:', validate: (v: string) => SAFE_DB_USER.test(v) ? true : 'Invalid' },
        { type: 'input', name: 'dbName',   message: 'Database name:',    validate: (v: string) => SAFE_DB_NAME.test(v) ? true : 'Invalid' },
      ]);
      const { confirm } = await inquirer.prompt<{ confirm: boolean }>([{
        type: 'confirm', name: 'confirm',
        message: `Grant ALL privileges on ${c.warning(fields.dbName)} to ${c.warning(fields.userName)}?`,
        default: true,
      }]);
      if (confirm) {
        banner();
        const code = runCommand(profile, method, buildGrantPrivileges(service, fields.userName, fields.dbName));
        code === 0 ? msg('Privileges granted!', 'success') : msg('Failed to grant privileges.', 'error');
        await pause();
      }
      continue;
    }

    if (action === 'chpasswd') {
      const fields = await inquirer.prompt<{ userName: string; password: string; confirmPwd: string }>([
        { type: 'input',    name: 'userName',   message: 'Username:', validate: (v: string) => SAFE_DB_USER.test(v) ? true : 'Invalid' },
        { type: 'password', name: 'password',   message: 'New password:', validate: (v: string) => v.length >= 8 ? true : 'Minimum 8 characters' },
        { type: 'password', name: 'confirmPwd', message: 'Confirm password:' },
      ]);
      if (fields.password !== fields.confirmPwd) {
        msg('Passwords do not match.', 'error');
        await pause();
        continue;
      }
      banner();
      const code = runCommand(profile, method, buildChangePassword(service, fields.userName, fields.password));
      code === 0 ? msg('Password changed!', 'success') : msg('Failed to change password.', 'error');
      await pause();
    }
  }
}

// ─── Service Control menu ─────────────────────────────────────────────────────

async function menuServiceControl(profile: Profile): Promise<void> {
  // Pick a service if multiple
  let service = profile.services[0]!;
  if (profile.services.length > 1) {
    const { svcId } = await inquirer.prompt<{ svcId: string }>([{
      type: 'list', name: 'svcId',
      message: 'Which service?',
      choices: profile.services.map(s => ({
        name: `${c.warning(s.type.padEnd(12))} ${s.name}`,
        value: s.id,
      })),
    }]);
    service = profile.services.find(s => s.id === svcId)!;
  }

  while (true) {
    banner();
    console.log(c.primary.bold(`  Service Control — ${profile.name} / ${service.name}`));
    console.log(c.muted(`  Type: ${service.type}\n`));

    const actions = getServiceActions(service);
    const method  = await pickConnectMethod(profile);

    const { choice } = await inquirer.prompt<{ choice: string }>([{
      type: 'list', name: 'choice',
      message: 'Select action:',
      choices: [
        ...actions.map(a => ({
          name: a.dangerous
            ? c.error(`⚠  ${a.label}`)
            : c.text(a.label),
          value: a.label,
        })),
        new inquirer.Separator(),
        { name: c.muted('← Back'), value: '__back__' },
      ],
      pageSize: 20,
    }]);

    if (choice === '__back__') return;

    const actionDef = actions.find(a => a.label === choice)!;

    if (actionDef.dangerous) {
      const { yes } = await inquirer.prompt<{ yes: boolean }>([{
        type: 'confirm', name: 'yes',
        message: c.error(`⚠  "${choice}" is a destructive action. Continue?`),
        default: false,
      }]);
      if (!yes) continue;
    }

    banner();
    console.log(c.primary.bold(`  Running: `) + c.muted(actionDef.command));
    console.log();
    runCommand(profile, method, actionDef.command);
    console.log();
    await pause();
  }
}

// ─── Pull Logs menu ───────────────────────────────────────────────────────────

async function menuPullLogs(profile: Profile): Promise<void> {
  while (true) {
    banner();
    console.log(c.primary.bold(`  Pull Logs — ${profile.name}\n`));

    const systemSources = getSystemLogSources();
    const serviceSources = profile.services.flatMap(s => getServiceLogSources(s));

    const existingLogs = listLocalLogs(profile.id);

    const { choice } = await inquirer.prompt<{ choice: string }>([{
      type: 'list', name: 'choice',
      message: 'Select log to pull:',
      choices: [
        new inquirer.Separator('── System ──'),
        ...systemSources.map(s => ({ name: c.text(s.label), value: `source:${s.label}` })),
        ...(serviceSources.length > 0 ? [
          new inquirer.Separator('── Services ──'),
          ...serviceSources.map(s => ({ name: `${c.warning(s.serviceType ?? '')}  ${c.text(s.label)}`, value: `source:${s.label}` })),
        ] : []),
        new inquirer.Separator('── Custom ──'),
        { name: `${c.primary('+')} Custom log path...`, value: '__custom__' },
        ...(existingLogs.length > 0 ? [
          new inquirer.Separator('── Pulled logs ──'),
          { name: `${c.secondary('🕐')} View pulled log history (${existingLogs.length})`, value: '__history__' },
        ] : []),
        new inquirer.Separator(),
        { name: c.muted('← Back'), value: '__back__' },
      ],
      pageSize: 25,
    }]);

    if (choice === '__back__') return;

    if (choice === '__history__') {
      await menuLogHistory(profile);
      continue;
    }

    let command = '';
    let fileName = '';

    if (choice === '__custom__') {
      const { remotePath } = await inquirer.prompt<{ remotePath: string }>([{
        type: 'input', name: 'remotePath',
        message: 'Remote file path (e.g. /var/log/myapp/app.log):',
        validate: (v: string) => v.trim().startsWith('/') ? true : 'Must be an absolute path',
      }]);
      const { lines } = await inquirer.prompt<{ lines: number }>([{
        type: 'number', name: 'lines',
        message: 'How many lines to pull?',
        default: 500,
      }]);
      command  = `sudo tail -n ${lines} ${remotePath} 2>/dev/null`;
      fileName = remotePathToFileName(remotePath) + '.log';
    } else {
      const label  = choice.slice(7); // strip 'source:'
      const source = [...systemSources, ...serviceSources].find(s => s.label === label);
      if (!source) continue;
      command  = source.command;
      fileName = source.fileName;
    }

    const method   = await pickConnectMethod(profile);
    const ts       = timestamp();
    const logDir   = getLogDir(profile.id);
    const filePath = `${logDir}/${ts}_${fileName}`;

    banner();
    console.log(c.primary.bold('  Pulling log to: ') + c.muted(filePath));
    console.log(c.muted('  Please wait...\n'));

    const { streamToFile } = await import('./lib/runner.js');
    const result = streamToFile(profile, method, command, filePath);

    if (result.success) {
      msg(`Log saved! Size: ${formatSize(result.fileSizeBytes)}`, 'success');
      console.log(c.muted(`  Path: ${filePath}`));
      console.log(c.muted(`  View: less "${filePath}"`));
    } else {
      msg(`Failed to pull log: ${result.error}`, 'error');
    }
    await pause();
  }
}

async function menuLogHistory(profile: Profile): Promise<void> {
  while (true) {
    banner();
    console.log(c.primary.bold(`  Log History — ${profile.name}\n`));

    const logs = listLocalLogs(profile.id);
    if (logs.length === 0) {
      msg('No pulled logs found.', 'info');
      await pause();
      return;
    }

    const { filePath } = await inquirer.prompt<{ filePath: string }>([{
      type: 'list', name: 'filePath',
      message: 'Select log file:',
      choices: [
        ...logs.map(l => ({
          name: [
            c.text(l.mtime.toLocaleString().padEnd(22)),
            c.primary(formatSize(l.fileSizeBytes).padEnd(10)),
            c.muted(l.fileName),
          ].join('  '),
          value: l.filePath,
        })),
        new inquirer.Separator(),
        { name: c.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    }]);

    if (filePath === '__back__') return;

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list', name: 'action',
      message: 'Action:',
      choices: [
        { name: `${c.primary('👁')}  View (less)`,    value: 'view' },
        { name: `${c.primary('📂')} Show path`,       value: 'path' },
        { name: `${c.error('✗')}  Delete`,            value: 'delete' },
        { name: c.muted('← Back'),                    value: 'back' },
      ],
    }]);

    if (action === 'back') continue;

    if (action === 'path') {
      console.log(c.muted('\n  Path: ') + c.text(filePath));
      await pause();
    }

    if (action === 'view') {
      const { spawnSync } = await import('child_process');
      spawnSync('less', [filePath], { stdio: 'inherit' });
    }

    if (action === 'delete') {
      const { yes } = await inquirer.prompt<{ yes: boolean }>([{
        type: 'confirm', name: 'yes',
        message: c.error('Delete this log file?'),
        default: false,
      }]);
      if (yes) {
        deleteLocalFile(filePath);
        msg('Log deleted.', 'success');
        await pause();
        return;
      }
    }
  }
}

// ─── Pull Files menu ──────────────────────────────────────────────────────────

async function menuPullFiles(profile: Profile): Promise<void> {
  // Common config/interesting files for quick access
  const QUICK_PATHS = [
    { label: 'postgresql.conf',   path: '/etc/postgresql/*/main/postgresql.conf' },
    { label: 'pg_hba.conf',       path: '/etc/postgresql/*/main/pg_hba.conf' },
    { label: 'pgbouncer.ini',     path: '/etc/pgbouncer/pgbouncer.ini' },
    { label: 'nginx.conf',        path: '/etc/nginx/nginx.conf' },
    { label: '/etc/hosts',        path: '/etc/hosts' },
    { label: '.env (app root)',   path: '/var/www/html/.env' },
    { label: 'docker-compose.yml',path: '/opt/app/docker-compose.yml' },
    { label: 'crontab',           path: '/etc/crontab' },
    { label: '/etc/environment',  path: '/etc/environment' },
  ];

  while (true) {
    banner();
    console.log(c.primary.bold(`  Pull Files — ${profile.name}\n`));

    const existingFiles = listLocalFiles(profile.id);

    const { choice } = await inquirer.prompt<{ choice: string }>([{
      type: 'list', name: 'choice',
      message: 'Select file to pull:',
      choices: [
        new inquirer.Separator('── Common config files ──'),
        ...QUICK_PATHS.map(q => ({ name: c.text(q.label), value: `quick:${q.path}` })),
        new inquirer.Separator('── Custom ──'),
        { name: `${c.primary('+')} Enter custom path...`, value: '__custom__' },
        ...(existingFiles.length > 0 ? [
          new inquirer.Separator('── Previously pulled ──'),
          { name: `${c.secondary('🕐')} View pulled files (${existingFiles.length})`, value: '__history__' },
        ] : []),
        new inquirer.Separator(),
        { name: c.muted('← Back'), value: '__back__' },
      ],
      pageSize: 20,
    }]);

    if (choice === '__back__') return;

    if (choice === '__history__') {
      await menuFileHistory(profile);
      continue;
    }

    let remotePath = '';

    if (choice === '__custom__') {
      const { p } = await inquirer.prompt<{ p: string }>([{
        type: 'input', name: 'p',
        message: 'Remote file path:',
        validate: (v: string) => v.trim().startsWith('/') ? true : 'Must be an absolute path',
      }]);
      remotePath = p;
    } else {
      remotePath = choice.slice(6); // strip 'quick:'
    }

    const method   = await pickConnectMethod(profile);
    const ts       = timestamp();
    const filesDir = getFilesDir(profile.id);
    const fileName = `${ts}_${remotePathToFileName(remotePath)}`;
    const filePath = `${filesDir}/${fileName}`;

    banner();
    console.log(c.primary.bold('  Pulling: ') + c.muted(remotePath));
    console.log(c.muted('  Saving to: ') + c.muted(filePath));
    console.log();

    const command = `sudo cat ${remotePath} 2>/dev/null`;
    const { streamToFile } = await import('./lib/runner.js');
    const result = streamToFile(profile, method, command, filePath);

    if (result.success) {
      msg(`File saved! Size: ${formatSize(result.fileSizeBytes)}`, 'success');
      console.log(c.muted(`  View: less "${filePath}"`));
    } else {
      msg(`Failed to pull file: ${result.error}`, 'error');
    }
    await pause();
  }
}

async function menuFileHistory(profile: Profile): Promise<void> {
  while (true) {
    banner();
    console.log(c.primary.bold(`  Pulled Files — ${profile.name}\n`));

    const files = listLocalFiles(profile.id);
    if (files.length === 0) {
      msg('No pulled files.', 'info');
      await pause();
      return;
    }

    const { filePath } = await inquirer.prompt<{ filePath: string }>([{
      type: 'list', name: 'filePath',
      message: 'Select file:',
      choices: [
        ...files.map(f => ({
          name: [
            c.text(f.mtime.toLocaleString().padEnd(22)),
            c.primary(formatSize(f.fileSizeBytes).padEnd(10)),
            c.muted(f.fileName),
          ].join('  '),
          value: f.filePath,
        })),
        new inquirer.Separator(),
        { name: c.muted('← Back'), value: '__back__' },
      ],
      pageSize: 15,
    }]);

    if (filePath === '__back__') return;

    const { action } = await inquirer.prompt<{ action: string }>([{
      type: 'list', name: 'action',
      message: 'Action:',
      choices: [
        { name: `${c.primary('👁')}  View (less)`,    value: 'view' },
        { name: `${c.primary('📂')} Show path`,       value: 'path' },
        { name: `${c.error('✗')}  Delete`,            value: 'delete' },
        { name: c.muted('← Back'),                    value: 'back' },
      ],
    }]);

    if (action === 'back') continue;

    if (action === 'path') {
      console.log(c.muted('\n  Path: ') + c.text(filePath));
      await pause();
    }

    if (action === 'view') {
      const { spawnSync } = await import('child_process');
      spawnSync('less', [filePath], { stdio: 'inherit' });
    }

    if (action === 'delete') {
      const { yes } = await inquirer.prompt<{ yes: boolean }>([{
        type: 'confirm', name: 'yes',
        message: c.error('Delete this file?'),
        default: false,
      }]);
      if (yes) {
        deleteLocalFile(filePath);
        msg('File deleted.', 'success');
        await pause();
        return;
      }
    }
  }
}

// ─── Import from ~/.ssh/config ───────────────────────────────────────────────

async function menuImportSSHConfig(): Promise<void> {
  banner();
  console.log(c.primary.bold('  Import from ~/.ssh/config\n'));

  if (!sshConfigExists()) {
    msg(`No SSH config found at ${sshConfigPath}`, 'error');
    await pause();
    return;
  }

  const hosts = parseSSHConfig();
  if (hosts.length === 0) {
    msg('No usable host entries found in ~/.ssh/config', 'error');
    await pause();
    return;
  }

  const existing = getProfiles();

  // Show each host entry with a checkbox — pre-check ones not yet imported
  const choices = hosts.map(h => {
    const alreadyImported = existing.some(
      p => p.sshConfigAlias === h.alias || p.host === (h.hostname ?? h.alias),
    );
    return {
      name: [
        c.bold(h.alias.padEnd(28)),
        h.hostname ? c.secondary(h.hostname) : c.muted('(no hostname)'),
        h.user    ? c.muted(` ${h.user}`) : '',
        h.proxyJump    ? c.warning(' ⤷J') : '',
        h.proxyCommand ? c.primary(' ⇢P') : '',
        alreadyImported ? c.muted(' (already imported)') : '',
      ].join(''),
      value: h.alias,
      checked: !alreadyImported,
    };
  });

  const { selected } = await inquirer.prompt<{ selected: string[] }>([{
    type: 'checkbox',
    name: 'selected',
    message: 'Select hosts to import (space to toggle, enter to confirm):',
    choices,
    pageSize: 20,
  }]);

  if (selected.length === 0) {
    msg('Nothing selected.', 'info');
    await pause();
    return;
  }

  // Ask group for all imported profiles
  const { group } = await inquirer.prompt<{ group: string }>([{
    type: 'list',
    name: 'group',
    message: 'Assign environment group to imported profiles:',
    choices: ['dev', 'staging', 'prod', 'database', 'monitoring', 'custom'],
    default: 'dev',
  }]);

  let imported = 0;
  let skipped = 0;

  for (const alias of selected) {
    const h = hosts.find(x => x.alias === alias)!;

    // Don't overwrite an existing profile with same alias
    if (existing.some(p => p.sshConfigAlias === alias)) {
      skipped++;
      continue;
    }

    const profile: Profile = {
      id: nanoid(),
      name: alias,
      user: h.user ?? 'ubuntu',
      port: h.port ?? 22,
      host: h.hostname ?? alias,         // fallback to alias if no HostName
      hostPrivate: undefined,
      keyPath: h.identityFile,
      sshConfigAlias: alias,             // delegate routing to SSH config
      jumpHost: undefined,
      cloudflaredHostname: undefined,
      proxyCommand: undefined,
      tunnels:  [],
      services: [],
      snippets: [],
      group,
      tags: [],
      notes: [
        h.proxyJump    ? `ProxyJump: ${h.proxyJump}` : '',
        h.proxyCommand ? `ProxyCommand: ${h.proxyCommand}` : '',
      ].filter(Boolean).join(' | ') || undefined,
      createdAt: new Date().toISOString(),
    };

    saveProfile(profile);
    imported++;
  }

  console.log();
  msg(`Imported ${imported} profile${imported !== 1 ? 's' : ''}${skipped ? `, skipped ${skipped} (already exist)` : ''}.`, 'success');
  await pause();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printProfileDetail(profile: Profile): void {
  if (profile.tunnels.length) {
    console.log(c.warning('  Tunnels:'));
    profile.tunnels.forEach(t => {
      if (t.type === 'local')   console.log(c.muted(`    L  localhost:${t.localPort} → ${t.remoteHost}:${t.remotePort}`));
      if (t.type === 'remote')  console.log(c.muted(`    R  remote:${t.localPort} → ${t.remoteHost}:${t.remotePort}`));
      if (t.type === 'dynamic') console.log(c.muted(`    D  SOCKS proxy on localhost:${t.localPort}`));
    });
  }
  if (profile.jumpHost)  console.log(c.warning('  Jump host: ') + c.muted(profile.jumpHost));
  if (profile.notes)     console.log(c.muted('  Notes: ') + c.text(profile.notes));
}

function pause(): Promise<void> {
  return inquirer.prompt([{ type: 'input', name: '_', message: c.muted('Press Enter to continue...') }]).then(() => {});
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch((err: Error) => {
  console.error(c.error('\nFatal error:'), err.message);
  process.exit(1);
});
