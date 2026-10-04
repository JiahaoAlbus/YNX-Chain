'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { join, resolve, relative, dirname, isAbsolute } = require('node:path');
const { fileURLToPath } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const LIMITS = Object.freeze({ entries: 4096, bytes: 64 * 1024 * 1024, steps: 128, archive: 256 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fault = (code, message) => Object.assign(Error(message + ' The recovery journal and user files were retained.'), { code });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const ordered = tree => Object.fromEntries(Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)));

// Backend-local only. There is no RPC, provider, auth service or network binding.
// A batch is a recoverable ordered transaction, not an atomic multi-path syscall.
class WorkspaceFileJournal {
  constructor(environment = process.env, { checkpoint, encodingService, saveAuthority } = {}) { this.env = { ...environment }; this.checkpoint = checkpoint; this.encodingService = encodingService; this.saveAuthority = saveAuthority; this.serial = Promise.resolve(); }
  operation(task) { const result = this.serial.then(task); this.serial = result.catch(() => {}); return result; }
  async scope() {
    const e = this.env, workspace = e.YNX_LOCAL_WORKSPACE, profile = e.YNX_LOCAL_PROFILE, projectId = e.YNX_LOCAL_PROJECT_ID;
    if (e.YNX_WORKSPACE_MODE !== 'local' || e.THEIA_CONFIG_DIR !== profile || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(projectId || '')) throw fault('JOURNAL_UNBOUND', 'Local project is not bound.');
    for (const path of [workspace, profile]) {
      if (!path || !isAbsolute(path) || resolve(path) !== path || await fs.realpath(path) !== path) throw fault('JOURNAL_SCOPE', 'Local root changed.');
      const stat = await fs.lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw fault('JOURNAL_SCOPE', 'Local root is unsafe.');
      if (path === profile && (stat.mode & 0o077)) throw fault('JOURNAL_SCOPE', 'Profile is not private.');
    }
    if (workspace === profile || !relative(workspace, profile).startsWith('..') || !relative(profile, workspace).startsWith('..')) throw fault('JOURNAL_SCOPE', 'Workspace and profile must be separate.');
    const bindingPath = join(profile, 'ynx-local-project.json');
    await this.bindingMetadata(bindingPath, profile); const binding = JSON.parse(await fs.readFile(bindingPath, 'utf8'));
    if (binding.schemaVersion !== 1 || binding.workspace !== workspace || binding.profile !== profile || binding.projectId !== projectId) throw fault('JOURNAL_UNBOUND', 'Local project binding changed.');
    const directory = join(profile, 'ynx-workspace-file-journal-v1');
    await fs.mkdir(directory, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const s = await fs.lstat(directory); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077) || await fs.realpath(directory) !== directory) throw fault('JOURNAL_SCOPE', 'Private journal directory changed.');
    const roots = await Promise.all([workspace, profile, directory].map(p => fs.lstat(p)));
    const identities = roots.map(s => `${s.dev}:${s.ino}`);
    if (this.identities && !same(this.identities, identities)) throw fault('JOURNAL_SCOPE', 'Local directory identity changed.');
    this.identities ||= identities;
    if (roots[0].dev !== roots[2].dev) throw fault('JOURNAL_SCOPE', 'Workspace and journal must share a filesystem for durable file replacement.');
    return { workspace, profile, projectId, directory, identities };
  }
  async bindingMetadata(path, profile) {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) || stat.size > 16384 || await fs.realpath(path) !== path || ![1, 2].includes(stat.nlink)) throw fault('JOURNAL_SCOPE', 'Local binding metadata is unsafe.');
    if (stat.nlink === 2) {
      let peers = 0;
      for (const name of await fs.readdir(profile)) {
        if (!/^\.binding-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name)) continue;
        const peerPath = join(profile, name), peer = await fs.lstat(peerPath);
        if (peer.dev !== stat.dev || peer.ino !== stat.ino) continue;
        if (!peer.isFile() || peer.isSymbolicLink() || peer.uid !== stat.uid || (peer.mode & 0o777) !== (stat.mode & 0o777) || (peer.mode & 0o077) || peer.nlink !== 2 || await fs.realpath(peerPath) !== peerPath) throw fault('JOURNAL_SCOPE', 'Local binding peer is unsafe.');
        peers++;
      }
      if (peers !== 1) throw fault('JOURNAL_SCOPE', 'Local binding has an unknown hardlink.');
    }
    const identity = stat.dev + ':' + stat.ino; if (this.bindingIdentity && this.bindingIdentity !== identity) throw fault('JOURNAL_UNBOUND', 'Local binding metadata was replaced.'); this.bindingIdentity ||= identity;
  }
  async regular(path, limit, privateFile = false) { const s = await fs.lstat(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid() || s.size > limit || privateFile && (s.mode & 0o077)) throw fault('JOURNAL_SCOPE', 'Unsafe file or capacity exceeded.'); return s; }
  path(value, workspace) {
    if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) throw fault('JOURNAL_PATH', 'Invalid workspace path.');
    let path = value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) { const uri = new URL(value); if (uri.protocol !== 'file:' || uri.host || uri.search || uri.hash) throw fault('JOURNAL_PATH', 'Only local file paths are supported.'); path = fileURLToPath(uri); }
    path = isAbsolute(path) ? resolve(path) : resolve(workspace, path);
    const child = relative(workspace, path); if (!child || child === '..' || child.startsWith('../') || isAbsolute(child) || child.split('/').some(p => p.startsWith('.ynx-journal-'))) throw fault('JOURNAL_PATH', 'Path is outside the bound project.');
    return child;
  }
  async snapshot(scope, footprint = this.footprint) {
    const tree = {}; let bytes = 0;
    const walk = async (directory, prefix = '') => {
      for (const name of (await fs.readdir(directory)).sort()) {
        const key = prefix ? `${prefix}/${name}` : name, path = join(directory, name); if (this.stashPaths?.has(path)) continue; const s = await fs.lstat(path);
        if (s.isSymbolicLink() || s.uid !== process.getuid() || !s.isDirectory() && (!s.isFile() || s.nlink !== 1)) throw fault('JOURNAL_SCOPE', 'Symlink, hardlink or special file is ineligible.');
        if (Object.keys(tree).length >= LIMITS.entries) throw fault('JOURNAL_LIMIT', 'Workspace contains too many entries.');
        if (s.isDirectory()) { tree[key] = { type: 'directory', mode: s.mode & 0o777 }; await walk(path, key); }
        else { bytes += s.size; if (bytes > LIMITS.bytes) throw fault('JOURNAL_LIMIT', 'Workspace exceeds raw byte capacity.'); const h = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const live = await h.stat(); if (live.ino !== s.ino || live.dev !== s.dev || live.nlink !== 1) throw fault('JOURNAL_CHANGED', 'File changed during capture.'); const content = await h.readFile(), blob = hash(content); this.blobs ||= {}; this.blobs[blob] = content.toString('base64'); tree[key] = { type: 'file', mode: s.mode & 0o777, blob }; } finally { await h.close(); } }
      }
    };
    for (const key of footprint) {
      const ancestors = key.split('/').slice(0, -1); let parent = '';
      for (const part of ancestors) { parent = parent ? parent + '/' + part : part; try { const stat = await fs.lstat(join(scope.workspace, parent)); if (!stat.isDirectory() || stat.isSymbolicLink()) throw fault('JOURNAL_SCOPE', 'Affected parent is unsafe.'); tree[parent] = { type: 'directory', mode: stat.mode & 0o777 }; } catch (e) { if (e.code !== 'ENOENT') throw e; break; } }
      const path = join(scope.workspace, key); let stat; try { stat = await fs.lstat(path); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      if (stat.isSymbolicLink() || stat.uid !== process.getuid() || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) throw fault('JOURNAL_SCOPE', 'Affected path is unsafe.');
      if (stat.isDirectory()) { tree[key] = { type: 'directory', mode: stat.mode & 0o777 }; await walk(path, key); }
      else { bytes += stat.size; if (bytes > LIMITS.bytes) throw fault('JOURNAL_LIMIT', 'Affected files exceed byte capacity.'); const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const current = await handle.stat(); if (current.ino !== stat.ino || current.dev !== stat.dev || current.nlink !== 1) throw fault('JOURNAL_CHANGED', 'Affected file changed during capture.'); const content = await handle.readFile(), blob = hash(content); this.blobs ||= {}; this.blobs[blob] = content.toString('base64'); tree[key] = { type: 'file', mode: stat.mode & 0o777, blob }; } finally { await handle.close(); } }
    }
    if (Object.keys(tree).length > LIMITS.entries) throw fault('JOURNAL_LIMIT', 'Affected entries exceed capacity.'); return ordered(tree);
  }
  simulate(tree, op, workspace) {
    const next = structuredClone(tree), path = this.path(op.path ?? op.from, workspace), exists = Object.hasOwn(next, path);
    const remove = key => { for (const entry of Object.keys(next)) if (entry === key || entry.startsWith(key + '/')) delete next[entry]; };
    const parent = dirname(path); if (parent !== '.' && next[parent]?.type !== 'directory') throw fault('JOURNAL_PATH', 'Parent directory is missing.');
    for (const flag of ['overwrite', 'ignoreIfExists', 'ignoreIfNotExists', 'recursive']) if (op[flag] !== undefined && typeof op[flag] !== 'boolean') throw fault('JOURNAL_OPERATION', 'Invalid operation flag.');
    if (op.type === 'create') {
      if (exists && op.ignoreIfExists && !op.overwrite) return next;
      if (exists && !op.overwrite) throw fault('JOURNAL_EXISTS', 'Create target exists.');
      if (exists) remove(path);
      if (op.directory) next[path] = { type: 'directory', mode: op.mode ?? 0o755 };
      else next[path] = { type: 'file', mode: op.mode ?? 0o644, blob: this.content(op.bytes) };
    } else if (op.type === 'write') {
      if (!exists || next[path].type !== 'file') throw fault('JOURNAL_MISSING', 'Write requires an existing regular file.');
      next[path] = { ...next[path], blob: this.content(op.bytes), ...(op.mode === undefined ? {} : { mode: op.mode }) };
    } else if (op.type === 'delete') {
      if (!exists && op.ignoreIfNotExists) return next;
      if (!exists) throw fault('JOURNAL_MISSING', 'Delete source is missing.');
      if (next[path].type === 'directory' && !op.recursive && Object.keys(next).some(k => k.startsWith(path + '/'))) throw fault('JOURNAL_OPERATION', 'Nonempty directory requires recursive deletion.');
      remove(path);
    } else if (op.type === 'move') {
      if (!exists) throw fault('JOURNAL_MISSING', 'Move source is missing.');
      const to = this.path(op.to, workspace), targetParent = dirname(to);
      if (to === path || to.startsWith(path + '/') || path.startsWith(to + '/')) throw fault('JOURNAL_PATH', 'Move paths overlap.');
      if (targetParent !== '.' && next[targetParent]?.type !== 'directory') throw fault('JOURNAL_PATH', 'Move destination parent is missing.');
      if (next[to] && op.ignoreIfExists && !op.overwrite) return next;
      if (next[to] && !op.overwrite) throw fault('JOURNAL_EXISTS', 'Move destination exists.');
      const entries = Object.entries(next).filter(([k]) => k === path || k.startsWith(path + '/')); remove(to); remove(path);
      for (const [key, value] of entries) next[to + key.slice(path.length)] = value;
    } else throw fault('JOURNAL_OPERATION', 'Unknown file operation.');
    for (const node of Object.values(next)) if (!Number.isInteger(node.mode) || node.mode < 0 || node.mode > 0o777) throw fault('JOURNAL_OPERATION', 'Invalid file mode.');
    if (Object.keys(next).length > LIMITS.entries || Object.values(next).reduce((sum, node) => sum + (node.type === 'file' ? Buffer.from(this.blobs[node.blob], 'base64').length : 0), 0) > LIMITS.bytes) throw fault('JOURNAL_LIMIT', 'Resulting workspace exceeds journal capacity.');
    return ordered(next);
  }
  content(value) { const content = this.bytes(value), id = hash(content); this.blobs ||= {}; this.blobs[id] = content.toString('base64'); return id; }
  bytes(value = Buffer.alloc(0)) { if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw fault('JOURNAL_OPERATION', 'File contents must be raw bytes.'); if (value.length > LIMITS.bytes) throw fault('JOURNAL_LIMIT', 'File byte capacity exceeded.'); return Buffer.from(value); }
  async save(scope, journal) {
    const data = JSON.stringify(journal), bytes = JSON.stringify({ data: journal, sha256: hash(data) }); if (Buffer.byteLength(bytes) > LIMITS.archive) throw fault('JOURNAL_LIMIT', 'Journal capacity exceeded.');
    const target = join(scope.directory, journal.id + '.json'), pending = target + '.pending';
    try { await fs.lstat(pending); throw fault('JOURNAL_PENDING', 'A pending journal archive requires review.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const h = await fs.open(pending, 'wx', 0o600); try { await h.writeFile(bytes); await this.checkpoint?.({ phase: 'journal-sync', id: journal.id }); await h.sync(); } catch (e) { await h.close(); if (e.code !== 'JOURNAL_SIMULATED_CRASH') await fs.unlink(pending); throw e; } await h.close();
    await this.scope(); try { await this.checkpoint?.({ phase: 'journal-rename', id: journal.id }); await fs.rename(pending, target); } catch (e) { if (e.code !== 'JOURNAL_SIMULATED_CRASH') await fs.unlink(pending); throw e; } await this.syncDir(scope.directory);
  }
  async load(scope, id) {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw fault('JOURNAL_ID', 'Invalid journal identifier.');
    const path = join(scope.directory, id + '.json'); await this.regular(path, LIMITS.archive, true);
    try { const e = JSON.parse(await fs.readFile(path, 'utf8')); if (e.sha256 !== hash(JSON.stringify(e.data)) || e.data.id !== id || e.data.projectId !== scope.projectId || e.data.workspace !== scope.workspace || e.data.schemaVersion !== 1 || !same(e.data.rootIdentities, scope.identities) || !Array.isArray(e.data.states)) throw Error(); 
      if (!Array.isArray(e.data.footprint) || !e.data.blobs || !Number.isInteger(e.data.position) || e.data.position < 0 || e.data.position >= e.data.states.length) throw Error();
      for (const key of e.data.footprint) if (this.path(key, scope.workspace) !== key) throw Error();
      for (const state of [...e.data.states, ...(e.data.replayStates || []), ...(e.data.saveIntent?.replayStates || [])]) for (const [key, node] of Object.entries(state)) { if (this.path(key, scope.workspace) !== key || !['file', 'directory'].includes(node.type) || !Number.isInteger(node.mode) || node.mode < 0 || node.mode > 0o777) throw Error(); if (node.type === 'file' && (!/^[a-f0-9]{64}$/.test(node.blob) || typeof e.data.blobs[node.blob] !== 'string' || hash(Buffer.from(e.data.blobs[node.blob], 'base64')) !== node.blob)) throw Error(); }
      return e.data; } catch { throw fault('JOURNAL_CORRUPT', 'Private journal is corrupt or belongs to another project.'); }
  }
  async syncDir(path) { const h = await fs.open(path, 'r'); try { await h.sync(); } finally { await h.close(); } }
  prepare(operations) { return this.operation(async () => {
    const scope = await this.scope(); if (!Array.isArray(operations) || !operations.length || operations.length > LIMITS.steps) throw fault('JOURNAL_LIMIT', 'Invalid ordered batch size.');
    for (const name of await fs.readdir(scope.directory)) {
      if (name.endsWith('.pending')) throw fault('JOURNAL_PENDING', 'A pending archive requires recovery before a new batch.');
      if (/^[a-f0-9-]{36}\.json$/.test(name)) { const existing = await this.load(scope, name.slice(0, -5)); if (existing.pending || existing.saveIntent || existing.status === 'progress') throw fault('JOURNAL_PENDING', 'A pending batch requires recovery before a new batch.'); }
    }
    const paths = operations.flatMap(op => [op.path ?? op.from, ...(op.type === 'move' ? [op.to] : [])]).map(p => this.path(p, scope.workspace));
    this.footprint = [...new Set(paths)].filter(p => !paths.some(other => p !== other && p.startsWith(other + '/'))).sort(); this.blobs = {};
    const states = [await this.snapshot(scope)]; for (const op of operations) states.push(this.simulate(states.at(-1), op, scope.workspace));
    const journal = { schemaVersion: 1, id: randomUUID(), projectId: scope.projectId, workspace: scope.workspace, rootIdentities: scope.identities, footprint: this.footprint, blobs: this.blobs, operations: operations.map(op => ({ type: op.type, path: this.path(op.path ?? op.from, scope.workspace), ...(op.type === 'move' ? { to: this.path(op.to, scope.workspace) } : {}) })), states, slots: {}, position: 0, status: 'prepared', pending: null };
    await this.save(scope, journal); return { id: journal.id, steps: operations.length, status: journal.status };
  }); }
  async parents(scope, key, writable = true) {
    await this.scope(); let p = scope.workspace;
    for (const part of key.split('/').slice(0, -1)) { p = join(p, part); const s = await fs.lstat(p); if (!s.isDirectory() || s.isSymbolicLink() || await fs.realpath(p) !== p) throw fault('JOURNAL_SCOPE', 'Parent path changed.'); }
    const stat = await fs.lstat(p); if (writable && (!(stat.mode & 0o200) || !(stat.mode & 0o100))) throw fault('JOURNAL_READONLY', 'Parent directory is not owner writable.');
  }
  subtree(tree, key) { return Object.fromEntries(Object.entries(tree).filter(([path]) => path === key || path.startsWith(key + '/')).map(([path, node]) => [path.slice(key.length), node])); }
  async at(scope, path) {
    try { await fs.lstat(path); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
    const name = require('node:path').basename(path), tree = await this.snapshot({ ...scope, workspace: dirname(path) }, [name]); return this.subtree(tree, name);
  }
  async verifySlots(scope, journal) {
    for (const slot of Object.values(journal.slots || {})) { let found = 0; for (const path of slot.paths) { const tree = await this.at(scope, path); if (Object.keys(tree).length) { if (!same(tree, slot.tree)) throw fault('JOURNAL_CHANGED', 'Recorded stash bytes or permissions changed.'); found++; } } if (found > 1) throw fault('JOURNAL_CHANGED', 'Multiple recorded stash copies conflict.'); }
  }
  async nativeStep(scope, journal, from, to) {
    const index = Math.min(from, to), op = journal.operations?.[index];
    if (!op || !['move', 'delete'].includes(op.type) || same((journal.replayStates || journal.states)[index], (journal.replayStates || journal.states)[index + 1])) return false;
    const source = join(scope.workspace, op.path), target = op.to ? join(scope.workspace, op.to) : null,
      before = (journal.replayStates || journal.states)[index], after = (journal.replayStates || journal.states)[index + 1],
      sourceTree = this.subtree(before, op.path), targetTree = op.to ? this.subtree(before, op.to) : {};
    const observedFootprint = await this.snapshot(scope);
    const affected = key => key === op.path || key.startsWith(op.path + '/') || op.to && (key === op.to || key.startsWith(op.to + '/'));
    for (const key of new Set([...Object.keys(before), ...Object.keys(observedFootprint)])) if (!affected(key) && !same(observedFootprint[key], before[key])) throw fault('JOURNAL_CHANGED', 'Other affected batch paths changed before native transfer.');
    const empty = value => Object.keys(value).length === 0;
    const heldTree = op.to ? targetTree : sourceTree;
    journal.slots ||= {};
    if (!journal.slots[index]) {
      const base = heldTree['']?.type === 'directory' ? dirname(target || source) : scope.directory;
      journal.slots[index] = { paths: [join(base, `.ynx-journal-${journal.id}-stash-${index}`)], tree: heldTree };
      await this.save(scope, journal);
    }
    this.stashPaths = new Set(Object.values(journal.slots).flatMap(slot => slot.paths));
    const candidates = journal.slots[index].paths, present = [];
    for (const path of candidates) { const value = await this.at(scope, path); if (!empty(value)) { if (!same(value, heldTree)) throw fault('JOURNAL_CHANGED', 'Recovery stash was externally modified.'); present.push(path); } }
    if (present.length > 1) throw fault('JOURNAL_CHANGED', 'Recovery stash locations conflict.');
    let stash = present[0];
    if (!stash) for (const candidate of candidates) { try { const parent = await fs.lstat(dirname(candidate)); if (parent.isDirectory() && !parent.isSymbolicLink()) { stash = candidate; break; } } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    if (!stash) throw fault('JOURNAL_CHANGED', 'No recorded stash parent remains available.');
    const a = await this.at(scope, source), b = target ? await this.at(scope, target) : {}, c = await this.at(scope, stash);
    const original = same(a, sourceTree) && same(b, targetTree) && empty(c),
      middle = same(a, sourceTree) && empty(b) && same(c, targetTree),
      applied = empty(a) && (target ? same(b, sourceTree) && same(c, targetTree) : same(c, sourceTree));
    if (!original && !middle && !applied) throw fault('JOURNAL_CHANGED', 'Native resource locations no longer match the recorded move or deletion.');
    const forward = to > from;
    async function transfer(src, dst, expected, label) {
      if (empty(expected)) return;
      const currentSource = await this.at(scope, src), currentTarget = await this.at(scope, dst);
      if (!same(currentSource, expected) || !empty(currentTarget)) throw fault('JOURNAL_CHANGED', 'Native transfer source or target changed.');
      if (src.startsWith(scope.workspace + '/')) await this.parents(scope, relative(scope.workspace, src));
      if (dst.startsWith(scope.workspace + '/')) await this.parents(scope, relative(scope.workspace, dst));
      for (const slot of Object.values(journal.slots)) for (const old of [...slot.paths]) if (old.startsWith(src + '/')) { const relocated = dst + old.slice(src.length); if (!slot.paths.includes(relocated)) slot.paths.push(relocated); }
      this.stashPaths = new Set(Object.values(journal.slots).flatMap(slot => slot.paths));
      journal.pending = { from, to, primitive: { type: 'rename', source: src, target: dst, label, expectedDigest: hash(JSON.stringify(expected)) } };
      await this.save(scope, journal); await this.checkpoint?.({ phase: 'native-before', id: journal.id, from, to, label });
      await fs.rename(src, dst); await this.syncDir(dirname(src)); if (dirname(dst) !== dirname(src)) await this.syncDir(dirname(dst));
      await this.checkpoint?.({ phase: 'native-after', id: journal.id, from, to, label });
    }
    const move = transfer.bind(this);
    if (forward) {
      if (applied) return true;
      if (target) { if (original && !empty(targetTree)) await move(target, stash, targetTree, 'backup-target'); await move(source, target, sourceTree, 'move-source'); }
      else await move(source, stash, sourceTree, 'delete-to-stash');
    } else {
      if (original) return true;
      if (target) { if (applied) await move(target, source, sourceTree, 'restore-source'); if (!empty(targetTree)) await move(stash, target, targetTree, 'restore-target'); }
      else await move(stash, source, sourceTree, 'restore-deleted');
    }
    const observed = await this.snapshot(scope);
    if (!same(observed, (journal.replayStates || journal.states)[to])) throw fault('JOURNAL_CHANGED', 'Native resource result differs from its recorded state.');
    return true;
  }
  async step(scope, journal, from, to) { await this.verifySlots(scope, journal); if (!await this.nativeStep(scope, journal, from, to)) await this.transition(scope, (journal.replayStates || journal.states)[from], (journal.replayStates || journal.states)[to]); }
  async transition(scope, before, after) {
    const actual = await this.snapshot(scope), keys = new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(actual)]);
    for (const key of keys) if (!same(actual[key], before[key]) && !same(actual[key], after[key])) throw fault('JOURNAL_CHANGED', 'External bytes, paths or permissions changed.');
    // Every changed node can be at its durable before or after state after a crash.
    const depth = key => key.split('/').length;
    for (const key of Object.keys(actual).sort((a, b) => depth(b) - depth(a))) {
      if (same(actual[key], after[key]) || actual[key].type === 'directory' && after[key]?.type === 'directory') continue;
      if (actual[key].type === 'file' && after[key]?.type === 'file') continue;
      await this.parents(scope, key); const path = join(scope.workspace, key);
      if (actual[key].type === 'directory') await fs.rmdir(path); else await fs.unlink(path);
      await this.syncDir(dirname(path));
    }
    for (const key of Object.keys(after).sort((a, b) => depth(a) - depth(b))) {
      const node = after[key], path = join(scope.workspace, key);
      if (same(actual[key], node)) continue;
      await this.parents(scope, key);
      if (node.type === 'directory') { await fs.mkdir(path, { mode: node.mode }).catch(e => { if (e.code !== 'EEXIST') throw e; }); await fs.chmod(path, node.mode); await this.syncDir(dirname(path)); }
      else {
        const previous = actual[key]; if (previous?.type === 'file' && !(previous.mode & 0o200)) throw fault('JOURNAL_READONLY', 'File is not owner writable.');
        const temporary = join(scope.directory, `.file-${randomUUID()}`), h = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await h.writeFile(Buffer.from(this.blobs[node.blob], 'base64')); await h.chmod(node.mode); await h.sync(); } finally { await h.close(); }
        await this.parents(scope, key);
        // Final out-of-root confinement is supplied by the existing project sandbox.
        // Node path APIs cannot eliminate a hostile directory-rename TOCTOU race.
        await fs.rename(temporary, path); await this.syncDir(dirname(path));
      }
    }
    if (!same(await this.snapshot(scope), after)) throw fault('JOURNAL_CHANGED', 'File transition did not match its recorded result.');
  }
  async run(id, destination, recovery = false) {
    const scope = await this.scope();
    if (recovery) {
      const target = join(scope.directory, id + '.json'), pending = target + '.pending';
      try {
        await this.regular(pending, LIMITS.archive, true);
        const envelope = JSON.parse(await fs.readFile(pending, 'utf8'));
        if (envelope.sha256 !== hash(JSON.stringify(envelope.data)) || envelope.data.id !== id || envelope.data.projectId !== scope.projectId || envelope.data.workspace !== scope.workspace || envelope.data.schemaVersion !== 1) throw fault('JOURNAL_CORRUPT', 'Pending archive is corrupt.');
        const committed = await this.load(scope, id); if (!same(committed.states, envelope.data.states)) throw fault('JOURNAL_CORRUPT', 'Pending archive changed batch contents.');
        await fs.rename(pending, target); await this.syncDir(scope.directory);
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    const journal = await this.load(scope, id); this.footprint = journal.footprint; this.blobs = { ...journal.blobs }; this.stashPaths = new Set(Object.values(journal.slots || {}).flatMap(slot => slot.paths));
    await this.verifySlots(scope, journal);
    if (journal.saveIntent) throw fault('JOURNAL_SAVE_PENDING', 'An observed native save is awaiting its bound completion.');
    if (journal.pending && !recovery) throw fault('JOURNAL_PENDING', 'An interrupted batch requires explicit recovery.');
    if (recovery && journal.pending) { const { from, to } = journal.pending; await this.step(scope, journal, to, from); journal.position = from; journal.pending = null; journal.status = 'recovered'; await this.save(scope, journal); }
    if (!same(await this.snapshot(scope), (journal.replayStates || journal.states)[journal.position])) throw fault('JOURNAL_CHANGED', 'Workspace changed outside the saved batch.');
    const end = destination === 'after' ? journal.states.length - 1 : 0;
    const original = journal.position;
    try {
      while (journal.position !== end) {
        const from = journal.position, to = from + Math.sign(end - from);
        journal.pending = { from, to }; journal.status = 'pending'; await this.save(scope, journal);
        await this.checkpoint?.({ phase: 'before', id, from, to });
        await this.step(scope, journal, from, to);
        await this.checkpoint?.({ phase: 'after', id, from, to });
        journal.position = to; journal.pending = null; journal.status = 'progress'; await this.save(scope, journal);
      }
      journal.status = end ? 'applied' : 'undone'; await this.save(scope, journal); return { id, status: journal.status, position: journal.position };
    } catch (error) {
      if (error.code === 'JOURNAL_SIMULATED_CRASH') throw error;
      try {
        if (journal.pending) { const { from, to } = journal.pending; await this.step(scope, journal, to, from); journal.position = from; journal.pending = null; await this.save(scope, journal); }
        while (journal.position !== original) { const from = journal.position, to = from + Math.sign(original - from); journal.pending = { from, to }; await this.save(scope, journal); await this.step(scope, journal, from, to); journal.position = to; journal.pending = null; await this.save(scope, journal); }
        journal.status = 'compensated'; await this.save(scope, journal);
      } catch (compensation) { error.recoveryError = compensation.code || compensation.message; }
      throw error;
    }
  }
  // Binding contract: the backend supplies its registered fence/task validator
  // and existing native FileService text writer. These capabilities are never
  // supplied by a save RPC caller. The frontend captures final text only after
  // WillSave participants, keeps the model fence until readback, then permits
  // native didSave. Encoding/BOM prediction uses the retained EncodingService.
  // This module does not itself bind frontend callbacks or expose save RPCs.
  saveReady() {
    if (!this.encodingService?.encode || !this.encodingService?.toResourceEncoding || !this.saveAuthority?.validateCapture || !this.saveAuthority?.writeText) throw fault('JOURNAL_SAVE_NOT_INTEGRATED', 'The fenced native save authority is not connected.');
  }
  saveCapture(scope, spec) {
    if (!spec || Object.hasOwn(spec, 'afterHash') || Object.hasOwn(spec, 'afterBytes')) throw fault('JOURNAL_SAVE_CAPTURE', 'An arbitrary raw save rebase is ineligible.');
    const path = this.path(spec.path, scope.workspace), model = spec.model;
    if (!model || this.path(model.uri, scope.workspace) !== path || typeof model.text !== 'string' || Buffer.byteLength(model.text) > LIMITS.bytes || typeof model.dirty !== 'boolean' ||
      !['versionId', 'alternativeVersionId', 'savedVersionId'].every(key => Number.isSafeInteger(model[key]) && model[key] >= 1) ||
      !['\n', '\r\n'].includes(model.eol) || typeof model.encoding !== 'string' || model.encoding.length > 64 || this.encodingService.exists?.(model.encoding) !== true ||
      typeof model.bom !== 'boolean' || typeof spec.overwriteEncoding !== 'boolean' || !/^[a-f0-9-]{36}$/.test(spec.taskId || '') || !/^[a-f0-9-]{36}$/.test(spec.fenceId || '') ||
      !spec.resourceVersion || typeof spec.resourceVersion.etag !== 'string' || !spec.resourceVersion.etag || !Number.isFinite(spec.resourceVersion.mtime)) throw fault('JOURNAL_SAVE_CAPTURE', 'A complete fenced native model capture is required.');
    if (spec.baseline && (typeof spec.baseline.text !== 'string' || Buffer.byteLength(spec.baseline.text) > LIMITS.bytes || typeof spec.baseline.dirty !== 'boolean' || this.path(spec.baseline.uri, scope.workspace) === undefined || !['versionId', 'alternativeVersionId', 'savedVersionId'].every(key => Number.isSafeInteger(spec.baseline[key]) && spec.baseline[key] >= 1))) throw fault('JOURNAL_SAVE_CAPTURE', 'The retained dirty baseline is invalid.');
    return { path, taskId: spec.taskId, fenceId: spec.fenceId, overwriteEncoding: spec.overwriteEncoding, resourceVersion: { ...spec.resourceVersion }, model: { ...model }, ...(spec.baseline ? { baseline: { ...spec.baseline } } : {}) };
  }
  saveAliases(journal, path) {
    const states = journal.replayStates || journal.states, aliases = new Map([[journal.position, path]]); let renamed = false;
    const affects = (key, base) => key === base || key.startsWith(base + '/');
    let key = path;
    for (let index = journal.position - 1; index >= 0; index--) {
      const op = journal.operations[index];
      if (op.type === 'move' && affects(key, op.to)) { key = op.path + key.slice(op.to.length); renamed = true; }
      else if (op.type !== 'move' && affects(key, op.path)) throw fault('JOURNAL_SAVE_SEMANTICS', 'Raw create, write or delete history requires its original batch save semantics.');
      if (!states[index][key] || states[index][key].type !== 'file') break; aliases.set(index, key);
    }
    key = path;
    for (let index = journal.position; index < journal.operations.length; index++) {
      const op = journal.operations[index];
      if (op.type === 'move' && affects(key, op.path)) { key = op.to + key.slice(op.path.length); renamed = true; }
      else if (op.type !== 'move' && affects(key, op.path)) throw fault('JOURNAL_SAVE_SEMANTICS', 'Raw create, write or delete history requires its original batch save semantics.');
      if (!states[index + 1][key] || states[index + 1][key].type !== 'file') break; aliases.set(index + 1, key);
    }
    if (!renamed) throw fault('JOURNAL_SAVE_SEMANTICS', 'Observed save lineage requires a recorded resource rename.');
    return aliases;
  }
  prepareObservedSave(id, spec) { return this.operation(async () => {
    this.saveReady(); const scope = await this.scope(), journal = await this.load(scope, id), capture = this.saveCapture(scope, spec);
    if (journal.pending || journal.saveIntent || !['applied', 'undone'].includes(journal.status)) throw fault('JOURNAL_SAVE_PENDING', 'The batch must have a stable resource position before native save.');
    if (journal.observedSaves?.some(save => save.taskId === capture.taskId)) throw fault('JOURNAL_SAVE_TASK', 'The native save task was already recorded.');
    if (await this.saveAuthority.validateCapture(capture) !== true) throw fault('JOURNAL_SAVE_CAPTURE', 'Native model capture is stale or lacks its registered fence.');
    this.footprint = journal.footprint; this.blobs = { ...journal.blobs }; this.stashPaths = new Set(Object.values(journal.slots || {}).flatMap(slot => slot.paths)); await this.verifySlots(scope, journal);
    const states = journal.replayStates || journal.states, actual = await this.snapshot(scope); if (!same(actual, states[journal.position])) throw fault('JOURNAL_CHANGED', 'The recorded raw bytes changed before native save.');
    const node = actual[capture.path]; if (node?.type !== 'file' || !(node.mode & 0o200)) throw fault('JOURNAL_READONLY', 'Observed save requires a writable recorded file.');
    const stat = await this.regular(join(scope.workspace, capture.path), LIMITS.bytes), etag = stat.mtimeMs.toString(29) + stat.size.toString(31);
    if (capture.resourceVersion.etag !== etag || capture.resourceVersion.mtime !== stat.mtimeMs) throw fault('JOURNAL_SAVE_VERSION', 'Native save resource version no longer matches the disk.');
    const aliases = this.saveAliases(journal, capture.path), beforeBytes = Buffer.from(journal.blobs[node.blob], 'base64');
    const encoding = await this.encodingService.toResourceEncoding(capture.model.encoding, { overwriteEncoding: capture.overwriteEncoding, read: async count => new Uint8Array(beforeBytes.subarray(0, count)) });
    if (encoding.hasBOM !== capture.model.bom) throw fault('JOURNAL_SAVE_ENCODING', 'Native BOM capture differs from the resolved resource encoding.');
    const encoded = Buffer.from(this.encodingService.encode(capture.model.text, encoding).buffer); if (encoded.length > LIMITS.bytes) throw fault('JOURNAL_LIMIT', 'Encoded save exceeds affected byte capacity.');
    const replayStates = structuredClone(states), afterBlob = hash(encoded); journal.blobs[afterBlob] = encoded.toString('base64');
    for (const [position, key] of aliases) { if (replayStates[position][key].blob !== node.blob || replayStates[position][key].mode !== node.mode) throw fault('JOURNAL_SAVE_SEMANTICS', 'Rename lineage crossed a different raw file state.'); replayStates[position][key].blob = afterBlob; }
    for (const state of replayStates) if (Object.values(state).reduce((total, node) => total + (node.type === 'file' ? Buffer.from(journal.blobs[node.blob], 'base64').length : 0), 0) > LIMITS.bytes) throw fault('JOURNAL_LIMIT', 'Observed save exceeds affected snapshot capacity.');
    const token = randomUUID();
    journal.saveIntent = { token, phase: 'prepared', capture, beforeBlob: node.blob, afterBlob, mode: node.mode, beforeIdentity: { dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size }, replayStates };
    await this.save(scope, journal); return { token, taskId: capture.taskId, encoding: encoding.encoding, hasBOM: encoding.hasBOM };
  }); }
  cancelObservedSave(id, token) { return this.operation(async () => {
    const scope = await this.scope(), journal = await this.load(scope, id), intent = journal.saveIntent; if (!intent || intent.token !== token) throw fault('JOURNAL_SAVE_TOKEN', 'Native save token is missing or stale.');
    const path = join(scope.workspace, intent.capture.path), stat = await this.regular(path, LIMITS.bytes);
    if (stat.dev !== intent.beforeIdentity.dev || stat.ino !== intent.beforeIdentity.ino || stat.mtimeMs !== intent.beforeIdentity.mtimeMs || (stat.mode & 0o777) !== intent.mode || hash(await fs.readFile(path)) !== intent.beforeBlob) throw fault('JOURNAL_CHANGED', 'A save that changed the disk cannot be discarded as unperformed.');
    journal.cancelledSaves ||= []; journal.cancelledSaves.push({ taskId: intent.capture.taskId, fenceId: intent.capture.fenceId, beforeBlob: intent.beforeBlob }); journal.saveIntent = null; await this.save(scope, journal); return { cancelled: true };
  }); }
  commitObservedSave(id, token) { return this.operation(async () => {
    this.saveReady(); const scope = await this.scope(), journal = await this.load(scope, id), intent = journal.saveIntent;
    if (!intent || intent.token !== token) throw fault('JOURNAL_SAVE_TOKEN', 'Native save token is missing or stale.');
    const capture = intent.capture, path = join(scope.workspace, capture.path);
    if (await this.saveAuthority.validateCapture(capture) !== true) throw fault('JOURNAL_SAVE_CAPTURE', 'Native save capture changed before write.');
    const stat = await this.regular(path, LIMITS.bytes); if (stat.dev !== intent.beforeIdentity.dev || stat.ino !== intent.beforeIdentity.ino || stat.mtimeMs !== intent.beforeIdentity.mtimeMs || (stat.mode & 0o777) !== intent.mode || hash(await fs.readFile(path)) !== intent.beforeBlob) throw fault('JOURNAL_CHANGED', 'The raw save target changed after its checkpoint.');
    await this.parents(scope, capture.path, false);
    journal.saveIntent.phase = 'writing'; await this.save(scope, journal);
    const result = await this.saveAuthority.writeText(path, capture.model.text, { encoding: capture.model.encoding, overwriteEncoding: capture.overwriteEncoding, version: capture.resourceVersion, taskId: capture.taskId, fenceId: capture.fenceId });
    journal.saveIntent.phase = 'write-returned'; journal.saveIntent.nativeResourceVersion = result; await this.save(scope, journal);
    await this.scope(); const after = await this.regular(path, LIMITS.bytes), raw = await fs.readFile(path);
    if ((after.mode & 0o777) !== intent.mode || hash(raw) !== intent.afterBlob || !result || result.etag !== after.mtimeMs.toString(29) + after.size.toString(31) || result.mtime !== after.mtimeMs) throw fault('JOURNAL_SAVE_READBACK', 'The native save did not produce its checkpointed bytes, mode and resource version.');
    if (await this.saveAuthority.validateCapture(capture) !== true) throw fault('JOURNAL_SAVE_CAPTURE', 'The native model changed during save.');
    journal.replayStates = intent.replayStates; journal.observedSaves ||= []; journal.observedSaves.push({ ...capture, beforeBlob: intent.beforeBlob, afterBlob: intent.afterBlob, mode: intent.mode, afterResourceVersion: { ...result } }); journal.saveIntent = null;
    await this.save(scope, journal); return { taskId: capture.taskId, resourceVersion: result, beforeRawHash: intent.beforeBlob, afterRawHash: intent.afterBlob };
  }); }
  apply(id) { return this.operation(() => this.run(id, 'after')); }
  undo(id) { return this.operation(() => this.run(id, 'before')); }
  redo(id) { return this.apply(id); }
  recover(id, destination = 'before') { if (!['before', 'after'].includes(destination)) return Promise.reject(fault('JOURNAL_OPERATION', 'Invalid recovery destination.')); return this.operation(() => this.run(id, destination, true)); }
  inspect(id) { return this.operation(async () => { const scope = await this.scope(), j = await this.load(scope, id); return { id, status: j.status, position: j.position, pending: j.pending, savePending: j.saveIntent ? { phase: j.saveIntent.phase, taskId: j.saveIntent.capture.taskId } : null, steps: j.states.length - 1 }; }); }
}
module.exports = { WorkspaceFileJournal, LIMITS };
