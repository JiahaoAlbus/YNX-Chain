import type { Availability, DashboardSnapshot } from './types';

export const STALE_AFTER_MS = 15_000;
export const MAX_POLL_FAILURES = 3;

export interface LiveHandlers {
  onSnapshot(snapshot: DashboardSnapshot): void;
  onStatus(status: Availability, detail?: string): void;
}
export interface LiveOptions {
  eventSource?: typeof EventSource;
  fetcher?: typeof fetch;
  timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
  now?: () => number;
  reconnectBaseMs?: number;
  pollMs?: number;
}

export function classifyFreshness(snapshot: DashboardSnapshot, receivedAt: number, now = Date.now()): Availability {
  const latest = Number(snapshot.summary?.latestHeight ?? 0);
  const indexed = Number(snapshot.summary?.indexedHeight ?? latest);
  if (latest > indexed) return 'catching-up';
  return now - receivedAt > STALE_AFTER_MS ? 'stale' : 'live';
}

export function connectLiveData(handlers: LiveHandlers, options: LiveOptions = {}) {
  const ES = options.eventSource ?? EventSource;
  const fetcher = options.fetcher ?? fetch;
  const timers = options.timers ?? globalThis;
  const now = options.now ?? Date.now;
  const reconnectBase = options.reconnectBaseMs ?? 1_000;
  const pollMs = options.pollMs ?? 10_000;
  let source: EventSource | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let reconnects = 0;
  let pollFailures = 0;

  const clear = () => {
    if (reconnectTimer) timers.clearTimeout(reconnectTimer);
    if (pollTimer) timers.clearTimeout(pollTimer);
    source?.close();
  };

  const accept = (snapshot: DashboardSnapshot) => {
    const receivedAt = now();
    handlers.onSnapshot(snapshot);
    handlers.onStatus(classifyFreshness(snapshot, receivedAt, now()), snapshot.warnings?.join(' · '));
    reconnects = 0;
    pollFailures = 0;
  };

  const poll = async () => {
    if (stopped) return;
    handlers.onStatus('polling', 'Live stream interrupted; bounded snapshot polling is active.');
    try {
      const [summary, blocks, transactions, validators] = await Promise.all([
        fetcher('/api/summary'), fetcher('/api/blocks/latest'), fetcher('/api/txs'), fetcher('/api/validators')
      ]);
      if (![summary, blocks, transactions, validators].every(r => r.ok)) throw new Error('one or more snapshot sources rejected the request');
      accept({ summary: await summary.json(), blocks: await blocks.json(), transactions: await transactions.json(), validators: await validators.json() });
    } catch (error) {
      pollFailures += 1;
      handlers.onStatus(pollFailures >= MAX_POLL_FAILURES ? 'unavailable' : 'stale', error instanceof Error ? error.message : 'snapshot failed');
    }
    if (!stopped && pollFailures < MAX_POLL_FAILURES) pollTimer = timers.setTimeout(poll, pollMs);
  };

  const connect = () => {
    if (stopped) return;
    handlers.onStatus('connecting');
    source = new ES('/api/stream');
    source.addEventListener('dashboard', event => {
      try { accept(JSON.parse((event as MessageEvent).data)); }
      catch { handlers.onStatus('stale', 'The upstream emitted an invalid dashboard event.'); }
    });
    source.addEventListener('upstream-error', event => handlers.onStatus('stale', (event as MessageEvent).data || 'Upstream error'));
    source.onopen = () => { reconnects = 0; };
    source.onerror = () => {
      source?.close();
      reconnects += 1;
      void poll();
      reconnectTimer = timers.setTimeout(connect, Math.min(reconnectBase * 2 ** (reconnects - 1), 8_000));
    };
  };
  connect();
  return () => { stopped = true; clear(); };
}
