import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness, connectLiveData, MAX_POLL_FAILURES, STALE_AFTER_MS } from './live';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (event: MessageEvent) => void>();
  closed = false;

  constructor(public url: string | URL) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener as (event: MessageEvent) => void);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown, lastEventId = '') {
    this.listeners.get(type)?.({ data: JSON.stringify(data), lastEventId } as MessageEvent);
  }
}

test('classifies index lag and stale data without inventing freshness', () => {
  assert.equal(classifyFreshness({ summary: { latestHeight: 12, indexedHeight: 10 } }, 100, 100), 'catching-up');
  assert.equal(classifyFreshness({ summary: { rpcHeight: 12, indexedHeight: 11, syncLagBlocks: 1 } }, 100, 100), 'catching-up');
  assert.equal(classifyFreshness({ summary: { latestHeight: 12, indexedHeight: 12 } }, 100, 100 + STALE_AFTER_MS + 1), 'stale');
});

test('preserves native SSE recovery and uses bounded polling fallback', async () => {
  FakeEventSource.instances = [];
  const statuses: string[] = [];
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok: false, json: async () => ({}) } as Response;
  };
  const stop = connectLiveData(
    { onSnapshot: () => {}, onStatus: status => statuses.push(status) },
    { eventSource: FakeEventSource as unknown as typeof EventSource, fetcher, reconnectBaseMs: 5, pollMs: 5 }
  );
  assert.equal(FakeEventSource.instances.length, 1);
  FakeEventSource.instances[0].onerror?.();
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(FakeEventSource.instances[0].closed, false);
  assert.ok(statuses.includes('polling'));
  assert.ok(statuses.includes('unavailable'));
  assert.ok(calls <= MAX_POLL_FAILURES * 4);
  stop();
});

test('accepts a dashboard event and reports catch-up', () => {
  FakeEventSource.instances = [];
  const statuses: string[] = [];
  let snapshots = 0;
  const stop = connectLiveData(
    { onSnapshot: () => snapshots += 1, onStatus: value => statuses.push(value) },
    { eventSource: FakeEventSource as unknown as typeof EventSource }
  );
  FakeEventSource.instances[0].emit('dashboard', { summary: { latestHeight: 8, indexedHeight: 7 } });
  assert.equal(snapshots, 1);
  assert.equal(statuses.at(-1), 'catching-up');
  stop();
});

test('surfaces a history gap and accepts the following snapshot', async () => {
  FakeEventSource.instances = [];
  const statuses: string[] = [];
  const details: string[] = [];
  let snapshots = 0;
  const fetcher = async () => ({ ok: false, json: async () => ({}) } as Response);
  const stop = connectLiveData(
    {
      onSnapshot: () => snapshots += 1,
      onStatus: (status, detail) => {
        statuses.push(status);
        if (detail) details.push(detail);
      }
    },
    { eventSource: FakeEventSource as unknown as typeof EventSource, fetcher, reconnectBaseMs: 50, pollMs: 50 }
  );
  const source = FakeEventSource.instances[0];
  source.emit('stream-reset', { schemaVersion: 'explorer.stream-recovery.v1', recovery: 'snapshot', reason: 'history_expired' });
  source.emit('dashboard', { summary: { rpcHeight: 9, indexedHeight: 9, syncLagBlocks: 0 } }, '9');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(snapshots, 1);
  assert.equal(statuses.at(-1), 'live');
  assert.ok(details.some(detail => detail.includes('history expired')));
  stop();
});
