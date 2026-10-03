import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWorkspaceStore } from '../../workspace-manager/src/store.mjs';
import { createNativeAIStore } from '../../codeoss-service/src/native-ai-store.mjs';
import { createModelRouter } from '../../model-router/src/router.mjs';
import { streamText } from '../../model-router/test/stream-fixture.mjs';
import { createAgentOrchestrator } from '../src/service.mjs';
import { consumerIdentityBinding } from '../../codeoss-service/src/identity-consumer-binding.mjs';

const PROTOCOL = 'ynx-code-agent/v1';
const digest = text => createHash('sha256').update(text).digest('hex');
const plan = () => JSON.stringify({ summary: 'Change the greeting', steps: [{ title: 'Edit source', acceptance: 'Greeting changes' }], contextPaths: ['main.ts'] });
const patch = () => JSON.stringify({ summary: 'Changed greeting', edits: [{ path: 'main.ts', expectedDigest: digest('export const greeting = "old";\n'), replacements: [{ find: '"old"', replace: '"new"' }] }] });
const review = () => JSON.stringify({ approved: true, summary: 'Approved bounded change', findings: [] });

async function fixture(t, { generate, useStore = true, outputs = [plan(), patch(), review()], currentCheck = true, maintenanceSignal, projectMemory } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ynx-agent-identity-'));
  const workspaceStore = createWorkspaceStore({ filename: join(root, 'workspace.sqlite') });
  const aiStore = useStore ? createNativeAIStore({ filename: join(root, 'ai.sqlite'), keyPath: join(root, 'ai.key') }) : null;
  const seed = (owner, projectId, name = projectId) => workspaceStore.put(owner, projectId, { expectedRevision: 0, idempotencyKey: `seed-${owner}-${projectId}`, payload: { name, files: { 'main.ts': 'export const greeting = "old";\n' }, folders: [], open: ['main.ts'], active: 'main.ts' } });
  seed('workspace-a', 'project', 'Project A'); seed('workspace-b', 'project', 'Project B'); seed('workspace-b', 'private-b');
  let state = { owner: 'identity-a', workspaceOwner: 'workspace-a', account: 'account-a', generation: 1, identityReference: 'ref-a', expiresAt: Date.now() + 60_000 };
  let verifyCount = 0;
  const sent = [], inputs = [];
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)); sent.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-ynx-ai-model': 'qwen3:4b' });
    res.end(streamText(outputs.shift() || plan()).replace('qa-session', body.session));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const router = createModelRouter({ hostedBaseURL: `http://127.0.0.1:${upstream.address().port}` });
  const agent = createAgentOrchestrator({ filename: join(root, 'agent.sqlite'), workspaceStore, aiStore, projectMemory,
    // A configured verifier is authoritative even when an old guest cookie exists.
    ownerForRequest: () => 'workspace-b',
    verifyIdentity: async () => {
      verifyCount++;
      const snapshot = state && { ...state };
      if (!snapshot) return null;
      return { ...snapshot, isCurrent: () => {
        if (currentCheck && (!state || ['owner', 'workspaceOwner', 'account', 'generation', 'identityReference'].some(key => state[key] !== snapshot[key])))
          throw Object.assign(new Error('Session revoked'), { code: 'core_identity_changed', status: 401 });
        // Production central verifier uses a throwing assertion, not boolean true.
      } };
    }, modelRouter: { generate: async input => { inputs.push(input); return generate ? generate(input) : router.generate(input); } } });
  const server = createServer(async (req, res) => { req.maintenanceSignal = maintenanceSignal; if (!await agent.handler(req, res)) res.writeHead(404).end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    agent.close(); aiStore?.close(); workspaceStore.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let identityKey;
  const refreshIdentity = async () => { identityKey = (await (await fetch(`${base}/runtime/agent/projects`)).json()).identityKey; };
  await refreshIdentity();
  const get = path => fetch(`${base}${path}`, { headers: { 'x-ynx-agent-identity': identityKey } });
  const post = async (path, body) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ynx-agent-identity': identityKey }, body: JSON.stringify({ protocolVersion: PROTOCOL, approvalId: randomUUID(), ownerId: 'forged-owner', workspaceOwner: 'workspace-b', ...body }) });
    return { status: response.status, value: await response.json() };
  };
  const create = extra => post('/runtime/agent/runs', { projectId: 'project', intent: 'Change the greeting export', approval: 'model-request-once', ...extra });
  return { base, port: server.address().port, post, get, create, agent, aiStore, workspaceStore, inputs, sent, refreshIdentity,
    state: () => state, setState: value => { state = value; }, verifyCount: () => verifyCount, identityKey: () => identityKey };
}

test('verified projects, Planner, approved Coder and Reviewer use exact workspace and durable existing Gateway sessions', async t => {
  const f = await fixture(t);
  const catalog = await (await fetch(`${f.base}/runtime/agent/projects`)).json();
  assert.deepEqual(catalog, { protocolVersion: PROTOCOL, account: 'account-a', generation: 1, identityKey: consumerIdentityBinding({ ...f.state(), isCurrent() {} }),
    projects: [{ projectId: 'project', name: 'Project A', revision: 1, activePath: 'main.ts', storageMode: 'text-snapshot' }] });
  const foreign = await f.create({ projectId: 'private-b' }); assert.equal(foreign.status, 404);
  let result = await f.create(); assert.equal(result.status, 201, JSON.stringify(result.value));
  const id = result.value.run.runId;
  for (const body of [{ action: 'approve-plan' }, { action: 'approve-context', paths: ['main.ts'], approval: 'context-read-once' }, { action: 'generate-proposal', approval: 'model-request-once' }]) {
    result = await f.post(`/runtime/agent/runs/${id}`, body); assert.equal(result.status, 200, JSON.stringify(result.value));
  }
  assert.equal(result.value.run.review.approved, true);
  assert.equal(f.inputs.length, 3); assert.equal(f.sent.length, 3);
  assert.ok(f.inputs.every(input => input.ownerId === 'identity-a'));
  assert.deepEqual(f.inputs.map(input => input.role), ['Planner', 'Coder', 'Reviewer']);
  assert.equal(new Set(f.inputs.map(input => input.hostedSession)).size, 3);
  for (let index = 0; index < f.inputs.length; index++) {
    const input = f.inputs[index], wire = f.sent[index], saved = f.aiStore.get('identity-a', 'project', input.hostedSession);
    const stored = input.attachments.length ? JSON.parse(saved.context) : { prompt: saved.context, attachments: [], includedContext: [], excludedContext: ['conversation', 'selected_files', 'selected_chain_records', 'selected_trust_records', 'selected_product_context'] };
    assert.equal(saved.status, 'completed'); assert.equal(stored.prompt, `${input.system}\n\n${input.prompt}`);
    assert.deepEqual(stored.attachments, input.attachments);
    assert.equal(saved.prompt, `YNX Code ${input.role} Agent`); assert.ok(saved.text);
    assert.notEqual(saved.id, id);
    assert.deepEqual(wire, { session: saved.id, prompt: stored.prompt, outputLanguage: 'en', includedContext: input.attachments.length ? ['selected_files'] : [],
      excludedContext: ['conversation', ...(!input.attachments.length ? ['selected_files'] : []), 'selected_chain_records', 'selected_trust_records', 'selected_product_context'], attachments: input.attachments, productContexts: [], continueFrom: '' });
  }
  assert.equal(f.aiStore.list('workspace-a', 'project').length, 0);
  assert.equal(f.aiStore.list('identity-b', 'project').length, 0);
  assert.equal(result.value.run.events.filter(event => /^(planner|coder|reviewer)\./.test(event.event_type)).every(event => event.payload.saved && event.payload.conversationId), true);
  result = await f.post(`/runtime/agent/runs/${id}`, { action: 'apply', approval: 'write-once' });
  assert.equal(result.status, 200); assert.equal(result.value.run.status, 'applied');
  assert.equal(f.workspaceStore.get('workspace-a', 'project').files['main.ts'], 'export const greeting = "new";\n');
  assert.equal(f.workspaceStore.get('workspace-b', 'project').files['main.ts'], 'export const greeting = "old";\n');
  f.setState({ ...f.state(), owner: 'identity-b', workspaceOwner: 'workspace-b', account: 'account-b', identityReference: 'ref-b' });
  await f.refreshIdentity();
  assert.equal((await f.get(`/runtime/agent/runs/${id}`)).status, 404);
});

test('verified admission never falls back to an old guest and missing AI store fails closed', async t => {
  const f = await fixture(t, { useStore: false });
  let result = await f.create(); assert.equal(result.status, 503); assert.equal(result.value.code, 'agent_ai_store_unavailable');
  assert.equal(f.inputs.length, 0);
  f.setState(null);
  result = await f.create(); assert.equal(result.status, 401);
  assert.equal((await fetch(`${f.base}/runtime/agent/projects`)).status, 401);
  assert.equal(f.agent.read('workspace-b', 'project'), null);
});

test('a previous account catalog cannot authorize the same project ID after the browser changes account before POST', async t => {
  const f = await fixture(t), keyA = f.identityKey();
  f.setState({ ...f.state(), owner: 'identity-b', workspaceOwner: 'workspace-b', account: 'account-b', identityReference: 'ref-b' });
  const result = await f.create();
  assert.equal(result.status, 401); assert.equal(result.value.code, 'core_consumer_identity_changed');
  assert.equal((await f.get('/runtime/agent/runs?projectId=project')).status, 401);
  assert.equal(f.inputs.length, 0); assert.equal(f.aiStore.list('identity-b', 'project').length, 0);
  assert.equal(f.workspaceStore.get('workspace-b', 'project').revision, 1);
  await f.refreshIdentity(); assert.notEqual(f.identityKey(), keyA);
  assert.equal((await f.create()).status, 201);
  const input = f.inputs[0]; assert.equal(input.ownerId, 'identity-b');
  assert.equal(f.aiStore.get('identity-b', 'project', input.hostedSession).status, 'completed');
});

test('provider authorization failure is a service failure and keeps the valid Wallet session distinguishable', async t => {
  const f = await fixture(t, { generate: async () => { throw Object.assign(new Error('Upstream provider authorization failed'), { code: 'provider_auth_failed', status: 401 }); } });
  const result = await f.create();
  assert.equal(result.status, 503); assert.equal(result.value.code, 'provider_auth_failed');
  assert.equal((await f.get('/runtime/agent/projects')).status, 200);
  assert.equal(f.aiStore.get('identity-a', 'project', f.inputs[0].hostedSession).status, 'failed');
});

test('delayed request body cannot send context after account, generation or identity reference changes', async t => {
  for (const changed of [{ account: 'account-b' }, { generation: 2 }, { identityReference: 'ref-replaced' }, { workspaceOwner: 'workspace-b' }, { owner: 'identity-b' }]) {
    await t.test(Object.keys(changed)[0], async t => {
      // Deliberately hold the local assertion true so the async verifier must compare bindings.
      const f = await fixture(t, { currentCheck: false });
      const before = f.verifyCount();
      const payload = JSON.stringify({ protocolVersion: PROTOCOL, projectId: 'project', intent: 'Change the greeting export', approval: 'model-request-once', approvalId: randomUUID() });
      const complete = new Promise((resolve, reject) => {
        const request = httpRequest({ host: '127.0.0.1', port: f.port, path: '/runtime/agent/runs', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'x-ynx-agent-identity': f.identityKey() } }, response => {
          let text = ''; response.on('data', chunk => { text += chunk; }); response.on('end', () => resolve({ status: response.statusCode, value: JSON.parse(text) }));
        });
        request.on('error', reject); request.write(payload.slice(0, 20));
        void (async () => {
          while (f.verifyCount() < before + 2) await new Promise(resolve => setTimeout(resolve, 5));
          f.setState({ ...f.state(), ...changed }); request.end(payload.slice(20));
        })().catch(reject);
      });
      const result = await complete; assert.equal(result.status, 401); assert.equal(result.value.code, 'agent_identity_changed');
      assert.equal(f.inputs.length, 0); assert.equal(f.aiStore.list('identity-a', 'project').length, 0);
    });
  }
});

test('revocation cancels an in-flight model and retains only the interrupted intent without a late plan or completed answer', async t => {
  let resolveModel, started;
  const begun = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { generate: input => { started(input); return new Promise(resolve => { resolveModel = resolve; }); } });
  const pending = f.create(); const input = await begun;
  f.setState(null);
  const result = await pending;
  assert.equal(result.status, 401); assert.equal(input.signal.aborted, true);
  const record = f.aiStore.get('identity-a', 'project', input.hostedSession); assert.equal(record.status, 'failed'); assert.equal(record.text, undefined);
  resolveModel({ provider: 'ynx-hosted', model: 'qwen3:4b', text: plan() });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.aiStore.get('identity-a', 'project', input.hostedSession).status, 'failed');
  f.setState({ owner: 'identity-a', workspaceOwner: 'workspace-a', account: 'account-a', generation: 2, identityReference: 'ref-new', expiresAt: Date.now() + 60_000 });
  await f.refreshIdentity();
  const runs = (await (await f.get('/runtime/agent/runs?projectId=project')).json()).runs;
  assert.equal(runs.length, 1); assert.equal(runs[0].status, 'planning'); assert.equal(runs[0].operation.status, 'interrupted');
  assert.equal(runs[0].plan, null); assert.equal(runs[0].proposal, null); assert.equal(runs[0].intent, 'Change the greeting export');
});

test('expiry cancels a provider that ignores the signal', async t => {
  let started; const begun = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { generate: input => { started(input); return new Promise(() => {}); } });
  f.setState({ ...f.state(), expiresAt: Date.now() + 150 });
  const pending = f.create(); const input = await begun; const result = await pending;
  assert.equal(result.status, 401); assert.equal(input.signal.aborted, true);
  assert.equal(f.aiStore.get('identity-a', 'project', input.hostedSession).status, 'failed');
});

test('an identity change during Coder generation preserves the reviewed run without a proposal or late saved answer', async t => {
  let f;
  f = await fixture(t, { currentCheck: false, generate: async input => {
    if (input.role === 'Planner') return { provider: 'ynx-hosted', model: 'qwen3:4b', text: plan() };
    f.setState({ ...f.state(), generation: 2 });
    return { provider: 'ynx-hosted', model: 'qwen3:4b', text: patch() };
  } });
  const created = await f.create(), id = created.value.run.runId;
  for (const body of [{ action: 'approve-plan' }, { action: 'approve-context', paths: ['main.ts'], approval: 'context-read-once' }])
    assert.equal((await f.post(`/runtime/agent/runs/${id}`, body)).status, 200);
  const result = await f.post(`/runtime/agent/runs/${id}`, { action: 'generate-proposal', approval: 'model-request-once' });
  assert.equal(result.status, 401); assert.equal(result.value.code, 'agent_identity_changed');
  const run = f.agent.read('workspace-a', id);
  assert.equal(run.status, 'proposal_generation'); assert.equal(run.proposal, null);
  assert.equal(f.inputs.length, 2); assert.equal(f.inputs[1].signal.aborted, true);
  assert.equal(f.aiStore.get('identity-a', 'project', f.inputs[1].hostedSession).status, 'failed');
  assert.equal(f.workspaceStore.get('workspace-a', 'project').revision, 1);
});

test('the production throwing isCurrent assertion aborts a quick late model result before saving', async t => {
  let f;
  f = await fixture(t, { generate: async () => {
    f.setState(null);
    return { provider: 'ynx-hosted', model: 'qwen3:4b', text: plan() };
  } });
  const result = await f.create();
  assert.equal(result.status, 401); assert.equal(result.value.code, 'core_identity_changed');
  assert.equal(f.inputs[0].signal.aborted, true);
  assert.equal(f.aiStore.get('identity-a', 'project', f.inputs[0].hostedSession).status, 'failed');
});

test('memory search receives current-identity checks and a revoked search cannot start Coder', async t => {
  let f;
  f = await fixture(t, { projectMemory: { search: async (owner, project, query, count, paths, { assertCurrent }) => {
    assert.equal(owner, 'workspace-a'); assert.equal(project, 'project'); assert.deepEqual(paths, ['main.ts']);
    await assertCurrent(); f.setState(null); await assertCurrent();
    assert.fail('Revoked memory context must not complete');
  } } });
  const created = await f.create(), id = created.value.run.runId;
  for (const body of [{ action: 'approve-plan' }, { action: 'approve-context', paths: ['main.ts'], approval: 'context-read-once' }])
    assert.equal((await f.post(`/runtime/agent/runs/${id}`, body)).status, 200);
  const result = await f.post(`/runtime/agent/runs/${id}`, { action: 'generate-proposal', approval: 'model-request-once' });
  assert.equal(result.status, 401); assert.equal(f.inputs.length, 1);
  assert.equal(f.agent.read('workspace-a', id).status, 'proposal_generation');
});

test('maintenance interruption remains recorded for the unchanged verified owner', async t => {
  const controller = new AbortController();
  const f = await fixture(t, { maintenanceSignal: controller.signal, generate: async input => {
    if (input.role === 'Planner') return { provider: 'ynx-hosted', model: 'qwen3:4b', text: plan() };
    controller.abort(Object.assign(new Error('Service maintenance'), { code: 'service_maintenance', status: 503 }));
    return { provider: 'ynx-hosted', model: 'qwen3:4b', text: patch() };
  } });
  const created = await f.create(), id = created.value.run.runId;
  for (const body of [{ action: 'approve-plan' }, { action: 'approve-context', paths: ['main.ts'], approval: 'context-read-once' }])
    assert.equal((await f.post(`/runtime/agent/runs/${id}`, body)).status, 200);
  const result = await f.post(`/runtime/agent/runs/${id}`, { action: 'generate-proposal', approval: 'model-request-once' });
  assert.equal(result.status, 503); assert.equal(result.value.code, 'service_maintenance');
  assert.equal(f.agent.read('workspace-a', id).events.at(-1).event_type, 'operation.maintenance_interrupted');
  assert.equal(f.aiStore.get('identity-a', 'project', f.inputs[1].hostedSession).status, 'failed');
});

test('native volume projects never send their preserved import snapshot to a model', async t => {
  const f = await fixture(t), token = 'a'.repeat(64);
  f.workspaceStore.claimWriter('workspace-a', 'project', { writerToken: token, sessionId: randomUUID(), expectedRevision: 1 });
  f.workspaceStore.markNativeProject('workspace-a', 'project', token);
  const result = await f.create(); assert.equal(result.status, 409); assert.equal(result.value.code, 'agent_native_tools_required');
  assert.equal(f.inputs.length, 0); assert.equal(f.aiStore.list('identity-a', 'project').length, 0);
  const catalog = await (await fetch(`${f.base}/runtime/agent/projects`)).json(); assert.equal(catalog.projects[0].storageMode, 'native-volume');
});

test('existing protected writer still blocks the approved patch write', async t => {
  const f = await fixture(t); const created = await f.create(), id = created.value.run.runId;
  for (const body of [{ action: 'approve-plan' }, { action: 'approve-context', paths: ['main.ts'], approval: 'context-read-once' }, { action: 'generate-proposal', approval: 'model-request-once' }])
    assert.equal((await f.post(`/runtime/agent/runs/${id}`, body)).status, 200);
  f.workspaceStore.claimWriter('workspace-a', 'project', { writerToken: 'b'.repeat(64), sessionId: randomUUID(), expectedRevision: 1 });
  const result = await f.post(`/runtime/agent/runs/${id}`, { action: 'apply', approval: 'write-once' });
  assert.equal(result.status, 409); assert.equal(result.value.code, 'core_writer_active');
  assert.equal(f.workspaceStore.get('workspace-a', 'project').revision, 1);
});

test('hosted validation retries receive distinct saved conversations and preserve system plus exact retry prompt', async t => {
  const f = await fixture(t, { outputs: [plan(), '{"wrong":"schema"}', patch(), '{"wrong":"schema"}', review()] });
  const created = await f.create(), id = created.value.run.runId;
  for (const body of [{ action: 'approve-plan' }, { action: 'approve-context', paths: ['main.ts'], approval: 'context-read-once' }, { action: 'generate-proposal', approval: 'model-request-once' }]) {
    const result = await f.post(`/runtime/agent/runs/${id}`, body); assert.equal(result.status, 200, JSON.stringify(result.value));
  }
  assert.equal(f.inputs.length, 5); assert.equal(new Set(f.inputs.map(value => value.hostedSession)).size, 5);
  assert.deepEqual(f.inputs.map(value => value.role), ['Planner', 'Coder', 'Coder', 'Reviewer', 'Reviewer']);
  for (const input of f.inputs) {
    const context = f.aiStore.get('identity-a', 'project', input.hostedSession).context;
    const stored = input.attachments.length ? JSON.parse(context) : { prompt: context, attachments: [] };
    assert.equal(stored.prompt, `${input.system}\n\n${input.prompt}`);
    assert.deepEqual(stored.attachments, input.attachments);
  }
  assert.match(f.inputs[2].prompt, /previous proposal failed server validation/); assert.match(f.inputs[4].prompt, /previous review failed server validation/);
});

test('oversized UTF-8 hosted input fails before conversation creation or model dispatch', async t => {
  const f = await fixture(t); const result = await f.create({ intent: '界'.repeat(2800) });
  assert.equal(result.status, 413); assert.equal(result.value.code, 'model_prompt_limit');
  assert.equal(f.inputs.length, 0); assert.equal(f.aiStore.list('identity-a', 'project').length, 0);
});

test('a missing BYOK provider key is a request error and does not retire the Wallet session', async t => {
  const f = await fixture(t);
  const result = await f.create({ provider: 'openai' });
  assert.equal(result.status, 400); assert.equal(result.value.code, 'provider_key_required');
  assert.equal(f.sent.length, 0); assert.equal(f.aiStore.list('identity-a', 'project').length, 0);
  assert.equal((await fetch(`${f.base}/runtime/agent/projects`)).status, 200);
});
