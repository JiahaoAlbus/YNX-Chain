// Shared by runtime gates. Timeouts must still leave a usable failure record.
export async function bounded(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), {code: 'GATE_TIMEOUT'})), ms);
    })]);
  } finally { clearTimeout(timer); }
}
export function allSelectedBrowsersPassed(results) {
  return results.length > 0 && results.every(result => result.temporaryUnpackedRuntimeTested === true);
}
export async function capturePwaFailure(page, {timeoutMs = 2500} = {}) {
  const read = async (name, callback) => {
    try { return await bounded(page.evaluate(callback), timeoutMs, name); }
    catch (error) { return {error: {name: error.name, code: error.code ?? null, message: error.message}}; }
  };
  const [document, workers, caches, detailedSnapshot] = await Promise.all([
    read('document metadata', () => {
      const frame = document.querySelector('#wallet');
      let iframe;
      try { iframe = {src: frame?.getAttribute('src') ?? null, url: frame?.contentWindow?.location.href ?? null,
        readyState: frame?.contentDocument?.readyState ?? null, title: frame?.contentDocument?.title ?? null,
        pwa: frame?.contentDocument?.documentElement?.dataset.pwa ?? null,
        dataset: {...frame?.contentDocument?.documentElement?.dataset},
        controller: frame?.contentWindow?.navigator.serviceWorker?.controller?.scriptURL ?? null}; }
      catch (error) { iframe = {src: frame?.getAttribute('src') ?? null, error: error.message}; }
      return {url: location.href, readyState: document.readyState, iframe};
    }),
    read('worker metadata', async () => (await navigator.serviceWorker.getRegistrations()).map(registration => {
      const worker = value => value ? {scriptURL: value.scriptURL, state: value.state} : null;
      return {scope: registration.scope, active: worker(registration.active), waiting: worker(registration.waiting), installing: worker(registration.installing)};
    })),
    read('cache metadata', async () => {
      const names = await caches.keys();
      return Promise.all(names.map(async name => ({name, entries: (await (await caches.open(name)).keys()).map(request => request.url)})));
    }),
    read('integrity snapshot', () => window.pwaUpgradeQA?.snapshot?.() ?? null),
  ]);
  return {document, workers, caches, detailedSnapshot};
}

// A navigating iframe temporarily has no documentElement; keep polling.
export function pwaFrameReady() {
  return document.querySelector("#wallet")?.contentDocument?.documentElement?.dataset.pwa === "ready";
}
