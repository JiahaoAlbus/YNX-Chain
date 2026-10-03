import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// Engineering QA only. This is not an admitted Social classifier, a user image
// processor, or a calibration set. The missing violence head stays explicit.
const [runtimeDirectory, modelPath] = process.argv.slice(2);
assert.ok(runtimeDirectory && modelPath, 'Usage: node task-classifier-xs-qa.mjs <isolated-runtime> <pinned-onnx>');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = Object.freeze({
  repository: 'OwenElliott/image-safety-classifier-xs',
  revision: '54f4560bd9c5ee92d45dc30418a8f8680e80de6d',
  path: 'onnx/image-safety-classifier-xs.onnx',
  bytes: 13137569,
  sha256: '8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689',
  labels: Object.freeze(['NSFL', 'NSFW', 'SFW']),
});
const runtimeRoot = join(resolve(runtimeDirectory), 'node_modules/onnxruntime-web');
const runtimePackage = JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8'));
assert.equal(runtimePackage.version, '1.30.0');
const modulePath = join(runtimeRoot, 'dist/ort.wasm.bundle.min.mjs');
const moduleBytes = await readFile(modulePath);
assert.equal(sha256(moduleBytes), '11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90');
const wasm = await readFile(join(runtimeRoot, 'dist/ort-wasm-simd-threaded.wasm'));
assert.equal(sha256(wasm), '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2');
const model = await readFile(resolve(modelPath));
assert.equal(model.byteLength, pin.bytes);
assert.equal(sha256(model), pin.sha256);

const ort = await import(pathToFileURL(modulePath).href);
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmBinary = wasm;
const previousFetch = globalThis.fetch;
let fetchAttempts = 0;
globalThis.fetch = async () => { fetchAttempts++; throw new Error('Network forbidden during classifier QA'); };
let session;
try {
  const started = performance.now();
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  const loadMs = performance.now() - started;
  assert.deepEqual(session.inputNames, ['image']);
  assert.equal(session.outputNames.length, 1);
  const checks = [];
  for (const pixelValue of [0, 127.5, 255]) {
    // The pinned ONNX graph includes normalization and softmax. No extra
    // normalization, threshold, class remapping or safety conclusion is added.
    const input = new ort.Tensor('float32', new Float32Array(3 * 224 * 224).fill(pixelValue), [1, 3, 224, 224]);
    const began = performance.now();
    const outputs = await session.run({ image: input });
    const elapsedMs = performance.now() - began;
    const output = outputs[session.outputNames[0]];
    assert.equal(output.type, 'float32');
    assert.deepEqual(output.dims, [1, 3]);
    const probabilities = Array.from(output.data);
    assert.ok(probabilities.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) < 0.0001);
    checks.push({ syntheticRGB: pixelValue, elapsedMs,
      probabilities: Object.fromEntries(pin.labels.map((label, index) => [label, probabilities[index]])),
      candidateCategories: { gore: probabilities[0], sexual_content: probabilities[1], explicit_violence: null },
      completeThreeCategoryClassifier: false, safetyConclusion: 'NOT_EVALUATED' });
    input.dispose();
    for (const tensor of Object.values(outputs)) tensor.dispose();
  }
  assert.equal(fetchAttempts, 0);
  console.log(JSON.stringify({ status: 'ACTUAL_CLASSIFIER_ENGINE_QA_ONLY', pin,
    runtime: runtimePackage.version, executionProvider: 'wasm', numThreads: 1,
    loadMs, checks, fetchAttempts, osNetworkIsolation: 'NOT_VERIFIED',
    realContentCalibration: 'NOT_RUN', signedArtifactAdmission: 'NOT_ADMITTED',
    productMount: 'NOT_MOUNTED', timestamp: new Date().toISOString() }, null, 2));
} finally {
  if (session) await session.release();
  globalThis.fetch = previousFetch;
  model.fill(0);
}
