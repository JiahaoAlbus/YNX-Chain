import { createModelRouter, validateRequest } from '../src/router.mjs';
import { createFairQueue } from '../src/fair-queue.mjs';
import { existingHostedRequest } from '../src/hosted-request.mjs';
import { readHostedCompletion } from '../src/hosted-completion.mjs';

export const streamText = text => `event: metadata\ndata: {"requestId":"qa-request","sessionId":"qa-session"}\n\nevent: token\ndata: ${JSON.stringify({text})}\n\nevent: done\ndata: {"requestId":"qa-request"}\n\n`;
export const streamResponse = text => new Response(streamText(text), { headers: { "content-type": "text/event-stream", "x-ynx-ai-model": "qwen3:4b" } });

// Independent test supply, never imported by product code. The normal router
// is deliberately closed while the producer generation authority is absent.
// This fixture exercises the real queue, request validator and supplied-response
// parser without pretending to furnish the missing production permission.
export function createMockHostedRouter(options = {}) {
  const real = createModelRouter(options), timeoutMs = options.timeoutMs || 180000;
  const queue = createFairQueue({ maxConcurrent: options.maxConcurrent || 4, maxQueued: options.maxQueued ?? 64,
    maxPerOwner: options.maxPerOwner || 1, maxQueuedPerOwner: options.maxQueuedPerOwner || 8,
    maxHostedConcurrent: options.maxHostedConcurrent || Math.min(2, options.maxConcurrent || 4),
    queueTimeoutMs: options.queueTimeoutMs || 60000, async run(input) {
      await input.assertCurrent?.();
      if (input.provider !== 'ynx-hosted') return real.generate(input);
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const body = input.hostedSession ? existingHostedRequest(input) : { prompt: `${input.system}\n\n${input.prompt}`, outputLanguage: input.outputLanguage, attachments: [], maxOutputTokens: input.maxOutputTokens };
      if (signal.aborted) throw Object.assign(new Error('Mock wait cancelled'), { code: 'model_request_cancelled', status: 499 });
      input.onDispatch?.();
      let response;
      try { response = await (options.fetchImpl || globalThis.fetch)(`${(options.hostedBaseURL || 'http://127.0.0.1:18111/ai-build').replace(/\/$/, '')}/ai/stream`, { method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify(body), signal }); }
      catch (error) { throw Object.assign(new Error('Mock supply wait ended'), { code: input.signal?.aborted ? 'model_request_cancelled' : 'model_timeout', status: input.signal?.aborted ? 499 : 504 }); }
      return { protocolVersion: 'ynx-code-model-router/v1', provider: 'ynx-hosted', credentialPersisted: false,
        ...await readHostedCompletion(response, { signal, callerSignal: input.signal, sessionId: input.hostedSession, onOperation: input.onOperation }) };
    } });
  return { ...real, catalog: () => ({ ...real.catalog(), ...queue.state() }), generate(request) {
    const input = validateRequest(request);
    if (options.ownerForRequest && !input.ownerId) throw Object.assign(new Error('Mock owner required'), { code: 'model_owner_required', status: 401 });
    return queue.schedule({ ...input, ownerId: input.ownerId || 'internal' });
  } };
}
