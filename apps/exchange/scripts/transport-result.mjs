import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// A local diagnostic boundary, not deployment authority. Never retry, expose
// argv/key paths, or infer remote absence from a timeout/empty output. The caller
// supplies an already frozen invocation and validates its expected receipt.
export function invokeOnce({ executable, argv, input, timeoutMs, validateReceipt }, spawn = spawnSync) {
  if (!executable?.startsWith('/') || !Array.isArray(argv) || !argv.every(x => typeof x === 'string') ||
      !Buffer.isBuffer(input) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000 ||
      typeof validateReceipt !== 'function') throw new Error('INVALID_FROZEN_TRANSPORT_INPUT');
  const result = spawn(executable, argv, { input, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
  const stdout = Buffer.from(result.stdout ?? []);
  const stderr = Buffer.from(result.stderr ?? []);
  let validated = false;
  if (result.status === 0 && !result.signal && !result.error && stdout.length) {
    try { validated = validateReceipt(stdout) === true; } catch { /* fail closed */ }
  }
  const receipt = {
    schema: 'ynx.exchange.local-transport-result/v1',
    attemptCount: 1,
    processExitStatus: Number.isInteger(result.status) ? result.status : null,
    processSignal: typeof result.signal === 'string' ? result.signal : null,
    processErrorCode: typeof result.error?.code === 'string' ? result.error.code : null,
    stdout: { bytes: stdout.length, sha256: digest(stdout) },
    stderr: { bytes: stderr.length, sha256: digest(stderr) },
    terminalReceiptValidated: validated,
    outcome: validated ? 'RECEIPT_VALIDATED' : 'FAILED_CLOSED_REMOTE_STATE_UNPROVEN',
    retryAttempted: false,
  };
  return { stdout, stderr, receipt };
}
