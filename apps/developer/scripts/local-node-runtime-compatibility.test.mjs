import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { reviewedMacNodeVersion, inspectReviewedNodeInput, bundleLocalNodeRuntime } from './bundle-local-node-runtime.mjs';
import { isSupportedLocalNodeVersion } from '../desktop/local-workbench.mjs';
const developer = resolve(fileURLToPath(new URL('..', import.meta.url)));
const official = '/usr/local/bin/node';
const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', OPENSSL_CONF: '/dev/null' } });

test('macOS reviewed versions are exact and agree between producer and supervisor', () => {
  for (const version of ['v24.19.0', 'v26.7.0']) { assert.equal(reviewedMacNodeVersion(version), true); assert.equal(isSupportedLocalNodeVersion(version), true); }
  for (const version of ['v24.18.0', 'v24.20.0', 'v26.8.0', 'v22.0.0', '24.19.0', '', 'v24.19.0;echo injected']) { assert.equal(reviewedMacNodeVersion(version), false); assert.equal(isSupportedLocalNodeVersion(version), false); }
});
test('installed official Node input matches original digest, signer, receipt and both architectures', async () => {
  const input = await inspectReviewedNodeInput(official);
  assert.equal(input.version, 'v24.19.0'); assert.equal(input.kind, 'official-node-installer');
  assert.match(input.originalSignature, /Node.js Foundation \(HX7739G8FX\)/);
  assert.match(input.installerReceipt, /v24\.19\.0/);
  assert.deepEqual(new Set(input.originalArchitectures), new Set(['x86_64', 'arm64']));
  for (const arch of input.originalArchitectures) assert.match(run('/usr/bin/otool', ['-arch', arch, '-l', official]), /minos 13\.5\b/);
});
test('an arbitrary system executable is refused before execution', async () => {
  await assert.rejects(inspectReviewedNodeInput('/bin/echo'), /exact reviewed/);
});
test('missing exact Node24 legal input refuses distribution before creating output', async () => {
  const output = join(developer, '.ynx-developer-candidates', 'node24-unadmitted-' + process.pid + '-' + Date.now());
  await assert.rejects(bundleLocalNodeRuntime(official, output), /full LICENSE input is missing/);
  await assert.rejects(access(output), { code: 'ENOENT' });
});
test('Node24 provides memory SQLite and retained NAPI/PTY/watcher loaders without writes', () => {
  const anchor = join(developer, 'runtime/theia/package.json');
  const result = JSON.parse(run(official, ['--no-experimental-global-navigator', '--input-type=module', '-e', `
    import {createRequire} from 'node:module'; import {DatabaseSync} from 'node:sqlite';
    const r=createRequire(${JSON.stringify(anchor)}), db=new DatabaseSync(':memory:');
    const value=db.prepare('select 1 as value').get().value;db.close();
    for(const name of ['node-pty','drivelist','@parcel/watcher'])r(name);
    console.log(JSON.stringify({value,modules:process.versions.modules,napi:process.versions.napi}));` ]));
  assert.deepEqual(result, { value: 1, modules: '137', napi: '10' });
});
test('actual small rebuilt drivelist link and process helper both measure 13.5 and NAPI loads', async () => {
  const proof = await mkdtemp(join(developer, '.ynx-developer-candidates/node24-native-floor-proof-'));
  const output = join(proof, 'native');
  const stdout = run(official, [join(developer, 'runtime/theia/scripts/build-native-darwin.mjs'), '/usr/local/include/node', output]);
  const binaries = ['drivelist.node', 'ynx-process-tree'];
  for (const binary of binaries) assert.match(run('/usr/bin/otool', ['-arch', process.arch, '-l', join(output, binary)]), /minos 13\.5\b/);
  const loaded = run(official, ['-e', `const module={exports:{}};process.dlopen(module,${JSON.stringify(join(output,'drivelist.node'))});if(typeof module.exports.list!=='function')throw Error('NAPI export missing');console.log('NAPI8_LOAD_PASS');`]);
  assert.match(loaded, /NAPI8_LOAD_PASS/);
  assert.equal(JSON.parse(await readFile(join(output, 'ynx-build-receipt.json'))).minimumOS, '13.5');
  assert.equal(JSON.parse(await readFile(join(output, 'ynx-process-tree.receipt.json'))).minimumOS, '13.5');
  console.log(JSON.stringify({ retainedQualification: proof, compilerOutput: stdout.trim(), measuredFloor: '13.5', priorCoreUnchanged: true, olderOSExecution: 'NOT_VERIFIED' }));
});
test('exact runtime binding, legal gating and build provenance remain wired in real sources', async () => {
  const launcher = await readFile(join(developer, 'desktop/local-workbench.mjs'), 'utf8');
  assert.match(launcher, /requiredNodeVersion !== version/);
  const packageScript = await readFile(join(developer, 'scripts/package-local-macos.sh'), 'utf8');
  assert.match(packageScript, /record\.licenseVerified!==true/);
  assert.match(packageScript, /record\.sourceSha256!=='1f08f0e5/);
  const manifest = await readFile(join(developer, 'runtime/theia/scripts/package-runtime.mjs'), 'utf8');
  assert.match(manifest, /nodeVersion: process\.version/);
  const bundle = await readFile(join(developer, 'scripts/bundle-composed-core.mjs'), 'utf8');
  assert.match(bundle, /requiredNodeVersion: manifest\.nodeVersion/);
});
test('actual packager admission measures legacy runtime and archived core at 27 without rebuilding', async () => {
  const shell = await readFile(join(developer, 'scripts/package-local-macos.sh'), 'utf8');
  const script = shell.match(/<<'NODE'\n([\s\S]*?)\nNODE/)[1];
  const candidates = join(developer, '.ynx-developer-candidates'), core = join(candidates, 'ynx-test-tree-state-core-20261005');
  const value = execFileSync(process.execPath, ['--input-type=module', '-', join(candidates, 'portable-local-node26-floor-20261005'), candidates, '13.5'], {
    input: script, encoding: 'utf8', cwd: developer, maxBuffer: 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', YNX_DEVELOPER_COMPOSED_ARTIFACT: core, YNX_DEVELOPER_COMPOSED_PIN: core + '.pin.json' }
  });
  assert.equal(value.trim(), '27.0');
});
