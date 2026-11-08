// New Auth NAPI/getter + recognized-child + LINK interop only. No old 24/Go7
// rerun, Root issuance, actual ledger authorization, P08 Store or SDK substitute.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test, {before, after} from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = async file => {const b = await fs.readFile(file); return {path: file, bytes: b.length, sha256: sha(b)};};
async function checkedPin(p) {
  assert.ok(p && path.isAbsolute(p.path) && Number.isSafeInteger(p.bytes) && /^[0-9a-f]{64}$/.test(p.sha256), 'explicit exact pin required');
  const bytes = await fs.readFile(p.path); assert.equal(bytes.length, p.bytes, p.path); assert.equal(sha(bytes), p.sha256, p.path); return bytes;
}
const jsonPin = async p => JSON.parse(await checkedPin(p));
function sameContent(supplied, original) {assert.ok(supplied); assert.equal(supplied.bytes, original.bytes); assert.equal(supplied.sha256, original.sha256); return supplied;}
async function ownedDirectory(input) {
  assert.ok(input && path.isAbsolute(input), 'explicit absolute private owned root required');
  const real = await fs.realpath(input), st = await fs.lstat(input);
  assert.equal(real, input, 'owned root must be physical'); assert.ok(st.isDirectory() && !st.isSymbolicLink());
  assert.equal(st.uid, process.geteuid()); assert.equal(st.mode & 0o077, 0, 'private root required'); return real;
}
function deferred() {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};}
async function put(directory, name, value) {await fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});}
let manifest, evidence, generated, inputs, addon;
const manifestPath = process.env.YNX_LINK_TASK_READ_NORMAL_MANIFEST;
const caseName = process.env.YNX_LINK_TASK_READ_NORMAL_CASE;

async function peer(directory, mode) {
  const socketDirectory = await fs.mkdtemp(path.join(await ownedDirectory(manifest.socketRoot), 'nc-'));
  const socket = path.join(socketDirectory, 's'); assert.ok(Buffer.byteLength(socket) < 104);
  const child = spawn(manifest.originalGo.path, [socket, mode, String(process.geteuid()), String(process.pid)], {stdio: ['pipe', 'pipe', 'pipe']});
  const exit = deferred(), events = [], waiters = []; let stdout = '', stderr = '', tail = '';
  const event = match => {const v = events.find(match); if (v) return Promise.resolve(v); return new Promise((resolve, reject) => {
    const w = {match, resolve, reject, timer: setTimeout(() => {waiters.splice(waiters.indexOf(w), 1); reject(Error('original peer event timeout'));}, 5000)}; waiters.push(w);
  });};
  child.stdout.on('data', b => {stdout += b; tail += b; let end; while ((end = tail.indexOf('\n')) >= 0) {
    const v = JSON.parse(tail.slice(0, end)); tail = tail.slice(end + 1); events.push(v);
    for (const w of [...waiters]) if (w.match(v)) {clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(v);}
  }});
  child.stderr.on('data', b => {stderr += b;}); child.stdin.on('error', e => {stderr += e.message;});
  child.on('error', exit.reject); child.on('exit', (code, signal) => {exit.resolve({code, signal}); for (const w of waiters) {clearTimeout(w.timer); w.reject(Error('original peer exited'));} waiters.length = 0;});
  let closeWork;
  const owned = {events, event, child,
    close() {return closeWork ??= (async () => {
      if (!child.stdin.destroyed) child.stdin.write('stop\n'); let killSelected = false; const timer = setTimeout(() => {killSelected = true; child.kill();}, 3500);
      let result; try {result = await exit.promise;} finally {clearTimeout(timer);}
      await fs.writeFile(path.join(directory, 'original-peer.stdout'), stdout, {flag: 'wx', mode: 0o600});
      await fs.writeFile(path.join(directory, 'original-peer.stderr'), stderr, {flag: 'wx', mode: 0o600});
      const drained = events.find(v => v.event === 'drained'); await put(directory, 'original-peer.exit.json', {result, killSelected, drained, PUBLIC: true});
      assert.equal(killSelected, false); assert.deepEqual(result, {code: 0, signal: null}); assert.ok(drained); assert.equal(drained.joinError, '<nil>'); assert.equal(drained.closeError, '<nil>');
      await fs.rm(socketDirectory, {recursive: true});
    })();}};
  try {
    const ready = await event(v => v.event === 'ready'); assert.equal(ready.pid, child.pid); assert.equal(ready.uid, process.geteuid());
    owned.profile = {socketPath: socket, serverUID: ready.uid, serverPID: ready.pid,
      service: 'ynx-ai-original-task-read-v1', connectTimeoutMs: 1000, requestTimeoutMs: 2000,
      routes: ['input', 'execute', 'query'].map(id => ({id, method: 'POST', path: '/internal/ai/original-task-read/' + id, maxRequestBytes: 1048576, maxResponseBytes: 1048576}))};
    return owned;
  } catch (first) {try {await owned.close();} catch {} throw first;}
}

async function childCase() {
  manifest = JSON.parse(await fs.readFile(manifestPath));
  const directory = process.env.YNX_LINK_TASK_READ_NORMAL_CASE_OUTPUT;
  const require = createRequire(import.meta.url), native = require(process.env.YNX_LINK_TASK_READ_NORMAL_ADDON);
  const acquired = native.acquireOriginalTaskGrantAuthorityBackendV1();
  assert.equal(acquired.errorPresent, false); assert.ok(acquired.owner); const root = acquired.owner;
  assert.equal(root.assertNativeCurrent(), undefined);
  let originalChild, transport, originalPeer, inv, caseFailure; const facts = {case: caseName, PUBLIC: true, SourceAdmission: false, RootAdmission: false, actualSDKStrongAdapter: true, actualSDKFullResourceBridge: false, P08StoreExecuted: false};
  try {
    const getter = root.readOriginalTaskReadContinuationModulePath;
    assert.throws(() => getter.call({}), /ORIGINAL_NATIVE_ROOT_REQUIRED/);
    assert.throws(() => getter.call(root, 'caller-path'), /ZERO_INPUT_REQUIRED/);
    if (caseName === 'missing' || caseName === 'tampered') {
      assert.throws(() => getter.call(root), /TASK_READ_CONTINUATION_MODULE_NOT_CURRENT/);
      if (caseName === 'missing') assert.equal(root.assertNativeCurrent(), undefined, 'optional missing capability must preserve original management Source');
      else assert.throws(() => root.assertNativeCurrent(), /NOT_CURRENT/);
      facts.noOriginalGoProcess = true; facts.native = native.PUBLICFixtureStats(); return;
    }
    const selected = getter.call(root); assert.equal(selected, manifest.carrier.path);
    const held = native.PUBLICFixtureStats(); assert.ok(held.holds >= 3); assert.ok(held.openHeldFDs >= 3);
    originalPeer = await peer(directory, caseName === 'partial' ? 'partial' : 'normal');
    const {openOriginalTaskReadStrongTransport} = await import(manifest.sdkStrongAdapter.path);
    const {createOriginalTaskReadContinuationInventory} = await import(manifest.authInventory.path);
    const cap = Object.freeze({PUBLIC: 'ledger capability seam, not authority'}), ctx = Object.freeze({PUBLIC: 'original caller seam'});
    const stats = {current: 0, claim: 0, caller: 0}; let selectedClaim = false;
    const binding = {PUBLIC: 'normal-consumer-mechanism'};
    const request = {grant: {binding, rev: 1}, step: binding, expectedGrantRevision: 1, operationId: 'PUBLIC-normal-consumer-original', rawInput: new Uint8Array([3, 1, 4])};
    const ledger = Object.freeze({
      currentOriginalTaskEffectContinuation(value, expected) {assert.equal(value, cap); assert.equal(expected.operationId, request.operationId); assert.deepEqual(expected.grant, request.grant); stats.current++;},
      claimOriginalTaskEffectContinuation(value, expected) {this.currentOriginalTaskEffectContinuation(value, expected); assert.equal(selectedClaim, false); selectedClaim = true; stats.claim++; if (caseName === 'claim-zero') throw 0;},
    });
    const caller = Object.freeze({assertOriginalTaskCallerAtCommit(value) {assert.equal(value, ctx); stats.caller++;}, async assertTaskCaller(value, expected) {assert.equal(value, ctx); assert.equal(expected.action, 'effect');}});
    inv = createOriginalTaskReadContinuationInventory(root, {taskGrants: ledger}, caller);
    const openedChild = await inv.openOriginal(ctx, request, cap); originalChild = openedChild.owner;
    assert.ok(originalChild); assert.equal(openedChild.errorPresent, false); assert.equal(typeof originalChild.executeOriginalTaskEffect, 'undefined', 'the real SDK adapter must use the carrier, not invent a child execute method');
    await assert.rejects(inv.openOriginal(ctx, request, cap), /ORIGINAL_CAP_SELECTED/);
    const original = Buffer.from('{"PUBLIC":"same-original-entity","operationId":"PUBLIC-normal-consumer-original"}'), body = Buffer.from(original);
    if (caseName === 'source-revoked') native.invalidatePUBLICSource();
    const pendingOpen = openOriginalTaskReadStrongTransport(root, originalPeer.profile, selected, body, originalChild); body.fill(0);
    const exchanged = await pendingOpen; transport = exchanged.owner; assert.ok(transport, 'actual SDK adopts a partial before status');
    if (caseName === 'source-revoked') {assert.equal(exchanged.errorPresent, true); assert.equal(exchanged.data, null); assert.equal(stats.claim, 0); assert.equal(originalPeer.events.some(v => v.event === 'request'), false); facts.prewriteDenied = true; return;}
    const data = exchanged.data; assert.ok(data, 'actual SDK adopts original response DATA before error');
    assert.equal(data.dispatchPossible, true); assert.equal(data.sourceVerified, false); assert.equal(data.operationVerified, false);
    assert.equal(stats.claim, 1); assert.equal(originalChild.isClosed(), false, 'LINK must not close the borrowed Auth child');
    const goRequest = originalPeer.events.find(v => v.event === 'request'); assert.ok(goRequest?.genuineLocalCaller); assert.equal(goRequest.continuationPresent, true); assert.deepEqual(Buffer.from(goRequest.body, 'base64'), original);
    if (caseName === 'normal') {assert.equal(exchanged.errorPresent, false); assert.equal(data.bodyComplete, true); assert.deepEqual(data.body, original); await transport.assertCurrent();}
    else if (caseName === 'claim-zero') {assert.equal(exchanged.errorPresent, true); assert.ok(Object.is(exchanged.error, 0) || Object.is(exchanged.error?.cause, 0)); assert.equal(originalChild.firstCause().errorPresent, true); assert.ok(Object.is(originalChild.firstCause().error, 0));}
    else {assert.equal(caseName, 'partial'); assert.equal(exchanged.errorPresent, true); assert.equal(data.bodyComplete, false); assert.ok(data.body.length > 0); assert.deepEqual(data.body, original.subarray(0, data.body.length));}
    assert.equal(transport.lifetime().responseHeld, true); assert.equal(originalChild.isClosed(), false); assert.equal(inv.lifetime().children, 1);
    const physical = await transport.close(); assert.equal(physical.physicalDone, true); assert.equal(transport.lifetime().responseHeld, false);
    assert.equal(originalChild.isClosed(), false); assert.equal(inv.lifetime().children, 1);
    originalChild.retire(); await originalChild.join(); await originalChild.close(); assert.equal(originalChild.isClosed(), true); assert.equal(inv.lifetime().children, 0);
    facts.transport = transport.lifetime(); facts.stats = stats; facts.statusCode = data.statusCode; facts.bodyComplete = data.bodyComplete; facts.bodyBase64 = data.body.toString('base64'); facts.physical = {physicalDone: physical.physicalDone, errorPresent: physical.errorPresent};
  } catch (error) {caseFailure = {error}; throw error;}
  finally {
    let cleanupFailure, physicalDone = !transport;
    const clean = async (phase, fn) => {try {await fn();} catch (error) {cleanupFailure ??= {error}; (facts.cleanupFailures ??= []).push({phase, errorPresent: true, error: String(error)});}};
    await clean('LINK transport', async () => {if (transport) {transport.retire(); const drained = await transport.close(); physicalDone = drained.physicalDone === true; assert.equal(physicalDone, true);}});
    // A transport UNKNOWN retains the Auth borrow. Do not close parent Source
    // to make a test's fd count look clean; still reap the owned Go peer.
    if (physicalDone) {
      await clean('Auth child', async () => {if (originalChild && !originalChild.isClosed()) {originalChild.retire(); await originalChild.join(); await originalChild.close();}});
      await clean('Auth inventory', async () => {if (inv) {inv.retire(); await inv.join(); await inv.close();}});
    }
    await clean('original Go peer', async () => {if (originalPeer) await originalPeer.close();});
    const childClosed = !originalChild || originalChild.isClosed();
    if (physicalDone && childClosed) await clean('Native Source', async () => {root.retire(); root.join(); root.close(); assert.equal(root.isClosed(), true);});
    facts.nativeAfterClose = native.PUBLICFixtureStats(); facts.transportPhysicalDone = physicalDone; facts.AuthChildClosed = childClosed;
    if (physicalDone && childClosed) await clean('held files', async () => assert.equal(facts.nativeAfterClose.openHeldFDs, 0));
    await put(directory, 'CASE-RESULT.json', facts);
    if (!caseFailure && cleanupFailure) throw cleanupFailure.error;
  }
}

if (caseName) {
  await childCase();
} else {
  before(async () => {
    assert.equal(process.platform, 'darwin', 'this new actual Objective-C/NAPI supplier control requires Darwin');
    assert.match(process.version, /^v24\./, 'actual Node24 required'); assert.ok(manifestPath && path.isAbsolute(manifestPath));
    manifest = JSON.parse(await fs.readFile(manifestPath)); assert.equal(manifest.schema, 'YNX-LINK-TASK-READ-NORMAL-CONSUMER-INPUTS/v1');
    evidence = await fs.mkdtemp(path.join(await ownedDirectory(process.env.YNX_LINK_TASK_READ_NORMAL_EVIDENCE), 'n-')); generated = path.join(evidence, 'private'); await fs.mkdir(generated, {mode: 0o700});
    const nativeH = await jsonPin(manifest.authNativeH); assert.equal(nativeH.schema, 'AUTH_TASK_READ_CONTINUATION_FIXED_NATIVE_ENTRY/v2'); assert.equal(nativeH.LINKCommit, 'eb311202d8d0227a2a968b19d8fd751f58eade25');
    const sdkH = await jsonPin(manifest.sdkH); assert.equal(sdkH.schema, 'SDK-STRONG-CONTINUATION-NORMAL-PUBLISHED-HANDOFF/v1'); assert.equal(sdkH.source.commit, '2ac465fcbc21e04af9794634b318c394a2cc6b3f');
    assert.ok(manifest.sdkSourceRoot && path.isAbsolute(manifest.sdkSourceRoot), 'explicit immutable SDK checkout required');
    const gitHead = spawnSync('git', ['-C', manifest.sdkSourceRoot, 'rev-parse', 'HEAD'], {encoding: 'utf8'}); assert.equal(gitHead.status, 0); assert.equal(gitHead.stdout.trim(), sdkH.source.commit);
    const gitTree = spawnSync('git', ['-C', manifest.sdkSourceRoot, 'rev-parse', 'HEAD^{tree}'], {encoding: 'utf8'}); assert.equal(gitTree.status, 0); assert.equal(gitTree.stdout.trim(), sdkH.source.tree);
    const sdkSourceFilesPin = sameContent(manifest.sdkSourceFiles, sdkH.refs.find(p => path.basename(p.path) === 'SOURCEFILES.json')), sdkFiles = await jsonPin(sdkSourceFilesPin);
    const sdkAdapterRow = sdkFiles.rows.find(p => p.path === 'packages/wallet-auth/src/desktop-grant-strong-continuation-transport-private.mjs'); assert.ok(sdkAdapterRow);
    assert.deepEqual(manifest.sdkStrongAdapter, {path: path.join(manifest.sdkSourceRoot, sdkAdapterRow.path), bytes: sdkAdapterRow.after.bytes, sha256: sdkAdapterRow.after.sha256});
    const recognizedH = await jsonPin(manifest.authRecognizedH), recognizedFilesPin = sameContent(manifest.authRecognizedSourceFiles, recognizedH.sourcefiles), recognizedFiles = await jsonPin(recognizedFilesPin);
    const actualInventory = recognizedFiles.production.find(p => path.basename(p.path) === 'desktop-grant-continuation-owner.mjs'); assert.ok(actualInventory); assert.equal(path.basename(manifest.authInventory.path), path.basename(actualInventory.path)); assert.equal(manifest.authInventory.bytes, actualInventory.bytes); assert.equal(manifest.authInventory.sha256, actualInventory.sha256);
    for (const p of [manifest.authInventory, manifest.canonical, manifest.sdkStrongAdapter]) {const relative = path.relative(manifest.sdkSourceRoot, p.path); assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));const blob = spawnSync('git', ['-C', manifest.sdkSourceRoot, 'show', sdkH.source.commit + ':' + relative], {maxBuffer: 2 << 20}); assert.equal(blob.status, 0); assert.equal(blob.stdout.length, p.bytes); assert.equal(sha(blob.stdout), p.sha256);}
    const supplier = new Map();
    assert.equal(manifest.authNativeSources.length, nativeH.source.length);
    for (const source of nativeH.source) {const name = path.basename(source.after.path), exact = manifest.authNativeSources.find(p => path.basename(p.path) === name); sameContent(exact, source.after); await checkedPin(exact); assert.equal(supplier.has(name), false); supplier.set(name, exact);}
    for (const p of [manifest.authInventory, manifest.sdkStrongAdapter, manifest.canonical, manifest.carrier, manifest.physical, manifest.callerNative, manifest.originalGo, manifest.originalGoSource, manifest.originalGoReceipt]) await checkedPin(p);
    const receipt = await jsonPin(manifest.originalGoReceipt); assert.deepEqual(receipt.binary, {bytes: manifest.originalGo.bytes, sha256: manifest.originalGo.sha256}); assert.equal(receipt.actualGoServer, true);
    const originalSourceRows = await jsonPin(manifest.originalGoSourceReceipt);
    for (const p of [manifest.originalGoSource, manifest.callerNative]) {const row = originalSourceRows.find(r => path.join(repository, r.file) === p.path); assert.ok(row); assert.equal(p.bytes, row.bytes); assert.equal(p.sha256, row.sha256);}
    assert.equal(path.resolve(manifest.carrier.path), path.join(here, 'task-read-resource-continuation.mjs')); assert.equal(path.resolve(manifest.physical.path), path.join(here, 'task-read-resource-caller.mjs')); assert.equal(path.resolve(manifest.callerNative.path), path.join(here, 'build/caller.node'));
    const own = [fileURLToPath(import.meta.url), path.join(here, 'task-read-resource-normal-consumer.fixture.mm')];
    inputs = [...await Promise.all(own.map(pin)), manifest.authNativeH, manifest.authRecognizedH, recognizedFilesPin, manifest.sdkH, sdkSourceFilesPin, ...[...supplier.values()], manifest.authInventory, manifest.sdkStrongAdapter, manifest.canonical, manifest.carrier, manifest.physical, manifest.callerNative, manifest.originalGo, manifest.originalGoSource, manifest.originalGoReceipt, manifest.originalGoSourceReceipt].map(({path, bytes, sha256}) => ({path, bytes, sha256}));
    await put(evidence, 'SOURCE-BEFORE.json', inputs);
    const getterBytes = await checkedPin(supplier.get('desktop-grant-source-methods.inc'));
    const getterSource = getterBytes.toString('utf8'), start = getterSource.indexOf('- (NSString*)copyOriginalDesktopTaskReadContinuationModule:'), end = getterSource.indexOf('\n- (BOOL)holdOriginalDesktopTaskGrantNativeAddress:', start);
    assert.ok(start >= 0 && end > start); const methodBytes = getterSource.slice(start, end).trimEnd() + '\n';
    assert.equal(sha(Buffer.from(methodBytes.trimEnd())), nativeH.fixtures.actualExtractedMethodSHA256, 'exact original getter extraction');
    await fs.writeFile(path.join(generated, 'PUBLIC-exact-source-getter.inc'), methodBytes, {flag: 'wx', mode: 0o600});
    for (const [name, p] of supplier) if (name !== 'desktop-grant-source-methods.inc') await fs.writeFile(path.join(generated, name), await checkedPin(p), {flag: 'wx', mode: 0o600});
    await fs.writeFile(path.join(generated, 'original-auth-identity-native-release.h'), '#pragma once\n#include <string>\n#include <vector>\n#include <cstdint>\nnamespace ynx_auth_private {struct NativeSourceRelease {}; }\n', {flag: 'wx', mode: 0o600});
    await fs.writeFile(path.join(generated, 'original-auth-identity-source-authority.h'), '#pragma once\n#import <Foundation/Foundation.h>\n#include "desktop-grant-release-private.hpp"\nstruct PublicSourceState;\n@interface YNXAuthIdentitySourceAuthority:NSObject { @public PublicSourceState*_publicState; const ynx::auth::desktopgrant::Release*_desktopGrantPolicy; }\n- (void)retire;\n- (BOOL)join:(NSError**)error;\n- (BOOL)fail:(NSString*)message error:(NSError**)error;\n- (BOOL)heldCurrent:(NSError**)error;\n- (NSData*)holdPublic:(NSString*)path maximum:(uint64_t)maximum image:(BOOL)image digest:(const std::string&)digest error:(NSError**)error;\n@end\n', {flag: 'wx', mode: 0o600});
    await fs.writeFile(path.join(generated, 'original-auth-identity-joint-owner.h'), '#pragma once\n#import <Foundation/Foundation.h>\n@interface YNXAuthIdentityCurrentOwner:NSObject\n@end\n', {flag: 'wx', mode: 0o600});
    const bootstrap = path.join(generated, 'PUBLIC-bootstrap.mjs'); await fs.writeFile(bootstrap, 'export function createOriginalTaskGrantNativeBackend(actualNAPIroot){return actualNAPIroot}\n', {flag: 'wx', mode: 0o600});
    addon = path.join(generated, 'PUBLIC-actual-Auth-NAPI.node');
    const include = process.env.NODE_INCLUDE_DIR || path.join(path.dirname(path.dirname(await fs.realpath(process.execPath))), 'include/node');
    await fs.access(path.join(include, 'node_api.h'));
    const args = ['-std=c++17', '-O1', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations', '-fobjc-arc', '-fPIC', '-mmacosx-version-min=13.5', '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=ynx_public_task_read_normal', '-DYNX_LINK_PUBLIC_TASK_READ_NORMAL_CONSUMER', '-I', include, '-iquote', generated, '-bundle', '-undefined', 'dynamic_lookup', '-framework', 'Foundation', path.join(here, 'task-read-resource-normal-consumer.fixture.mm'), '-o', addon];
    const built = spawnSync('/usr/bin/clang++', args, {encoding: 'utf8', timeout: 45000, maxBuffer: 4 << 20});
    await fs.writeFile(path.join(evidence, 'new-napi-fixture.stdout'), built.stdout ?? '', {flag: 'wx', mode: 0o600}); await fs.writeFile(path.join(evidence, 'new-napi-fixture.stderr'), built.stderr ?? '', {flag: 'wx', mode: 0o600});
    await put(evidence, 'new-napi-fixture.json', {command: '/usr/bin/clang++', args, status: built.status, signal: built.signal, error: built.error?.message ?? null});
    assert.equal(built.error, undefined); assert.equal(built.status, 0, built.stderr);
    await put(evidence, 'FIXTURE.json', {actualAuthStageAndQualificationBytes: true, actualClosureGetterSHA256: nativeH.fixtures.actualExtractedMethodSHA256, addon: await pin(addon), originalAuthInventory: manifest.authInventory, actualSDKStrongAdapter: manifest.sdkStrongAdapter, actualKernelOriginalGo: true, PUBLICRootAndLedgerAndCallerSeams: true, actualRootAdmission: false, wholeAuthAddonLinked: false, P08StoreExecuted: false});
    manifest = {...manifest, fixtureBootstrap: bootstrap};
    console.log('# New normal-consumer evidence ' + evidence);
  });
  after(async () => {
    if (!evidence || !inputs) return;
    const afterPins = await Promise.all(inputs.map(p => pin(p.path))); await put(evidence, 'SOURCE-AFTER.json', afterPins); assert.deepEqual(afterPins, inputs);
  });
  for (const scenario of ['normal', 'missing', 'tampered', 'claim-zero', 'partial', 'source-revoked']) test('actual Auth NAPI/SDK strong consumer: ' + scenario, {timeout: 20000}, async () => {
    const directory = path.join(evidence, scenario); await fs.mkdir(directory, {mode: 0o700});
    const config = {bootstrap: manifest.fixtureBootstrap, physical: manifest.physical.path, carrier: scenario === 'missing' ? '' : manifest.carrier.path, closure: [manifest.carrier, manifest.physical, manifest.callerNative]};
    if (scenario === 'tampered') config.closure = config.closure.map((p, i) => i === 0 ? {...p, sha256: '0'.repeat(64)} : p);
    const configPath = path.join(directory, 'PUBLIC-native-config.json'); await put(directory, 'PUBLIC-native-config.json', config);
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {cwd: repository, env: {...process.env, GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB', YNX_LINK_TASK_READ_NORMAL_CASE: scenario, YNX_LINK_TASK_READ_NORMAL_CASE_OUTPUT: directory, YNX_LINK_PUBLIC_NATIVE_CONFIG: configPath, YNX_LINK_TASK_READ_NORMAL_ADDON: addon}, encoding: 'utf8', timeout: 15000, maxBuffer: 4 << 20});
    await fs.writeFile(path.join(directory, 'node.stdout'), child.stdout ?? '', {flag: 'wx', mode: 0o600}); await fs.writeFile(path.join(directory, 'node.stderr'), child.stderr ?? '', {flag: 'wx', mode: 0o600});
    await put(directory, 'node-exit.json', {status: child.status, signal: child.signal, error: child.error?.message ?? null});
    assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
    assert.ok(JSON.parse(await fs.readFile(path.join(directory, 'CASE-RESULT.json'))));
  });
}
