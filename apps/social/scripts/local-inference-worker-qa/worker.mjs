import * as ort from '/runtime/ort.wasm.bundle.min.mjs';

const modelSHA = '03e61be280fb24114facd87a1e1e6b2b654aad49845686da2f930c72740914aa';
const wasmSHA = '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2';
const digest = async buffer => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
let started = false;
self.onmessage = async event => {
  if (started) return;
  started = true;
  let session;
  let tensor;
  try {
    const { model, wasm } = event.data;
    if (!(model instanceof ArrayBuffer) || !(wasm instanceof ArrayBuffer) ||
      await digest(model) !== modelSHA || await digest(wasm) !== wasmSHA) throw new Error('Asset integrity failed');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = wasm;
    let fetchBlocked = false;
    try { await fetch('/network-probe'); }
    catch { fetchBlocked = true; }
    if (!fetchBlocked) throw new Error('Worker connection was not blocked');
    const loadStart = performance.now();
    session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] });
    const loadMs = performance.now() - loadStart;
    tensor = new ort.Tensor('float32', new Float32Array(3 * 224 * 224), [1, 3, 224, 224]);
    const results = [];
    for (let run = 0; run < 2; ++run) {
      const start = performance.now();
      const output = await session.run({ pixel_values: tensor });
      const shapes = Object.entries(output).map(([name, value]) => {
        if (!(value.data instanceof Float32Array) || !value.data.every(Number.isFinite)) throw new Error('Nonfinite output');
        const result = { name, dimensions: value.dims }; value.dispose(); return result;
      });
      results.push({ run, elapsedMs: performance.now() - start, shapes });
    }
    tensor.dispose(); tensor = undefined;
    await session.release(); session = undefined;
    self.postMessage({ status: 'SYNTHETIC_WORKER_GRAPH_PASS_ONLY', fetchBlocked, loadMs, results,
      sessionReleased: true, privateContentProcessed: false, classifierAccuracy: 'NOT_VERIFIED' });
  } catch (error) {
    self.postMessage({ status: 'FAIL', error: error instanceof Error ? error.message : 'Worker failed' });
  } finally {
    tensor?.dispose();
    if (session) await session.release();
  }
};
