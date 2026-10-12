import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, realpath, writeFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { captureArtifactSelection, resolveSelectedArtifact } from './marketplace-artifact-policy.mjs';
import { createArtifactDownloader } from './marketplace-artifact-transport.mjs';
const selection = { namespace: 'example', name: 'language', version: '1.2.3', targetPlatform: 'darwin-arm64' };
const url = 'https://open-vsx.org/api/example/language/1.2.3/file/example.language-1.2.3.vsix';
const metadata = value => ({ extensions: [{ namespace: 'example', name: 'language', version: '1.2.3', targetPlatform: 'universal', files: { download: value } }] });
test('selected metadata rejects caller capability injection and foreign or mismatched download locations', () => {
  assert.equal(resolveSelectedArtifact(selection, metadata(url)).url, url);
  for (const extra of ['url', 'headers', 'destination', 'cookie']) assert.throws(() => captureArtifactSelection({ ...selection, [extra]: 'private' }));
  for (const invalid of [url.replace('open-vsx.org', '127.0.0.1'), url.replace('example/language', 'other/language'), url + '?token=secret', url.replace('https:', 'http:'), url.replace('file/', 'file/../'), url.replace('.vsix', '%2fescape.vsix')]) {
    assert.throws(() => resolveSelectedArtifact(selection, metadata(invalid)));
  }
  assert.throws(() => resolveSelectedArtifact(selection, { extensions: [...metadata(url).extensions, ...metadata(url).extensions] }), /ambiguous/);
});
async function fixture(t, status = 200) {
  const root = await realpath(await mkdtemp('/private/tmp/ynx-artifact-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'fixture'), { mode: 0o700 }); await mkdir(join(root, 'fixture', 'extension'));
  await writeFile(join(root, 'fixture', 'extension', 'package.json'), JSON.stringify({ name: 'language', publisher: 'example', version: '1.2.3', engines: { vscode: '^1.80.0' } }));
  execFileSync('/usr/bin/zip', ['-q', '-r', '../fixture.vsix', 'extension'], { cwd: join(root, 'fixture') });
  const archive = await readFile(join(root, 'fixture.vsix'));
  const staging = join(root, 'staging'); await mkdir(staging, { mode: 0o700 });
  const calls = []; let live = true;
  const downloader = createArtifactDownloader({ directory: staging, assertCurrent: async () => { if (!live) throw Error('Session retired'); } }, {
    catalog: async (operation, options) => { calls.push({ operation, options }); return metadata(url); },
    request: (requested, options, callback) => {
      assert.equal(requested, url); assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false);
      assert.deepEqual(options.headers, { Accept: 'application/octet-stream' });
      const req = new EventEmitter(); req.destroy = error => { if (error) req.emit('error', error); };
      req.end = () => options.lookup('open-vsx.org', {}, error => {
        if (error) return req.emit('error', error);
        const response = Readable.from([archive]); response.statusCode = status;
        response.headers = { 'content-type': 'application/octet-stream', 'content-length': archive.length, ...(status === 302 ? { location: 'https://unapproved.example/file.vsix' } : {}) };
        callback(response);
      });
      return req;
    },
    dnsLookup: (_host, _options, callback) => callback(null, [{ address: '8.8.8.8', family: 4 }]),
  });
  t.after(() => downloader.cleanup());
  return { downloader, archive, calls, staging, retire() { live = false; } };
}
test('exact selected VSIX is privately staged with digest and file identity, then owned cleanup removes it', async t => {
  const f = await fixture(t); const result = await f.downloader.download(selection);
  assert.equal(result.sha256, createHash('sha256').update(f.archive).digest('hex'));
  assert.equal(result.bytes, f.archive.length); assert.deepEqual(await readFile(result.path), f.archive);
  assert.equal(f.calls[0].operation, 'query'); assert.equal(f.calls[0].options.extensionVersion, '1.2.3');
  assert.ok(result.path.startsWith(f.staging + '/extension-')); assert.ok(result.ino > 0);
  await f.downloader.cleanup(); assert.deepEqual(await readdir(f.staging), []);
});
test('unapproved redirect cleans its partial and retired or cancelled session cannot download', async t => {
  const f = await fixture(t, 302);
  await assert.rejects(f.downloader.download(selection), /redirects are not approved/);
  assert.deepEqual(await readdir(f.staging), []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.downloader.download(selection, controller.signal), /cancelled/);
  f.retire(); await assert.rejects(f.downloader.download(selection), /Session retired/);
  assert.equal(f.calls.length, 1);
});
