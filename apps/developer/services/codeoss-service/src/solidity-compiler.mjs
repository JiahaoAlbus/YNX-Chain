import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { fault } from './central-identity.mjs';

// Compilation parses user text; it never executes a project, reads imports
// from disk, installs packages or contacts a registry. Each request has its own
// worker and no persisted source/artifact shared with another owner.
export function createSolidityCompiler({ maxConcurrent = 4, timeoutMs = 15000 } = {}) {
  const owners = new Set(); let active = 0;
  async function compile({ owner, name, source, signal }) {
    if (typeof owner !== 'string' || !owner) throw fault('An admitted project owner is required.', 'compiler_owner', 401);
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 64 * 1024)
      throw fault('Choose a contract name and Solidity source up to 64 KiB.', 'compiler_source', 400);
    if (signal?.aborted) throw fault('The project session ended before compilation.', 'compiler_retired', 401);
    if (active >= maxConcurrent || owners.has(owner)) throw fault('Compilation is already busy. Retry after the current build ends.', 'compiler_capacity', 429);
    active++; owners.add(owner);
    let worker, timer, abort;
    try {
      worker = new Worker(new URL('../../../scripts/compiler-worker.mjs', import.meta.url), {
        workerData: { name, source }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 },
      });
      const result = await new Promise((resolve, reject) => {
        abort = () => reject(fault('The project session ended during compilation.', 'compiler_retired', 401));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) return abort();
        timer = setTimeout(() => reject(fault('Solidity compilation exceeded its time limit.', 'compiler_timeout', 504)), timeoutMs);
        worker.once('message', resolve);
        worker.once('error', () => reject(fault('The Solidity compiler worker failed.', 'compiler_worker', 503)));
        worker.once('exit', () => reject(fault('The Solidity compiler stopped before returning an artifact.', 'compiler_worker', 503)));
      });
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw fault('The compiler artifact exceeds 2 MiB.', 'compiler_result_limit', 413);
      return { ...result, sourceSha256: createHash('sha256').update(source).digest('hex') };
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // Hold quota until the real worker has stopped, including cancellation.
      try { await worker?.terminate(); } finally { active--; owners.delete(owner); }
    }
  }
  return { compile, status: () => ({ active, maxConcurrent, queued: 0 }) };
}
