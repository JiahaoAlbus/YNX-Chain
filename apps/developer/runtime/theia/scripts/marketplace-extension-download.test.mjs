import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, basename } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, rename, symlink, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Duplex } from 'node:stream';
const require = createRequire(new URL('../package.json', import.meta.url));
function load(name) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL(`../../ynx-workbench/lib/${name}.js`, import.meta.url), 'utf8'), {
    module, require, process, Buffer, setTimeout, clearTimeout, AbortController,
  });
  return module.exports;
}
const { connectArtifactResolver, verifyReceipt, artifactResolverClass } = load('marketplace-extension-resolver');
const { serveArtifacts, artifactClient } = load('marketplace-artifact-channel');
const selection = { namespace: 'example', name: 'language', version: '1.2.3', targetPlatform: `${process.platform}-${process.arch}` };
async function fixture(t, manifest = selection) {
  const root = await mkdtemp('/private/tmp/ynx-artifact-resolver-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = `${root}/extension-abcdef`; await mkdir(directory, { mode: 0o700 });
  const source = `${root}/source`; await mkdir(`${source}/extension`, { recursive: true });
  await writeFile(`${source}/extension/package.json`, JSON.stringify({ publisher: manifest.namespace, name: manifest.name, version: manifest.version, engines: { vscode: '^1.80.0' } }));
  execFileSync('/usr/bin/zip', ['-q', '-r', '../fixture.vsix', 'extension'], { cwd: source });
  const path = `${directory}/archive.vsix`, bytes = await readFile(`${root}/fixture.vsix`);
  await writeFile(path, bytes, { mode: 0o600 }); const identity = await lstat(path);
  return { root, source, path, receipt: { selection, path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, dev: identity.dev, ino: identity.ino } };
}
async function restage(f, bytes) {
  await writeFile(f.path, bytes); const identity = await lstat(f.path);
  return { ...f.receipt, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), dev: identity.dev, ino: identity.ino };
}
test('kernel resolver uses exact compatibility selection and hands verified artifact to original deployer context', async t => {
  const fixtureData = await fixture(t), prior = process.env.TMPDIR;
  process.env.TMPDIR = fixtureData.root;
  t.after(() => { if (prior === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prior; });
  const calls = [], deployed = [];
  const base = { vsxApiFilter: async () => ({ async findLatestCompatibleExtension(options) {
    calls.push(options); return { namespace: 'example', name: 'language', version: '1.2.3' };
  } }), hasSameOrNewerVersion: () => false };
  connectArtifactResolver(base, { async request(captured) { assert.deepEqual(JSON.parse(JSON.stringify(captured)), selection); return fixtureData.receipt; } });
  await base.resolve({ getOriginId: () => 'vscode-extension://example.language', addPlugin: (...args) => deployed.push(args) }, { version: '1.2.3' });
  assert.equal(calls[0].extensionVersion, '1.2.3'); assert.equal(calls[0].targetPlatform, selection.targetPlatform);
  assert.equal(deployed.length, 1); assert.equal(deployed[0][1], fixtureData.path);
  await assert.rejects(base.resolve({ getOriginId: () => 'vscode-extension://example.language' }), /explicit extension version/);
});
test('actual kernel dependency injection uses retained base properties without recursive resolution', () => {
  const { Container } = require('@theia/core/shared/inversify');
  const { VSXExtensionResolver } = require('@theia/vsx-registry/lib/node/vsx-extension-resolver');
  const container = new Container();
  for (const token of [require('@theia/vsx-registry/lib/common/ovsx-client-provider').OVSXClientProvider,
    require('@theia/plugin-ext/lib/common/plugin-protocol').PluginDeployerHandler,
    require('@theia/core/shared/@theia/request').RequestService,
    require('@theia/plugin-ext-vscode/lib/common/plugin-vscode-environment').PluginVSCodeEnvironment,
    require('@theia/plugin-ext/lib/main/node/plugin-uninstallation-manager').PluginUninstallationManager,
    require('@theia/ovsx-client').OVSXApiFilterProvider]) container.bind(token).toConstantValue({ fixture: true });
  container.bind(require('@theia/core').ILogger).toConstantValue({ fixture: true }).whenTargetNamed('vsx-registry:VSXExtensionResolver');
  container.bind(VSXExtensionResolver).to(artifactResolverClass(VSXExtensionResolver, { request() {} })).inSingletonScope();
  const resolver = container.get(VSXExtensionResolver);
  assert.ok(resolver instanceof VSXExtensionResolver); assert.ok(resolver.vsxApiFilter.fixture); assert.ok(resolver.environment.fixture);
  assert.equal(container.get(VSXExtensionResolver), resolver);
});
test('valid ZIP with different publisher, name or version never reaches installation', async t => {
  for (const changed of [{ namespace: 'other' }, { name: 'other' }, { version: '9.0.0' }]) {
    const f = await fixture(t, { ...selection, ...changed });
    await assert.rejects(verifyReceipt(f.receipt, selection, f.root), /package identity does not match/);
  }
});
test('validated real VSIX is processed by original kernel unpacker with its manifest intact', async t => {
  const f = await fixture(t); await verifyReceipt(f.receipt, selection, f.root);
  const { unpackToDeploymentDir } = require('@theia/plugin-ext-vscode/lib/node/plugin-vscode-utils');
  const { FileUri } = require('@theia/core/lib/common/file-uri');
  const deployed = await unpackToDeploymentDir({ getDeploymentDirUri: async () => FileUri.create(`${f.root}/deployed`) }, f.path, 'example.language@1.2.3');
  const manifest = JSON.parse(await readFile(`${deployed}/extension/package.json`, 'utf8'));
  assert.equal(manifest.publisher, selection.namespace); assert.equal(manifest.version, selection.version);
});
test('archive symlink and oversized declared expansion are refused before original unpacking', async t => {
  const f = await fixture(t);
  await symlink('/etc/passwd', `${f.source}/extension/link`);
  execFileSync('/usr/bin/zip', ['-q', '-y', '-r', '../link.vsix', 'extension'], { cwd: f.source });
  const receipt = await restage(f, await readFile(`${f.root}/link.vsix`));
  await assert.rejects(verifyReceipt(receipt, selection, f.root), /archive entry.*refused/);
  const oversized = Buffer.from(await readFile(`${f.root}/fixture.vsix`));
  const entry = oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(entry >= 0); oversized.writeUInt32LE(129 * 1024 * 1024, entry + 24);
  await assert.rejects(verifyReceipt(await restage(f, oversized), selection, f.root), /refused|size mismatch/);
});
test('altered digest and replaced inode are rejected before deployment', async t => {
  const { root, path, receipt } = await fixture(t);
  await verifyReceipt(receipt, selection, root);
  await writeFile(path, Buffer.alloc(receipt.bytes, 65));
  await assert.rejects(verifyReceipt(receipt, selection, root), /changed before/);
  await rename(path, `${path}.old`); await writeFile(path, Buffer.alloc(receipt.bytes), { mode: 0o600 });
  await assert.rejects(verifyReceipt(receipt, selection, root), /identity changed/);
  await assert.rejects(verifyReceipt({ ...receipt, path: '/etc/passwd' }, selection, root), /outside/);
});
function pair() {
  let a, b;
  a = new Duplex({ read() {}, write(chunk, encoding, done) { b.push(Buffer.from(chunk)); done(); } });
  b = new Duplex({ read() {}, write(chunk, encoding, done) { a.push(Buffer.from(chunk)); done(); } });
  return [a, b];
}
test('session close aborts its download and waits for partial cleanup without replay', async () => {
  const [server, clientStream] = pair(); let started, cleanup = 0, calls = 0;
  const began = new Promise(resolve => { started = resolve; });
  const host = serveArtifacts(server, { download(value, signal) {
    calls++; started(); return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
  }, async cleanup() { cleanup++; } });
  const client = artifactClient(clientStream);
  const result = assert.rejects(client.request(selection), /ended/);
  await began; client.close(); await host.close(); await result;
  assert.equal(calls, 1); assert.equal(cleanup, 1);
  await assert.rejects(client.request(selection), /unavailable/); assert.equal(calls, 1);
});
test('selected request resolves once over dedicated pipe and closes cleanly', async () => {
  const [server, clientStream] = pair(); let calls = 0;
  const host = serveArtifacts(server, { async download(value) { calls++; return { selection: value, receipt: 'controlled' }; }, async cleanup() {} });
  const client = artifactClient(clientStream);
  assert.equal((await client.request(selection)).receipt, 'controlled'); assert.equal(calls, 1);
  client.close(); await host.close();
});
test('artifact fd6 survives real packaged lock and denied-network sandbox but is absent in ordinary children', { skip: process.platform !== 'darwin', timeout: 15000 }, async t => {
  const profile = await mkdtemp('/private/tmp/ynx-artifact-fd6-');
  t.after(() => rm(profile, { recursive: true, force: true }));
  const node = '/Applications/YNX Developer Testnet Preview.app/Contents/Resources/runtime/node';
  const helper = '/Applications/YNX Developer Testnet Preview.app/Contents/Resources/runtime/ynx-local-workbench-lock';
  const modulePath = fileURLToPath(new URL('../../ynx-workbench/lib/marketplace-artifact-channel.js', import.meta.url));
  const probe = "try { require('node:fs').writeSync(6,'LEAK'); process.exit(2); } catch { process.exit(0); }";
  const script = `const client=require(${JSON.stringify(modulePath)}).inheritedArtifacts();
    (async()=>{const result=await client.request(${JSON.stringify(selection)});if(result.receipt!=='controlled')throw Error('bad receipt');
    if(require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(probe)}]).status!==0)throw Error('fd6 leaked');
    console.log('ARTIFACT_FD6_CHILD_ISOLATED');client.close();})().catch(e=>{console.error(e.message);process.exitCode=1;client.close()});`;
  const child = spawn('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', helper, profile, node, '-e', script], {
    env: { PATH: '/usr/bin:/bin', YNX_EXTENSION_ARTIFACT_PIPE: '6' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '', errors = '', calls = 0;
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  const host = serveArtifacts(child.stdio[6], { async download(value) { calls++; assert.equal(value.version, selection.version); return { receipt: 'controlled' }; }, async cleanup() {} });
  try { const [code] = await once(child, 'close'); assert.equal(code, 0, errors); assert.match(output, /ARTIFACT_FD6_CHILD_ISOLATED/); assert.equal(calls, 1); }
  finally { await host.close(); }
});
test('actual macOS copy recipe ships the new host import graph and packaged Node loads it', { skip: process.platform !== 'darwin' }, async t => {
  const developer = fileURLToPath(new URL('../../../', import.meta.url));
  const recipe = await readFile(resolve(developer, 'scripts/package-local-macos.sh'), 'utf8');
  const launcher = await readFile(resolve(developer, 'desktop/local-workbench.mjs'), 'utf8');
  const stage = await mkdtemp('/private/tmp/ynx-artifact-package-');
  t.after(() => rm(stage, { recursive: true, force: true }));
  const copied = new Set();
  for (const line of recipe.split('\n')) {
    if (!line.startsWith('cp ') || !/marketplace-/.test(line)) continue;
    const parts = /^cp ([^"]+) "\$app\/Contents\/Resources\/([^\"]+)"$/.exec(line);
    assert.ok(parts, 'download copies must use explicit regular sources and a fixed destination');
    const destination = resolve(stage, parts[2]); await mkdir(destination, { recursive: true });
    for (const input of parts[1].trim().split(/\s+/)) {
      assert.match(input, /^(desktop|runtime\/ynx-workbench\/lib)\/marketplace-[a-z-]+\.(mjs|js)$/);
      assert.ok((await lstat(resolve(developer, input))).isFile());
      await copyFile(resolve(developer, input), resolve(destination, basename(input))); copied.add(input);
    }
  }
  const base = resolve(stage, 'code/apps/developer');
  for (const input of ['desktop/marketplace-artifact-policy.mjs', 'desktop/marketplace-artifact-transport.mjs', 'runtime/ynx-workbench/lib/marketplace-artifact-channel.js']) {
    assert.ok(copied.has(input), `actual recipe omits ${input}`);
    assert.ok((await lstat(resolve(base, input))).isFile());
  }
  const references = [...launcher.matchAll(/from ['"]([^'"]*marketplace-artifact[^'"]*)['"]/g)].map(match => match[1]);
  assert.equal(references.length, 2);
  for (const reference of references) assert.ok((await lstat(resolve(base, 'desktop', reference))).isFile());
  const transport = pathToFileURL(resolve(base, 'desktop/marketplace-artifact-transport.mjs')).href;
  const channel = pathToFileURL(resolve(base, 'runtime/ynx-workbench/lib/marketplace-artifact-channel.js')).href;
  const output = execFileSync('/Applications/YNX Developer Testnet Preview.app/Contents/Resources/runtime/node', ['--input-type=module', '-e',
    `const transport=await import(${JSON.stringify(transport)});const channel=await import(${JSON.stringify(channel)});if(typeof transport.createArtifactDownloader!=='function'||typeof channel.default.serveArtifacts!=='function')throw Error('missing exported capability');console.log('PACKAGED_ARTIFACT_MODULES_LOAD');`], { encoding: 'utf8', timeout: 5000 });
  assert.match(output, /PACKAGED_ARTIFACT_MODULES_LOAD/);
});
