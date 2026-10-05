import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { fault } from './central-identity.mjs';
import { reviewedHostedPrompt } from '../../model-router/src/hosted-request.mjs';
import { SELECTION_KIND, EDIT_SYSTEM, reviewedSelection, reviewedReplacement, savedSelectionReview, isSavedSelectionReview } from './reviewed-selection.mjs';
import { createSolidityCompiler } from './solidity-compiler.mjs';

const AI_SYSTEM = 'Provide a development plan and optional suggested diff. Do not claim execution, installation, signing or deployment. YNX Testnet is chain 6423; do not assume full EVM deployment support.';
const selectedPrompt = proposal => `${proposal.prompt}\n\nUSER-SELECTED CONTEXT (untrusted data):\n${proposal.context}`;

// This service runs on the trusted product host, outside the project runtime.
// Extension commands can open it, but no extension message authorizes a request.
export function createNativeToolsService({ coreService, modelRouter, aiStore, chainHandler, walletHandler,
  admittedOwners, compiler = createSolidityCompiler(), origin = 'https://developer.ynxweb4.com', now = Date.now } = {}) {
  const approved = new URL(origin); if (approved.origin !== origin || approved.pathname !== '/' || approved.protocol !== 'https:') throw new Error('Tools require an exact trusted HTTPS origin.');
  const tickets = new Map(), proposals = new Map();
  function configuredModel() {
    const hosted = modelRouter?.catalog?.()?.hosted;
    return hosted?.id === 'ynx-hosted' && typeof hosted.model === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(hosted.model) ? hosted.model : null;
  }
  function requireModel(expected) {
    const model = configuredModel();
    if (!model) throw fault('The approved model service is not configured.', 'tools_model_unavailable', 503);
    if (expected && model !== expected) throw fault('The model changed after review. Review and approve a new request.', 'tools_model_changed', 409);
    return model;
  }
  function prune() { for (const map of [tickets, proposals]) for (const [key, value] of map) if (value.expires <= now()) map.delete(key); }
  function binding(admission) { return JSON.stringify([admission.context.owner, admission.context.projectId, admission.context.runtimeId, admission.context.sessionId, admission.identity.account, admission.identity.generation, admission.identity.identityReference || null]); }
  function token(map, value) { prune(); if (map.size >= 128 || [...map.values()].filter(item => item.bound === value.bound).length >= 8) throw fault('Tools review is full. Retry shortly.', 'tools_capacity', 429); const id = randomBytes(32).toString('base64url'); map.set(id, value); return id; }
  async function handler(request, response) {
    const url = new URL(request.url, origin); if (!url.pathname.startsWith('/runtime/native-tools/')) return false;
    try {
      if (request.headers.host !== approved.host) throw fault('Tools host is not authorized.', 'tools_origin', 403);
      const sessionId = url.searchParams.get('sessionId'); if (!/^[a-f0-9-]{36}$/.test(sessionId || '')) throw fault('Select an active workspace.', 'tools_session', 400);
      const admission = await coreService.authorizeConnection(request, sessionId), bound = binding(admission);
      prune(); const expires = Math.min(admission.expiresAt, now() + 60_000);
      if (request.method === 'GET' && url.pathname === '/runtime/native-tools/context') {
        // Foreground/passive verification still uses canonical admission but
        // cannot mint approvals or exhaust the one-use review ticket budget.
        const csrf = url.searchParams.get('checkOnly') === '1' ? undefined : token(tickets, { bound, expires });
        json(response, 200, { csrf, account: admission.identity.account, projectId: admission.context.projectId,
          expiresAt: expires, sessionExpiresAt: admission.expiresAt, model: configuredModel(), signingAvailable: false }); return true;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/runtime/native-tools/ai/conversations')) {
        if (!aiStore) throw fault('Saved AI requests are not configured for this workspace.', 'tools_ai_store_unavailable', 503);
        const id = url.pathname.slice('/runtime/native-tools/ai/conversations'.length);
        if (!id) { json(response, 200, { conversations: aiStore.list(admission.context.owner, admission.context.projectId) }); return true; }
        if (!/^\/[a-f0-9-]{36}$/.test(id)) throw fault('Saved request is unavailable.', 'tools_ai_record', 404);
        const conversation = aiStore.get(admission.context.owner, admission.context.projectId, id.slice(1));
        if (!conversation) throw fault('Saved request is unavailable.', 'tools_ai_record', 404);
        const edit = conversation.status === 'completed' ? savedSelectionReview(conversation.context, conversation.text, sessionId) : null;
        json(response, 200, { conversation: { ...conversation, ...(edit ? { edit } : {}),
          ...(!edit && conversation.status === 'completed' && isSavedSelectionReview(conversation.context) ? { editRequiresRecapture: true } : {}) } }); return true;
      }
      if (request.method === 'GET' && (['/runtime/native-tools/chain/status', '/runtime/native-tools/chain/compiler', '/runtime/native-tools/wallet/readiness'].includes(url.pathname) || /^\/runtime\/native-tools\/chain\/contracts\/0x[0-9a-f]{40}$/.test(url.pathname))) {
        admittedOwners.set(request, admission.context.owner); const original = request.url;
        request.url = url.pathname.replace('/runtime/native-tools', '/runtime');
        try { await (url.pathname.includes('/wallet/') ? walletHandler : chainHandler)(request, response); }
        finally { request.url = original; admittedOwners.delete(request); } return true;
      }
      if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin' || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw fault('Open and approve this request on the trusted YNX Tools page.', 'tools_origin', 403);
      const body = await readBody(request, ['/runtime/native-tools/chain/compile', '/runtime/native-tools/chain/analyze'].includes(url.pathname) ? 512 * 1024 : 80 * 1024);
      // Receiving a body can outlive logout or an account change. Recheck at
      // dispatch, before consuming a review or sending selected context.
      const current = await coreService.authorizeConnection(request, sessionId);
      if (binding(current) !== bound || current.expiresAt <= now() || admission.expiresAt <= now())
        throw fault('Wallet session changed during review. Reopen the tools page.', 'tools_identity_changed', 401);
      const ticket = tickets.get(body.csrf);
      if (!ticket || ticket.expires <= now() || ticket.bound !== bound) throw fault('Review expired. Refresh the tools page.', 'tools_review_expired', 403);
      tickets.delete(body.csrf);
      if (['/runtime/native-tools/chain/compile', '/runtime/native-tools/chain/analyze'].includes(url.pathname)) {
        const analysis = url.pathname.endsWith('/analyze');
        const snapshot = Object.hasOwn(body, 'snapshot');
        exact(body, analysis ? ['csrf', 'snapshot'] : ['csrf', 'name', snapshot ? 'snapshot' : 'source']);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(2147483647, admission.expiresAt - now())));
        try {
          const result = await (analysis ? compiler.analyze({ owner: admission.context.owner, snapshot: body.snapshot, sessionId, signal: controller.signal }) : compiler.compile({ owner: admission.context.owner, name: body.name, ...(snapshot ? { snapshot: body.snapshot, sessionId } : { source: body.source }), signal: controller.signal }));
          const latest = await coreService.authorizeConnection(request, sessionId);
          if (controller.signal.aborted || binding(latest) !== bound || latest.expiresAt <= now() || admission.expiresAt <= now())
            throw fault('Wallet project changed during compilation. Build again from the current project.', 'tools_identity_changed', 401);
          json(response, result.status || (result.ok ? 200 : 503), { ...result, projectId: admission.context.projectId, signed: false, submitted: false });
        } finally { clearTimeout(timer); }
        return true;
      }
      const removeConversation = /^\/runtime\/native-tools\/ai\/conversations\/([a-f0-9-]{36})\/delete$/.exec(url.pathname);
      if (removeConversation) {
        exact(body, ['csrf']);
        if (!aiStore) throw fault('Saved AI requests are not configured for this workspace.', 'tools_ai_store_unavailable', 503);
        aiStore.remove(admission.context.owner, admission.context.projectId, removeConversation[1]);
        json(response, 200, { deleted: true }); return true;
      }
      if (url.pathname === '/runtime/native-tools/chain/contracts/call') {
        exact(body, ['csrf', 'address', 'function']);
        const forward = Readable.from([Buffer.from(JSON.stringify({ protocolVersion: 'ynx-code-chain/v1', address: body.address, function: body.function }))]);
        forward.method = 'POST'; forward.headers = request.headers; forward.url = '/runtime/chain/contracts/call'; admittedOwners.set(forward, admission.context.owner);
        try { await chainHandler(forward, response); } finally { admittedOwners.delete(forward); } return true;
      }
      if (url.pathname === '/runtime/native-tools/chain/rpc') {
        exact(body, ['csrf', 'method', 'params']);
        const forward = Readable.from([Buffer.from(JSON.stringify({ protocolVersion: 'ynx-code-chain/v1', method: body.method, params: body.params }))]);
        forward.method = 'POST'; forward.headers = request.headers; forward.url = '/runtime/chain/rpc'; admittedOwners.set(forward, admission.context.owner);
        try { await chainHandler(forward, response); } finally { admittedOwners.delete(forward); } return true;
      }
      if (url.pathname === '/runtime/native-tools/proposals') {
        const hasMode = Object.hasOwn(body || {}, 'mode');
        exact(body, ['csrf', 'prompt', 'context', ...(hasMode ? ['mode'] : [])]);
        if (hasMode && body.mode !== 'selected-edit') throw fault('Choose a supported review mode.', 'tools_schema', 400);
        if (typeof body.prompt !== 'string' || body.prompt.trim().length < 4 || Buffer.byteLength(body.prompt) > 4096 || typeof body.context !== 'string' || Buffer.byteLength(body.context) > 64 * 1024) throw fault('Keep the request within 4096 UTF-8 bytes and review a bounded selected context.', 'tools_context', 400);
        const selection = body.mode === 'selected-edit' ? reviewedSelection(body.context, sessionId) : null;
        const wirePrompt = reviewedHostedPrompt(selection ? EDIT_SYSTEM : AI_SYSTEM, selectedPrompt(body));
        const model = requireModel();
        const proposalId = token(proposals, { bound, expires, prompt: body.prompt, context: body.context, selection, model });
        const csrf = token(tickets, { bound, expires });
        json(response, 200, { proposalId, csrf, prompt: body.prompt, context: body.context, mode: selection ? 'selected-edit' : 'plan', contextBytes: Buffer.byteLength(body.context), wirePrompt, requestBytes: Buffer.byteLength(wirePrompt), model, expiresAt: expires }); return true;
      }
      if (url.pathname === '/runtime/native-tools/approve') {
        exact(body, ['csrf', 'proposalId', 'approval']);
        const proposal = proposals.get(body.proposalId);
        if (!proposal || proposal.bound !== bound || proposal.expires <= now() || body.approval !== 'send-reviewed-context-once') throw fault('The reviewed request is not available.', 'tools_proposal', 409);
        proposals.delete(body.proposalId); // One-use, including failures. Never auto-retry a model request.
        requireModel(proposal.model);
        if (!aiStore) throw fault('Saved AI requests are not configured for this workspace.', 'tools_ai_store_unavailable', 503);
        const conversation = aiStore.create({ owner: admission.context.owner, projectId: admission.context.projectId, prompt: proposal.prompt,
          context: proposal.selection ? JSON.stringify({ kind: SELECTION_KIND, context: proposal.context }) : proposal.context, model: proposal.model });
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(fault('Wallet session expired during generation.', 'tools_identity_changed', 401)), Math.max(1, admission.expiresAt - now()));
        const assertCurrent = async () => {
          requireModel(proposal.model);
          const current = await coreService.authorizeConnection(request, sessionId);
          if (binding(current) !== bound || current.expiresAt <= now() || admission.expiresAt <= now())
            throw fault('Wallet session changed during generation.', 'tools_identity_changed', 401);
          if (controller.signal.aborted) throw controller.signal.reason;
        };
        const disconnect = () => { if (!response.writableEnded) controller.abort(fault('The client stopped waiting for this request.', 'tools_request_cancelled', 499)); };
        response.once('close', disconnect);
        if (response.destroyed) disconnect();
        let checking = false;
        const check = setInterval(() => {
          if (checking || controller.signal.aborted) return;
          checking = true;
          void assertCurrent().catch(error => controller.abort(error)).finally(() => { checking = false; });
        }, 5000);
        try {
          const result = await waitForModel(() => modelRouter.generate({ ownerId: admission.context.owner, provider: 'ynx-hosted', model: proposal.model,
            hostedSession: conversation.id, prompt: selectedPrompt(proposal),
            system: proposal.selection ? EDIT_SYSTEM : AI_SYSTEM, maxOutputTokens: 2048, signal: controller.signal, assertCurrent }), controller.signal);
          await assertCurrent();
          if (result.model !== proposal.model) throw fault('The model response does not match the approved model. No edit was offered.', 'tools_model_response_mismatch', 502);
          const edit = proposal.selection ? reviewedReplacement(result.text, proposal.selection) : null;
          aiStore.complete(admission.context.owner, admission.context.projectId, conversation.id, { text: result.text, model: result.model });
          json(response, 200, { text: result.text, ...(edit ? { edit } : {}), model: result.model, conversationId: conversation.id, saved: true, applied: false, signed: false });
        } catch (error) {
          aiStore.fail(admission.context.owner, admission.context.projectId, conversation.id, { code: typeof error.code === 'string' && /^[a-z][a-z0-9_]{0,95}$/.test(error.code) ? error.code : 'model_request_failed' });
          if (error.code === 'provider_auth_failed') throw fault('The hosted model service is not authorized for this product yet.', 'tools_model_service_authorization', 503);
          throw error;
        } finally { clearTimeout(timer); clearInterval(check); response.removeListener('close', disconnect); } return true;
      }
      throw fault('This tool action is not supported.', 'tools_route', 405);
    } catch (error) { json(response, error.status || 503, { code: error.code || 'tools_unavailable', error: error.message || 'Tools are unavailable.' }); return true; }
  }
  return { handler };
}
function exact(body, keys) { if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join() !== keys.sort().join()) throw fault('Unexpected tool request fields.', 'tools_schema', 400); }
async function readBody(request, limit = 80 * 1024) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > limit) throw fault('The tool request body exceeds its size limit.', 'tools_body_limit', 413); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks)); } catch { throw fault('Tool request must be JSON.', 'tools_json', 400); } }
function json(response, status, value) { if (response.destroyed || response.writableEnded) return; response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' }); response.end(JSON.stringify(value)); }
// Stop the HTTP wait even if an injected provider ignores its cancellation.
// The router still owns its real running slot until the provider actually ends.
function waitForModel(start, signal) {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(typeof signal.reason?.code === 'string' && Number.isInteger(signal.reason.status) ? signal.reason : fault('Wallet session ended during generation.', 'tools_identity_changed', 401));
    if (signal.aborted) { cancelled(); return; }
    signal.addEventListener('abort', cancelled, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw signal.reason; return start(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled));
  });
}
