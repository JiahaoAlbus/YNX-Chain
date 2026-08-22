import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Hermetic executable model of the leased command object: named curl,
// systemctl, file and readlink stubs exercise switch and rollback only in /tmp.
const root = mkdtempSync(join(tmpdir(), 'finance-production-fixture-'));
const sha = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : readFileSync(value)).digest('hex');
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
const receipt = (url, body) => ({ url, status: '200', bytes: Buffer.byteLength(body), sha256: sha(Buffer.from(body)) });
const safeChild = (parent, relative) => {
  assert.ok(relative && !relative.startsWith('/') && !relative.split('/').includes('..'), 'reject traversal');
  const path = resolve(parent, relative); assert.ok(path.startsWith(`${resolve(parent)}/`), 'reject sibling'); return path;
};

function makeFixture() {
  const dir = mkdtempSync(join(root, 'case-')); const old = join(dir, 'old-release'); const candidate = join(dir, 'candidate-release');
  const env = join(dir, 'finance.env'); const state = join(dir, 'state.json'); const current = join(dir, 'finance-current');
  write(join(old, 'web', 'app.js'), 'old-asset'); write(join(candidate, 'web', 'app.js'), 'new-asset'); write(join(old, 'ynx-finance'), 'old-bin'); write(join(candidate, 'ynx-finance'), 'new-bin');
  write(env, 'YNX_FINANCE_WEB_DIR=old'); write(state, 'old-state'); symlinkSync(old, current);
  const service = { active: true, pid: 101, nrestarts: 7 };
  const curl = ({ body }) => ({ status: '200', body: Buffer.from(body) });
  const systemctl = { isActive: () => service.active, show: key => service[key], restart: () => { service.pid += 1; service.nrestarts += 1; service.active = true; }, stop: () => { service.active = false; }, start: () => { service.active = true; } };
  const file = path => ({ regular: lstatSync(path).isFile(), symlink: lstatSync(path).isSymbolicLink() });
  const readlink = path => readlinkSync(path);
  return { dir, old, candidate, env, state, current, service, curl, systemctl, file, readlink };
}
function checkHttp(fixture, expected, body) {
  const response = fixture.curl({ url: expected.url, body }); assert.equal(response.status, expected.status, 'HTTP status'); assert.equal(response.body.byteLength, expected.bytes, 'HTTP bytes'); assert.equal(sha(response.body), expected.sha256, 'HTTP SHA');
}
function deployFixture(fixture, { forceCandidateFailure = false } = {}) {
  const oldEnv = readFileSync(fixture.env); const oldState = readFileSync(fixture.state); const oldTarget = fixture.readlink(fixture.current);
  const oldPid = fixture.systemctl.show('pid'); const oldRestarts = fixture.systemctl.show('nrestarts');
  const oldHealth = receipt('https://old/health', 'old-health'); const oldVersion = receipt('https://old/version', 'old-version');
  const candidateHealth = receipt('https://new/health', forceCandidateFailure ? 'wrong-health' : 'new-health'); const candidateVersion = receipt('https://new/version', 'new-version'); const candidateAsset = receipt('https://new/web/app.js', 'new-asset');
  const localAsset = safeChild(fixture.candidate, 'web/app.js'); assert.ok(fixture.file(localAsset).regular && !fixture.file(localAsset).symlink, 'candidate asset regular'); assert.equal(sha(localAsset), candidateAsset.sha256, 'candidate local asset');
  checkHttp(fixture, oldHealth, 'old-health'); checkHttp(fixture, oldVersion, 'old-version');
  const backup = join(fixture.dir, 'backup'); mkdirSync(backup); write(join(backup, 'env'), oldEnv); write(join(backup, 'state'), oldState); let switched = false;
  try {
    const newRelease = join(fixture.dir, 'new-release'); renameSync(fixture.candidate, newRelease); fixture.candidate = newRelease; write(fixture.env, 'YNX_FINANCE_WEB_DIR=new'); write(fixture.state, 'candidate-state'); rmSync(fixture.current); symlinkSync(newRelease, fixture.current); switched = true; fixture.systemctl.restart();
    assert.ok(fixture.systemctl.isActive(), 'candidate active'); assert.ok(fixture.systemctl.show('pid') > 0 && fixture.systemctl.show('pid') !== oldPid, 'candidate PID transition'); assert.equal(fixture.systemctl.show('nrestarts'), oldRestarts + 1, 'candidate restart transition');
    checkHttp(fixture, candidateHealth, 'new-health'); checkHttp(fixture, candidateVersion, 'new-version'); const liveAsset = safeChild(newRelease, 'web/app.js'); assert.equal(sha(liveAsset), candidateAsset.sha256, 'live local asset'); checkHttp(fixture, candidateAsset, 'new-asset');
  } catch (error) {
    fixture.systemctl.stop(); const candidateState = lstatSync(fixture.state); if (candidateState.isSymbolicLink() || !candidateState.isFile()) throw new Error('candidate state fence');
    rmSync(fixture.state); const stateTmp = join(dirname(fixture.state), '.state.restore'); cpSync(join(backup, 'state'), stateTmp); renameSync(stateTmp, fixture.state); assert.equal(readFileSync(fixture.state, 'utf8'), oldState.toString(), 'state restored atomically');
    write(fixture.env, oldEnv); rmSync(fixture.current); symlinkSync(oldTarget, fixture.current); fixture.systemctl.start(); checkHttp(fixture, oldHealth, 'old-health'); checkHttp(fixture, oldVersion, 'old-version'); assert.equal(readFileSync(fixture.env, 'utf8'), oldEnv.toString(), 'env restored'); assert.equal(fixture.readlink(fixture.current), oldTarget, 'symlink restored'); assert.ok(switched, 'failure after switch'); throw error;
  }
}

const success = makeFixture(); deployFixture(success); assert.equal(success.readlink(success.current), success.candidate, 'success selects candidate');
const failure = makeFixture(); assert.throws(() => deployFixture(failure, { forceCandidateFailure: true }), /HTTP (bytes|SHA)/); assert.equal(failure.readlink(failure.current), failure.old, 'rollback selects old release');
assert.throws(() => safeChild(root, '../traversal'), /reject traversal/); assert.throws(() => safeChild(root, '/absolute'), /reject traversal/);
const symlinkCase = makeFixture(); rmSync(symlinkCase.state); symlinkSync(symlinkCase.old, symlinkCase.state); assert.throws(() => { if (lstatSync(symlinkCase.state).isSymbolicLink()) throw new Error('state symlink rejected'); }, /state symlink/);
const httpCase = makeFixture(); const bad = receipt('https://bad', 'ok'); assert.throws(() => checkHttp(httpCase, { ...bad, bytes: 3 }, 'ok'), /HTTP bytes/);
assert.throws(() => checkHttp(httpCase, { ...bad, status: '503' }, 'ok'), /HTTP status/);
const assetCase = makeFixture(); write(join(assetCase.candidate, 'web', 'app.js'), 'tampered'); assert.throws(() => assert.equal(sha(join(assetCase.candidate, 'web', 'app.js')), receipt('u', 'new-asset').sha256, 'asset mismatch'), /asset mismatch/);
console.log('finance production dynamic fixture: pass');
