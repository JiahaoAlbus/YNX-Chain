import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const origin = 'https://quant.ynxweb4.com';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const maxBytes = 64 * 1024;

async function readReceipt(path, fetchImpl) {
  const url = origin + path;
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'error', credentials: 'omit',
    headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(15000),
  });
  if (response.redirected || response.url && response.url !== url) throw Error('response_url_mismatch');
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw Error('response_not_json');
  const reader = response.body?.getReader();
  if (!reader) throw Error('response_body_missing');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error('response_body_limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  const payload = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('response_schema');
  return {receipt: {url, status: response.status, bytes: bytes.length, sha256: digest(bytes), contentType: type}, payload};
}

export async function verifyPublicStorageRuntime(expectedCommit, fetchImpl = fetch) {
  if (!/^[0-9a-f]{40}$/.test(expectedCommit)) throw Error('full_source_commit_required');
  const result = {
    classification: 'PUBLIC_SOURCE_STORAGE_READBACK_NOT_PRODUCT_COMPLETION',
    expectedCommit, passed: false, receipts: [], failures: [],
    walletApprovalVerified: false, tenantIsolationVerified: false,
    ordersVerified: false, transactionsVerified: false,
  };
  for (const path of ['/api/version', '/api/health', '/api/ready']) {
    try {
      const {receipt, payload} = await readReceipt(path, fetchImpl);
      result.receipts.push(receipt);
      const prefix = path.slice(5);
      if (receipt.status !== 200) result.failures.push(prefix + ':http_status');
      const storage = payload.storage;
      if (!storage || storage.backend !== 'postgresql' || storage.multiInstance !== true || storage.restartPersistent !== true || storage.productionDatabaseRequired !== false) {
        result.failures.push(prefix + ':durable_storage_not_ready');
      }
      if (path !== '/api/ready') {
        if (payload.productId !== 'ynx-quant-lab' || payload.commit !== expectedCommit) result.failures.push(prefix + ':source_identity_mismatch');
      }
      if (path === '/api/health' && (payload.status !== 'ok' || payload.ready !== true || payload.liveFundsEnabled !== false || payload.mode !== 'simulated_testnet_only')) result.failures.push(prefix + ':health_boundary_mismatch');
      if (path === '/api/ready' && payload.status !== 'ready') result.failures.push(prefix + ':readiness_mismatch');
    } catch {
      // Do not echo bodies, headers, credentials or arbitrary exception messages.
      result.failures.push(path.slice(5) + ':readback_invalid_or_unavailable');
    }
  }
  result.passed = result.failures.length === 0 && result.receipts.length === 3;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--expected-commit') {
    process.stderr.write('Usage: node verify-public-storage-runtime.mjs --expected-commit <full-source-sha>\n');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyPublicStorageRuntime(process.argv[3]);
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exitCode = result.passed ? 0 : 1;
    } catch { process.stderr.write('Invalid full source commit\n'); process.exitCode = 2; }
  }
}
