import { randomUUID, createHash } from 'node:crypto';
import { open, realpath, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fault } from './central-identity.mjs';
import { reviewedSoliditySnapshot, sourceDigest, validSolidityPath } from './solidity-snapshot.mjs';

// Local launch-generation projection in the original workspace journal. It is
// deliberately independent from Wallet's actor epoch and never grants access.
export function createProjectBuildBinding({ db, resolveAdmission, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS codeoss_build_generations(
    workspace_owner TEXT NOT NULL, project TEXT NOT NULL, session TEXT NOT NULL,
    generation TEXT NOT NULL, PRIMARY KEY(workspace_owner,project,session));
    CREATE TABLE IF NOT EXISTS codeoss_build_generation_heads(
    workspace_owner TEXT NOT NULL, project TEXT NOT NULL, generation TEXT NOT NULL,
    PRIMARY KEY(workspace_owner,project));`);
  const contexts = new WeakMap();
  const unavailable = () => fault('The original project or saved source changed. Save and build again.', 'build_source_changed', 409);
  function generation(a) {
    const owner = a.identity.workspaceOwner, project = a.context.projectId, session = a.context.sessionId;
    db.exec('BEGIN IMMEDIATE');
    try {
      let row = db.prepare('SELECT generation FROM codeoss_build_generations WHERE workspace_owner=? AND project=? AND session=?').get(owner, project, session);
      if (!row) {
        const prior = db.prepare('SELECT generation FROM codeoss_build_generation_heads WHERE workspace_owner=? AND project=?').get(owner, project);
        if (prior && !/^(0|[1-9][0-9]*)$/.test(prior.generation)) throw unavailable();
        row = { generation: String(BigInt(prior?.generation || '0') + 1n) };
        db.prepare('INSERT OR REPLACE INTO codeoss_build_generation_heads VALUES(?,?,?)').run(owner, project, row.generation);
        db.prepare('INSERT INTO codeoss_build_generations VALUES(?,?,?,?)').run(owner, project, session, row.generation);
      }
      db.exec('COMMIT'); return row.generation;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const same = (a,b) => a.context.owner === b.context.owner && a.context.projectId === b.context.projectId &&
    a.context.sessionId === b.context.sessionId && a.context.runtimeId === b.context.runtimeId &&
    a.identity.workspaceOwner === b.identity.workspaceOwner && a.identity.account === b.identity.account &&
    a.identity.generation === b.identity.generation && a.identity.identityReference === b.identity.identityReference;
  async function current(original) {
    const a = await resolveAdmission(original);
    if (!same(a,original) || a.expiresAt <= now()) throw unavailable();
    return a;
  }
  async function checkSources(a, sources) {
    const root = join(a.context.projectDirectory, 'workspace');
    if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw unavailable();
    for (const [path, expected] of Object.entries(sources)) {
      if (!validSolidityPath(path)) throw unavailable();
      const full = join(root,path);
      // Reject links in every component, including directory aliases.
      let parent = root;
      for (const part of path.split('/')) {
        parent = join(parent,part);
        if ((await lstat(parent)).isSymbolicLink()) throw unavailable();
      }
      const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await file.stat();
        if (!before.isFile() || before.size > 65536) throw unavailable();
        const bytes = await file.readFile(), after = await file.stat();
        if (bytes.length > 65536 || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
          sourceDigest(bytes) !== expected || await realpath(full) !== full) throw unavailable();
      } finally { await file.close(); }
    }
  }
  async function checkedSources(a, sources) {
    try { await checkSources(a,sources); }
    catch (error) { if (error.code === 'build_source_changed') throw error; throw Object.assign(unavailable(), { cause: error }); }
  }
  async function bind(admission, { sourceSha256, snapshot, name, source }) {
    const a = await current(admission);
    const digest = createHash('sha256').update(JSON.stringify(snapshot || { name, source })).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(sourceSha256 || '') || sourceSha256 !== digest) throw unavailable();
    const sources = snapshot ? reviewedSoliditySnapshot(snapshot, a.context.sessionId).sourceDigests :
      { [`${name}.sol`]: sourceDigest(source) };
    await checkedSources(a,sources);
    const gen = generation(a);
    const ctx = Object.freeze({ realm: 'ynx-developer-local', tenant: a.identity.workspaceOwner,
      actor: a.identity.owner, actorEpoch: String(a.identity.generation), traceId: randomUUID(), requestId: randomUUID() });
    const row = db.prepare('SELECT revision FROM codeoss_sessions WHERE id=?').get(a.context.sessionId);
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) throw unavailable();
    const project = Object.freeze({ realm: ctx.realm, tenant: ctx.tenant, kind: 'project', id: a.context.projectId, rev: String(row.revision) });
    const assertCurrentSource = async () => { const latest = await current(admission); await checkedSources(latest,sources); await current(admission); };
    contexts.set(ctx,{ admission, project, assertCurrentSource });
    return Object.freeze({ ctx,project,gen,commit: sourceSha256,assertCurrentSource });
  }
  async function authorize(ctx, project, operation) {
    const bound = contexts.get(ctx);
    if (!bound || !['build','read-build'].includes(operation) || JSON.stringify(project) !== JSON.stringify(bound.project))
      throw fault('An original project build binding is required.', 'build_admission',403);
    await current(bound.admission);
    if (operation === 'build') await bound.assertCurrentSource();
  }
  return Object.freeze({ bind,authorize });
}
