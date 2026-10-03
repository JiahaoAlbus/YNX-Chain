import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// Candidate engineering run, not a signed classifier admission, calibrated
// display policy, private-content processor or product UI mount.
const [runtimeDirectory, xsPath, encoderPath, headPath, dataPath] = process.argv.slice(2);
assert.ok(runtimeDirectory && xsPath && encoderPath && headPath && dataPath,
  'Usage: node three-category-inference-qa.mjs <runtime> <xs> <encoder256> <head> <head-data>');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pins = {
  xs: { repository: 'OwenElliott/image-safety-classifier-xs', revision: '54f4560bd9c5ee92d45dc30418a8f8680e80de6d',
    bytes: 13137569, sha256: '8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689' },
  encoder256: { repository: 'onnx-community/siglip2-base-patch16-256-ONNX', revision: 'd1114256522a37ffa257a0a58017348ab0058db2',
    bytes: 63451786, sha256: '712064dae0cce3fb4c94497c7dfd65d11f4ad34eadafe09442208474068cf777' },
  violenceHead: { repository: 'khasinski/siglip2-moderation-heads', revision: 'b88fe03369e3dc6aa9887cd3b4cd3e9b7cf76ee5',
    bytes: 869, sha256: '268b8702e8e373ab0fea4de55250f506650ff87be532d1809ba70513bd5fa5b4' },
  violenceData: { bytes: 788480, sha256: '433df42d2b884d598a65f41d1cb16e2c44b60000f0f46da6b7c380f3851ce2ef' },
};
async function verified(path, pin) {
  const bytes = await readFile(resolve(path));
  assert.equal(bytes.byteLength, pin.bytes, 'Pinned artifact size mismatch: ' + path);
  assert.equal(sha256(bytes), pin.sha256, 'Pinned artifact digest mismatch: ' + path);
  return bytes;
}
const xsBytes = await verified(xsPath, pins.xs);
const encoderBytes = await verified(encoderPath, pins.encoder256);
const headBytes = await verified(headPath, pins.violenceHead);
const headData = await verified(dataPath, pins.violenceData);
const runtimeRoot = join(resolve(runtimeDirectory), 'node_modules/onnxruntime-web');
assert.equal(JSON.parse(await readFile(join(runtimeRoot, 'package.json'), 'utf8')).version, '1.30.0');
const modulePath = join(runtimeRoot, 'dist/ort.wasm.bundle.min.mjs');
assert.equal(sha256(await readFile(modulePath)), '11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90');
const wasm = await readFile(join(runtimeRoot, 'dist/ort-wasm-simd-threaded.wasm'));
assert.equal(sha256(wasm), '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2');
const require = createRequire(import.meta.url);
assert.equal(require('pngjs/package.json').version, '5.0.0');
const { PNG } = require('pngjs');
const imageBytes = await readFile(new URL('../assets/ynx-original-logo.png', import.meta.url));
assert.ok(imageBytes.length < 2 * 1024 * 1024);
assert.equal(imageBytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
const width = imageBytes.readUInt32BE(16), height = imageBytes.readUInt32BE(20);
assert.ok(width > 0 && height > 0 && width <= 2048 && height <= 2048);
const image = PNG.sync.read(imageBytes, { checkCRC: true });
assert.equal(image.width, width); assert.equal(image.height, height);

// Deliberate QA white composite of the public logo, then half-pixel bilinear
// resize. Not asserted bit-for-bit equivalent to every Pillow/browser decoder.
function resizedRGB(image, size) {
  const rgb = new Float32Array(3 * size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.max(0, Math.min(image.width - 1, (x + 0.5) * image.width / size - 0.5));
    const sy = Math.max(0, Math.min(image.height - 1, (y + 0.5) * image.height / size - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const x1 = Math.min(x0 + 1, image.width - 1), y1 = Math.min(y0 + 1, image.height - 1);
    const dx = sx - x0, dy = sy - y0;
    for (let c = 0; c < 3; c++) {
      const pixel = (px, py) => {
        const p = 4 * (py * image.width + px), alpha = image.data[p + 3] / 255;
        return image.data[p + c] * alpha + 255 * (1 - alpha);
      };
      rgb[c * size * size + y * size + x] =
        (pixel(x0, y0) * (1 - dx) + pixel(x1, y0) * dx) * (1 - dy) +
        (pixel(x0, y1) * (1 - dx) + pixel(x1, y1) * dx) * dy;
    }
  }
  assert.ok(rgb.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
  return rgb;
}
assert.deepEqual(Array.from(resizedRGB({ width: 1, height: 1, data: new Uint8Array([20, 40, 60, 255]) }, 2)),
  [20, 20, 20, 20, 40, 40, 40, 40, 60, 60, 60, 60]);
assert.deepEqual(Array.from(resizedRGB({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) }, 1)), [255, 255, 255]);
const sigmoid = value => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
function finiteTensor(tensor, dims) {
  assert.ok(tensor, 'Required output tensor missing');
  assert.equal(tensor.type, 'float32'); assert.deepEqual(tensor.dims, dims);
  assert.ok(Array.from(tensor.data).every(Number.isFinite));
}
const ort = await import(pathToFileURL(modulePath).href);
ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmBinary = wasm;
const previousFetch = globalThis.fetch;
let fetchAttempts = 0;
globalThis.fetch = async () => { fetchAttempts++; throw new Error('Network forbidden during composition QA'); };
const sessions = [];
try {
  const began = performance.now();
  const xs = await ort.InferenceSession.create(xsBytes, { executionProviders: ['wasm'] }); sessions.push(xs);
  const encoder = await ort.InferenceSession.create(encoderBytes, { executionProviders: ['wasm'] }); sessions.push(encoder);
  const head = await ort.InferenceSession.create(headBytes, { executionProviders: ['wasm'],
    externalData: [{ path: 'violence_head.onnx.data', data: headData }] }); sessions.push(head);
  const loadMs = performance.now() - began;
  assert.deepEqual(xs.inputNames, ['image']); assert.equal(xs.outputNames.length, 1);
  assert.deepEqual(encoder.inputNames, ['pixel_values']);
  assert.deepEqual(head.inputNames, ['embedding']); assert.deepEqual(head.outputNames, ['logits']);
  const checks = [];
  for (const sample of ['solid-gray', 'original-public-logo', 'original-public-logo-repeat']) {
    const xsPixels = sample === 'solid-gray' ? new Float32Array(3 * 224 * 224).fill(127.5) : resizedRGB(image, 224);
    const encoderPixels = sample === 'solid-gray' ? new Float32Array(3 * 256 * 256).fill(127.5) : resizedRGB(image, 256);
    for (let i = 0; i < encoderPixels.length; i++) encoderPixels[i] = encoderPixels[i] / 127.5 - 1;
    const input = new ort.Tensor('float32', xsPixels, [1, 3, 224, 224]);
    const encoderInput = new ort.Tensor('float32', encoderPixels, [1, 3, 256, 256]);
    const started = performance.now();
    const xsOutputs = await xs.run({ image: input });
    const xsMs = performance.now() - started;
    const probabilities = xsOutputs[xs.outputNames[0]];
    finiteTensor(probabilities, [1, 3]);
    assert.ok(Array.from(probabilities.data).every(value => value >= 0 && value <= 1));
    assert.ok(Math.abs(Array.from(probabilities.data).reduce((sum, value) => sum + value, 0) - 1) < 0.0001);
    const encoderStarted = performance.now();
    const encoderOutputs = await encoder.run({ pixel_values: encoderInput });
    const encoderMs = performance.now() - encoderStarted;
    const features = encoderOutputs.pooler_output;
    finiteTensor(features, [1, 768]);
    const norm = Math.sqrt(Array.from(features.data).reduce((sum, value) => sum + value * value, 0));
    assert.ok(Number.isFinite(norm) && norm > 0);
    const normalized = Float32Array.from(features.data, value => value / norm);
    const normalizedNorm = Math.sqrt(Array.from(normalized).reduce((sum, value) => sum + value * value, 0));
    assert.ok(Math.abs(normalizedNorm - 1) < 0.00001);
    const embedding = new ort.Tensor('float32', normalized, [1, 768]);
    const headStarted = performance.now();
    const headOutputs = await head.run({ embedding });
    const headMs = performance.now() - headStarted;
    finiteTensor(headOutputs.logits, [1, 1]);
    const scores = { gore: probabilities.data[0], explicit_violence: sigmoid(headOutputs.logits.data[0]), sexual_content: probabilities.data[1] };
    assert.ok(Object.values(scores).every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    checks.push({ sample, scores, xsMs, encoderMs, headMs, normalizedEmbeddingNorm: normalizedNorm,
      allThreeNumericalOutputsPresent: true, safetyConclusion: 'NOT_EVALUATED' });
    for (const tensor of [input, encoderInput, embedding, ...Object.values(xsOutputs), ...Object.values(encoderOutputs), ...Object.values(headOutputs)]) tensor.dispose();
    xsPixels.fill(0); encoderPixels.fill(0); normalized.fill(0);
  }
  assert.equal(fetchAttempts, 0);
  console.log(JSON.stringify({ status: 'ACTUAL_THREE_CATEGORY_COMPOSITION_QA_ONLY', pins, runtime: '1.30.0',
    loadMs, checks, publicImageSHA256: sha256(imageBytes), publicImageDimensions: [width, height],
    encoderQuantization: 'q4; fp32 parity/calibration NOT_VERIFIED', fetchAttempts,
    osNetworkIsolation: 'NOT_VERIFIED', realContentCalibration: 'NOT_RUN',
    signedArtifactAdmission: 'NOT_ADMITTED', productMount: 'NOT_MOUNTED', timestamp: new Date().toISOString() }, null, 2));
} finally {
  for (const session of sessions.reverse()) await session.release();
  globalThis.fetch = previousFetch;
  image.data.fill(0); xsBytes.fill(0); encoderBytes.fill(0); headBytes.fill(0); headData.fill(0);
}
