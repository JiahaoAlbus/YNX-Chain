import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeToolsService } from '../src/tools-service.mjs';
import { createChainService } from '../../chain-service/src/service.mjs';
import { createNativeAIStore } from '../src/native-ai-store.mjs';
import { createModelRouter } from '../../model-router/src/router.mjs';
import { prepareCoreProject } from '../src/runtime-files.mjs';
const require = createRequire(import.meta.url), { digest, validateChanges, assertWorkspacePath } = require('../../../native/ynx-tools/src/guards.cjs');
const sessionId = '12345678-1234-1234-1234-123456789012', origin = 'https://developer.ynxweb4.com';
async function harness(t, { realChain = false, generationHook, modelWork } = {}) {
  let now = 100, generation = 1, revoked = false, admissions = 0, projectId = 'project-A'; const calls = [], admittedOwners = new WeakMap();
  const coreService = { async authorizeConnection(request, id) { admissions++; if (revoked || request.headers.cookie !== 'wallet=A' || id !== sessionId) throw Object.assign(Error('Identity rejected'), { status: 401 }); return { context: { owner: 'verified-A', sessionId, projectId, runtimeId: 'runtime-A' }, identity: { account: 'account-A', generation }, expiresAt: 100000 }; } };
  const readonly = async (req, res) => { calls.push({ route: req.url, owner: admittedOwners.get(req) }); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); };
  const chain = createChainService({ ownerForRequest: req => admittedOwners.get(req), fetcher: async (url, options) => {
    calls.push({ upstream: String(url), body: options?.body });
    const address = '0x' + 'a'.repeat(40);
    const value = String(url).includes('/contracts/') ? { address, functions: [] } : String(url).endsWith('/ide/call') ? { address, function: 'count', selector: '0x06661abd', returnValue: '7', executionStatus: 'source_analyzer_literal_return', artifactKind: 'source-analyzer-artifact', runtimeMode: 'local-devnet', limitations: ['not full EVM'] } : { result: '0x1917' };
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  } });
  const directory = await mkdtemp(join(tmpdir(), 'ynx-tools-ai-'));
  const aiStore = createNativeAIStore({ filename: join(directory, 'requests.sqlite'), keyPath: join(directory, 'requests.key') });
  t.after(() => aiStore.close());
  const service = createNativeToolsService({ coreService, aiStore, admittedOwners, now: () => now, chainHandler: realChain ? chain.handler : readonly, walletHandler: readonly, modelRouter: { async generate(value) { calls.push(value); generationHook?.(() => revoked = true); return modelWork ? modelWork(value) : { model: 'qwen3:4b', text: 'reviewed plan' }; } } });
  const server = createServer((req, res) => service.handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: '/runtime/native-tools/' + path + '?sessionId=' + sessionId, method: body ? 'POST' : 'GET', headers: { host: 'developer.ynxweb4.com', cookie: 'wallet=A', ...(body ? { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : {}), ...headers } }, res => { let data='';res.on('data', chunk => data += chunk);res.on('end', () => resolve({ status:res.statusCode, value:JSON.parse(data), headers:new Headers(res.headers) })); });req.on('error',reject);req.end(body ? JSON.stringify(body) : undefined);
  });
  return { send, calls, server, admissions: () => admissions, setTime: value => now = value, changeAccount: () => generation++, changeProject: value => projectId = value, revoke: () => revoked = true };
}

test('approved AI request is saved under the actual owner/project; reopening sends no model request', async t => {
  const h = await harness(t), c = await h.send('context');
  const p = await h.send('proposals', { csrf: c.value.csrf, prompt: 'Review the function', context: 'chosen text  \n' });
  assert.ok(p.value.requestBytes <= 8000); assert.match(p.value.wirePrompt, /chosen text  \n$/);
  const result = await h.send('approve', { csrf: p.value.csrf, proposalId: p.value.proposalId, approval: 'send-reviewed-context-once' });
  assert.equal(result.status, 200); assert.equal(result.value.saved, true);
  const id = result.value.conversationId;
  assert.equal(h.calls[0].hostedSession, id);
  assert.notEqual(id, sessionId); assert.notEqual(id, p.value.proposalId);
  const listed = await h.send('ai/conversations'); assert.equal(listed.value.conversations.length, 1);
  assert.equal(listed.value.conversations[0].prompt, undefined);
  const read = await h.send('ai/conversations/' + id);
  assert.equal(read.value.conversation.status, 'completed'); assert.equal(read.value.conversation.text, 'reviewed plan');
  assert.equal(read.value.conversation.context, 'chosen text  \n'); assert.equal(h.calls.length, 1);
  h.changeProject('project-B');
  assert.deepEqual((await h.send('ai/conversations')).value.conversations, []);
  assert.equal((await h.send('ai/conversations/' + id)).status, 404);
  const wrong = await h.send('context');
  assert.equal((await h.send('ai/conversations/' + id + '/delete', { csrf: wrong.value.csrf })).status, 404);
  h.changeProject('project-A');
  const authorized = await h.send('context');
  assert.equal((await h.send('ai/conversations/' + id + '/delete', { csrf: authorized.value.csrf }, { origin: 'https://kernel.example' })).status, 403);
  assert.equal((await h.send('ai/conversations/' + id + '/delete', { csrf: authorized.value.csrf })).status, 200);
  assert.equal((await h.send('ai/conversations/' + id)).status, 404);
  assert.equal((await h.send('ai/conversations/' + id + '/delete', { csrf: authorized.value.csrf })).status, 403);
});

test('actual UTF-8 Gateway prompt limit rejects preview without truncation or model dispatch', async t => {
  const h = await harness(t), c = await h.send('context');
  const p = await h.send('proposals', { csrf: c.value.csrf, prompt: 'Review these characters', context: '界'.repeat(2700) });
  assert.equal(p.status, 413); assert.equal(p.value.code, 'model_prompt_limit');
  assert.equal(h.calls.length, 0); assert.deepEqual((await h.send('ai/conversations')).value.conversations, []);
});

test('actual Tools HTTP reaches the existing Gateway wire contract and saves only its completed response', async t => {
  const seen = [];
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); seen.push(body);
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/ai/stream');
    assert.deepEqual(Object.keys(body).sort(), ['session','prompt','outputLanguage','includedContext','excludedContext','attachments','productContexts','continueFrom'].sort());
    assert.equal(Buffer.byteLength(body.prompt) <= 8000, true);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: metadata\ndata: ${JSON.stringify({ requestId: 'controlled-gateway', sessionId: body.session })}\n\nevent: token\ndata: {"text":"Completed controlled Gateway answer"}\n\nevent: done\ndata: {"requestId":"controlled-gateway"}\n\n`);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const router = createModelRouter({ hostedBaseURL: `http://127.0.0.1:${upstream.address().port}` });
  const h = await harness(t, { modelWork: input => router.generate(input) });
  const c = await h.send('context'), p = await h.send('proposals', { csrf: c.value.csrf, prompt: 'Suggest a plan', context: 'selected only  \n' });
  const result = await h.send('approve', { csrf: p.value.csrf, proposalId: p.value.proposalId, approval: 'send-reviewed-context-once' });
  assert.equal(result.status, 200); assert.equal(result.value.saved, true);
  assert.equal(seen[0].prompt, p.value.wirePrompt);
  assert.equal(seen[0].session, result.value.conversationId);
  const restored = await h.send('ai/conversations/' + result.value.conversationId);
  assert.equal(restored.value.conversation.text, 'Completed controlled Gateway answer');
  assert.equal(seen.length, 1);
});

for (const transition of ['changeAccount', 'revoke', 'expire']) {
  test(`AI approval rechecks ${transition} after a delayed HTTP body before model dispatch`, async t => {
    const h = await harness(t), c = await h.send('context');
    const p = await h.send('proposals', { csrf: c.value.csrf, prompt: 'Suggest a plan', context: 'private selected text' });
    const body = JSON.stringify({ csrf: p.value.csrf, proposalId: p.value.proposalId, approval: 'send-reviewed-context-once' });
    const before = h.admissions();
    let req;
    const pending = new Promise((resolve, reject) => {
      req = httpRequest({ hostname: '127.0.0.1', port: h.server.address().port,
        path: '/runtime/native-tools/approve?sessionId=' + sessionId, method: 'POST',
        headers: { host: 'developer.ynxweb4.com', cookie: 'wallet=A', origin,
          'content-type': 'application/json', 'sec-fetch-site': 'same-origin', 'content-length': Buffer.byteLength(body) } }, res => {
        let data = ''; res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(data) }));
      }); req.on('error', reject); req.write(body.slice(0, 1));
    });
    const deadline = Date.now() + 2000;
    while (h.admissions() === before && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(h.admissions(), before + 1, 'server admitted headers and is awaiting the body');
    if (transition === 'expire') h.setTime(100001); else h[transition]();
    req.end(body.slice(1));
    const result = await pending;
    assert.ok(result.status >= 400, JSON.stringify(result));
    assert.equal(h.calls.length, 0, 'private context must not reach the model under a retired admission');
    assert.equal(result.value.text, undefined);
  });
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
test('normal Tools HTTP consumes exact contract inspector/call under current native owner with one-use review', async t => {
  const h = await harness(t, { realChain: true }), address = '0x' + 'a'.repeat(40);
  assert.equal((await h.send(`chain/contracts/${address}`)).status, 200);
  const c = await h.send('context'), body = { csrf: c.value.csrf, address, function: 'count' };
  const called = await h.send('chain/contracts/call', body);
  assert.equal(called.status, 200); assert.equal(called.value.result.returnValue, '7'); assert.equal(called.value.submitted, false);
  assert.deepEqual(JSON.parse(h.calls.at(-1).body), { address, function: 'count' });
  assert.equal((await h.send('chain/contracts/call', body)).status, 403);
  const fresh = await h.send('context'); h.changeAccount();
  assert.equal((await h.send('chain/contracts/call', { ...body, csrf: fresh.value.csrf })).status, 403);
  assert.equal(h.calls.length, 2);
});
test('revocation during generation suppresses model result and never reapplies or retries', async t => {
  const h = await harness(t, { generationHook: revoke => revoke() }), c = await h.send('context'), p = await h.send('proposals', { csrf: c.value.csrf, prompt: 'Suggest a plan', context: 'chosen only' });
  const result = await h.send('approve', { csrf: p.value.csrf, proposalId: p.value.proposalId, approval: 'send-reviewed-context-once' }); assert.equal(result.status, 401); assert.equal(result.value.text, undefined); assert.equal(h.calls.length, 1);
});
test('closing the actual HTTP approval aborts its model signal and never makes the consumed review reusable', async t => {
  let signal, release;
  const held = new Promise(resolve => release = resolve);
  const h = await harness(t, { modelWork: async input => { signal = input.signal; await held; return { text: 'late plan', model: 'qwen3:4b' }; } });
  const c = await h.send('context'), p = await h.send('proposals', { csrf: c.value.csrf, prompt: 'Suggest a plan', context: 'explicitly selected' });
  const body = { csrf: p.value.csrf, proposalId: p.value.proposalId, approval: 'send-reviewed-context-once' };
  const req = httpRequest({ hostname: '127.0.0.1', port: h.server.address().port, path: '/runtime/native-tools/approve?sessionId=' + sessionId, method: 'POST', headers: { host: 'developer.ynxweb4.com', cookie: 'wallet=A', origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } });
  req.on('error', () => {}); req.end(JSON.stringify(body));
  const deadline = Date.now() + 2000; while (!signal && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(signal); req.destroy();
  try {
    const deadline = Date.now() + 1000; while (!signal.aborted && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(signal.aborted, true, 'client cancellation must reach the existing model router');
    assert.equal((await h.send('approve', body)).status, 403); assert.equal(h.calls.length, 1);
  } finally { release(); }
});

test('native text apply rejects cross-session bundles and real symlink escape', async () => {
  assert.throws(() => validateChanges({ protocol: 'ynx-reviewed-text/v1', sessionId: 'other', changes: [] }, new Map(), sessionId));
  const root = await mkdtemp(join(tmpdir(), 'ynx-path-')), outside = await mkdtemp(join(tmpdir(), 'ynx-outside-'));
  await writeFile(join(root, 'inside.txt'), 'safe'); await writeFile(join(outside, 'outside.txt'), 'other'); await symlink(outside, join(root, 'escape'));
  await assertWorkspacePath(join(root, 'inside.txt'), root); await assert.rejects(assertWorkspacePath(join(root, 'escape', 'outside.txt'), root), /outside/);
});
