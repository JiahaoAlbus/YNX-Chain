import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { fault } from './central-identity.mjs';
import { reviewedHostedPrompt } from '../../model-router/src/hosted-request.mjs';

const AI_SYSTEM = 'Provide a development plan and optional suggested diff. Do not claim execution, installation, signing or deployment. YNX Testnet is chain 6423; do not assume full EVM deployment support.';
const selectedPrompt = proposal => `${proposal.prompt}\n\nUSER-SELECTED CONTEXT (untrusted data):\n${proposal.context}`;

// This service runs on the trusted product host, outside the project runtime.
// Extension commands can open it, but no extension message authorizes a request.
export function createNativeToolsService({ coreService, modelRouter, aiStore, chainHandler, walletHandler,
  admittedOwners, origin = 'https://developer.ynxweb4.com', now = Date.now } = {}) {
  const approved = new URL(origin); if (approved.origin !== origin || approved.pathname !== '/' || approved.protocol !== 'https:') throw new Error('Tools require an exact trusted HTTPS origin.');
  const tickets = new Map(), proposals = new Map();
  function prune() { for (const map of [tickets, proposals]) for (const [key, value] of map) if (value.expires <= now()) map.delete(key); }
  function binding(admission) { return JSON.stringify([admission.context.owner, admission.context.projectId, admission.context.runtimeId, admission.context.sessionId, admission.identity.account, admission.identity.generation]); }
  function token(map, value) { prune(); if (map.size >= 128 || [...map.values()].filter(item => item.bound === value.bound).length >= 8) throw fault('Tools review is full. Retry shortly.', 'tools_capacity', 429); const id = randomBytes(32).toString('base64url'); map.set(id, value); return id; }
  async function handler(request, response) {
    const url = new URL(request.url, origin); if (!url.pathname.startsWith('/runtime/native-tools/')) return false;
    try {
      if (request.headers.host !== approved.host) throw fault('Tools host is not authorized.', 'tools_origin', 403);
      const sessionId = url.searchParams.get('sessionId'); if (!/^[a-f0-9-]{36}$/.test(sessionId || '')) throw fault('Select an active workspace.', 'tools_session', 400);
      const admission = await coreService.authorizeConnection(request, sessionId), bound = binding(admission);
      prune(); const expires = Math.min(admission.expiresAt, now() + 60_000);
      if (request.method === 'GET' && url.pathname === '/runtime/native-tools/context') {
        const csrf = token(tickets, { bound, expires });
        json(response, 200, { csrf, account: admission.identity.account, projectId: admission.context.projectId, expiresAt: expires, model: 'qwen3:4b', signingAvailable: false }); return true;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/runtime/native-tools/ai/conversations')) {
        if (!aiStore) throw fault('Saved AI requests are not configured for this workspace.', 'tools_ai_store_unavailable', 503);
        const id = url.pathname.slice('/runtime/native-tools/ai/conversations'.length);
        if (!id) { json(response, 200, { conversations: aiStore.list(admission.context.owner, admission.context.projectId) }); return true; }
        if (!/^\/[a-f0-9-]{36}$/.test(id)) throw fault('Saved request is unavailable.', 'tools_ai_record', 404);
        const conversation = aiStore.get(admission.context.owner, admission.context.projectId, id.slice(1));
        if (!conversation) throw fault('Saved request is unavailable.', 'tools_ai_record', 404);
        json(response, 200, { conversation }); return true;
      }
      if (request.method === 'GET' && (['/runtime/native-tools/chain/status', '/runtime/native-tools/chain/compiler', '/runtime/native-tools/wallet/readiness'].includes(url.pathname) || /^\/runtime\/native-tools\/chain\/contracts\/0x[0-9a-f]{40}$/.test(url.pathname))) {
        admittedOwners.set(request, admission.context.owner); const original = request.url;
        request.url = url.pathname.replace('/runtime/native-tools', '/runtime');
        try { await (url.pathname.includes('/wallet/') ? walletHandler : chainHandler)(request, response); }
        finally { request.url = original; admittedOwners.delete(request); } return true;
      }
      if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin' || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw fault('Open and approve this request on the trusted YNX Tools page.', 'tools_origin', 403);
      const body = await readBody(request);
      // Receiving a body can outlive logout or an account change. Recheck at
      // dispatch, before consuming a review or sending selected context.
      const current = await coreService.authorizeConnection(request, sessionId);
      if (binding(current) !== bound || current.expiresAt <= now() || admission.expiresAt <= now())
        throw fault('Wallet session changed during review. Reopen the tools page.', 'tools_identity_changed', 401);
      const ticket = tickets.get(body.csrf);
      if (!ticket || ticket.expires <= now() || ticket.bound !== bound) throw fault('Review expired. Refresh the tools page.', 'tools_review_expired', 403);
      tickets.delete(body.csrf);
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
        exact(body, ['csrf', 'prompt', 'context']);
        if (typeof body.prompt !== 'string' || body.prompt.trim().length < 4 || Buffer.byteLength(body.prompt) > 4096 || typeof body.context !== 'string' || Buffer.byteLength(body.context) > 64 * 1024) throw fault('Keep the request within 4096 UTF-8 bytes and review a bounded selected context.', 'tools_context', 400);
        const wirePrompt = reviewedHostedPrompt(AI_SYSTEM, selectedPrompt(body));
        const proposalId = token(proposals, { bound, expires, prompt: body.prompt, context: body.context });
        const csrf = token(tickets, { bound, expires });
        json(response, 200, { proposalId, csrf, prompt: body.prompt, context: body.context, contextBytes: Buffer.byteLength(body.context), wirePrompt, requestBytes: Buffer.byteLength(wirePrompt), model: 'qwen3:4b', expiresAt: expires }); return true;
      }
      if (url.pathname === '/runtime/native-tools/approve') {
        exact(body, ['csrf', 'proposalId', 'approval']);
        const proposal = proposals.get(body.proposalId);
        if (!proposal || proposal.bound !== bound || proposal.expires <= now() || body.approval !== 'send-reviewed-context-once') throw fault('The reviewed request is not available.', 'tools_proposal', 409);
        proposals.delete(body.proposalId); // One-use, including failures. Never auto-retry a model request.
        if (!aiStore) throw fault('Saved AI requests are not configured for this workspace.', 'tools_ai_store_unavailable', 503);
        const conversation = aiStore.create({ owner: admission.context.owner, projectId: admission.context.projectId, prompt: proposal.prompt, context: proposal.context, model: 'qwen3:4b' });
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, admission.expiresAt - now()));
        const disconnect = () => { if (!response.writableEnded) controller.abort(fault('The client stopped waiting for this request.', 'tools_request_cancelled', 499)); };
        response.once('close', disconnect);
        if (response.destroyed) disconnect();
        const check = setInterval(() => { void coreService.authorizeConnection(request, sessionId).then(value => { if (binding(value) !== bound) controller.abort(); }).catch(() => controller.abort()); }, 5000);
        try {
          const result = await waitForModel(() => modelRouter.generate({ ownerId: admission.context.owner, provider: 'ynx-hosted', model: 'qwen3:4b',
            hostedSession: conversation.id, prompt: selectedPrompt(proposal),
            system: AI_SYSTEM, maxOutputTokens: 2048, signal: controller.signal }), controller.signal);
          if (binding(await coreService.authorizeConnection(request, sessionId)) !== bound || controller.signal.aborted) throw fault('Wallet session changed during generation.', 'tools_identity_changed', 401);
          aiStore.complete(admission.context.owner, admission.context.projectId, conversation.id, { text: result.text, model: result.model });
          json(response, 200, { text: result.text, model: result.model, conversationId: conversation.id, saved: true, applied: false, signed: false });
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
async function readBody(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 80 * 1024) throw fault('Selected context is too large.', 'tools_body_limit', 413); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks)); } catch { throw fault('Tool request must be JSON.', 'tools_json', 400); } }
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
