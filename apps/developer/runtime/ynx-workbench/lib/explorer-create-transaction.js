'use strict';
// The only writer is the native commit.
const TOKEN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_TTL_MS = 15000;
async function explorerCreateTransaction(bridge, fileService, options, { current, decode, toFileStat, now = () => performance.now() }) {
  if (!current()) return undefined;
  if (bridge.createProtocol === undefined) {
    const reply = await bridge.open(options);
    return current() && !reply?.cancelled ? decode(reply, 'created') : undefined;
  }
  if (bridge.createProtocol !== 1 || [bridge.prepareCreate, bridge.commitCreate, bridge.cancelCreate, fileService?.createExplorerResource].some(fn => typeof fn !== 'function')) {
    throw Error('The file creation bridge is unavailable.');
  }

  const prepared = await bridge.prepareCreate(options);
  if (prepared?.cancelled) return undefined;
  const token = prepared?.token;
  if (typeof token !== 'string' || !TOKEN.test(token)) throw Error('The IDE could not confirm a prepared creation request.');
  let confirmed = false;
  try {
    if (!current()) return undefined;
    if (!Number.isSafeInteger(prepared.ttlMs) || prepared.ttlMs < 1 || prepared.ttlMs > MAX_TTL_MS) throw Error('The creation request has an invalid deadline.');
    const expires = now() + prepared.ttlMs;
    const mayCommit = () => current() && now() < expires;
    const target = decode(prepared, 'prepared');
    await fileService.createExplorerResource(target, {
      current: mayCommit,
      async commit(uri) {
        if (!mayCommit()) throw Error('Creation request expired or the project changed.');
        const result = await bridge.commitCreate(token);
        try {
          const committed = decode(result, 'created');
          if (!uri.isEqual(committed)) throw Error('The native creation receipt differs from the prepared file.');
          // Metadata is captured as part of the native operation; no second disk write.
          const stat = toFileStat(committed, result.stat, options.kind);
          confirmed = true;
          return stat;
        } catch (cause) {
          throw Object.assign(Error('Creation could not be confirmed. Check the selected folder before retrying.', { cause }), {
            code: 'YNX_EXPLORER_CREATE_UNKNOWN',
          });
        }
      },
    });
    return current() ? target : undefined;
  } finally {
    // A cleanup failure must not replace a committed result or first cause.
    // The native token also expires independently on its monotonic clock.
    if (!confirmed) await cancelPrepared(bridge, token);
  }
}
async function cancelPrepared(bridge, token) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => bridge.cancelCreate(token)),
      new Promise(resolve => { timer = setTimeout(resolve, 1000); }),
    ]);
  } catch {} finally { clearTimeout(timer); }
}
module.exports = { explorerCreateTransaction };
