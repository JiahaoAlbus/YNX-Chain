// Exercise real Faucet + Core processes. This creates bounded testnet funding.
// No forwarded IP headers, quota overrides, user keys or existing recipients.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export async function exerciseFaucet({ endpoint, coreEndpoint, count = 10, publicTestnet = false, output, waitMs = 120_000 }) {
  const faucet = target(endpoint, publicTestnet), core = target(coreEndpoint, publicTestnet);
  if (!Number.isInteger(count) || count < 2 || count > (publicTestnet ? 10 : 50)) throw new Error('Use 2–50 local recipients, or at most 10 explicitly selected public testnet recipients');
  if (!Number.isInteger(waitMs) || waitMs < 1000 || waitMs > 180_000) throw new Error('Wait bound must be 1–180 seconds');
  if (!output) throw new Error('An exclusive output journal is required');
  const file = path.resolve(output);
  const fd = fs.openSync(file, 'wx', 0o600);
  const record = { schemaVersion: 1, startedAt: new Date().toISOString(), endpoint: faucet, coreEndpoint: core, count, publicTestnet,
    scope: 'Real HTTP claims from one client IP; duplicate request IDs, dropped-response recovery, per-address balances and quota isolation. Not wallet signing, global availability or consensus-finality proof.',
    completed: false, requests: [], recipients: [] };
  const save = () => { fs.ftruncateSync(fd, 0); fs.writeSync(fd, JSON.stringify(record, null, 2) + '\n', 0, 'utf8'); fs.fsyncSync(fd); };
  const http = async (base, route, init = {}) => {
    const started = performance.now();
    let response;
    try {
      response = await fetch(base + route, { ...init, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json', ...init.headers } });
      const text = await response.text();
      if (text.length > 1_048_576) throw new Error('Oversized response');
      let body; try { body = JSON.parse(text); } catch { body = null; }
      record.requests.push({ method: init.method ?? 'GET', route, status: response.status, elapsedMs: performance.now() - started });
      return { status: response.status, body };
    } catch (error) {
      record.requests.push({ method: init.method ?? 'GET', route, status: null, elapsedMs: performance.now() - started, error: error.name });
      return { status: null, body: null };
    }
  };
  try {
    save();
    const health = await http(faucet, '/health');
    assert.equal(health.status, 200, 'Faucet health');
    assert.equal(health.body?.chainId, 6423, 'Only YNX Testnet 6423 may be exercised');
    assert.equal(health.body?.idempotentRequests, true, 'Durable request-ID support is mandatory');
    assert.equal(health.body?.fundingReady, true, 'Funding must be ready');
    assert.equal(health.body?.requestStatusPath, '/request-status', 'Expected read-only reconciliation route');
    const amount = health.body.defaultAmount;
    assert.ok(Number.isSafeInteger(amount) && amount > 0 && amount <= 100, 'Bound test funding to at most 100 tokens per recipient');
    const coreHealth = await http(core, '/health');
    assert.equal(coreHealth.status, 200, 'Core health');
    assert.equal(coreHealth.body?.network?.chainId, 6423, 'Core must be the same testnet');
    const runID = randomBytes(16).toString('hex');
    record.amountPerRecipient = amount;
    record.maximumNewFunding = amount * count;
    for (let index = 0; index < count; index++) record.recipients.push({ address: '0x' + randomBytes(20).toString('hex'), requestId: `faucet_http_${runID}_${String(index).padStart(4, '0')}` });
    // Persist all intents before the first mutating request; an interrupted run
    // can be reconciled using these same IDs without inventing new funding.
    for (const recipient of record.recipients) {
      const before = await http(core, `/accounts/${recipient.address}`);
      assert.ok(before.status === 404 || before.status === 200 && BigInt(before.body.account.balance) === 0n, 'Recipient must be unused');
    }
    save();
    const started = performance.now();
    const results = await Promise.allSettled(record.recipients.map(async recipient => {
      const began = performance.now();
      const submit = () => http(faucet, '/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: recipient.address, amount, requestId: recipient.requestId }) });
      // Two simultaneous transport requests, one business intent. The first
      // response is intentionally discarded, modeling a client that loses ACK.
      const responses = await Promise.all([submit(), submit()]);
      recipient.submissionStatuses = responses.map(response => response.status);
      recipient.firstResponseDiscarded = true;
      const deadline = Date.now() + waitMs;
      let recovered;
      while (Date.now() < deadline) {
        const current = await http(faucet, `/request-status?requestId=${encodeURIComponent(recipient.requestId)}`);
        if (current.status === 200 && current.body?.status === 'accepted') { recovered = current.body; break; }
        assert.ok([202, 503, null].includes(current.status), `Status lookup rejected admitted intent: ${current.status}`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.ok(recovered, 'Original receipt must become recoverable without another POST');
      assert.equal(recovered.requestId, recipient.requestId);
      assert.equal(recovered.address, recipient.address);
      assert.equal(recovered.amount, amount);
      assert.equal(recovered.transaction?.to, recipient.address);
      assert.equal(recovered.transaction?.amount, amount);
      assert.match(recovered.transactionHash, /^0x[0-9a-f]{64}$/);
      assert.equal(recovered.transaction.hash, recovered.transactionHash);
      recipient.transactionHash = recovered.transactionHash;
      const after = await http(core, `/accounts/${recipient.address}`);
      assert.equal(after.status, 200);
      assert.equal(BigInt(after.body.account.balance), BigInt(amount), 'Duplicate requests must fund once');
      recipient.balance = String(after.body.account.balance);
      recipient.elapsedMs = performance.now() - began;
    }));
    record.elapsedMs = performance.now() - started;
    record.failures = results.flatMap((result, index) => result.status === 'rejected' ? [{ requestId: record.recipients[index].requestId, error: String(result.reason.message) }] : []);
    if (record.failures.length) throw new Error(`${record.failures.length} concurrent recipient(s) failed; inspect the journal, do not run new intents blindly`);
    assert.equal(new Set(record.recipients.map(item => item.transactionHash)).size, count, 'Each recipient must have a distinct transaction');
    // A NEW intent for an already funded address must still be rate limited,
    // even though its earlier same-ID duplicates were allowed to reconcile.
    const first = record.recipients[0];
    const blocked = await http(faucet, '/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: first.address, amount, requestId: `quota_check_${runID}_0000` }) });
    assert.equal(blocked.status, 429, 'Address quota survives other users and duplicate requests');
    const unchanged = await http(core, `/accounts/${first.address}`);
    assert.equal(unchanged.status, 200);
    assert.equal(BigInt(unchanged.body.account.balance), BigInt(amount));
    const latencies = record.recipients.map(item => item.elapsedMs).sort((a, b) => a - b);
    const percentile = p => latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)];
    record.latencyMs = { p50: percentile(0.5), p95: percentile(0.95), max: latencies.at(-1) };
    record.completed = true;
    record.completedAt = new Date().toISOString();
    save();
    return { completed: true, count, amount, elapsedMs: record.elapsedMs, latencyMs: record.latencyMs, journal: file };
  } catch (error) {
    record.error = error.message;
    save();
    throw error;
  } finally { fs.closeSync(fd); }
}

function target(value, allowPublic) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an origin without credentials or path');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && (!allowPublic || url.protocol !== 'https:')) throw new Error('Public requests require --public-testnet and HTTPS');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
  return url.origin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--public-testnet') { options.publicTestnet = true; continue; }
    if (!['--endpoint', '--core', '--count', '--output', '--wait-ms'].includes(key) || !args[index + 1]) throw new Error('Usage: --endpoint <origin> --core <origin> --count <2–50> --output <new-journal.json> [--public-testnet] [--wait-ms <1000–180000>]');
    const value = args[++index];
    options[({ '--endpoint': 'endpoint', '--core': 'coreEndpoint', '--count': 'count', '--output': 'output', '--wait-ms': 'waitMs' })[key]] = ['--count', '--wait-ms'].includes(key) ? Number(value) : value;
  }
  console.log(JSON.stringify(await exerciseFaucet(options), null, 2));
}
