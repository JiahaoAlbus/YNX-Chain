import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readSync, lstatSync } from 'node:fs';
import path from 'node:path';

const tables = ['basic', 'described', 'epoch'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function readPrivate(file, limit) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || st.nlink !== 1
        || (st.mode & 0o777) !== 0o600 || st.size <= 0 || st.size > limit) {
      throw Error('Invalid private directory capture file');
    }
    const bytes = Buffer.alloc(st.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const received = readSync(fd, bytes, size, bytes.length - size, null);
      if (received === 0) break;
      size += received;
    }
    if (size !== st.size) throw Error('Directory capture size changed');
    return bytes.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}

function requirePrivateDirectory(directory) {
  const st = lstatSync(directory);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o700) {
    throw Error('Invalid private directory capture path');
  }
}

export function readReviewedDirectoryCapture(message, { root, scopeSHA256, binarySHA256, now = Date.now() }) {
  if (!isHash(scopeSHA256) || !isHash(binarySHA256)) throw Error('Directory capture pins required');
  const casePath = path.join(root, 'normal-directory-once-' + scopeSHA256);
  const receiptPath = path.join(casePath, 'operation.json');
  const directory = path.join(casePath, 'tables');
  if (message?.state !== 'fetched' || message.out !== directory || message.receipt !== receiptPath
      || !isHash(message.receiptSHA256) || message.firstFailure !== null) {
    throw Error('Directory capture result rejected');
  }
  requirePrivateDirectory(casePath);
  requirePrivateDirectory(directory);
  const bytes = readPrivate(receiptPath, 65536);
  if (hash(bytes) !== message.receiptSHA256) throw Error('Directory capture receipt changed');
  const receipt = JSON.parse(bytes);
  const child = receipt.processes?.[0];
  if (receipt.schema !== 'P05_NYM_NORMAL_DIRECTORY_OWNED_CAPTURE_V1'
      || receipt.state !== 'fetched' || receipt.out !== directory
      || receipt.scopeSHA256 !== scopeSHA256 || receipt.binarySHA256 !== binarySHA256
      || !Number.isSafeInteger(receipt.expiresAt) || now >= receipt.expiresAt * 1000
      || receipt.firstFailure !== null || receipt.cleanupFailure !== null || receipt.childOutcomeRecordingFailure !== null
      || receipt.completeEOFBeforeCleanup !== true || JSON.stringify(receipt.capturedEOF) !== '["stderr","stdout"]'
      || !Array.isArray(receipt.remainingOwned) || receipt.remainingOwned.length !== 0
      || !Array.isArray(receipt.signals) || receipt.signals.length !== 0
      || receipt.productionQualification !== false || receipt.processes?.length !== 1
      || !Number.isSafeInteger(child?.pid) || child.pid <= 1 || child.pid !== child.pgid
      || child.terminalOutcome !== 'ORIGINAL_POPEN_WAIT' || child.exit !== 0 || child.reaped !== true
      || !isHash(receipt.summary?.exactPayloadSHA256WithoutFinalLF)
      || !tables.every(name => isHash(receipt.sha256?.[name]))) throw Error('Directory capture receipt rejected');
  const content = {};
  const digests = [];
  for (const name of tables) {
    const table = readPrivate(path.join(directory, name + '.json'), 16_777_217);
    if (hash(table) !== receipt.sha256[name]) throw Error('Directory capture table changed');
    content[name] = JSON.parse(table);
    digests.push(receipt.sha256[name]);
  }
  return { directory, ...content, digests };
}

// Keep the original normal vendor QA command while the Python supervisor owns
// each actual Popen, both output descriptors and the final wait receipt.
export async function fetchReviewedDirectory(args) {
  const script = fileURLToPath(new URL('./capture-reviewed-directory.py', import.meta.url));
  const child = spawn('/usr/bin/python3', ['-IB', script, ...args], { stdio: 'inherit', detached: true });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  let cancelled = false;
  function forward(signal) {
    cancelled = true;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
  for (const signal of signals) process.on(signal, forward);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(cancelled ? 1 : (code ?? 1)));
    });
  } finally {
    for (const signal of signals) process.off(signal, forward);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await fetchReviewedDirectory(process.argv.slice(2));
}
