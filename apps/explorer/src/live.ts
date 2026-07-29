import { summaryLatestHeight, type Availability, type DashboardSnapshot } from './types';

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
  const latest = Number(summaryLatestHeight(snapshot.summary) ?? 0);
  const indexed = Number(snapshot.summary?.indexedHeight ?? latest);
  const lag = Number(snapshot.summary?.syncLagBlocks ?? Math.max(0, latest - indexed));
  if (lag > 0) return 'catching-up';
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
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let reconnects = 0;
  let pollFailures = 0;
  let pollingActive = false;

  const stopPolling = () => {
    pollingActive = false;
    if (pollTimer) timers.clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const clear = () => {
    stopPolling();
    source?.close();
  };

  const accept = (snapshot: DashboardSnapshot, fromStream = false) => {
    const receivedAt = now();
    if (fromStream) stopPolling();
    handlers.onSnapshot(snapshot);
    handlers.onStatus(classifyFreshness(snapshot, receivedAt, now()), snapshot.warnings?.join(' · '));
    reconnects = 0;
    pollFailures = 0;
  };

  const poll = async () => {
    if (stopped || !pollingActive) return;
    handlers.onStatus('polling', 'Live stream interrupted; bounded snapshot polling is active.');
    try {
      const [summary, blocks, transactions, validators] = await Promise.all([
        fetcher('/api/summary'),
        fetcher('/api/blocks/latest'),
        fetcher('/api/txs'),
        fetcher('/api/validators')
      ]);
      if (![summary, blocks, transactions, validators].every(response => response.ok)) {
        throw new Error('one or more snapshot sources rejected the request');
      }
      accept({
        summary: await summary.json(),
        blocks: await blocks.json(),
        transactions: await transactions.json(),
        validators: await validators.json()
      });
    } catch (error) {
      pollFailures += 1;
      handlers.onStatus(
        pollFailures >= MAX_POLL_FAILURES ? 'unavailable' : 'stale',
        error instanceof Error ? error.message : 'snapshot failed'
      );
    }
    if (!stopped && pollingActive && pollFailures < MAX_POLL_FAILURES) {
      pollTimer = timers.setTimeout(() => void poll(), pollMs);
    }
  };

  const startPolling = (delay = reconnectBase) => {
    if (stopped || pollingActive) return;
    pollingActive = true;
    pollTimer = timers.setTimeout(() => void poll(), delay);
  };

  const connect = () => {
    if (stopped) return;
    handlers.onStatus('connecting');
    source = new ES('/api/stream');
    source.addEventListener('dashboard', event => {
      try {
        accept(JSON.parse((event as MessageEvent).data), true);
      } catch {
        handlers.onStatus('stale', 'The upstream emitted an invalid dashboard event.');
      }
    });
    source.addEventListener('stream-reset', event => {
      let reason = 'event history is unavailable';
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { reason?: string };
        if (payload.reason) reason = payload.reason.replace(/_/g, ' ');
      } catch {
        reason = 'the recovery control event was invalid';
      }
      handlers.onStatus('polling', `Live event gap detected (${reason}); awaiting a full snapshot.`);
      startPolling(0);
    });
    source.addEventListener('upstream-error', event => {
      handlers.onStatus('stale', (event as MessageEvent).data || 'Upstream error');
      startPolling();
    });
    source.onopen = () => {
      reconnects = 0;
      stopPolling();
    };
    source.onerror = () => {
      reconnects += 1;
      handlers.onStatus('connecting', `Live stream reconnect attempt ${reconnects}; native Last-Event-ID recovery remains active.`);
      startPolling(Math.min(reconnectBase * 2 ** (reconnects - 1), 8_000));
    };
  };

  connect();
  return () => {
    stopped = true;
    clear();
  };
}
