import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeToolsService } from '../src/tools-service.mjs';
import { createChainService } from '../../chain-service/src/service.mjs';
import { prepareCoreProject } from '../src/runtime-files.mjs';
const require = createRequire(import.meta.url), { digest, validateChanges, assertWorkspacePath } = require('../../../native/ynx-tools/src/guards.cjs');
const sessionId = '12345678-1234-1234-1234-123456789012', origin = 'https://developer.ynxweb4.com';
async function harness(t, { realChain = false, generationHook } = {}) {
  let now = 100, generation = 1, revoked = false; const calls = [], admittedOwners = new WeakMap();
  const coreService = { async authorizeConnection(request, id) { if (revoked || request.headers.cookie !== 'wallet=A' || id !== sessionId) throw Object.assign(Error('Identity rejected'), { status: 401 }); return { context: { owner: 'verified-A', sessionId, projectId: 'project-A', runtimeId: 'runtime-A' }, identity: { account: 'account-A', generation }, expiresAt: 100000 }; } };
  const readonly = async (req, res) => { calls.push({ route: req.url, owner: admittedOwners.get(req) }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); };
  const chain = createChainService({ ownerForRequest: req => admittedOwners.get(req), fetcher: async (url, options) => { calls.push({ upstream: String(url), body: options?.body }); return new Response(JSON.stringify({ result: '0x1917' }), { headers: { 'content-type': 'application/json' } }); } });
  const service = createNativeToolsService({ coreService, admittedOwners, now: () => now, chainHandler: realChain ? chain.handler : readonly, walletHandler: readonly, modelRouter: { async generate(value) { calls.push(value); generationHook?.(() => revoked = true); return { model: 'qwen3:4b', text: 'reviewed plan' }; } } });
  const server = createServer((req, res) => service.handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: '/runtime/native-tools/' + path + '?sessionId=' + sessionId, method: body ? 'POST' : 'GET', headers: { host: 'developer.ynxweb4.com', cookie: 'wallet=A', ...(body ? { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : {}), ...headers } }, res => { let data='';res.on('data', chunk => data += chunk);res.on('end', () => resolve({ status:res.statusCode, value:JSON.parse(data), headers:new Headers(res.headers) })); });req.on('error',reject);req.end(body ? JSON.stringify(body) : undefined);
  });
  return { send, calls, setTime: value => now = value, changeAccount: () => generation++, revoke: () => revoked = true };
}
test('actual HTTP requires explicit preview and one-use approval; model uses verified owner, selected text only', async t => {
  const h = await harness(t), identity = await h.send('context');
  assert.equal(identity.status, 200); assert.equal(identity.headers.get('access-control-allow-origin'), null);
  const body = { csrf: identity.value.csrf, prompt: 'Suggest a test plan', context: 'public selected text' };
  const proposal = await h.send('proposals', body); assert.equal(proposal.status, 200); assert.equal(h.calls.length, 0);
  const approval = { csrf: proposal.value.csrf, proposalId: proposal.value.proposalId, approval: 'send-reviewed-context-once' };
  const result = await h.send('approve', approval); assert.equal(result.status, 200); assert.equal(result.value.applied, false);
  assert.equal(h.calls[0].ownerId, 'verified-A'); assert.equal(h.calls[0].provider, 'ynx-hosted'); assert.equal(h.calls[0].apiKey, undefined);
  assert.match(h.calls[0].prompt, /public selected text/); assert.equal((await h.send('approve', approval)).status, 403); assert.equal(h.calls.length, 1);
});
test('hostile extension origins, forged owners, cross-account and stale generations never call the model', async t => {
  const h = await harness(t), identity = await h.send('context');
  const body = { csrf: identity.value.csrf, prompt: 'Suggest a plan', context: '' };
  assert.equal((await h.send('proposals', body, { origin: 'https://kernel.unrelated.example', 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await h.send('proposals', body, { host: 'kernel.unrelated.example' })).status, 403);
  assert.equal((await h.send('proposals', body, { cookie: 'wallet=B' })).status, 401);
  assert.equal((await h.send('proposals', { ...body, ownerId: 'verified-B' })).status, 400);
  const fresh = await h.send('context'), proposal = await h.send('proposals', { ...body, csrf: fresh.value.csrf }); h.changeAccount();
  assert.equal((await h.send('approve', { csrf: proposal.value.csrf, proposalId: proposal.value.proposalId, approval: 'send-reviewed-context-once' })).status, 403);
  assert.equal(h.calls.length, 0);
});
test('expired proposals/revoked sessions preserve context without generation or hidden retry', async t => {
  const h = await harness(t), identity = await h.send('context'), proposal = await h.send('proposals', { csrf: identity.value.csrf, prompt: 'Suggest a plan', context: 'draft retained locally' });
  h.setTime(60101); assert.equal((await h.send('approve', { csrf: proposal.value.csrf, proposalId: proposal.value.proposalId, approval: 'send-reviewed-context-once' })).status, 403);
  h.revoke(); assert.equal((await h.send('context')).status, 401); assert.equal(h.calls.length, 0);
});
test('read-only chain and readiness reuse handlers with verified native owner; no signing route', async t => {
  const h = await harness(t); assert.equal((await h.send('chain/status')).status, 200); assert.equal((await h.send('wallet/readiness')).status, 200);
  assert.deepEqual(h.calls, [{ route: '/runtime/chain/status', owner: 'verified-A' }, { route: '/runtime/wallet/readiness', owner: 'verified-A' }]);
  const c = await h.send('context'); assert.equal((await h.send('wallet/deployments/broadcast', { csrf: c.value.csrf })).status, 405);
});
test('reviewed document changes reject concurrent edits, digest mismatch and duplicate paths', () => {
  let version = 4, text = 'original'; const doc = { get version() { return version; }, getText: () => text }, documents = new Map([['file:///project/a.ts', doc]]);
  const change = { uri: 'file:///project/a.ts', version, fullTextDigest: digest(text), text: 'suggested' }, bundle = { protocol: 'ynx-reviewed-text/v1', sessionId, changes: [change] };
  assert.equal(validateChanges(bundle, documents, sessionId).length, 1); version++; assert.throws(() => validateChanges(bundle, documents)); version--; text = 'concurrent'; assert.throws(() => validateChanges(bundle, documents)); text = 'original'; assert.throws(() => validateChanges({ ...bundle, changes: [change, change] }, documents, sessionId));
});
test('pinned tools install survives reopen and never overwrites tampered extension or symlink', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'ynx-tools-install-')), context = { projectDirectory };
  await prepareCoreProject(context); await prepareCoreProject(context);
  const path = join(projectDirectory, 'extensions', 'ynx.ynx-tools-0.1.0', 'src', 'guards.cjs');
  assert.match(await readFile(path, 'utf8'), /validateChanges/); await writeFile(path, 'changed by project');
  await assert.rejects(prepareCoreProject(context), { code: 'core_tools_review_required' }); assert.equal(await readFile(path, 'utf8'), 'changed by project');
  await import('node:fs/promises').then(fs => fs.unlink(path)); await symlink('/etc/passwd', path); await assert.rejects(prepareCoreProject(context), { code: 'core_tools_review_required' });
});

test('actual read-only Chain handler accepts chain query and rejects transaction/signing before upstream', async t => {
  const h = await harness(t, { realChain: true });
  let c = await h.send('context'); assert.equal((await h.send('chain/rpc', { csrf: c.value.csrf, method: 'eth_chainId', params: [] })).status, 200); assert.equal(h.calls.length, 1);
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign']) { c = await h.send('context'); assert.equal((await h.send('chain/rpc', { csrf: c.value.csrf, method, params: [] })).status, 400); }
  assert.equal(h.calls.length, 1);
});
test('revocation during generation suppresses model result and never reapplies or retries', async t => {
  const h = await harness(t, { generationHook: revoke => revoke() }), c = await h.send('context'), p = await h.send('proposals', { csrf: c.value.csrf, prompt: 'Suggest a plan', context: 'chosen only' });
  const result = await h.send('approve', { csrf: p.value.csrf, proposalId: p.value.proposalId, approval: 'send-reviewed-context-once' }); assert.equal(result.status, 401); assert.equal(result.value.text, undefined); assert.equal(h.calls.length, 1);
});

test('native text apply rejects cross-session bundles and real symlink escape', async () => {
  assert.throws(() => validateChanges({ protocol: 'ynx-reviewed-text/v1', sessionId: 'other', changes: [] }, new Map(), sessionId));
  const root = await mkdtemp(join(tmpdir(), 'ynx-path-')), outside = await mkdtemp(join(tmpdir(), 'ynx-outside-'));
  await writeFile(join(root, 'inside.txt'), 'safe'); await writeFile(join(outside, 'outside.txt'), 'other'); await symlink(outside, join(root, 'escape'));
  await assertWorkspacePath(join(root, 'inside.txt'), root); await assert.rejects(assertWorkspacePath(join(root, 'escape', 'outside.txt'), root), /outside/);
});
