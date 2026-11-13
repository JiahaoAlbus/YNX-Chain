import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {parseP04SourceArchive, verifyP04ArchiveMembers, safeP04Relative, p04GoImports, inspectP04TypeGraph,
  qualifyP04ProtectedAncestors, verifyP04ConsumerDependencies, prepareP04ConsumerComposite, qualifyP04ConsumerEvents,
  runP04FiniteGETConsumerCI, verifyP04RequestIdentityDependencies, qualifyP04RequestIdentityEvents,
  P04_REQUIRED_TOPS, P04_REQUIRED_SUBTESTS} from './p04-finite-get-consumer-ci.mjs';
const deps = path.join(path.dirname(fileURLToPath(import.meta.url)), 'p04-consumer-deps');
const packageName = 'github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority';
function scratch(t) {
  const parent = process.env.YNX_LINK_P04_CONSUMER_DRIVER_TEST_ARTIFACTS;
  assert.ok(parent && path.isAbsolute(parent), 'explicit owned external/runner scratch root required');
  fs.mkdirSync(parent, {recursive: true, mode: 0o700}); const root = fs.mkdtempSync(path.join(fs.realpathSync(parent), 'p04-control-'));
  t.after(() => fs.rmSync(root, {recursive: true})); return root;
}
function archive(entries) {
  const chunks = [];
  for (const {name, raw = Buffer.from('PUBLIC'), type = '0', link = '', mode = 0o644} of entries) {
    const h = Buffer.alloc(512); h.write(name); h.write(mode.toString(8).padStart(7, '0') + '\0', 100);
    h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(raw.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136); h.fill(32, 148, 156); h.write(type, 156); h.write(link, 157); h.write('ustar\0', 257); h.write('00', 263);
    h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(h, raw, Buffer.alloc((512 - raw.length % 512) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function pax(key, value) {const rest = ' ' + key + '=' + value + '\n'; let length = rest.length + 1; while ((String(length) + rest).length !== length) length = (String(length) + rest).length; return Buffer.from(String(length) + rest);}
function events() {
  const rows = [];
  for (const Test of P04_REQUIRED_TOPS) {
    rows.push({Action: 'run', Package: packageName, Test});
    for (const sub of P04_REQUIRED_SUBTESTS.filter(n => n.startsWith(Test + '/'))) rows.push({Action: 'run', Package: packageName, Test: sub}, {Action: 'pass', Package: packageName, Test: sub});
    rows.push({Action: 'pass', Package: packageName, Test});
  }
  rows.push({Action: 'pass', Package: packageName}); return rows;
}
const lines = rows => rows.map(r => JSON.stringify(r)).join('\n');

test('P04 single-consume 446-source and original PUBLIC280/vector CAS intake is portable metadata only', () => {
  const v = verifyP04ConsumerDependencies();
  assert.equal(v.sourceManifest.inputs.length, 446); assert.equal(v.candidate.files.size, 455); assert.equal(v.sdk.files.size, 280);
  assert.equal(v.graph.cometGoSourceRequired, false); assert.equal(v.comet.length, 2);
  const principalTest = v.sourceManifest.inputs.find(row => row.relative === 'internal/developerauthority/original_finite_get_principal_test.go');
  assert.equal(principalTest.bytes, 27538);
  assert.equal(principalTest.sha256, 'bf53776fd915800766b6a58626840733e4d1acffb6de06037b71e0422586fd0e');
  for (const name of ['private_client_v1.h', 'private_client_startup_v1.h']) assert.equal(v.candidate.files.has('cmd/ynx-secure-link-caller/' + name), true);
  assert.equal(v.inputs.some(r => r.pin.path.includes('/Users/huangjiahao/PUBLIC-')), false);
});
test('P04 archives accept regular bytes and bounded original per-file PAX without invoking tar extraction', () => {
  const value = parseP04SourceArchive(archive([{name: 'pax', type: 'x', raw: pax('mtime', '1794118266.626442')}, {name: 'source.go'}]));
  assert.equal(value.files.get('source.go').toString(), 'PUBLIC');
  const renamed = parseP04SourceArchive(archive([{name: 'pax', type: 'x', raw: pax('path', 'internal/deep/source.go')}, {name: 'short'}]));
  assert.equal(renamed.files.has('internal/deep/source.go'), true);
});
test('P04 tar traversal symlink hardlink special sparse duplicate orphanPAX malformed and oversized members are rejected', () => {
  for (const name of ['/absolute', '../outside', 'a/../outside', 'a//b', 'a\\b', 'a:b']) assert.throws(() => safeP04Relative(name));
  for (const type of ['1', '2', '3', '4', '6', 'g', 'S', 'L']) assert.throws(() => parseP04SourceArchive(archive([{name: 'bad', type, link: '../outside'}])));
  for (const entries of [[{name: 'same'}, {name: 'same'}], [{name: 'pax', type: 'x', raw: pax('path', '../outside')}, {name: 'safe'}],
    [{name: 'pax', type: 'x', raw: pax('linkpath', 'safe')}, {name: 'safe'}], [{name: 'pax', type: 'x', raw: pax('mtime', '1')}],
    [{name: 'key.key'}], [{name: 'mode', mode: 0o4644}]]) assert.throws(() => parseP04SourceArchive(archive(entries)));
  const broken = zlib.gunzipSync(archive([{name: 'a'}])); broken[0] ^= 1; assert.throws(() => parseP04SourceArchive(zlib.gzipSync(broken)));
  assert.throws(() => parseP04SourceArchive(archive([{name: 'a'}]), 512));
});
test('P04 complete archive closure rejects extras missing files hash mismatch and file-directory conflict', () => {
  const a = parseP04SourceArchive(archive([{name: 'source.go'}]));
  for (const rows of [[], [{relative: 'other', bytes: 6, sha256: '0'.repeat(64)}], [{relative: 'source.go', bytes: 6, sha256: '0'.repeat(64)}]]) assert.throws(() => verifyP04ArchiveMembers(a, rows));
  assert.throws(() => verifyP04ArchiveMembers(parseP04SourceArchive(archive([{name: 'a'}, {name: 'a/b'}])), [{relative: 'a'}, {relative: 'a/b'}]));
});
test('P04 original descriptor-only restore rejects any newly imported Comet source and missing local package closure', () => {
  assert.deepEqual(p04GoImports(Buffer.from('package p\n// import "fake"\nconst s=`import "also-fake"`\nimport (x "context"; "net/http")')), ['context', 'net/http']);
  assert.throws(() => inspectP04TypeGraph(new Map([['internal/developerauthority/x.go', Buffer.from('package p\nimport "github.com/cometbft/cometbft/types"')]])), /Comet import/);
  assert.throws(() => inspectP04TypeGraph(new Map([['internal/developerauthority/x.go', Buffer.from('package p\nimport "github.com/JiahaoAlbus/YNX-Chain/internal/missing"')]])), /complete local package/);
});
test('P04 unchanged full ancestor guard accepts root-owned 0755 and self0700, refuses writable foreign or symlink ancestors', () => {
  const uid = process.getuid(), rows = [{path: '/home/runner/private', directory: true, symlink: false, uid, mode: 0o700}, {path: '/', directory: true, symlink: false, uid: 0, mode: 0o755}];
  assert.equal(qualifyP04ProtectedAncestors(rows), true);
  for (const change of [{mode: 0o777}, {mode: 0o775}, {uid: uid + 1000}, {symlink: true}, {directory: false}]) assert.throws(() => qualifyP04ProtectedAncestors([{...rows[0], ...change}, rows[1]]));
  assert.throws(() => qualifyP04ProtectedAncestors([rows[0]]));
});
test('P04 wrong missing pending or crossed supplier CAS is rejected before any source staging', t => {
  for (const mutate of [m => {m.state = 'NOT_SUPPLIED';}, m => {m.comet.moduleTree = '0'.repeat(40);},
    m => {m.candidate.archive.sha256 = '0'.repeat(64);}, m => {m.sdk.archive.file = '../escape';},
    m => {m.candidate.extraMembers.push({...m.candidate.extraMembers[0]});}, m => {m.sdk.vector.bytes++;}]) {
    const root = scratch(t), copy = path.join(root, 'deps'); fs.cpSync(deps, copy, {recursive: true});
    const f = path.join(copy, 'ORIGINAL.json'), m = JSON.parse(fs.readFileSync(f)); mutate(m); fs.writeFileSync(f, JSON.stringify(m));
    const privateRoot = path.join(root, 'private'); assert.throws(() => prepareP04ConsumerComposite({dependencyRoot: copy, privateRoot, publicRoot: path.join(root, 'public')}));
    assert.equal(fs.existsSync(privateRoot), false);
  }
});
test('P04 actual five tops and seven negative RUN PASS plus package PASS are mandatory without skip or duplicate', () => {
  assert.equal(qualifyP04ConsumerEvents(lines(events()), 0, null, null).negatives, 7);
  const base = events();
  for (const rows of [base.filter(r => r.Test !== P04_REQUIRED_SUBTESTS[0]), base.filter(r => r.Action !== 'run'), base.filter(r => r.Test),
    [...base, base[0]], [...base, base.at(-1)], base.map(r => r.Test === P04_REQUIRED_SUBTESTS[0] && r.Action === 'pass' ? {...r, Action: 'skip'} : r),
    base.map(r => ({...r, Package: 'wrong'})), [base.at(-1), ...base], [...base, {Action: 'fail', Package: packageName}]])
    assert.throws(() => qualifyP04ConsumerEvents(lines(rows), 0, null, null));
  for (const [exit, signal, error] of [[1, null, null], [null, 'SIGTERM', null], [0, null, {code: 'ETIMEDOUT'}]]) assert.throws(() => qualifyP04ConsumerEvents(lines(base), exit, signal, error));
  assert.throws(() => qualifyP04ConsumerEvents('not JSON', 0, null, null));
});
test('P04 consumer driver never executes Go outside original CI or from metadata imports', () => {
  assert.throws(() => runP04FiniteGETConsumerCI({CI: 'false', GITHUB_ACTIONS: 'false'}), /original GitHub/);
});

test('P04 request identity uses the exact supplier composition and separate LINK and Auth pass records', () => {
  const verified = verifyP04RequestIdentityDependencies();
  assert.equal(verified.sourceManifest.inputs.length, 448);
  assert.equal(verified.candidate.files.size, 449);
  assert.equal(verified.graph.cometGoSourceRequired, false);
  for (const [suite, pkg, names] of [
    ['request-identity-link', packageName.replace('developerauthority', 'securelink'), ['TestOriginalServerTLSOriginalRequestIdentity']],
    ['request-identity-auth', packageName, ['TestAuthReceiverUsesLiveLINKRequestIdentity', 'TestAuthReceiverRefusesUnboundLINKRequest']],
  ]) {
    const actual = names.flatMap(Test => [{Package: pkg, Test, Action: 'run'}, {Package: pkg, Test, Action: 'pass'}]);
    const terminal = {Package: pkg, Action: 'pass'};
    const qualify = rows => qualifyP04RequestIdentityEvents(suite, lines(rows), 0, null, null);
    assert.deepEqual(qualify([...actual, terminal]).passed, names);
    assert.throws(() => qualify([...actual.slice(2), terminal]));
    assert.throws(() => qualify([...actual, {...terminal, Package: 'wrong'}]));
    assert.throws(() => qualify([...actual, {...terminal, Action: 'skip'}]));
  }
});
