const run = document.querySelector('#run');
const cancel = document.querySelector('#cancel');
const status = document.querySelector('#status');
const result = document.querySelector('#result');
let epoch = 0;
let worker;
let controller;
let timer;
function stop(message) {
  ++epoch; controller?.abort(); controller = undefined;
  worker?.terminate(); worker = undefined;
  clearTimeout(timer); timer = undefined;
  run.disabled = false; cancel.disabled = true;
  status.textContent = message;
}
cancel.addEventListener('click', () => stop('Cancelled. Worker terminated; no result is accepted.'));
window.addEventListener('pagehide', () => stop('Closed. Worker terminated.'));
run.addEventListener('click', async () => {
  stop('Loading source-pinned local QA assets...');
  const original = epoch;
  result.textContent = ''; run.disabled = true; cancel.disabled = false;
  controller = new AbortController();
  const signal = controller.signal;
  timer = setTimeout(() => { if (epoch === original) stop('Timed out. Worker terminated. Retry is available.'); }, 20_000);
  try {
    const modelResponse = await fetch('/model.onnx', { signal, credentials: 'omit' });
    if (!modelResponse.ok) throw new Error('Model unavailable');
    const model = await modelResponse.arrayBuffer();
    const wasmResponse = await fetch('/runtime/ort-wasm-simd-threaded.wasm', { signal, credentials: 'omit' });
    if (!wasmResponse.ok) throw new Error('WASM unavailable');
    const wasm = await wasmResponse.arrayBuffer();
    if (original !== epoch) return;
    const active = new Worker('/worker.mjs', { type: 'module' });
    worker = active; status.textContent = 'Running synthetic tensor inside the connection-blocked Worker...';
    active.onmessage = async event => {
      if (epoch !== original || worker !== active) return;
      try {
        const count = await (await fetch('/probe-count', { signal, credentials: 'omit' })).json();
        if (epoch !== original || worker !== active) return;
        const record = { ...event.data, serverProbeRequests: count.probeRequests };
        result.textContent = JSON.stringify(record, null, 2);
        const passed = record.status === 'SYNTHETIC_WORKER_GRAPH_PASS_ONLY' && record.fetchBlocked && count.probeRequests === 0;
        stop(passed ? 'Worker check passed. This is NOT a content-filter accuracy result.' : 'Worker check failed. Protection is not available.');
      } catch { if (epoch === original) stop('Result verification failed. Worker terminated.'); }
    };
    active.onerror = () => { if (epoch === original) stop('Worker failed. No protection result is accepted. Retry is available.'); };
    active.postMessage({ model, wasm }, [model, wasm]);
  } catch {
    if (epoch === original) stop('Local asset load failed. Nothing was classified. Retry is available.');
  }
});
