const fs = require('node:fs/promises');
const { resolve, dirname, join, relative, isAbsolute } = require('node:path');
const { fileURLToPath } = require('node:url');
const { createHash, randomUUID } = require('node:crypto');
const MAX_DRAFT = 2 * 1024 * 1024, MAX_ARCHIVE = 16 * 1024 * 1024, MAX_ENTRIES = 64;
const hash = value => createHash('sha256').update(value).digest('hex');
const fault = (code, message) => Object.assign(Error(message), { code });

// Profile-local data only. The registered driver supplies these two nonsecret
// roots; this service creates no identity, admission, subprocess or connection.
class DraftRecoveryStore {
  constructor({ workspace = process.env.YNX_CORE_WORKSPACE, profile = process.env.THEIA_CONFIG_DIR } = {}) {
    this.inputs = { workspace, profile }; this.serial = Promise.resolve();
  }
  async scope() {
    if (!this.scopePromise) this.scopePromise = (async () => {
      const { workspace, profile } = this.inputs;
      for (const path of [workspace, profile]) if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || await fs.realpath(path) !== path) throw fault('RECOVERY_UNBOUND', 'Draft recovery profile is unavailable.');
      if (workspace === profile || dirname(workspace) !== dirname(profile)) throw fault('RECOVERY_UNBOUND', 'Draft recovery profile must belong to this project.');
      const directory = join(profile, 'ynx-draft-recovery-v1');
      await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      if (!(await fs.lstat(directory)).isDirectory() || await fs.realpath(directory) !== directory) throw fault('RECOVERY_SCOPE', 'Draft recovery directory changed.');
      return { workspace, profile, directory, workspaceHash: hash(workspace) };
    })();
    const scope = await this.scopePromise;
    if (await fs.realpath(this.inputs.profile) !== this.inputs.profile || await fs.realpath(scope.directory) !== scope.directory) throw fault('RECOVERY_SCOPE', 'Draft recovery directory changed.');
    return scope;
  }
  async path(uri, checkTarget = false) {
    if (typeof uri !== 'string' || uri.length > 8192) throw fault('RECOVERY_SCOPE', 'Invalid draft location.');
    const scope = await this.scope(), url = new URL(uri);
    if (url.protocol === 'untitled:' && !url.search && !url.hash) return undefined;
    if (url.protocol !== 'file:' || url.search || url.hash) throw fault('RECOVERY_SCOPE', 'Only this project’s editable files can be backed up.');
    const path = fileURLToPath(url), child = relative(scope.workspace, path);
    const ownSettings = path === join(scope.profile, 'settings.json');
    if (!ownSettings && (!child || child === '..' || child.startsWith('../') || child.startsWith('..\\') || isAbsolute(child))) throw fault('RECOVERY_SCOPE', 'Draft is outside this project.');
    if (checkTarget) {
      let target;
      try { target = await fs.realpath(path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; target = join(await fs.realpath(dirname(path)), path.slice(dirname(path).length + 1)); }
      const actual = relative(scope.workspace, target);
      if (target !== join(scope.profile, 'settings.json') && (!actual || actual === '..' || actual.startsWith('../') || actual.startsWith('..\\') || isAbsolute(actual))) throw fault('RECOVERY_SCOPE', 'Draft target is outside this project.');
    }
    return path;
  }
  async validate(entry) {
    if (!entry || typeof entry.text !== 'string' || Buffer.byteLength(entry.text) > MAX_DRAFT || entry.baseHash !== null && !/^[a-f0-9]{64}$/.test(entry.baseHash || '')) throw fault('RECOVERY_LIMIT', 'This draft exceeds the automatic backup limit. Save it before closing.');
    await this.path(entry.uri);
  }
  async load() {
    const scope = await this.scope(), valid = [], damaged = [];
    const pending = (await fs.readdir(scope.directory)).filter(name => /^\.pending-[a-f0-9-]+$/.test(name));
    if (pending.length > 8) throw fault('RECOVERY_DAMAGED', 'Interrupted draft backups were kept for review.');
    for (const name of ['a.json', 'b.json', ...pending]) {
      const path = join(scope.directory, name);
      try {
        if (!(await fs.lstat(path)).isFile()) throw Error('Nonregular archive');
        if ((await fs.stat(path)).size > MAX_ARCHIVE) throw Error('Oversized archive');
        const envelope = JSON.parse(await fs.readFile(path, 'utf8')), data = envelope.data;
        if (!data || data.schema !== 1 || data.workspaceHash !== scope.workspaceHash || !Number.isSafeInteger(data.generation) || data.generation < 1 || !Array.isArray(data.entries) || data.entries.length > MAX_ENTRIES || envelope.sha256 !== hash(JSON.stringify(data))) throw Error('Invalid archive');
        const identities = new Set();
        for (const entry of data.entries) { await this.validate(entry); if (identities.has(entry.uri)) throw Error('Duplicate draft'); identities.add(entry.uri); }
        valid.push(data);
      } catch (error) { if (error.code !== 'ENOENT') damaged.push(path); }
    }
    valid.sort((a, b) => b.generation - a.generation);
    if (!valid.length && damaged.length) throw fault('RECOVERY_DAMAGED', 'Draft backups need review. Existing backups have been kept.');
    return { generation: valid[0]?.generation || 0, entries: valid[0]?.entries || [], damaged: [...new Set([...damaged, ...pending.map(name => join(scope.directory, name))])] };
  }
  async list() {
    try { const state = await this.load(); return { status: state.damaged.length ? 'read-only' : 'ready', entries: state.entries, warning: state.damaged.length ? 'An older draft snapshot was recovered; damaged backups were kept for review.' : undefined }; }
    catch (error) { return { status: 'unavailable', entries: [], warning: error.message }; }
  }
  async getBaseline(uri, loadedText) {
    if (typeof loadedText !== 'string' || Buffer.byteLength(loadedText) > MAX_DRAFT) throw fault('RECOVERY_LIMIT', 'This file exceeds the automatic draft backup limit.');
    const path = await this.path(uri, true);
    if (!path) return { hash: null, exists: false };
    try {
      if ((await fs.stat(path)).size > MAX_DRAFT) throw fault('RECOVERY_LIMIT', 'This file exceeds the automatic draft backup limit.');
      const raw = await fs.readFile(path);
      const normalized = text => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      return { hash: typeof loadedText === 'string' && normalized(raw.toString('utf8')) === normalized(loadedText) ? hash(raw) : null, exists: true };
    } catch (error) { if (error.code === 'ENOENT') return { hash: null, exists: false }; throw error; }
  }
  async persist(entries, state) {
    if (state.damaged.length) throw fault('RECOVERY_DAMAGED', 'Damaged backups were kept. Save changes manually before closing.');
    const scope = await this.scope(), generation = state.generation + 1;
    const data = { schema: 1, workspaceHash: scope.workspaceHash, generation, entries };
    const serialized = JSON.stringify({ data, sha256: hash(JSON.stringify(data)) });
    if (Buffer.byteLength(serialized) > MAX_ARCHIVE || entries.length > MAX_ENTRIES) throw fault('RECOVERY_LIMIT', 'Automatic draft backup is full. Save changes before closing.');
    const target = join(scope.directory, generation % 2 ? 'a.json' : 'b.json'), temporary = join(scope.directory, `.pending-${randomUUID()}`);
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, target);
    const directory = await fs.open(scope.directory, 'r');
    try { await directory.sync(); } catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) throw error; } finally { await directory.close(); }
    return { status: 'saved', generation };
  }
  operation(task) { const result = this.serial.then(task); this.serial = result.catch(() => {}); return result; }
  upsert(entry) {
    return this.operation(async () => {
      await this.validate(entry); await this.path(entry.uri, true);
      const state = await this.load(), previous = state.entries.find(item => item.uri === entry.uri);
      if (previous && previous.baseHash !== entry.baseHash) throw fault('RECOVERY_STALE', 'Another recovered draft must be reviewed before replacing it.');
      return this.persist([...state.entries.filter(item => item.uri !== entry.uri), { uri: entry.uri, text: entry.text, baseHash: entry.baseHash }], state);
    });
  }
  remove(uri) {
    return this.operation(async () => {
      await this.path(uri); const state = await this.load();
      if (!state.entries.some(item => item.uri === uri)) return { status: 'unchanged' };
      return this.persist(state.entries.filter(item => item.uri !== uri), state);
    });
  }
}
module.exports = { DraftRecoveryStore, MAX_DRAFT, MAX_ARCHIVE, MAX_ENTRIES };
