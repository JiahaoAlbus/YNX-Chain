import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { fault } from './central-identity.mjs';
import { reviewedSoliditySnapshot } from './solidity-snapshot.mjs';

// Compilation parses user text; it never executes a project, reads imports
// from disk, installs packages or contacts a registry. Each request has its own
// worker and no persisted source/artifact shared with another owner.
export function createSolidityCompiler({ maxConcurrent = 4, timeoutMs = 15000 } = {}) {
  const owners = new Set(); let active = 0;
  async function run({ owner, name, source, snapshot, sessionId, signal }, mode) {
    if (typeof owner !== 'string' || !owner) throw fault('An admitted project owner is required.', 'compiler_owner', 401);
    if ((mode !== 'analysis' && (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))) || (mode === 'analysis' && (snapshot === undefined || name !== undefined)) || (snapshot === undefined && (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > 64 * 1024)) || (snapshot !== undefined && source !== undefined))
      throw fault(mode === 'analysis' ? 'Review a source-bound Solidity project snapshot before analysis.' : 'Choose a contract name and Solidity source up to 64 KiB.', 'compiler_source', 400);
    const project = snapshot === undefined ? undefined : reviewedSoliditySnapshot(snapshot, sessionId);
    if (signal?.aborted) throw fault('The project session ended before compilation.', 'compiler_retired', 401);
    if (active >= maxConcurrent || owners.has(owner)) throw fault('Compilation is already busy. Retry after the current build ends.', 'compiler_capacity', 429);
    active++; owners.add(owner);
    let worker, timer, abort;
    try {
      worker = new Worker(new URL('../../../scripts/compiler-worker.mjs', import.meta.url), {
        workerData: { name, mode, ...(project ? { sourceName: project.sourceName, sources: project.sources } : { source }) }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32 },
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
      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw fault(mode === 'analysis' ? 'The compiler analysis exceeds 2 MiB.' : 'The compiler artifact exceeds 2 MiB.', 'compiler_result_limit', 413);
      return { ...result, ...(project ? { sourceDigests: project.sourceDigests, sourceBytes: project.sourceBytes, sourceSha256: project.sourceDigests[project.sourceName] } : { sourceSha256: createHash('sha256').update(source).digest('hex') }) };
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      // Hold quota until the real worker has stopped, including cancellation.
      try { await worker?.terminate(); } finally { active--; owners.delete(owner); }
    }
  }
  return { compile: args => run(args, 'compile'), analyze: args => run(args, 'analysis'), status: () => ({ active, maxConcurrent, queued: 0 }) };
}
