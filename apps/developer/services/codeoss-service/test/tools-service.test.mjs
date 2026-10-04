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
import { compilerReadiness } from '../../../scripts/compiler-pin.mjs';
const require = createRequire(import.meta.url), { digest, validateChanges, assertWorkspacePath } = require('../../../native/ynx-tools/src/guards.cjs');
const sessionId = '12345678-1234-1234-1234-123456789012', origin = 'https://developer.ynxweb4.com';
async function harness(t, { realChain = false, generationHook, modelWork, compilerWork } = {}) {
  let now = 100, generation = 1, revoked = false, admissions = 0, projectId = 'project-A', identityReference = 'reference-A'; const calls = [], admittedOwners = new WeakMap();
  const coreService = { async authorizeConnection(request, id) { admissions++; if (revoked || request.headers.cookie !== 'wallet=A' || id !== sessionId) throw Object.assign(Error('Identity rejected'), { status: 401 }); return { context: { owner: 'verified-A', sessionId, projectId, runtimeId: 'runtime-A' }, identity: { account: 'account-A', generation, identityReference }, expiresAt: 100000 }; } };
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
  const service = createNativeToolsService({ coreService, aiStore, admittedOwners, now: () => now, ...(compilerWork ? { compiler: { async compile(value) { calls.push(value); return compilerWork(value); } } } : {}), chainHandler: realChain ? chain.handler : readonly, walletHandler: readonly, modelRouter: { async generate(value) { calls.push(value); generationHook?.(() => revoked = true); return modelWork ? modelWork(value) : { model: 'qwen3:4b', text: 'reviewed plan' }; } } });
  const server = createServer((req, res) => service.handler(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: '/runtime/native-tools/' + path + (path.includes('?') ? '&' : '?') + 'sessionId=' + sessionId, method: body ? 'POST' : 'GET', headers: { host: 'developer.ynxweb4.com', cookie: 'wallet=A', ...(body ? { origin, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : {}), ...headers } }, res => { let data='';res.on('data', chunk => data += chunk);res.on('end', () => resolve({ status:res.statusCode, value:JSON.parse(data), headers:new Headers(res.headers) })); });req.on('error',reject);req.end(body ? JSON.stringify(body) : undefined);
  });
  return { send, calls, server, aiStore, changeReference: () => identityReference += '-new', admissions: () => admissions, setTime: value => now = value, changeAccount: () => generation++, changeProject: value => projectId = value, revoke: () => revoked = true };
}

test('admitted HTTP compile uses real pinned input and consumes its project-bound ticket once', async t => {
  if (!compilerReadiness().available) return t.skip('Supply the reviewed offline compiler input.');
  const h = await harness(t), context = await h.send('context');
  const body = { csrf: context.value.csrf, name: 'PinCheck', source: '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24; contract PinCheck { function ping() external pure returns(uint256) { return 1; } }' };
  const result = await h.send('chain/compile', body);
  assert.equal(result.status, 200); assert.equal(result.value.compiler.version, '0.8.24');
  assert.equal(result.value.projectId, 'project-A'); assert.equal(result.value.signed, false); assert.equal(result.value.submitted, false);
  assert.ok(result.value.abi.some(item => item.name === 'ping')); assert.match(result.value.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal((await h.send('chain/compile', body)).status, 403);
  assert.equal((await h.send('chain/compile', body, {cookie:'wallet=B'})).status, 401);
});
test('real admitted HTTP project build resolves declared files and rejects snapshots from another session', async t => {
  if (!compilerReadiness().available) return t.skip('Supply the reviewed offline compiler input.');
  const h=await harness(t),context=await h.send('context');
  const sources=Object.fromEntries(Object.entries({'PinCheck.sol':'pragma solidity 0.8.24; import "./Part.sol"; contract PinCheck { function ping() external pure returns(uint256){return Part.value();}}','Part.sol':'pragma solidity 0.8.24; library Part {function value() internal pure returns(uint256){return 3;}}'}).map(([path,content])=>[path,{content,sha256:digest(content),documentVersion:2}]));
  const snapshot={protocol:'ynx-solidity-project/v1',sessionId,entryPath:'PinCheck.sol',sources};
  const compiled=await h.send('chain/compile',{csrf:context.value.csrf,name:'PinCheck',snapshot});
  assert.equal(compiled.status,200);assert.equal(Object.keys(compiled.value.sourceDigests).length,2);assert.equal(compiled.value.sourceName,'PinCheck.sol');
  const fresh=await h.send('context');snapshot.sessionId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const rejected=await h.send('chain/compile',{csrf:fresh.value.csrf,name:'PinCheck',snapshot});assert.equal(rejected.status,400);assert.equal(rejected.value.bytecode,undefined);
});
for (const mutation of ['changeProject', 'changeAccount', 'changeReference', 'revoke', 'expire']) test(`compile results are retired after ${mutation} while the worker is running`, async t => {
  let release, started; const running = new Promise(resolve => started = resolve), finished = new Promise(resolve => release = resolve);
  const h = await harness(t, { compilerWork: async value => { started(); await finished; return { ok:true, bytecode:'PRIVATE_OLD_PROJECT' }; } });
  const context = await h.send('context');
  const pending = h.send('chain/compile', {csrf:context.value.csrf,name:'PinCheck',source:'reviewed source'});
  await running;
  if (mutation === 'expire') h.setTime(100001);
  else if (mutation === 'changeProject') h.changeProject('project-B');
  else h[mutation]();
  release();
  const result = await pending; assert.equal(result.status, 401); assert.equal(result.value.bytecode, undefined);
  assert.equal(h.calls[0].owner, 'verified-A');
});

test('passive foreground checks require identity, report session lifetime and mint no review tickets', async t => {
  const h = await harness(t);
  for (let i = 0; i < 20; i++) {
    const checked = await h.send('context?checkOnly=1');
    assert.equal(checked.status, 200); assert.equal(checked.value.sessionExpiresAt, 100000);
    assert.equal(checked.value.expiresAt, 60100); assert.equal(Object.hasOwn(checked.value, 'csrf'), false);
  }
  const fresh = await h.send('context');
  assert.equal(fresh.status, 200); assert.equal(fresh.value.sessionExpiresAt, 100000);
  const preview = await h.send('proposals', { csrf: fresh.value.csrf, prompt: 'Suggest a plan', context: 'reviewed text' });
  assert.equal(preview.status, 200); assert.equal(h.calls.length, 0);
  assert.equal((await h.send('context?checkOnly=1', undefined, { cookie: 'wallet=B' })).status, 401);
  h.revoke(); assert.equal((await h.send('context?checkOnly=1')).status, 401);
  assert.equal(h.calls.length, 0);
});

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
  const path = join(projectDirectory, 'extensions', 'ynx.ynx-tools-0.2.8', 'src', 'guards.cjs');
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


for (const transition of ['changeAccount','changeProject','changeReference','revoke','expire','unchanged']) {
  test('actual queued Tools request rechecks ' + transition + ' before sending private context', async t => {
    let release, started;
    const held=new Promise(resolve=>release=resolve), ready=new Promise(resolve=>started=resolve), seen=[];
    const upstream=createServer(async (req,res)=>{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));seen.push(body);
      if(seen.length===1){started();await held;}
      res.writeHead(200,{'content-type':'text/event-stream'});
      res.end('event: metadata\ndata: '+JSON.stringify({requestId:'controlled-queue',sessionId:body.session})+'\n\nevent: token\ndata: {"text":"controlled answer"}\n\nevent: done\ndata: {"requestId":"controlled-queue"}\n\n');
    });
    await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
    t.after(()=>{release();upstream.closeAllConnections();upstream.close();});
    const router=createModelRouter({hostedBaseURL:'http://127.0.0.1:'+upstream.address().port,maxConcurrent:1,maxHostedConcurrent:1,maxPerOwner:1});
    const blocker=router.generate({ownerId:'other-owner',hostedSession:'00000000-0000-4000-8000-000000000001',prompt:'Controlled blocker'});
    await ready;
    const h=await harness(t,{modelWork:input=>router.generate(input)}), c=await h.send('context');
    const p=await h.send('proposals',{csrf:c.value.csrf,prompt:'Review this private selection',context:'PRIVATE_QUEUE_CONTEXT'});
    const body={csrf:p.value.csrf,proposalId:p.value.proposalId,approval:'send-reviewed-context-once'};
    const pending=h.send('approve',body);
    const deadline=Date.now()+2000;while(router.catalog().queued!==1&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(router.catalog().queued,1);
    if(transition==='expire')h.setTime(100001);else if(transition==='changeProject')h.changeProject('project-B');else if(transition!=='unchanged')h[transition]();
    release();await blocker;const result=await pending;
    if(transition==='unchanged'){
      assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.text,'controlled answer');assert.equal(seen.length,2);
      const saved=h.aiStore.get('verified-A','project-A',result.value.conversationId);assert.equal(saved.status,'completed');assert.equal(saved.context,'PRIVATE_QUEUE_CONTEXT');
      assert.equal((await h.send('approve',body)).status,403);assert.equal(seen.length,2);return;
    }
    assert.equal(result.status,401,JSON.stringify(result.value));assert.equal(result.value.text,undefined);
    assert.equal(seen.length,1,'retired queued context must not reach the upstream HTTP service');
    assert.equal(JSON.stringify(seen).includes('PRIVATE_QUEUE_CONTEXT'),false);
    const saved=h.aiStore.list('verified-A','project-A');assert.equal(saved.length,1);assert.equal(saved[0].status,'failed');
    assert.equal(h.aiStore.get('verified-A','project-A',saved[0].id).text,undefined);
    assert.equal((await h.send('approve',body)).status>=400,true);assert.equal(seen.length,1);
    assert.equal(router.catalog().active,0);assert.equal(router.catalog().queued,0);
  });
}

test('actual Tools selected-edit approval exports and reopens a version-bound replacement without applying it',async t=>{
 const text='prefix\nselected passage\nsuffix', selection={uri:'file:///project/a.ts',version:7,fullTextDigest:digest(text),selectedText:'selected passage',sessionId};
 const answer=JSON.stringify({summary:'Replace selected passage',replacement:'new passage'});
 const h=await harness(t,{modelWork:async()=>({model:'qwen3:4b',text:answer})}),c=await h.send('context');
 const p=await h.send('proposals',{csrf:c.value.csrf,prompt:'Improve the selected text',context:JSON.stringify(selection),mode:'selected-edit'});
 assert.equal(p.status,200);assert.equal(p.value.mode,'selected-edit');assert.match(p.value.wirePrompt,/Return JSON only/);
 const result=await h.send('approve',{csrf:p.value.csrf,proposalId:p.value.proposalId,approval:'send-reviewed-context-once'});
 assert.equal(result.status,200);assert.equal(result.value.applied,false);assert.equal(result.value.signed,false);
 const changes=validateChanges(result.value.edit.bundle,new Map([[selection.uri,{version:7,getText:()=>text}]]),sessionId);
 assert.equal(changes[0].text,'prefix\nnew passage\nsuffix');assert.equal(h.calls.length,1);
 const restored=await h.send('ai/conversations/'+result.value.conversationId);assert.equal(restored.status,200);assert.deepEqual(restored.value.conversation.edit,result.value.edit);assert.equal(h.calls.length,1);
});
test('invalid capture or model-invented edit metadata cannot produce a native edit or reusable approval',async t=>{
 const h=await harness(t,{modelWork:async()=>({model:'qwen3:4b',text:JSON.stringify({summary:'Wrong target',replacement:'new',uri:'file:///foreign'})})});
 let c=await h.send('context');const bad=await h.send('proposals',{csrf:c.value.csrf,prompt:'Improve selection',context:JSON.stringify({sessionId:'foreign'}),mode:'selected-edit'});
 assert.equal(bad.status,400);assert.equal(h.calls.length,0);
 c=await h.send('context');const capture={uri:'file:///project/a.ts',version:1,fullTextDigest:digest('selected'),selectedText:'selected',sessionId};
 const p=await h.send('proposals',{csrf:c.value.csrf,prompt:'Improve selection',context:JSON.stringify(capture),mode:'selected-edit'});
 const body={csrf:p.value.csrf,proposalId:p.value.proposalId,approval:'send-reviewed-context-once'},response=await h.send('approve',body);
 assert.equal(response.status,502);assert.equal(response.value.code,'tools_edit_output_invalid');assert.equal(response.value.edit,undefined);
 const records=h.aiStore.list('verified-A','project-A');assert.equal(records[0].status,'failed');assert.equal(h.aiStore.get('verified-A','project-A',records[0].id).text,undefined);
 assert.equal((await h.send('approve',body)).status,403);assert.equal(h.calls.length,1);
});
test('a saved selected edit from an earlier runtime remains readable without rebinding its edit to the new session',async t=>{
 const h=await harness(t),context=JSON.stringify({kind:'ynx-native-selected-edit/v1',context:JSON.stringify({uri:'file:///project/a.ts',version:2,fullTextDigest:digest('selected'),selectedText:'selected',sessionId:'00000000-0000-4000-8000-000000000099'})});
 const record=h.aiStore.create({owner:'verified-A',projectId:'project-A',prompt:'Earlier selection',context,model:'qwen3:4b'});
 const text=JSON.stringify({summary:'Earlier edit',replacement:'new'});h.aiStore.complete('verified-A','project-A',record.id,{text,model:'qwen3:4b'});
 const reopened=await h.send('ai/conversations/'+record.id);assert.equal(reopened.status,200);assert.equal(reopened.value.conversation.text,text);
 assert.equal(reopened.value.conversation.edit,undefined);assert.equal(reopened.value.conversation.editRequiresRecapture,true);assert.equal(h.calls.length,0);
});
test('versioned Tools upgrade preserves legacy extension files and installs the new exact bundle separately',async t=>{
 const fs=await import('node:fs/promises'),root=await mkdtemp(join(tmpdir(),'ynx-tools-versioned-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));const previous=join(root,'extensions','ynx.ynx-tools-0.2.0','src');await fs.mkdir(previous,{recursive:true});await writeFile(join(previous,'guards.cjs'),'previous candidate preserved');const legacy=join(root,'extensions','ynx.ynx-tools-0.1.0','src');await fs.mkdir(legacy,{recursive:true});await writeFile(join(legacy,'guards.cjs'),'legacy user file preserved');
 const lastRelease=join(root,'extensions','ynx.ynx-tools-0.2.3','src');await fs.mkdir(lastRelease,{recursive:true});await writeFile(join(lastRelease,'extension.cjs'),'previous installed user changes preserved');
 const priorCopy=join(root,'extensions','ynx.ynx-tools-0.2.4','src');await fs.mkdir(priorCopy,{recursive:true});await writeFile(join(priorCopy,'extension.cjs'),'0.2.4 installed user draft preserved');
 const priorBrand=join(root,'extensions','ynx.ynx-developer-brand-0.1.1');await fs.mkdir(priorBrand,{recursive:true});await writeFile(join(priorBrand,'ynx-logo.png'),'preserved previous brand');
 await prepareCoreProject({projectDirectory:root});
 assert.equal(await readFile(join(priorBrand,'ynx-logo.png'),'utf8'),'preserved previous brand');
 assert.equal(JSON.parse(await readFile(join(root,'extensions','ynx.ynx-developer-brand-0.1.2','package.json'),'utf8')).version,'0.1.2');
 assert.equal(await readFile(join(legacy,'guards.cjs'),'utf8'),'legacy user file preserved');
 assert.equal(await readFile(join(previous,'guards.cjs'),'utf8'),'previous candidate preserved');
 const current=join(root,'extensions','ynx.ynx-tools-0.2.8');assert.equal(JSON.parse(await readFile(join(current,'package.json'),'utf8')).version,'0.2.8');
 assert.match(await readFile(join(current,'src','guards.cjs'),'utf8'),/replacements/);await prepareCoreProject({projectDirectory:root});
 assert.equal(await readFile(join(legacy,'guards.cjs'),'utf8'),'legacy user file preserved');
 assert.equal(await readFile(join(lastRelease,'extension.cjs'),'utf8'),'previous installed user changes preserved');
 assert.equal(await readFile(join(priorCopy,'extension.cjs'),'utf8'),'0.2.4 installed user draft preserved');
});
