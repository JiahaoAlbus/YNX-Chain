// PUBLIC mechanism controls only. The held callbacks below are not an Auth
// capability, Source provider, reservation verifier or P08 resource executor.
import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openOriginalTaskReadContinuationTransport as open} from './task-read-resource-continuation.mjs';
import {openOriginalTaskReadResourceCaller as openPhysical} from './task-read-resource-caller.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(here, '../..');
const service = 'ynx-ai-original-task-read-v1';
const original = Buffer.from('{ "PUBLIC":"same original entity", "exactInteger":9007199254740993 }\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); promise.catch(() => {}); return {promise, resolve, reject};};
let evidence, executable, sourceFiles, beforePins;
const pin = async file => {const b = await fs.readFile(path.join(repository, file)); return {file, bytes: b.length, sha256: sha(b)};};
const put = (name, value) => fs.writeFile(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
before(async () => {
  const root = process.env.YNX_LINK_TASK_READ_RESOURCE_TEST_ARTIFACTS;
  assert.ok(root && path.isAbsolute(root), 'explicit external evidence root required');
  await fs.mkdir(root, {recursive: true, mode: 0o700}); evidence = await fs.mkdtemp(path.join(root, 'ct-'));
  for (const key of ['GOCACHE', 'GOTMPDIR']) {assert.ok(path.isAbsolute(process.env[key] || '')); await fs.mkdir(process.env[key], {recursive: true});}
  const goLeaves = (await fs.readdir(path.join(repository, 'internal/securelink'))).filter(f => f.startsWith('task_read_continuation') && f.endsWith('.go')).sort();
  assert.ok(goLeaves.length >= 3, 'actual portable and Unix carrier sources required');
  sourceFiles = ['go.mod', 'go.sum', 'internal/securelink/local_caller.go', 'internal/securelink/local_caller_unix.go',
    ...goLeaves.map(f => 'internal/securelink/' + f), ...['native.c', 'build.mjs', 'build/caller.node',
      'task-read-resource-caller.mjs', 'task-read-resource-continuation.mjs', 'task-read-resource-continuation.test.mjs',
      'go-task-read-continuation-fixture/main.go', 'testdata/task-read-continuation/ORIGINAL.json'].map(f => 'cmd/ynx-secure-link-caller/' + f)];
  beforePins = await Promise.all(sourceFiles.map(pin)); await put('SOURCE-BEFORE.json', beforePins);
  executable = path.join(evidence, 'PUBLIC-continuation-peer');
  const args = ['build', '-mod=readonly', '-p', '1', '-o', executable, './cmd/ynx-secure-link-caller/go-task-read-continuation-fixture'];
  const built = spawnSync('go', args, {cwd: repository, env: {...process.env, CGO_ENABLED: '0', GOTOOLCHAIN: 'local',
    GOWORK: 'off', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', TMPDIR: process.env.GOTMPDIR}, encoding: 'utf8', timeout: 90000, maxBuffer: 4 << 20});
  await fs.writeFile(path.join(evidence, 'go-build.stdout'), built.stdout ?? '', {flag: 'wx'});
  await fs.writeFile(path.join(evidence, 'go-build.stderr'), built.stderr ?? '', {flag: 'wx'});
  await put('go-build.json', {args, status: built.status, signal: built.signal, error: built.error?.message ?? null, GoArchive: false});
  assert.equal(built.error, undefined); assert.equal(built.status, 0, built.stderr);
  const binary = await fs.readFile(executable);
  await put('FIXTURE.json', {PUBLIC: true, actualUnix: true, actualGoServer: true, binary: {bytes: binary.length, sha256: sha(binary)},
    RootAdmission: false, SourceAdmission: false, P08StoreExecuted: false, realAuthCapability: false});
  console.log('# Continuation transport evidence ' + evidence);
}, {timeout: 95000});
after(async () => {
  if (!beforePins) return;
  const actual = await Promise.all(sourceFiles.map(pin)); await put('SOURCE-AFTER.json', actual);
  assert.deepEqual(actual, beforePins, 'source/native tuple changed during controls');
});
function profile(socketPath, pid) {return {socketPath, serverUID: process.geteuid(), serverPID: pid, service,
  connectTimeoutMs: 1000, requestTimeoutMs: 3000, routes: ['input', 'execute', 'query'].map(id => ({id, method: 'POST',
    path: '/internal/ai/original-task-read/' + id, maxRequestBytes: 1 << 20, maxResponseBytes: 1 << 20}))};}
function publicHeld({failCurrentAt, failValue, holdCurrentAt, claimErrorPresent = false, claimError} = {}) {
  const waiting = deferred(), release = deferred();
  const stats = {current: 0, read: 0, claims: 0, retire: 0, join: 0, close: 0};
  const child = Object.freeze({
    async assertCurrent() {const n = ++stats.current; if (n === holdCurrentAt) {waiting.resolve(); await release.promise;} if (n === failCurrentAt) throw failValue;},
    readOriginalRequestDATA() {stats.read++; return {PUBLIC: 'detached DATA, not a Source or Grant', entitySHA256: sha(original)};},
    claimAtOriginalResourceFence() {stats.claims++; if (claimErrorPresent) throw claimError;},
    assertOriginalTaskEffectReceiptAtCommit() {}, retire() {stats.retire++;},
    async join() {stats.join++; return {physicalDone: true, errorPresent: false};},
    async close() {stats.close++; return {physicalDone: true, errorPresent: false};},
    isJoined() {return false;}, isClosed() {return false;}, firstCause() {return {errorPresent: false};},
  });
  return {child, stats, waiting: waiting.promise, release: () => release.resolve()};
}
async function fixture(t, mode = 'normal') {
  const directory = await fs.mkdtemp('/tmp/ct-'); await fs.chmod(directory, 0o700);
  const socket = path.join(directory, 's'), child = spawn(executable, [socket, mode, String(process.geteuid()), String(process.pid)], {stdio: ['pipe', 'pipe', 'pipe']});
  const exit = deferred(), events = [], waiters = [], owners = [], packets = new Set(), works = [], held = [];
  let stdout = '', stderr = '', tail = '';
  const event = match => {const old = events.find(match); if (old) return Promise.resolve(old); return new Promise((resolve, reject) => {
    const w = {match, resolve, reject, timer: setTimeout(() => {waiters.splice(waiters.indexOf(w), 1); reject(Error('PUBLIC event timeout: ' + stdout + stderr));}, 6000)}; waiters.push(w);
  });};
  child.stdout.on('data', b => {stdout += b; tail += b; let end; while ((end = tail.indexOf('\n')) >= 0) {
    const line = tail.slice(0, end); tail = tail.slice(end + 1); const v = JSON.parse(line); events.push(v);
    for (const w of [...waiters]) if (w.match(v)) {clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(v);}
  }});
  child.stderr.on('data', b => {stderr += b;}); child.stdin.on('error', e => {stderr += e.message;});
  child.on('error', e => exit.reject(e)); child.on('exit', (code, signal) => {exit.resolve({code, signal}); for (const w of waiters) {clearTimeout(w.timer); w.reject(Error('PUBLIC peer exited'));} waiters.length = 0;});
  const f = {mode, child, events, event, owners, packets, held, command(s) {if (!child.stdin.destroyed) child.stdin.write(s + '\n');},
    async open(h, bytes = original, changes = {}, options) {held.push(h); const out = await open({...f.profile, ...changes}, bytes, h.child, options); if (out.owner) owners.push(out.owner); return out;},
    exchange(owner, options) {const work = owner.exchange(options).then(out => {if (out.response) packets.add(out.response); return out;}); works.push(work); return work;}};
  t.after(async () => {
    for (const h of held) h.release();
    for (const owner of owners) {try {owner.retire();} catch {}}
    await Promise.allSettled(works);
    for (const packet of packets) {try {packet.release();} catch {}}
    const cleanup = [];
    for (const owner of owners) {const signal = AbortSignal.timeout(2500); try {const out = await owner.close({signal}); cleanup.push({physicalDone: out.physicalDone, errorPresent: out.errorPresent});} catch (e) {cleanup.push({physicalDone: false, error: String(e)});}}
    f.command('stop'); let killSelected = false; const kill = setTimeout(() => {killSelected = true; child.kill();}, 3500);
    let outcome; try {outcome = await exit.promise;} finally {clearTimeout(kill);}
    const name = path.basename(directory), drained = events.find(v => v.event === 'drained');
    await fs.writeFile(path.join(evidence, name + '.stdout'), stdout, {flag: 'wx'}); await fs.writeFile(path.join(evidence, name + '.stderr'), stderr, {flag: 'wx'});
    await put(name + '.exit.json', {mode, exit: outcome, killSelected, drained: drained ?? null, cleanup, PUBLIC: true});
    await fs.rm(directory, {recursive: true, force: true});
    assert.equal(killSelected, false, 'forced peer termination cannot qualify'); assert.deepEqual(outcome, {code: 0, signal: null});
    assert.ok(drained, 'real Go drain required'); for (const c of cleanup) assert.equal(c.physicalDone, true);
    for (const h of held) assert.deepEqual([h.stats.retire, h.stats.join, h.stats.close], [0, 0, 0], 'LINK borrows the original child; Auth owns its close');
  });
  const ready = await event(v => v.event === 'ready'); assert.equal(ready.pid, child.pid); assert.equal(ready.uid, process.geteuid());
  f.profile = profile(socket, ready.pid); return f;
}
async function acquired(f, h, bytes = original) {const out = await f.open(h, bytes); assert.ok(out.owner, 'nonnull partial adopted before status'); assert.equal(out.errorPresent, false, String(out.error)); return out.owner;}
async function finish(f, owner, response) {if (response) {response.release(); f.packets.delete(response);} const out = await owner.close(); assert.equal(out.physicalDone, true); return out;}

test('same original Go caller binds the held continuation and exact entity without minting authority', async t => {
  const f = await fixture(t), h = publicHeld(), input = Buffer.from(original);
  const pending = f.open(h, input); input.fill(0); const opened = await pending;
  assert.ok(opened.owner); assert.equal(opened.errorPresent, false); const owner = opened.owner;
  const out = await f.exchange(owner); assert.equal(out.errorPresent, false, String(out.error)); assert.ok(out.response);
  const data = out.response.copyDATA(); assert.equal(data.statusCode, 200); assert.equal(data.bodyComplete, true);
  assert.deepEqual(data.body, original); assert.equal(data.sourceVerified, false); assert.equal(data.operationVerified, false);
  assert.equal(h.stats.claims, 1); assert.ok(h.stats.current >= 3); assert.ok(h.stats.read >= 1);
  const request = f.events.find(v => v.event === 'request'); assert.ok(request);
  assert.equal(request.originalCurrent, true); assert.equal(request.sameContextCaller, true); assert.equal(request.cloneDenied, true);
  assert.equal(request.continuationPresent, true); assert.equal(request.path, '/internal/ai/original-task-read/execute');
  assert.deepEqual(Buffer.from(request.body, 'base64'), original);
  const wait = await owner.close({signal: AbortSignal.abort(0)});
  assert.equal(wait.physicalDone, false, 'whole response loan remains a real debt'); assert.equal(wait.errorPresent, true);
  assert.ok(Object.is(wait.error, 0) || Object.is(wait.error?.cause, 0));
  const closed = await finish(f, owner, out.response); assert.equal(closed.errorPresent, false);
  assert.equal(h.stats.claims, 1, 'closing does not select another claim');
}, {timeout: 20000});

test('plain input and query coexist while plain execute and an old server cannot supply a continuation', async t => {
  const f = await fixture(t);
  for (const id of ['input', 'query', 'execute']) {
    const opened = await openPhysical(f.profile); assert.equal(opened.errorPresent, false); f.owners.push(opened.owner);
    const out = await opened.owner.exchange(id, original); if (out.response) f.packets.add(out.response);
    assert.ok(out.response); const data = out.response.copyDATA();
    if (id === 'execute') {assert.equal(out.errorPresent, true); assert.notEqual(data.statusCode, 200);}
    else {assert.equal(out.errorPresent, false); assert.deepEqual(data.body, original);}
    await finish(f, opened.owner, out.response);
  }
  const requests = f.events.filter(v => v.event === 'request'); assert.equal(requests.length, 2);
  for (const r of requests) {assert.equal(r.continuationPresent, false); assert.equal(r.getterDenied, true);}
  const old = await fixture(t, 'old-server'), h = publicHeld(), owner = await acquired(old, h);
  const denied = await old.exchange(owner); assert.equal(denied.errorPresent, true); assert.equal(h.stats.claims, 0);
  await finish(old, owner, denied.response); assert.equal(old.events.filter(v => v.event === 'request').length, 0);
}, {timeout: 20000});

test('opening errors keep nonnull partials and one original child cannot rebind to another attempt', async t => {
  const f = await fixture(t);
  for (const value of [0, null]) {
    const h = publicHeld({failCurrentAt: 1, failValue: value}), out = await f.open(h);
    assert.ok(out.owner); assert.equal(out.errorPresent, true); assert.ok(Object.is(out.error, value) || Object.is(out.error?.cause, value));
    const closed = await out.owner.close(); assert.equal(closed.physicalDone, true); assert.equal(closed.errorPresent, true);
  }
  const h = publicHeld(), owner = await acquired(f, h), duplicate = await f.open(h);
  assert.ok(duplicate.owner); assert.equal(duplicate.errorPresent, true); assert.equal((await duplicate.owner.close()).physicalDone, true);
  const out = await f.exchange(owner); assert.equal(out.errorPresent, false); await finish(f, owner, out.response);
  assert.equal(h.stats.claims, 1); assert.equal(f.events.filter(v => v.event === 'request').length, 1);
}, {timeout: 20000});

test('a late original Current failure retains error zero, actual packet and physical cleanup independently', async t => {
  const f = await fixture(t), h = publicHeld({failCurrentAt: 3, failValue: 0}), owner = await acquired(f, h);
  const out = await f.exchange(owner); assert.equal(out.errorPresent, true); assert.ok(Object.is(out.error, 0) || Object.is(out.error?.cause, 0));
  assert.ok(out.response, 'late failure must return the adopted original response loan');
  const data = out.response.copyDATA(); assert.equal(data.dispatchPossible, true); assert.notEqual(data.statusCode, 200);
  const closed = await finish(f, owner, out.response); assert.equal(closed.physicalDone, true); assert.equal(closed.errorPresent, true);
  assert.equal(closed.error, out.error); assert.equal(h.stats.claims, 0);
}, {timeout: 20000});

test('a failed or lost claim acknowledgement never rearms the original held child', async t => {
  const f = await fixture(t), h = publicHeld({claimErrorPresent: true, claimError: 0}), owner = await acquired(f, h);
  const first = await f.exchange(owner); assert.equal(first.errorPresent, true); assert.ok(Object.is(first.error, 0) || Object.is(first.error?.cause, 0));
  assert.equal(h.stats.claims, 1); const second = await f.exchange(owner); assert.equal(second.errorPresent, true);
  assert.equal(h.stats.claims, 1); await finish(f, owner, first.response); if (second.response) await finish(f, owner, second.response);
  const lost = await fixture(t, 'claim-lost-ack'), originalHeld = publicHeld(), originalOwner = await acquired(lost, originalHeld);
  const unknown = await lost.exchange(originalOwner); assert.equal(unknown.errorPresent, true);
  assert.equal(originalHeld.stats.claims, 1, 'the original F was invoked despite lost reply');
  assert.equal((await lost.exchange(originalOwner)).errorPresent, true); assert.equal(originalHeld.stats.claims, 1);
  await finish(lost, originalOwner, unknown.response);
}, {timeout: 20000});

test('retirement cannot claim physical drain while original Source work is still pending', async t => {
  const f = await fixture(t), h = publicHeld({holdCurrentAt: 3}), owner = await acquired(f, h);
  const work = f.exchange(owner); await h.waiting; owner.retire();
  const before = owner.lifetime(), probe = await owner.close({signal: AbortSignal.abort(0)});
  assert.equal(probe.physicalDone, false); assert.equal(probe.errorPresent, true);
  assert.ok(Object.is(probe.error, 0) || Object.is(probe.error?.cause, 0));
  await put('pending-source.json', {PUBLIC: true, before, physicalDone: probe.physicalDone, errorPresent: probe.errorPresent});
  h.release(); const out = await work; assert.equal(out.errorPresent, true); assert.equal(h.stats.claims, 0);
  const closed = await finish(f, owner, out.response); assert.equal(closed.physicalDone, true); assert.equal(closed.errorPresent, true);
}, {timeout: 20000});

test('partial HTTP after the selected claim preserves its actual prefix and uncertain original attempt', async t => {
  const f = await fixture(t, 'partial'), h = publicHeld(), owner = await acquired(f, h);
  const out = await f.exchange(owner); assert.equal(out.errorPresent, true); assert.ok(out.response);
  const data = out.response.copyDATA(); assert.equal(data.statusCode, 200); assert.equal(data.bodyComplete, false);
  assert.ok(data.body.length > 0); assert.equal(data.dispatchPossible, true); assert.equal(h.stats.claims, 1);
  assert.equal((await f.exchange(owner)).errorPresent, true); assert.equal(h.stats.claims, 1);
  const closed = await finish(f, owner, out.response); assert.equal(closed.errorPresent, true);
}, {timeout: 20000});

test('foreign body hashes and sequence numbers cannot invoke Current or Claim on the held child', async t => {
  for (const mode of ['bad-hash', 'bad-seq']) {
    const f = await fixture(t, mode), h = publicHeld(), owner = await acquired(f, h);
    const out = await f.exchange(owner); assert.equal(out.errorPresent, true); assert.equal(h.stats.claims, 0);
    assert.equal(owner.lifetime().calls, 0, 'malformed remote C was rejected before selecting a callback');
    assert.equal(h.stats.current, 3, 'only local open/prewrite/post checks; malformed C adds no Source call');
    await finish(f, owner, out.response);
    const request = f.events.find(v => v.event === 'request'); assert.equal(request.genuineLocalCaller, false, 'raw protocol fault mode is not a genuine Go caller');
  }
}, {timeout: 20000});
