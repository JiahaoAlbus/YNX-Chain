// Public, same-origin reads only. This module has no Wallet or account capability.
export const MARKET = 'YNXT-YUSD_TEST';
export const SNAPSHOT_PATH = '/api/v1/market-data/snapshot';
export const STREAM_PATH = '/api/v1/market-data/stream';
const invalid = () => Object.assign(new Error('The venue returned invalid market data.'), {code: 'MARKET_DATA_INVALID'});
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const MAX_MARKET_DOCUMENT_BYTES = 8 * 1024 * 1024;

// Keep additive venue audit fields, but do not silently choose the last value
// of a duplicated JSON key. Scan before materializing deeply nested documents.
function parseMarketDocument(text) {
  if (typeof text !== 'string' || text.length > MAX_MARKET_DOCUMENT_BYTES || new TextEncoder().encode(text).byteLength > MAX_MARKET_DOCUMENT_BYTES) throw invalid();
  let cursor = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(text[cursor] ?? '\0')) cursor++; };
  const stringToken = () => {
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor] === '\\') { cursor += 2; continue; }
      if (text[cursor++] === '"') return text.slice(start, cursor);
    }
    throw invalid();
  };
  const scan = depth => {
    if (depth > 64) throw invalid();
    whitespace();
    if (text[cursor] === '"') { stringToken(); return; }
    if (text[cursor] === '{' || text[cursor] === '[') {
      const object = text[cursor++] === '{', close = object ? '}' : ']', keys = new Set();
      whitespace();
      if (text[cursor] === close) { cursor++; return; }
      while (cursor < text.length) {
        if (object) {
          if (text[cursor] !== '"') throw invalid();
          const key = JSON.parse(stringToken());
          if (keys.has(key)) throw invalid();
          keys.add(key); whitespace();
          if (text[cursor++] !== ':') throw invalid();
        }
        scan(depth + 1); whitespace();
        if (text[cursor] === close) { cursor++; return; }
        if (text[cursor++] !== ',') throw invalid();
        whitespace();
      }
      throw invalid();
    }
    const start = cursor;
    while (cursor < text.length && !/[\t\n\r ,}\]]/.test(text[cursor])) cursor++;
    if (cursor === start) throw invalid();
  };
  try {
    scan(0); whitespace();
    if (cursor !== text.length) throw invalid();
    return JSON.parse(text);
  } catch { throw invalid(); }
}

async function readMarketDocument(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_MARKET_DOCUMENT_BYTES)) throw invalid();
  const reader = response.body?.getReader();
  if (!reader) throw invalid();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once:true});
  let size = 0;
  const decoder = new TextDecoder('utf-8', {fatal:true}), parts = [];
  try {
    if (signal.aborted) throw invalid();
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MARKET_DOCUMENT_BYTES) throw invalid();
      parts.push(decoder.decode(value, {stream:true}));
    }
    parts.push(decoder.decode());
    return parseMarketDocument(parts.join(''));
  } catch (error) {
    if (error?.code === 'MARKET_DATA_INVALID') throw error;
    throw invalid();
  } finally {
    signal.removeEventListener('abort', cancel); cancel();
    try { reader.releaseLock(); } catch {}
  }
}

export const CANDLE_INTERVALS = Object.freeze([60_000, 300_000, 3_600_000]);

// A snapshot retains at most 1000 venue matches, not complete candle history.
// Never fill empty intervals, extend prices, or certify bucket completeness.
export function aggregateRetainedCandles(trades, intervalMs) {
  if (!CANDLE_INTERVALS.includes(intervalMs) || !Array.isArray(trades) || trades.length > 1000) throw invalid();
  const ids = new Set();
  const ordered = trades.map(trade => {
    if (!trade || typeof trade.id !== 'string' || !trade.id || ids.has(trade.id) || trade.market !== MARKET ||
        !integer(trade.priceMicro, 1) || !integer(trade.amountMicro, 1) || !date(trade.createdAt) ||
        trade.sourceType !== 'deterministic_price_time_match' || !/^[a-f0-9]{64}$/.test(trade.sourceDigest)) throw invalid();
    ids.add(trade.id);
    const time = Date.parse(trade.createdAt);
    // Date.parse truncates sub-ms precision; preserve venue RFC3339 nanoseconds.
    const fraction = trade.createdAt.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '';
    const subMs = Number(fraction.padEnd(9, '0').slice(3, 9));
    return {trade, time, subMs};
  }).sort((a,b) => a.time-b.time || a.subMs-b.subMs || a.trade.id.localeCompare(b.trade.id));
  const candles = [];
  for (const {trade,time} of ordered) {
    const start = Math.floor(time/intervalMs)*intervalMs;
    let candle = candles.at(-1);
    if (!candle || candle.start !== start) {
      candle = {start, end:start+intervalMs, openMicro:trade.priceMicro, highMicro:trade.priceMicro,
        lowMicro:trade.priceMicro, closeMicro:trade.priceMicro, volumeMicro:'0', trades:[], complete:false};
      candles.push(candle);
    }
    candle.highMicro = Math.max(candle.highMicro,trade.priceMicro);
    candle.lowMicro = Math.min(candle.lowMicro,trade.priceMicro);
    candle.closeMicro = trade.priceMicro;
    candle.volumeMicro = (BigInt(candle.volumeMicro)+BigInt(trade.amountMicro)).toString();
    candle.trades.push({id:trade.id,sourceDigest:trade.sourceDigest});
  }
  return candles;
}

export function validateSnapshot(value) {
  const source = value?.sourceMetadata, book = value?.orderBook;
  if (value?.schemaVersion !== 'exchange-public-market-v1' || value.market !== MARKET || !integer(value.revision) ||
      source?.authority !== 'YNX-owned deterministic order state' || source.classification !== 'testnet' ||
      !['live', 'degraded_single_host'].includes(source.status) || !date(source.asOf) ||
      typeof source.version !== 'string' || !source.version || typeof source.coverage !== 'string' || !source.coverage ||
      !['postgresql', 'file_snapshot'].includes(source.stateBackend) || typeof source.multiInstance !== 'boolean' ||
      (source.status === 'live' && (!source.multiInstance || source.stateBackend !== 'postgresql')) ||
      book?.market !== MARKET || !Array.isArray(book.bids) || !Array.isArray(book.asks) || !Array.isArray(value.trades) || value.trades.length > 1000) throw invalid();
  const orderIDs = new Set(), tradeIDs = new Set();
  for (const [side, rows] of [['buy', book.bids], ['sell', book.asks]]) {
    for (const row of rows) {
      if (!row?.id || typeof row.id !== 'string' || orderIDs.has(row.id) || row.market !== MARKET || row.side !== side ||
          !integer(row.priceMicro, 1) || !integer(row.amountMicro, 1) || !integer(row.filledMicro) || row.filledMicro >= row.amountMicro || !date(row.createdAt)) throw invalid();
      orderIDs.add(row.id);
    }
  }
  for (const trade of value.trades) {
    if (!trade?.id || typeof trade.id !== 'string' || tradeIDs.has(trade.id) || trade.market !== MARKET || !integer(trade.priceMicro, 1) ||
        !integer(trade.amountMicro, 1) || !date(trade.createdAt) || trade.sourceType !== 'deterministic_price_time_match' || !/^[a-f0-9]{64}$/.test(trade.sourceDigest)) throw invalid();
    tradeIDs.add(trade.id);
  }
  return value;
}

export function formatMicro(value, locale = 'en') {
  if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) throw invalid();
  const raw = BigInt(value), sign = raw < 0n ? '-' : '', amount = raw < 0n ? -raw : raw;
  const whole = new Intl.NumberFormat(locale, {maximumFractionDigits: 0}).format(amount / 1_000_000n);
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal').value;
  return `${sign}${whole}${separator}${fraction}`;
}

export function createMarketFeed({fetchImpl = globalThis.fetch, EventSourceImpl = globalThis.EventSource, onSnapshot, onStatus,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout} = {}) {
  let epoch = 0, stopped = true, snapshot = null, revisionContents = null, stream = null, abort = null, requestTimer = null, retryTimer = null, watchdog = null, observationTimer = null, attempts = 0;
  const report = (phase, code = null) => onStatus?.({phase, code, source: snapshot?.sourceMetadata ?? null});
  function cancel() {
    abort?.abort(); abort = null;
    clearTimer(requestTimer); requestTimer = null;
    stream?.close(); stream = null;
    clearTimer(retryTimer); retryTimer = null;
    clearTimer(watchdog); watchdog = null;
    clearTimer(observationTimer); observationTimer = null;
  }
  function apply(value) {
    const next = validateSnapshot(value);
    if (snapshot && next.revision < snapshot.revision) throw invalid();
    // The venue binds revision to persisted state.Sequence. Observation time,
    // transport health and row ordering can change without a state mutation,
    // but prices, fills and match provenance cannot change at the same revision.
    const sorted = rows => rows.slice().sort((a,b)=>a.id.localeCompare(b.id));
    const order = row => [row.id,row.market,row.side,row.priceMicro,row.amountMicro,row.filledMicro,row.createdAt];
    const trade = row => [row.id,row.market,row.priceMicro,row.amountMicro,row.createdAt,row.sourceType,row.sourceDigest];
    const contents = JSON.stringify([sorted(next.orderBook.bids).map(order),sorted(next.orderBook.asks).map(order),sorted(next.trades).map(trade)]);
    if (snapshot && next.revision === snapshot.revision && contents !== revisionContents) throw invalid();
    revisionContents = contents;
    snapshot = next;
    onSnapshot?.(snapshot);
  }
  function reconnect(code) {
    if (stopped) return;
    ++epoch; cancel();
    report(snapshot ? 'reconnecting' : 'unavailable', code);
    retryTimer = setTimer(() => refresh(), Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)));
  }
  function armWatchdog(token) {
    clearTimer(watchdog);
    watchdog = setTimer(() => { if (token === epoch) reconnect('MARKET_STREAM_TIMEOUT'); }, 20_000);
  }
  function subscribe(token) {
    if (!EventSourceImpl) {
      report('polling');
      retryTimer = setTimer(() => refresh(), 5000);
      return;
    }
    try {
      stream = new EventSourceImpl(STREAM_PATH, {withCredentials: false});
      const receive = event => {
        if (token !== epoch || stopped) return;
        try { apply(parseMarketDocument(event.data)); attempts = 0; report('live'); armWatchdog(token); }
        catch { reconnect('MARKET_DATA_INVALID'); }
      };
      stream.addEventListener('snapshot', receive);
      stream.addEventListener('reconciled', receive);
      stream.addEventListener('heartbeat', event => {
        if (token !== epoch || stopped) return;
        try {
          const body = parseMarketDocument(event.data);
          if (!integer(body.revision) || body.revision < snapshot.revision) throw invalid();
          // A heartbeat carries no depth/trades. A newer revision means the
          // full reconciliation was missed; never promote cached data to live.
          if (body.revision > snapshot.revision) { reconnect('MARKET_REVISION_GAP'); return; }
          armWatchdog(token);
        }
        catch { reconnect('MARKET_DATA_INVALID'); }
      });
      stream.addEventListener('source-unavailable', () => { if (token === epoch) reconnect('MARKET_SOURCE_UNAVAILABLE'); });
      stream.onerror = () => { if (token === epoch) reconnect('MARKET_STREAM_DISCONNECTED'); };
      armWatchdog(token);
      // Unchanged-state heartbeats are not new source observations. Refresh
      // the actual snapshot before the 120-second advisory-rule age limit.
      observationTimer = setTimer(() => { if (token === epoch && !stopped) return refresh(); }, 60_000);
    } catch { reconnect('MARKET_STREAM_UNAVAILABLE'); }
  }
  async function refresh() {
    stopped = false;
    const token = ++epoch;
    cancel(); report(snapshot ? 'reconnecting' : 'loading');
    const controller = new AbortController(); abort = controller;
    let rejectAborted;
    const aborted = new Promise((_,reject) => { rejectAborted = () => reject(Object.assign(new Error('Market read cancelled'),{code:'MARKET_SOURCE_UNAVAILABLE'})); });
    controller.signal.addEventListener('abort',rejectAborted,{once:true});
    // Retire the epoch at the deadline, not just the fetch signal. A stalled
    // transport/body must not keep loading alive or apply a late response.
    const timeout = setTimer(() => { if (token === epoch && !stopped) reconnect('MARKET_SOURCE_UNAVAILABLE'); }, 10_000);
    requestTimer = timeout;
    try {
      // Signal cancellation alone does not guarantee a custom transport or
      // delayed body settles. Bound callers too, without accepting late data.
      const body = await Promise.race([(async () => {
        const response = await fetchImpl(SNAPSHOT_PATH, {method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: {Accept: 'application/json'}, signal: controller.signal});
        if (!response.ok) throw Object.assign(new Error('Market read failed'), {code: response.status === 429 ? 'MARKET_RATE_LIMITED' : 'MARKET_SOURCE_UNAVAILABLE'});
        if (!/^application\/json\b/i.test(response.headers.get('content-type') || '')) throw invalid();
        return readMarketDocument(response, controller.signal);
      })(),aborted]);
      if (token !== epoch || stopped) return;
      apply(body); report('live'); subscribe(token);
    } catch (error) {
      if (token === epoch && !stopped) reconnect(error?.code === 'MARKET_DATA_INVALID' ? error.code : error?.code === 'MARKET_RATE_LIMITED' ? error.code : 'MARKET_SOURCE_UNAVAILABLE');
    } finally { clearTimer(timeout); if (requestTimer === timeout) requestTimer = null; controller.signal.removeEventListener('abort',rejectAborted); }
  }
  return Object.freeze({start: refresh, retry: refresh,
    offline() { stopped = true; ++epoch; cancel(); report('offline'); },
    stop() { stopped = true; ++epoch; cancel(); },
    snapshot: () => snapshot});
}
