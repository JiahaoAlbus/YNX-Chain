import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough, duplexPair } from 'node:stream';
import readme from '../runtime/ynx-workbench/lib/marketplace-readme.js';
import channel from '../runtime/ynx-workbench/lib/marketplace-channel.js';
import { fetchCatalog } from './marketplace-catalog-transport.mjs';
const url = 'https://open-vsx.org/api/openai/chatgpt/darwin-arm64/26.5908.31748/file/readme.md';
const selection = readme.selectionFromReadmeURL(url);
test('readme selection rejects resource/path/credential injection and binds its official hop', () => {
  assert.equal(readme.readmeURL(selection), url);
  const target = url.replace('open-vsx.org/api/', 'openvsx.eclipsecontent.org/').replace('/file/', '/');
  assert.equal(readme.officialReadmeRedirect(url, target), target);
  for (const invalid of [url.replace('https:', 'http:'), url.replace('open-vsx.org', '127.0.0.1'), url + '?token=x', url + '#x', url.replace('readme.md', 'package.json'), url.replace('readme.md', '%2fREADME.md'), url.replace('/chatgpt/', '/chatgpt%2fescape/')]) assert.throws(() => readme.selectionFromReadmeURL(invalid));
  for (const invalid of [target.replace('darwin-arm64', 'linux-x64'), target.replace('chatgpt/', 'other/'), target.replace('readme.md', 'other.md'), target.replace('openvsx.eclipsecontent.org', 'other.example'), target + '?token=x']) assert.throws(() => readme.officialReadmeRedirect(url, invalid));
  assert.throws(() => readme.decodeReadme(Buffer.from('<script>x</script>'), 'text/html'));
  assert.throws(() => readme.decodeReadme(Buffer.from([255]), 'text/plain'));
  assert.throws(() => readme.decodeReadme(Buffer.alloc(readme.MAX_README_BYTES + 1), 'text/plain'));
});
test('normal registry readme override uses only inherited catalog; failures render an explicit safe status', async () => {
  const calls = [], prototype = { fetchReadme() { throw Error('direct network must not be used'); } };
  let failure;
  readme.installReadmeTransport(prototype, { async request(op, selected) { calls.push({ op, selected }); if (failure) throw failure; return '# Publisher description'; } });
  const registry = Object.create(prototype);
  assert.equal(await registry.fetchReadme(url), '# Publisher description');
  assert.deepEqual(calls, [{ op: 'readme', selected: selection }]);
  failure = Object.assign(Error('https://secret.example/?token=secret'), { code: 'EPERM' });
  const status = await registry.fetchReadme(url);
  assert.match(status, /Extension description unavailable/); assert.match(status, /EPERM/); assert.doesNotMatch(status, /secret|token/);
  await registry.fetchReadme('file:///private/readme.md'); assert.equal(calls.length, 2);
});
test('readme request crosses original pipe and closed clients cannot issue more description work', async () => {
  const [parent, child] = duplexPair(); let signal;
  const server = channel.serveCatalog(parent, async (op, selected, current) => { assert.equal(op, 'readme'); assert.deepEqual(selected, selection); signal = current; return '# Description'; });
  const client = channel.catalogClient(child);
  try { assert.equal(await client.request('readme', selection), '# Description'); }
  finally { client.close(); server.close(); }
  assert.equal(parent.destroyed, true); assert.ok(signal);
  await assert.rejects(client.request('readme', selection));
});
test('retiring a readme pipe aborts its actual in-flight request and rejects late completion', async () => {
  const [parent, child] = duplexPair(); let complete, signal, started;
  const begun = new Promise(resolve => { started = resolve; });
  const server = channel.serveCatalog(parent, (_op, _selection, current) => { signal = current; started(); return new Promise(resolve => { complete = resolve; }); });
  const client = channel.catalogClient(child), pending = assert.rejects(client.request('readme', selection));
  await begun; server.close(); client.close(); await pending;
  assert.equal(signal.aborted, true); complete('# Late description');
  await assert.rejects(client.request('readme', selection));
});
test('managed readme transport bounds decoded bytes and allows only one exact official redirect', async t => {
  const original = https.request; let fixture = {}, calls;
  https.request = (requested, options, receive) => {
    calls.push(requested); assert.equal(options.agent, false); assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.headers.Accept, 'text/markdown, text/plain;q=0.9');
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = () => queueMicrotask(() => {
      const response = new PassThrough();
      response.statusCode = calls.length === 1 && fixture.redirect ? 302 : fixture.secondRedirect ? 302 : 200;
      response.headers = { 'content-type': fixture.type || 'text/plain; charset=utf-8', location: fixture.redirect };
      receive(response); if (!response.destroyed) response.end(fixture.bytes || '# Actual publisher README');
    }); return req;
  };
  t.after(() => { https.request = original; });
  calls = []; assert.equal(await fetchCatalog('readme', selection), '# Actual publisher README'); assert.equal(calls.length, 1);
  fixture = { redirect: url.replace('open-vsx.org/api/', 'openvsx.eclipsecontent.org/').replace('/file/', '/') }; calls = [];
  assert.equal(await fetchCatalog('readme', selection), '# Actual publisher README'); assert.equal(calls.length, 2);
  for (const bad of [{ redirect: 'https://other.example/readme.md' }, { ...fixture, secondRedirect: true }, { bytes: Buffer.alloc(readme.MAX_README_BYTES + 1) }, { type: 'text/html' }]) {
    fixture = bad; calls = []; await assert.rejects(fetchCatalog('readme', selection)); assert.ok(calls.length <= 2);
  }
});
