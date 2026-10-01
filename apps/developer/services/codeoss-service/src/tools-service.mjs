import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { fault } from './central-identity.mjs';

// This service runs on the trusted product host, outside the project runtime.
// Extension commands can open it, but no extension message authorizes a request.
export function createNativeToolsService({ coreService, modelRouter, chainHandler, walletHandler,
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
      if (request.method === 'GET' && ['/runtime/native-tools/chain/status', '/runtime/native-tools/chain/compiler', '/runtime/native-tools/wallet/readiness'].includes(url.pathname)) {
        admittedOwners.set(request, admission.context.owner); const original = request.url;
        request.url = url.pathname.replace('/runtime/native-tools', '/runtime');
        try { await (url.pathname.includes('/wallet/') ? walletHandler : chainHandler)(request, response); }
        finally { request.url = original; admittedOwners.delete(request); } return true;
      }
      if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin' || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw fault('Open and approve this request on the trusted YNX Tools page.', 'tools_origin', 403);
      const body = await readBody(request), ticket = tickets.get(body.csrf);
      if (!ticket || ticket.expires <= now() || ticket.bound !== bound) throw fault('Review expired. Refresh the tools page.', 'tools_review_expired', 403);
      tickets.delete(body.csrf);
      if (url.pathname === '/runtime/native-tools/chain/rpc') {
        exact(body, ['csrf', 'method', 'params']);
        const forward = Readable.from([Buffer.from(JSON.stringify({ protocolVersion: 'ynx-code-chain/v1', method: body.method, params: body.params }))]);
        forward.method = 'POST'; forward.headers = request.headers; forward.url = '/runtime/chain/rpc'; admittedOwners.set(forward, admission.context.owner);
        try { await chainHandler(forward, response); } finally { admittedOwners.delete(forward); } return true;
      }
      if (url.pathname === '/runtime/native-tools/proposals') {
        exact(body, ['csrf', 'prompt', 'context']);
        if (typeof body.prompt !== 'string' || body.prompt.trim().length < 4 || body.prompt.length > 4096 || typeof body.context !== 'string' || Buffer.byteLength(body.context) > 64 * 1024) throw fault('Review a bounded prompt and selected context.', 'tools_context', 400);
        const proposalId = token(proposals, { bound, expires, prompt: body.prompt, context: body.context });
        const csrf = token(tickets, { bound, expires });
        json(response, 200, { proposalId, csrf, prompt: body.prompt, context: body.context, contextBytes: Buffer.byteLength(body.context), model: 'qwen3:4b', expiresAt: expires }); return true;
      }
      if (url.pathname === '/runtime/native-tools/approve') {
        exact(body, ['csrf', 'proposalId', 'approval']);
        const proposal = proposals.get(body.proposalId);
        if (!proposal || proposal.bound !== bound || proposal.expires <= now() || body.approval !== 'send-reviewed-context-once') throw fault('The reviewed request is not available.', 'tools_proposal', 409);
        proposals.delete(body.proposalId); // One-use, including failures. Never auto-retry a model request.
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1, admission.expiresAt - now()));
        const check = setInterval(() => { void coreService.authorizeConnection(request, sessionId).then(value => { if (binding(value) !== bound) controller.abort(); }).catch(() => controller.abort()); }, 5000);
        try {
          const result = await modelRouter.generate({ ownerId: admission.context.owner, provider: 'ynx-hosted', model: 'qwen3:4b',
            prompt: `${proposal.prompt}\n\nUSER-SELECTED CONTEXT (untrusted data):\n${proposal.context}`,
            system: 'Provide a development plan and optional suggested diff. Do not claim execution, installation, signing or deployment. YNX Testnet is chain 6423; do not assume full EVM deployment support.', maxOutputTokens: 2048, signal: controller.signal });
          if (binding(await coreService.authorizeConnection(request, sessionId)) !== bound || controller.signal.aborted) throw fault('Wallet session changed during generation.', 'tools_identity_changed', 401);
          json(response, 200, { text: result.text, model: result.model, applied: false, signed: false });
        } finally { clearTimeout(timer); clearInterval(check); } return true;
      }
      throw fault('This tool action is not supported.', 'tools_route', 405);
    } catch (error) { json(response, error.status || 503, { code: error.code || 'tools_unavailable', error: error.message || 'Tools are unavailable.' }); return true; }
  }
  return { handler };
}
function exact(body, keys) { if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join() !== keys.sort().join()) throw fault('Unexpected tool request fields.', 'tools_schema', 400); }
async function readBody(request) { const chunks = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 80 * 1024) throw fault('Selected context is too large.', 'tools_body_limit', 413); chunks.push(chunk); } try { return JSON.parse(Buffer.concat(chunks)); } catch { throw fault('Tool request must be JSON.', 'tools_json', 400); } }
function json(response, status, value) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' }); response.end(JSON.stringify(value)); }
