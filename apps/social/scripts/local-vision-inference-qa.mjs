import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// Engineering benchmark only, not the production content classifier. No private
// input, image download, automatic model download, scores or moderation actions.
const expectedModelSHA = '03e61be280fb24114facd87a1e1e6b2b654aad49845686da2f930c72740914aa';
const stage = process.argv[2];
const modelPath = process.argv[3];
if (!stage || !modelPath) throw new Error('Usage: local-vision-inference-qa.mjs <isolated-stage> <pinned-model-file>');
const root = resolve(stage);
const packageRoot = join(root, 'node_modules/onnxruntime-web');
const packageMetadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
if (packageMetadata.version !== '1.30.0') throw new Error('QA runtime version does not match the frozen dependency');
const model = new Uint8Array(await readFile(resolve(modelPath)));
const actualSHA = createHash('sha256').update(model).digest('hex');
if (actualSHA !== expectedModelSHA || model.byteLength !== 63_267_466) throw new Error('QA model bytes do not match the source pin');

const originalFetch = globalThis.fetch;
let fetchAttempts = 0;
globalThis.fetch = async () => {
  ++fetchAttempts;
  throw new Error('QA disallows fetch after local assets are acquired');
};
let session;
try {
  const ort = await import(pathToFileURL(join(packageRoot, 'dist/ort.wasm.bundle.min.mjs')).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const loadStart = performance.now();
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  const loadMs = performance.now() - loadStart;
  if (session.inputNames.length !== 1 || session.inputNames[0] !== 'pixel_values') {
    throw new Error(`Unsupported QA graph inputs: ${session.inputNames.join(',')}`);
  }
  const tensor = new ort.Tensor('float32', new Float32Array(3 * 224 * 224), [1, 3, 224, 224]);
  const runs = [];
  for (let iteration = 0; iteration < 2; ++iteration) {
    const started = performance.now();
    const output = await session.run({ pixel_values: tensor });
    const outputs = Object.entries(output).map(([name, value]) => {
      const data = value.data;
      if (!(data instanceof Float32Array) || !data.length || !data.every(Number.isFinite)) {
        throw new Error('QA graph returned unsupported or nonfinite output');
      }
      const description = { name, dimensions: value.dims, elements: data.length, finite: true };
      value.dispose();
      return description;
    });
    if (!outputs.length) throw new Error('QA graph returned no output');
    runs.push({ iteration, elapsedMs: performance.now() - started, outputs });
  }
  tensor.dispose();
  await session.release();
  session = undefined;
  if (fetchAttempts !== 0) throw new Error('QA runtime attempted fetch');
  process.stdout.write(JSON.stringify({
    status: 'LOCAL_VISION_GRAPH_QA_ONLY', runtime: 'onnxruntime-web@1.30.0', provider: 'wasm', threads: 1,
    modelSHA256: actualSHA, modelBytes: model.byteLength, input: 'synthetic-zero-tensor-only',
    loadMs, runs, processRSSBytes: process.memoryUsage().rss, fetchAttempts, sessionReleased: true,
    osNetworkIsolation: 'NOT_VERIFIED', threeCategoryAccuracy: 'NOT_VERIFIED', productionClassifier: false,
    privateContentProcessed: false, installedOrPublicAcceptance: false,
  }, null, 2) + '\n');
} finally {
  if (session) await session.release();
  globalThis.fetch = originalFetch;
}
