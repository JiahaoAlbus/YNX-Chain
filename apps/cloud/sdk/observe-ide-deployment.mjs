import { YNXCloudClient } from './index.js';

const bindingKeys = ['projectId', 'version', 'contentDigest', 'publishPurpose', 'targetEnvironment', 'byteSize'];
const identityKeys = ['manifestSHA256', 'approvalSHA256', 'publisherId', 'resourceId'];

export class YNXCloudObservationError extends Error {
  constructor(message, requestId, lastObservation, cause) {
    super(message, { cause });
    this.name = 'YNXCloudObservationError';
    this.operationRequestId = requestId;
    this.lastObservation = lastObservation;
    // Observation cancellation never means the original deployment failed.
    this.state = lastObservation?.operation?.state ?? 'unknown';
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    timer = setTimeout(done, ms);
  });
}

function expectedSnapshot(expected) {
  if (!expected || typeof expected !== 'object' || !expected.binding) throw new TypeError('Original deployment selection required');
  const result = { binding: {} };
  for (const key of bindingKeys) {
    const value = expected.binding[key];
    if (key === 'byteSize' ? !Number.isSafeInteger(value) || value < 1 || value > 64 * 1024 * 1024 : typeof value !== 'string' || !value || value.length > 256) {
      throw new TypeError(`Invalid original binding ${key}`);
    }
    result.binding[key] = value;
  }
  for (const key of identityKeys) {
    const value = expected[key];
    if (typeof value !== 'string' || !value || value.length > 256) throw new TypeError(`Original ${key} required`);
    result[key] = value;
  }
  for (const digest of [result.binding.contentDigest, result.manifestSHA256, result.approvalSHA256]) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('Original SHA256 binding required');
  }
  return result;
}

// This is a consumer of original decisions, NOT a signer/verifier or grant
// producer. The IDE persists its original request before dispatch and supplies
// pins from the independently verified artifact and actual resource approval.
// No method in this module can submit, retry, approve or cancel a deployment.
export async function observeIDEDeployment(client, options) {
  if (!(client instanceof YNXCloudClient)) throw new TypeError('Original YNX Cloud client required');
  const { requestId, signal, maxObservations = 30, intervalMs = 1000, timeoutMs = 60000, until = 'running-or-terminal' } = options ?? {};
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new TypeError('Original operation request ID required');
  if (!Number.isInteger(maxObservations) || maxObservations < 1 || maxObservations > 120 || !Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 10000 || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000 || !['running-or-terminal', 'terminal'].includes(until)) {
    throw new TypeError('Bounded observation policy required');
  }
  const expected = expectedSnapshot(options.expected);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => controller.abort(new DOMException('Deployment observation deadline exceeded', 'TimeoutError')), timeoutMs);
  let last = null;
  try {
    for (let count = 0; count < maxObservations; count++) {
      controller.signal.throwIfAborted();
      // The original client obtains fresh proof headers for every GET. Never
      // cache the earlier POST's credentials or reopen its approval bytes.
      const operation = await client.getIDEDeploymentStatus(requestId, { signal: controller.signal });
      if (operation.requestId !== requestId || bindingKeys.some(key => operation.binding?.[key] !== expected.binding[key]) || identityKeys.some(key => operation[key] !== expected[key])) {
        throw new Error('Original deployment selection changed during observation');
      }
      const previous = last?.operation;
      if (previous && ((['completed', 'failed'].includes(previous.state) && operation.state !== previous.state) || (previous.state === 'running' && operation.state === 'unknown') || (previous.deploymentId && operation.deploymentId !== previous.deploymentId))) {
        throw new Error('Original deployment lifecycle regressed or changed resource instance');
      }
      last = { operation, logs: null, observationCount: count + 1 };
      if (operation.state !== 'unknown') {
        const logs = await client.getIDEDeploymentLogs(requestId, { signal: controller.signal });
        if (logs.requestId !== requestId || logs.runtimeLogSource !== 'original-resource') throw new Error('Original resource logs required');
        last.logs = logs;
      }
      controller.signal.throwIfAborted();
      if (operation.state === 'completed' || operation.state === 'failed' || (operation.state === 'running' && until === 'running-or-terminal')) return last;
      if (count + 1 < maxObservations) await sleep(intervalMs, controller.signal);
    }
    return last;
  } catch (cause) {
    throw new YNXCloudObservationError('Original deployment observation incomplete; query the same request only', requestId, last, cause);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
