import * as ort from '/ort.mjs';

const pins = {
  xs: [13137569, '8c28c49d9075f3ad15ebdc2961f02d5b3f99be944815b848b49c9f0e6f3fb689'],
  encoder: [63451786, '712064dae0cce3fb4c94497c7dfd65d11f4ad34eadafe09442208474068cf777'],
  head: [869, '268b8702e8e373ab0fea4de55250f506650ff87be532d1809ba70513bd5fa5b4'],
  data: [788480, '433df42d2b884d598a65f41d1cb16e2c44b60000f0f46da6b7c380f3851ce2ef'],
};
let sessions;
let busy = false;
function check(condition) { if (!condition) throw new Error('Invalid pinned engine input'); }
async function verified(bytes, pin) {
  check(bytes instanceof ArrayBuffer && bytes.byteLength === pin[0]);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  check(Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('') === pin[1]);
  return new Uint8Array(bytes);
}
function finite(tensor, dimensions) {
  check(tensor?.type === 'float32' && JSON.stringify(tensor.dims) === JSON.stringify(dimensions));
  check(Array.from(tensor.data).every(Number.isFinite));
}
function pixels(bitmap, size, normalize) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  check(context);
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'low';
  context.drawImage(bitmap, 0, 0, size, size);
  const rgba = context.getImageData(0, 0, size, size).data;
  const data = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) for (let channel = 0; channel < 3; channel++) {
    data[channel * size * size + i] = normalize ? rgba[4 * i + channel] / 127.5 - 1 : rgba[4 * i + channel];
  }
  return data;
}
self.onmessage = async event => {
  const message = event.data;
  if (busy) { self.postMessage({ type: 'error', code: 'ENGINE_BUSY' }); return; }
  busy = true;
  try {
    if (message?.type === 'setup') {
      check(!sessions);
      const models = {};
      for (const [name, pin] of Object.entries(pins)) models[name] = await verified(message.assets[name], pin);
      const wasmDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', message.wasm));
      check(Array.from(wasmDigest, byte => byte.toString(16).padStart(2, '0')).join('') ===
        '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2');
      ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.wasm.wasmBinary = new Uint8Array(message.wasm);
      const xs = await ort.InferenceSession.create(models.xs, { executionProviders: ['wasm'] });
      const encoder = await ort.InferenceSession.create(models.encoder, { executionProviders: ['wasm'] });
      const head = await ort.InferenceSession.create(models.head, { executionProviders: ['wasm'],
        externalData: [{ path: 'violence_head.onnx.data', data: models.data }] });
      sessions = { xs, encoder, head };
      let cspProbeBlocked = false;
      try { await fetch('/network-probe'); } catch { cspProbeBlocked = true; }
      check(cspProbeBlocked);
      self.postMessage({ type: 'ready', cspProbeBlocked });
    } else {
      check(sessions && message?.protocol === 'ynx-social-classifier-worker-v1' && message.type === 'classify' &&
        Number.isSafeInteger(message.id) && message.id > 0 && message.mimeType === 'image/png' &&
        message.content instanceof ArrayBuffer && message.content.byteLength > 0 && message.content.byteLength < 2 * 1024 * 1024);
      const bitmap = await createImageBitmap(new Blob([message.content], { type: 'image/png' }));
      check(bitmap.width > 0 && bitmap.height > 0 && bitmap.width <= 2048 && bitmap.height <= 2048);
      const xsInput = new ort.Tensor('float32', pixels(bitmap, 224, false), [1, 3, 224, 224]);
      const encoderInput = new ort.Tensor('float32', pixels(bitmap, 256, true), [1, 3, 256, 256]);
      bitmap.close();
      const began = performance.now();
      const xsOutputs = await sessions.xs.run({ image: xsInput });
      const xsScores = xsOutputs[sessions.xs.outputNames[0]];
      finite(xsScores, [1, 3]);
      check(Array.from(xsScores.data).every(score => score >= 0 && score <= 1));
      check(Math.abs(Array.from(xsScores.data).reduce((sum, value) => sum + value, 0) - 1) < 0.0001);
      self.postMessage({ type: 'phase', value: 'encoder-run-entry' });
      const encoded = await sessions.encoder.run({ pixel_values: encoderInput });
      const features = encoded.pooler_output; finite(features, [1, 768]);
      const norm = Math.sqrt(Array.from(features.data).reduce((sum, value) => sum + value * value, 0));
      check(Number.isFinite(norm) && norm > 0);
      const embedding = new ort.Tensor('float32', Float32Array.from(features.data, value => value / norm), [1, 768]);
      const headOutputs = await sessions.head.run({ embedding }); finite(headOutputs.logits, [1, 1]);
      const value = headOutputs.logits.data[0];
      const violence = value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
      const scores = { gore: xsScores.data[0], explicit_violence: violence, sexual_content: xsScores.data[1] };
      check(Object.values(scores).every(score => Number.isFinite(score) && score >= 0 && score <= 1));
      for (const tensor of [xsInput, encoderInput, embedding, ...Object.values(xsOutputs), ...Object.values(encoded), ...Object.values(headOutputs)]) tensor.dispose();
      self.postMessage({ protocol: 'ynx-social-classifier-worker-v1', type: 'scores', id: message.id, scores });
      self.postMessage({ type: 'timing', elapsedMs: performance.now() - began });
    }
  } catch { self.postMessage({ type: 'error', code: 'PIN_OR_ENGINE_CHECK_FAILED' }); }
  finally { busy = false; }
};
