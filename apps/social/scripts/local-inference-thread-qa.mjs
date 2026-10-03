import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

// Node worker mechanism QA only. Reuse the actual pinned pipeline; do not
// implement a substitute for the pending product worker consumer or certify
// browser/mobile containment, privacy, calibration or model admission.
const args = process.argv.slice(2);
assert.equal(args.length, 5, 'Usage: node local-inference-thread-qa.mjs <runtime> <xs> <encoder256> <head> <head-data>');
const modulePath = join(resolve(args[0]), 'node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs');
const moduleBytes = await readFile(modulePath);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(moduleBytes), '11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90');
const pipelineURL = new URL('./three-category-inference-qa.mjs', import.meta.url);

if (!isMainThread) {
  assert.ok(parentPort);
  assert.ok(['complete', 'cancel-at-encoder-entry', 'complete-after-cancel'].includes(workerData.mode));
  // Observation only: arguments and results are passed to the real methods
  // unchanged. No generated scores or mock inference replace the WASM engine.
  const ort = await import(pathToFileURL(modulePath).href);
  const create = ort.InferenceSession.create.bind(ort.InferenceSession);
  ort.InferenceSession.create = async (...parameters) => {
    const session = await create(...parameters);
    const run = session.run.bind(session);
    session.run = (...parameters) => {
      parentPort.postMessage({ phase: 'real-session-run-entry', inputNames: Object.keys(parameters[0]), workerTimeMs: performance.now() });
      return run(...parameters);
    };
    return session;
  };
  await import(pipelineURL.href);
} else {
  async function check(mode) {
    const worker = new Worker(new URL(import.meta.url), { argv: args, workerData: { mode }, stdout: true, stderr: true });
    const initialThreadId = worker.threadId;
    let stdout = '', stderr = '', phases = [];
    let cancelRequestedAt;
    let termination;
    let terminationResult;
    let timedOut = false;
    let ticks = 0, maximumParentGapMs = 0, lastTick = performance.now();
    const heartbeat = setInterval(() => {
      const now = performance.now(); maximumParentGapMs = Math.max(maximumParentGapMs, now - lastTick);
      lastTick = now; ticks++;
    }, 20);
    const deadline = setTimeout(() => { timedOut = true; void worker.terminate(); }, 20000);
    worker.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.length > 65536) void worker.terminate(); });
    worker.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 16384) void worker.terminate(); });
    worker.on('message', message => {
      phases.push(message);
      if (mode === 'cancel-at-encoder-entry' && message.phase === 'real-session-run-entry' &&
        message.inputNames.includes('pixel_values') && cancelRequestedAt === undefined) {
        cancelRequestedAt = performance.now();
        termination = worker.terminate().then(code => {
          terminationResult = { exitCode: code, elapsedMs: performance.now() - cancelRequestedAt };
        });
      }
    });
    const exit = new Promise((resolve, reject) => {
      worker.once('error', reject); worker.once('exit', resolve);
    });
    try {
      const exitCode = await exit;
      if (termination) await termination;
      assert.equal(timedOut, false, 'Real model worker exceeded the QA deadline');
      assert.equal(worker.threadId, -1, 'Worker must actually exit before this check ends');
      assert.ok(ticks > 0, 'Parent heartbeat must run during worker computation');
      assert.ok(phases.some(phase => phase.inputNames.includes('image')));
      assert.ok(phases.some(phase => phase.inputNames.includes('pixel_values')));
      if (mode === 'cancel-at-encoder-entry') {
        assert.ok(cancelRequestedAt !== undefined && terminationResult);
        assert.equal(stdout.trim(), '', 'Cancelled pipeline must not publish its final score document');
        return { mode, initialThreadId, threadIdAfterExit: worker.threadId, exitCode, ticks, maximumParentGapMs,
          termination: terminationResult, finalScoreDocumentPublished: false, phases,
          instructionLevelCancellation: 'NOT_VERIFIED; cancellation at actual encoder run entry' };
      }
      assert.equal(exitCode, 0);
      const result = JSON.parse(stdout);
      assert.equal(result.status, 'ACTUAL_THREE_CATEGORY_COMPOSITION_QA_ONLY');
      assert.equal(result.checks.length, 3);
      assert.ok(result.checks.every(check => check.allThreeNumericalOutputsPresent &&
        Object.values(check.scores).every(score => Number.isFinite(score) && score >= 0 && score <= 1)));
      return { mode, initialThreadId, threadIdAfterExit: worker.threadId, exitCode, ticks, maximumParentGapMs,
        phases, actualPipeline: result, stderr };
    } finally {
      clearInterval(heartbeat); clearTimeout(deadline);
      if (worker.threadId !== -1) await worker.terminate();
    }
  }
  const checks = [];
  for (const mode of ['complete', 'cancel-at-encoder-entry', 'complete-after-cancel']) checks.push(await check(mode));
  console.log(JSON.stringify({ status: 'ACTUAL_NODE_MODEL_WORKER_QA_ONLY', node: process.versions.node,
    pipelineSHA256: hash(await readFile(pipelineURL)), checks,
    browserWorker: 'NOT_VERIFIED', nativeMobileWorker: 'NOT_VERIFIED', productConsumer: 'NOT_MOUNTED',
    modelAdmission: 'NOT_ADMITTED', realContentCalibration: 'NOT_RUN', timestamp: new Date().toISOString() }, null, 2));
}
