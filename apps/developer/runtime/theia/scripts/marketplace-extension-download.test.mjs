import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, basename } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, rename, symlink, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Duplex, Readable } from 'node:stream';
import { selectedArtifactMetadata, createArtifactDownloader, officialArtifactRedirect } from '../../../desktop/marketplace-artifact-transport.mjs';
const require = createRequire(new URL('../package.json', import.meta.url));
function load(name) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL(`../../ynx-workbench/lib/${name}.js`, import.meta.url), 'utf8'), {
    module, require, process, Buffer, setTimeout, clearTimeout, AbortController,
  });
  return module.exports;
}
const { connectArtifactResolver, verifyReceipt, artifactResolverClass } = load('marketplace-extension-resolver');
test('observed official content redirect must retain exact selected archive identity', () => {
  const source = 'https://open-vsx.org/api/MS-CEINTL/vscode-language-pack-zh-hans/1.91.0/file/MS-CEINTL.vscode-language-pack-zh-hans-1.91.0.vsix';
  const target = 'https://openvsx.eclipsecontent.org/MS-CEINTL/vscode-language-pack-zh-hans/1.91.0/MS-CEINTL.vscode-language-pack-zh-hans-1.91.0.vsix';
  assert.equal(officialArtifactRedirect(source, target), target);
  for (const invalid of [target.replace('https:', 'http:'), target.replace('openvsx.eclipsecontent.org', '127.0.0.1'), target.replace('1.91.0/', '1.92.0/'), target + '?token=x', target + '#fragment', target.replace('https://', 'https://user@'), target.replace('.vsix', '-other.vsix')]) {
    assert.throws(() => officialArtifactRedirect(source, invalid), /identity rejected/);
  }
});
test('exact-platform absence resolves the same selected universal version without changing requested identity', async () => {
  const selection = { namespace: 'MS-CEINTL', name: 'vscode-language-pack-zh-hans', version: '1.91.0', targetPlatform: 'darwin-arm64' };
  const calls = [], universal = { extensions: [{ ...selection, targetPlatform: 'universal' }] };
  let assertions = 0;
  const result = await selectedArtifactMetadata(selection, async (operation, options) => {
    calls.push({ operation, ...options });
    return options.targetPlatform === 'universal' ? universal : { extensions: [] };
  }, new AbortController().signal, async () => { assertions++; });
  assert.equal(result, universal); assert.equal(assertions, 1);
  assert.deepEqual(calls.map(row => row.targetPlatform), ['darwin-arm64', 'universal']);
  assert.ok(calls.every(row => row.extensionVersion === '1.91.0' && row.namespaceName === 'MS-CEINTL'));
  assert.equal(selection.targetPlatform, 'darwin-arm64');
});
test('platform-specific metadata wins and transport failure does not invoke fallback', async () => {
  const selection = { namespace: 'example', name: 'language', version: '1.2.3', targetPlatform: 'darwin-arm64' };
  const exact = { extensions: [{ ...selection }] }; let calls = 0;
  assert.equal(await selectedArtifactMetadata(selection, async () => { calls++; return exact; }, undefined, async () => {}), exact);
  assert.equal(calls, 1);
  const failure = Error('TLS refused'); calls = 0;
  await assert.rejects(selectedArtifactMetadata(selection, async () => { calls++; throw failure; }, undefined, async () => {}), e => e === failure);
  assert.equal(calls, 1);
});
test('retired or cancelled selection cannot issue universal lookup', async () => {
  const selection = { namespace: 'example', name: 'language', version: '1.2.3', targetPlatform: 'darwin-arm64' };
  let calls = 0; const controller = new AbortController();
  await assert.rejects(selectedArtifactMetadata(selection, async () => { calls++; controller.abort(); return { extensions: [] }; }, controller.signal, async () => {}), /cancelled/);
  assert.equal(calls, 1); calls = 0;
  await assert.rejects(selectedArtifactMetadata(selection, async () => { calls++; return { extensions: [] }; }, undefined, async () => { throw Error('Session retired'); }), /Session retired/);
  assert.equal(calls, 1);
});
const { serveArtifacts, artifactClient } = load('marketplace-artifact-channel');
const selection = { namespace: 'example', name: 'language', version: '1.2.3', targetPlatform: `${process.platform}-${process.arch}` };
async function fixture(t, manifest = selection) {
  const root = await mkdtemp('/private/tmp/ynx-artifact-resolver-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = `${root}/extension-abcdef`; await mkdir(directory, { mode: 0o700 });
  const source = `${root}/source`; await mkdir(`${source}/extension`, { recursive: true });
  await writeFile(`${source}/extension/package.json`, JSON.stringify({ publisher: manifest.namespace, name: manifest.name, version: manifest.version, engines: { vscode: '^1.80.0' } }));
  await writeFile(`${source}/extension.vsixmanifest`, '<PackageManifest/>');
  execFileSync('/usr/bin/zip', ['-q', '-r', '../fixture.vsix', 'extension', 'extension.vsixmanifest'], { cwd: source });
  const path = `${directory}/archive.vsix`, bytes = await readFile(`${root}/fixture.vsix`);
  await writeFile(path, bytes, { mode: 0o600 }); const identity = await lstat(path);
  return { root, source, path, receipt: { selection, path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, dev: identity.dev, ino: identity.ino } };
}
async function restage(f, bytes) {
  await writeFile(f.path, bytes); const identity = await lstat(f.path);
  return { ...f.receipt, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), dev: identity.dev, ino: identity.ino };
}
test('universal catalog fallback reaches real private staging and retained VSIX verification', async t => {
  const f = await fixture(t), bytes = await readFile(f.path), platforms = [];
  const url = 'https://open-vsx.org/api/example/language/1.2.3/file/example.language-1.2.3.vsix';
  const downloader = createArtifactDownloader({ directory: f.root, assertCurrent: async () => {} }, {
    catalog: async (_, options) => {
      platforms.push(options.targetPlatform);
      return { extensions: options.targetPlatform === 'universal' ? [{ ...selection, targetPlatform: 'universal', files: { download: url } }] : [] };
    },
    request: (requested, options, callback) => {
      assert.equal(requested, url); assert.equal(options.rejectUnauthorized, true);
      const req = new EventEmitter(); req.destroy = () => {};
      req.end = () => {
        const response = Readable.from([bytes]); response.statusCode = 200;
        response.headers = { 'content-type': 'application/octet-stream', 'content-length': bytes.length };
        callback(response);
      };
      return req;
    },
  });
  try {
    const receipt = await downloader.download(selection);
    assert.deepEqual(platforms, ['darwin-arm64', 'universal']);
    assert.deepEqual(receipt.selection, selection);
    assert.equal(await verifyReceipt(receipt, selection, f.root), receipt.path);
  } finally { await downloader.cleanup(); }
});
const admittedSelection = { namespace: 'MS-CEINTL', name: 'vscode-language-pack-zh-hans', version: '1.91.0', targetPlatform: 'darwin-arm64' };
const admittedSource = 'https://open-vsx.org/api/MS-CEINTL/vscode-language-pack-zh-hans/1.91.0/file/MS-CEINTL.vscode-language-pack-zh-hans-1.91.0.vsix';
const admittedTarget = 'https://openvsx.eclipsecontent.org/MS-CEINTL/vscode-language-pack-zh-hans/1.91.0/MS-CEINTL.vscode-language-pack-zh-hans-1.91.0.vsix';
async function guardedHopFixture(t, options = {}) {
  const f = await fixture(t, admittedSelection), bytes = await readFile(f.path);
  const requests = [], hosts = [], controller = new AbortController(); let assertions = 0;
  const downloader = createArtifactDownloader({ directory: f.root, assertCurrent: async () => {
    if (++assertions === 3) {
      if (options.retire) throw Error('Session retired at hop');
      if (options.cancel) controller.abort();
    }
  } }, {
    catalog: async () => ({ extensions: [{ ...admittedSelection, targetPlatform: 'universal', files: { download: admittedSource } }] }),
    dnsLookup: (host, _, callback) => {
      hosts.push(host);
      callback(null, [{ address: options.privateAddress && host === 'openvsx.eclipsecontent.org' ? '127.0.0.1' : '8.8.8.8', family: 4 }]);
    },
    request: (url, requestOptions, callback) => {
      requests.push(url); assert.equal(requestOptions.rejectUnauthorized, true); assert.equal(requestOptions.agent, false);
      assert.deepEqual(requestOptions.headers, { Accept: 'application/octet-stream' });
      const req = new EventEmitter(); req.destroy = error => { if (error) req.emit('error', error); };
      req.end = () => requestOptions.lookup(new URL(url).hostname, {}, error => {
        if (error) return req.emit('error', error);
        const first = url === admittedSource, response = Readable.from(first ? [] : [bytes]);
        response.statusCode = first ? 302 : options.secondRedirect ? 302 : 200;
        response.headers = first ? { location: options.location || admittedTarget } : { 'content-type': 'application/octet-stream', 'content-length': bytes.length, ...(options.secondRedirect ? { location: admittedSource } : {}) };
        callback(response);
      });
      return req;
    },
  });
  return { ...f, downloader, requests, hosts, controller };
}
test('guarded CDN branch follows only admitted official hop and verifies retained selected archive', async t => {
  const f = await guardedHopFixture(t);
  try {
    const receipt = await f.downloader.download(admittedSelection);
    assert.deepEqual(f.requests, [admittedSource, admittedTarget]);
    assert.deepEqual(f.hosts, ['open-vsx.org', 'openvsx.eclipsecontent.org']);
    assert.equal(await verifyReceipt(receipt, admittedSelection, f.root), receipt.path);
    await f.downloader.cleanup();
    assert.equal((await readdir(f.root)).filter(name => name.startsWith('extension-') && name !== 'extension-abcdef').length, 0);
  } finally { await f.downloader.cleanup(); }
});
for (const [name, options, pattern, count] of [
  ['foreign target', { location: admittedTarget.replace('openvsx.eclipsecontent.org', 'foreign.example') }, /identity rejected/, 1],
  ['different version', { location: admittedTarget.replace('/1.91.0/', '/1.92.0/') }, /identity rejected/, 1],
  ['second redirect', { secondRedirect: true }, /redirects are not approved/, 2],
  ['private CDN DNS', { privateAddress: true }, /address rejected/, 2],
  ['retired session', { retire: true }, /Session retired/, 1],
  ['cancelled session', { cancel: true }, /cancelled/, 1],
]) test(`guarded CDN branch refuses ${name} and cleans its owned partial`, async t => {
  const f = await guardedHopFixture(t, options);
  try {
    await assert.rejects(f.downloader.download(admittedSelection, f.controller.signal), pattern);
    assert.equal(f.requests.length, count);
    assert.equal((await readdir(f.root)).filter(name => name.startsWith('extension-') && name !== 'extension-abcdef').length, 0);
  } finally { await f.downloader.cleanup(); }
});
const generalSelections = [
  { namespace: 'ms-python', name: 'python', version: '2026.4.0', targetPlatform: 'darwin-arm64' },
  { namespace: 'llvm-vs-code-extensions', name: 'vscode-clangd', version: '0.6.0', targetPlatform: 'darwin-arm64' },
  { namespace: 'ms-vscode', name: 'js-debug', version: '1.140.0', targetPlatform: 'darwin-arm64' },
];
async function generalHopFixture(t, options = {}) {
  const f = await fixture(t), requests = [], sentinel = `${f.root}/unrelated-project.txt`;
  await writeFile(sentinel, 'keep');
  const urls = selected => {
    const file = `${selected.namespace}.${selected.name}-${selected.version}.vsix`;
    return { source: `https://open-vsx.org/api/${selected.namespace}/${selected.name}/${selected.version}/file/${file}`,
      target: `https://openvsx.eclipsecontent.org/${selected.namespace}/${selected.name}/${selected.version}/${file}` };
  };
  const downloader = createArtifactDownloader({ directory: f.root, assertCurrent: options.assertCurrent || (async () => {}) }, {
    catalog: async (_, query) => {
      const selected = generalSelections.find(row => row.namespace === query.namespaceName && row.name === query.extensionName && row.version === query.extensionVersion);
      assert.ok(selected, 'catalog must use captured identity');
      return { extensions: [{ ...selected, targetPlatform: 'universal', files: { download: urls(selected).source } }] };
    },
    dnsLookup: (host, _, callback) => callback(null, [{ address: options.privateAddress && host === 'openvsx.eclipsecontent.org' ? '127.0.0.1' : '8.8.8.8', family: 4 }]),
    request: (url, requestOptions, callback) => {
      requests.push(url); const selected = generalSelections.find(row => Object.values(urls(row)).includes(url));
      assert.ok(selected); assert.equal(requestOptions.rejectUnauthorized, true); assert.equal(requestOptions.agent, false);
      assert.deepEqual(requestOptions.headers, { Accept: 'application/octet-stream' });
      const req = new EventEmitter(); req.destroy = error => { if (error) req.emit('error', error); };
      req.end = () => requestOptions.lookup(new URL(url).hostname, {}, error => {
        if (error) return req.emit('error', error);
        const first = url === urls(selected).source;
        const bytes = archiveFixture([['extension.vsixmanifest', '<PackageManifest/>'], ['extension/package.json', JSON.stringify({ publisher: selected.namespace, name: selected.name, version: selected.version, engines: { vscode: '^1.80.0' } })]]);
        const response = Readable.from(first ? [] : [bytes]);
        response.statusCode = first ? options.firstStatus || 302 : options.secondStatus || 200;
        response.headers = first ? { location: options.location ? options.location(urls(selected).target) : urls(selected).target } : { 'content-type': 'application/octet-stream', 'content-length': bytes.length, ...(options.secondStatus ? { location: urls(selected).source } : {}) };
        callback(response); options.afterResponse?.(selected, first);
      });
      return req;
    },
  });
  return { ...f, downloader, requests, sentinel, urls };
}
for (const selected of generalSelections) test(`general selected CDN supports ${selected.namespace}.${selected.name} without version or filename substitution`, async t => {
  const f = await generalHopFixture(t);
  try {
    const receipt = await f.downloader.download(selected);
    assert.deepEqual(f.requests, Object.values(f.urls(selected)));
    assert.deepEqual(receipt.selection, selected);
    assert.equal(await verifyReceipt(receipt, selected, f.root), receipt.path);
    await f.downloader.cleanup(); assert.equal(await readFile(f.sentinel, 'utf8'), 'keep');
  } finally { await f.downloader.cleanup(); }
});
for (const [name, options, pattern, count] of [
  ['foreign origin', { location: url => url.replace('openvsx.eclipsecontent.org', 'foreign.example') }, /identity rejected/, 1],
  ['foreign port', { location: url => url.replace('.org/', '.org:444/') }, /identity rejected/, 1],
  ['HTTP downgrade', { location: url => url.replace('https:', 'http:') }, /identity rejected/, 1],
  ['userinfo', { location: url => url.replace('https://', 'https://user@') }, /identity rejected/, 1],
  ['query', { location: url => url + '?token=x' }, /identity rejected/, 1],
  ['fragment', { location: url => url + '#fragment' }, /identity rejected/, 1],
  ['encoded filename drift', { location: url => url.replace('.vsix', '%2Evsix') }, /identity rejected/, 1],
  ['version drift', { location: url => url.replace('/0.6.0/', '/0.7.0/') }, /identity rejected/, 1],
  ['filename drift', { location: url => url.replace('.vsix', '-other.vsix') }, /identity rejected/, 1],
  ['private CDN DNS', { privateAddress: true }, /address rejected/, 2],
  ['second redirect', { secondStatus: 302 }, /redirects are not approved/, 2],
  ...[301, 303, 307, 308].map(status => [`unadmitted ${status}`, { firstStatus: status }, /redirects are not approved/, 1]),
]) test(`general selected CDN refuses ${name} and preserves unrelated files`, async t => {
  const f = await generalHopFixture(t, options);
  try {
    await assert.rejects(f.downloader.download(generalSelections[1]), pattern);
    assert.equal(f.requests.length, count);
    assert.equal((await readdir(f.root)).filter(name => name.startsWith('extension-') && name !== 'extension-abcdef').length, 0);
    assert.equal(await readFile(f.sentinel, 'utf8'), 'keep');
  } finally { await f.downloader.cleanup(); }
});
test('general selected CDN concurrent cancellation does not retire another selected archive', async t => {
  const controller = new AbortController();
  const f = await generalHopFixture(t, { afterResponse: (selected, first) => {
    if (first && selected.name === 'js-debug') controller.abort();
  } });
  try {
    const [cpp, js] = await Promise.allSettled([
      f.downloader.download(generalSelections[1]), f.downloader.download(generalSelections[2], controller.signal),
    ]);
    assert.equal(cpp.status, 'fulfilled'); assert.equal(js.status, 'rejected');
    assert.match(js.reason.message, /cancelled/);
    assert.equal(await verifyReceipt(cpp.value, generalSelections[1], f.root), cpp.value.path);
    assert.ok(!f.requests.includes(f.urls(generalSelections[2]).target));
    assert.equal(await readFile(f.sentinel, 'utf8'), 'keep');
  } finally { await f.downloader.cleanup(); }
});
test('general selected CDN retirement at hop prevents follow and allows owned cleanup', async t => {
  let current = true;
  const f = await generalHopFixture(t, {
    assertCurrent: async () => { if (!current) throw Error('Session retired'); },
    afterResponse: (_, first) => { if (first) current = false; },
  });
  try {
    await assert.rejects(f.downloader.download(generalSelections[1]), /Session retired/);
    assert.equal(f.requests.length, 1);
    assert.equal((await readdir(f.root)).filter(name => name.startsWith('extension-') && name !== 'extension-abcdef').length, 0);
    assert.equal(await readFile(f.sentinel, 'utf8'), 'keep');
  } finally { await f.downloader.cleanup(); }
});
// Stored ZIP fixture preserves noncanonical names that command-line zip cleans.
function archiveFixture(members) {
  let offset = 0; const local = [], central = [];
  for (const [name, content = ''] of members) {
    const filename = Buffer.from(name), data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28); record.writeUInt32LE(offset, 42);
    if (name.endsWith('/')) record.writeUInt32LE(0x10, 38);
    local.push(header, filename, data); central.push(record, filename); offset += header.length + filename.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(members.length, 8); end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
const selectedManifest = JSON.stringify({ publisher: selection.namespace, name: selection.name, version: selection.version, engines: { vscode: '^1.80.0' } });
const competingManifest = JSON.stringify({ publisher: 'other', name: 'other', version: '9.0.0', engines: { vscode: '^1.80.0' } });
function standardMembers() { return [['extension.vsixmanifest', '<PackageManifest/>'], ['extension/', ''], ['extension/package.json', selectedManifest]]; }
async function kernelLoad(f, suffix, requireResolved = true) {
  const { unpackToDeploymentDir } = require('@theia/plugin-ext-vscode/lib/node/plugin-vscode-utils');
  const { PluginVsCodeDirectoryHandler } = require('@theia/plugin-ext-vscode/lib/node/plugin-vscode-directory-handler');
  const { FileUri } = require('@theia/core/lib/common/file-uri');
  const deployed = await unpackToDeploymentDir({ getDeploymentDirUri: async () => FileUri.create(`${f.root}/${suffix}`) }, f.path, 'example.language@1.2.3');
  let currentPath = deployed; const values = new Map();
  const plugin = { path: () => currentPath, id: () => 'example.language@1.2.3', getValue: key => values.get(key), storeValue: (key, value) => values.set(key, value), updatePath: value => { currentPath = value; } };
  const handler = new PluginVsCodeDirectoryHandler(); handler.logger = { debug() {} };
  const resolved = await handler.attemptResolution(plugin);
  if (requireResolved) assert.equal(resolved, true);
  return { manifest: values.get('package.json'), path: currentPath, deployed, resolved };
}
test('parent accepts competing root and path aliases that retained loader can consume', async t => {
  const module = { exports: {} };
  const source = execFileSync('/usr/bin/git', ['show', 'b55d2048a290eb69cfcfeba30b4c0423a0946211:apps/developer/runtime/ynx-workbench/lib/marketplace-extension-resolver.js'], { encoding: 'utf8', cwd: dirname(fileURLToPath(import.meta.url)) });
  vm.runInNewContext(source, { module, require, process, Buffer, setTimeout, clearTimeout });
  const f = await fixture(t);
  // Without the VSIX marker, the actual loader unambiguously selects root.
  const rootReceipt = await restage(f, archiveFixture([['extension/package.json', selectedManifest], ['package.json', competingManifest]]));
  await module.exports.verifyReceipt(rootReceipt, selection, f.root);
  assert.equal((await kernelLoad(f, 'parent-root')).manifest.name, 'other');
  for (const alias of ['extension/./package.json', 'extension//package.json']) {
    await module.exports.verifyReceipt(await restage(f, archiveFixture([...standardMembers(), [alias, competingManifest]])), selection, f.root);
    const loaded = await kernelLoad(f, alias.includes('//') ? 'parent-empty' : 'parent-dot', false);
    const bytes = await readFile(`${loaded.deployed}/extension/package.json`, 'utf8');
    if (loaded.resolved) {
      assert.equal(loaded.path, `${loaded.deployed}/extension`);
      assert.ok(['language', 'other'].includes(loaded.manifest.name));
    } else {
      // The parent's concurrent alias writes can also corrupt the canonical JSON.
      // Require that concrete failure, while current positive loader checks stay strict.
      assert.throws(() => JSON.parse(bytes), SyntaxError);
    }
  }
});
test('standard VSIX keeps one selected manifest through actual directory loader', async t => {
  const f = await fixture(t); await verifyReceipt(await restage(f, archiveFixture(standardMembers())), selection, f.root);
  const loaded = await kernelLoad(f, 'fixed-standard');
  assert.equal(loaded.manifest.publisher, selection.namespace); assert.equal(loaded.manifest.name, selection.name); assert.equal(loaded.manifest.version, selection.version);
});
test('competing roots and noncanonical or equivalent destinations are refused before unpack writes', async t => {
  const f = await fixture(t);
  const cases = [
    [['package.json', competingManifest]], [['package/package.json', competingManifest]], [['Package.json', competingManifest]],
    [['extension/./package.json', competingManifest]], [['extension//package.json', competingManifest]],
    [['extension/PACKAGE.JSON', competingManifest]], [['extension/package.json/', '']],
    [['extension/assets', 'file'], ['extension/assets/icon.svg', 'child']],
    [['extension/Cafe\u0301.txt', 'one'], ['extension/Caf\u00e9.txt', 'two']],
  ];
  for (const extra of cases) {
    const receipt = await restage(f, archiveFixture([...standardMembers(), ...extra])); let unpackStarted = false;
    await assert.rejects((async () => { await verifyReceipt(receipt, selection, f.root); unpackStarted = true; await kernelLoad(f, 'fixed-rejected'); })(), /archive.*refused/);
    assert.equal(unpackStarted, false);
  }
  await assert.rejects(verifyReceipt(await restage(f, archiveFixture([['extension/package.json', selectedManifest]])), selection, f.root), /package identity/);
  await assert.rejects(lstat(`${f.root}/fixed-rejected`), { code: 'ENOENT' });
});
test('canonical path length and depth quotas reject before deployment', async t => {
  const f = await fixture(t);
  for (const name of ['a/'.repeat(30000) + 'x', 'a/'.repeat(128) + 'x', 'extension/' + 'b'.repeat(4090)]) {
    const receipt = await restage(f, archiveFixture([...standardMembers(), [name, '']])); let unpackStarted = false;
    await assert.rejects((async () => { await verifyReceipt(receipt, selection, f.root); unpackStarted = true; await kernelLoad(f, 'quota-refused'); })(), /archive.*budget refused/);
    assert.equal(unpackStarted, false);
  }
  await assert.rejects(lstat(`${f.root}/quota-refused`), { code: 'ENOENT' });
});
test('cumulative path storage is bounded even when all individual members fit', async t => {
  const f = await fixture(t), prefix = 'q'.repeat(2000) + '/' + 'r'.repeat(2000) + '/';
  const members = standardMembers();
  for (let i = 0; i < 4200; i++) members.push([prefix + i, '']);
  assert.ok(members.reduce((sum, [name]) => sum + Buffer.byteLength(name), 0) > 16 * 1024 * 1024);
  await assert.rejects(verifyReceipt(await restage(f, archiveFixture(members)), selection, f.root), /path budget refused/);
});
test('destination node quota bounds many distinct canonical branches', async t => {
  const f = await fixture(t), members = standardMembers();
  for (let i = 0; i < 1600; i++) members.push(['branch' + i + '/' + 'a/'.repeat(126) + 'x', '']);
  assert.ok(members.length < 40000); assert.ok(members.reduce((sum, [name]) => sum + Buffer.byteLength(name), 0) < 16 * 1024 * 1024);
  await assert.rejects(verifyReceipt(await restage(f, archiveFixture(members)), selection, f.root), /node budget refused/);
});
test('ordinary nested paths and late explicit directories load, both file-directory conflict orders refuse', async t => {
  const f = await fixture(t);
  const normal = [...standardMembers(), ['extension/assets/nested/icon.svg', '<svg/>'], ['extension/assets/nested/', ''], ['extension/assets/', '']];
  await verifyReceipt(await restage(f, archiveFixture(normal)), selection, f.root);
  const loaded = await kernelLoad(f, 'nested-standard');
  assert.equal(loaded.manifest.name, selection.name); assert.equal(await readFile(`${loaded.path}/assets/nested/icon.svg`, 'utf8'), '<svg/>');
  for (const extra of [[['extension/dir', 'file'], ['extension/dir/child', '']], [['extension/dir/child', ''], ['extension/dir', 'file']]]) {
    await assert.rejects(verifyReceipt(await restage(f, archiveFixture([...standardMembers(), ...extra])), selection, f.root), /destination collision refused/);
  }
});
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
