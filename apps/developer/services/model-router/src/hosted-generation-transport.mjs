import { existingHostedRequest } from './hosted-request.mjs';
import { readHostedCompletion } from './hosted-completion.mjs';
const refused = () => Object.assign(new Error('Original hosted generation/project authorization has not been supplied.'), { code: 'model_supply_not_supplied', status: 503 });
// Supplier closure belongs to the original service owner; input flags cannot grant it.
export function createHostedGenerationTransport({ getSupply = () => null } = {}) {
  return Object.freeze({
    configured() { return typeof getSupply()?.openGeneration === 'function'; },
    async generate(input) {
      let timer;
      try {
      const supply = getSupply();
      if (typeof supply?.openGeneration !== 'function' || !input.hostedSession || !input.projectBinding) throw refused();
      const { ownerId, projectId, sessionId, generation, identityReference } = input.projectBinding;
      if ([ownerId, projectId, sessionId, identityReference].some(value => typeof value !== 'string' || !value || value.length > 256)) throw refused();
      const binding = Object.freeze({ ownerId, projectId, sessionId, generation, identityReference, conversationId: input.hostedSession, scope: 'ai:generate' });
      if (binding.ownerId !== input.ownerId || !binding.projectId || !binding.sessionId || !(Number.isSafeInteger(binding.generation) && binding.generation >= 0) || !binding.identityReference) throw refused();
      const body = existingHostedRequest(input), deadline = new AbortController();
      const signal = input.signal ? AbortSignal.any([input.signal, deadline.signal]) : deadline.signal;
      let expiresAt = Date.now() + Math.min(input.generationTimeoutMs || 180000, 180000);
      timer = setTimeout(() => deadline.abort(), Math.max(1, expiresAt - Date.now()));
      timer.unref?.();
      signal?.throwIfAborted();
      await input.assertCurrent?.();
      const lease = await supply.openGeneration(binding, { signal });
      if (typeof lease?.assertCurrent !== 'function' || typeof lease.request !== 'function') { try { lease?.close?.(); } catch {} throw refused(); }
      async function current() {
        signal?.throwIfAborted();
        await input.assertCurrent?.();
        const value = await lease.assertCurrent(binding, { signal });
        if (value?.scope !== 'ai:generate' || value.ownerId !== binding.ownerId || value.projectId !== binding.projectId || value.sessionId !== binding.sessionId ||
          value.generation !== binding.generation || value.identityReference !== binding.identityReference || value.conversationId !== binding.conversationId ||
          !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) throw refused();
        expiresAt = Math.min(expiresAt, value.expiresAt);
        if (expiresAt <= Date.now()) throw refused();
        clearTimeout(timer);
        timer = setTimeout(() => deadline.abort(), Math.max(1, expiresAt - Date.now()));
        timer.unref?.();
        signal?.throwIfAborted();
      }
      try {
        await current();
        input.onDispatch?.();
        // Durable dispatch bookkeeping can outlast the grant while timers are queued.
        // Keep this final fence synchronous and use the original, tightened deadline.
        signal.throwIfAborted();
        if (expiresAt <= Date.now()) throw refused();
        const response = await lease.request(Object.freeze({ method: 'POST', path: '/ai/stream', body }), { signal });
        if (!response?.ok) throw Object.assign(new Error('Hosted generation service rejected the request.'), { code: 'model_upstream_failed', status: 502 });
        const result = await readHostedCompletion(response, { signal, callerSignal: input.signal, sessionId: input.hostedSession, onOperation: input.onOperation });
        await current();
        if (result.model !== input.model) throw Object.assign(new Error('Hosted model differs from the reviewed selection.'), { code: 'model_response_mismatch', status: 502 });
        return result;
      } finally { clearTimeout(timer); try { lease.close?.(); } catch {} }
      } catch (error) {
        if (input.signal?.aborted) throw Object.assign(new Error('Stopped waiting; remote cancellation is not confirmed.', { cause: error }), { code: 'model_request_cancelled', status: 499 });
        const messages = { model_supply_not_supplied: ['Original generation/project authorization is unavailable.', 503], model_timeout: ['Hosted generation timed out.', 504], model_stream_invalid: ['Hosted generation stream is invalid.', 502], model_receipt_invalid: ['Hosted generation receipt is invalid.', 502], model_response_mismatch: ['Hosted model differs from the reviewed selection.', 502], model_prompt_limit: ['Reviewed prompt exceeds the service limit.', 413], model_context_limit: ['Selected context exceeds the service limit.', 413] };
        const code = Object.hasOwn(messages, error?.code) ? error.code : 'provider_unavailable';
        const [message, status] = messages[code] || ['Hosted generation service is unavailable; remote outcome may be UNKNOWN.', 503];
        throw Object.assign(new Error(message, { cause: error }), { code, status });
      } finally { clearTimeout(timer); }
    },
  });
}
