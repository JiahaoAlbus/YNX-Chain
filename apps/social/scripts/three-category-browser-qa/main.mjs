const stage = document.querySelector('#stage');
const result = document.querySelector('#result');
const trace = document.querySelector('#trace');
const runButtons = Array.from(document.querySelectorAll('[data-mode]'));
const cancelButton = document.querySelector('#cancel');
let current;
let sequence = 0;
function finish(task, status) {
  if (current !== task) return;
  clearTimeout(task.deadline); task.abort.abort(); task.worker?.terminate();
  current = undefined; stage.textContent = status;
  runButtons.forEach(button => { button.disabled = false; }); cancelButton.disabled = true;
}
async function fetchBytes(path, signal) {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error('Local QA resource unavailable');
  return response.arrayBuffer();
}
async function run(mode) {
  if (current) return;
  const task = { id: ++sequence, abort: new AbortController(), worker: undefined, deadline: undefined };
  current = task; result.textContent = ''; trace.textContent = '';
  runButtons.forEach(button => { button.disabled = true; }); cancelButton.disabled = false;
  task.deadline = setTimeout(() => finish(task, 'Timed out. No score accepted. Retry available.'), 20000);
  try {
    const assets = {};
    for (const [name, path] of [['xs', '/assets/xs'], ['encoder', '/assets/encoder'], ['head', '/assets/head'], ['data', '/assets/head-data']]) {
      stage.textContent = 'Loading pinned local asset: ' + name;
      assets[name] = await fetchBytes(path, task.abort.signal);
      if (current !== task) return;
    }
    const wasm = await fetchBytes('/assets/wasm', task.abort.signal);
    const content = await fetchBytes('/logo.png', task.abort.signal);
    if (current !== task) return;
    if (mode === 'corrupt-xs') new Uint8Array(assets.xs)[0] ^= 1; // In-memory fixture only; no original file changed.
    task.worker = new Worker('/worker.mjs', { type: 'module' });
    task.worker.onerror = () => finish(task, 'Local engine failed. No score accepted. Retry available.');
    task.worker.onmessageerror = () => finish(task, 'Worker message failed. No score accepted. Retry available.');
    task.worker.onmessage = event => {
      if (current !== task) return;
      const message = event.data;
      trace.textContent += JSON.stringify(message) + '\n';
      if (message.type === 'ready') {
        stage.textContent = 'Worker verified pinned assets. Decoding the public PNG inside Worker.';
        task.worker.postMessage({ protocol: 'ynx-social-classifier-worker-v1', type: 'classify', id: task.id,
          content, mimeType: 'image/png' }, [content]);
      } else if (message.type === 'phase') {
        stage.textContent = 'Actual encoder run entry.';
        if (mode === 'cancel-at-encoder-entry') finish(task, 'Cancelled at encoder entry. No score accepted. Retry available.');
      } else if (message.type === 'scores' && message.id === task.id) {
        result.textContent = JSON.stringify({ ...message.scores, calibration: 'NOT_RUN', productMount: 'NOT_MOUNTED' }, null, 2);
        finish(task, 'Three finite scores returned. This is not a safety decision.');
      } else if (message.type === 'error') {
        finish(task, 'Pinned asset or engine check rejected. No score accepted. Retry available.');
      }
    };
    stage.textContent = 'Worker loading and verifying the fixed graph bundle.';
    task.worker.postMessage({ type: 'setup', assets, wasm }, [...Object.values(assets), wasm]);
  } catch { finish(task, 'Local resource load failed. No score accepted. Retry available.'); }
}
for (const button of runButtons) button.addEventListener('click', () => { void run(button.dataset.mode); });
cancelButton.addEventListener('click', () => { if (current) finish(current, 'Cancelled. No score accepted. Retry available.'); });
window.addEventListener('pagehide', () => { if (current) finish(current, 'Stopped on page exit.'); });
