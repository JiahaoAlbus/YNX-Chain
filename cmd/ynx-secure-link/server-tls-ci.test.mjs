import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyAuthSnapshot, prepareServerTLSComposite, verifyCompositeUnchanged, ownedEmptyRoot,
  qualifyServerTLSTestEvents, SERVER_TLS_REQUIRED_TESTS, runServerTLSCI} from './server-tls-ci.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const dependencies = path.join(directory, 'server-tls-auth-deps');
function scratch(t) {
  const root = process.env.YNX_LINK_SERVER_TLS_DRIVER_TEST_ARTIFACTS ?? os.tmpdir(); fs.mkdirSync(root, {recursive: true});
  const output = fs.realpathSync(fs.mkdtempSync(path.join(root, 'server-ci-control-')));
  t.after(() => fs.rmSync(output, {recursive: true})); return output;
}
function fixture(t) {
  const root = scratch(t), repo = path.join(root, 'PUBLIC-repo'); fs.mkdirSync(repo);
  const files = {'go.mod': 'module github.com/JiahaoAlbus/YNX-Chain\n\ngo 1.26.10\n\nreplace github.com/cometbft/cometbft => ./third_party/cometbft\n',
    'go.sum': 'PUBLIC sum fixture\n', 'cmd/ynx-secure-link-caller/private_client_v1.h': '/* PUBLIC original CGO header metadata */\n', 'third_party/cometbft/go.mod': 'module github.com/cometbft/cometbft\ngo 1.26.10\n',
    'third_party/cometbft/go.sum': 'PUBLIC original replacement descriptors\n',
    'internal/securelink/PUBLIC.go': 'package securelink\n// PUBLIC metadata only; no business authority or real Go execution.\n',
    'internal/securelink/native/PUBLIC.c': '/* PUBLIC source graph metadata, no compilation */\n'};
  for (const [name, data] of Object.entries(files)) {const file = path.join(repo, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data);}
  return {root, repo, privateRoot: path.join(root, 'private-composite'), publicRoot: path.join(root, 'public-sources')};
}
const prepare = f => prepareServerTLSComposite({repositoryRoot: f.repo, privateRoot: f.privateRoot, publicRoot: f.publicRoot});
function copyDependencies(root) {
  const dest = path.join(root, 'deps'); fs.cpSync(dependencies, dest, {recursive: true}); return dest;
}
function goEvents(names = SERVER_TLS_REQUIRED_TESTS) {
  return [...names.map(Test => JSON.stringify({Action: 'pass', Test})), JSON.stringify({Action: 'pass', Package: 'PUBLIC'})].join('\n');
}

test('server TLS driver snapshots exact actual3 Auth public source without owner release or Root', () => {
  const verified = verifyAuthSnapshot(); assert.equal(verified.sources.length, 3);
  assert.equal(verified.sources.find(row => row.repositoryPath.endsWith('/lease.go')).descriptor.bytes, 16311);
  assert.ok(verified.sources.every(row => row.originalSupplierPath.includes('/listener-identity-successor/source/internal/authservertls/')));
  // Importing this driver and verifying public bytes executes no Go/native work.
});

test('server TLS driver rejects changed missing duplicate or extra Auth snapshot metadata/source', t => {
  for (const change of [
    j => {j.sources.pop();}, j => {j.sources.push({...j.sources[0], path: 'internal/authservertls/extra.go'});},
    j => {j.sources[1] = {...j.sources[0]};}, j => {j.sources[0].sha256 = 'f'.repeat(64);},
    j => {j.RootAdmission = true;}, j => {j.SourceAdmission = true;}, j => {j.copiedSourceOnly = false;},
  ]) {
    const root = scratch(t), deps = copyDependencies(root), file = path.join(deps, 'ORIGINALS.json'), manifest = JSON.parse(fs.readFileSync(file));
    change(manifest); fs.writeFileSync(file, JSON.stringify(manifest)); assert.throws(() => verifyAuthSnapshot(deps));
  }
  const deps = copyDependencies(scratch(t)); fs.appendFileSync(path.join(deps, 'internal/authservertls/lease.go'), '\n// changed\n');
  assert.throws(() => verifyAuthSnapshot(deps));
});

test('server TLS driver creates byte-preserving private graph plus public-only source evidence without editing repo', t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.repo, 'go.mod')), composite = prepare(f);
  assert.equal(composite.sources.length, 10); assert.equal(composite.completeSourceGraphNotJustGitHead, true);
  assert.equal(composite.RootAdmission, false); assert.equal(composite.SourceAdmission, false);
  assert.equal(fs.readFileSync(path.join(f.privateRoot, 'go.mod')).equals(before), true);
  assert.equal(fs.readFileSync(path.join(f.repo, 'go.mod')).equals(before), true);
  assert.equal(fs.existsSync(path.join(f.repo, 'internal/authservertls')), false);
  assert.equal(fs.readFileSync(path.join(f.publicRoot, 'internal/authservertls/lease.go')).equals(fs.readFileSync(path.join(dependencies, 'internal/authservertls/lease.go'))), true);
  assert.equal(verifyCompositeUnchanged(composite), true);
});

test('server TLS driver refuses copied input or evidence drift, source symlink, or preexisting real Auth package', t => {
  const missing = fixture(t); fs.unlinkSync(path.join(missing.repo, 'cmd/ynx-secure-link-caller/private_client_v1.h')); assert.throws(() => prepare(missing));
  const f = fixture(t), composite = prepare(f); fs.appendFileSync(composite.sources[0].virtualPath, 'PUBLIC drift');
  assert.throws(() => verifyCompositeUnchanged(composite));
  const other = fixture(t); fs.mkdirSync(path.join(other.repo, 'internal/authservertls'));
  assert.throws(() => prepare(other), /explicit owner rebind/);
  const linked = fixture(t); fs.symlinkSync('PUBLIC.go', path.join(linked.repo, 'internal/securelink/fake.go'));
  assert.throws(() => prepare(linked), /symlink/);
});

test('server TLS driver requires fresh owned disjoint evidence/private roots and preserves first outputs', t => {
  const root = scratch(t), evidence = path.join(root, 'evidence'), privateRoot = path.join(root, 'private');
  ownedEmptyRoot(evidence); ownedEmptyRoot(privateRoot, [evidence]);
  fs.writeFileSync(path.join(evidence, 'KEEP'), 'PUBLIC first-cause');
  assert.throws(() => ownedEmptyRoot(evidence)); assert.equal(fs.readFileSync(path.join(evidence, 'KEEP'), 'utf8'), 'PUBLIC first-cause');
  assert.throws(() => ownedEmptyRoot(path.join(evidence, 'private'), [evidence]));
  const alias = path.join(root, 'alias'); fs.symlinkSync(evidence, alias);
  assert.throws(() => ownedEmptyRoot(path.join(alias, 'new'))); assert.equal(fs.existsSync(path.join(evidence, 'new')), false);
});

test('server TLS driver requires the one actual normal factory top-level test pass without skip zero-hit or opaque false green', () => {
  const qualified = qualifyServerTLSTestEvents(goEvents(), 0, null, null);
  assert.equal(qualified.pass, 1); assert.equal(qualified.actualAuthEmptyRootRefused, true); assert.equal(qualified.RootAdmission, false);
  for (const [text, exit, signal, error] of [
    [goEvents().replace('"pass"', '"skip"'), 0, null, null], [goEvents(SERVER_TLS_REQUIRED_TESTS.slice(1)), 0, null, null],
    [goEvents([...SERVER_TLS_REQUIRED_TESTS, SERVER_TLS_REQUIRED_TESTS[0]]), 0, null, null], ['', 0, null, null],
    [goEvents() + '\n' + JSON.stringify({Action: 'fail', Package: 'PUBLIC'}), 0, null, null],
    [goEvents(), 1, null, null], [goEvents(), null, 'SIGTERM', null], [goEvents(), 0, null, {code: 'ETIMEDOUT'}], ['not-json', 0, null, null],
  ]) assert.throws(() => qualifyServerTLSTestEvents(text, exit, signal, error));
});

test('server TLS driver fails before any child process outside original CI context', () => {
  assert.throws(() => runServerTLSCI({CI: 'false', GITHUB_ACTIONS: 'false'}), /original GitHub Actions source CI/);
});
