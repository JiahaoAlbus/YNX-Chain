import type { MatrixEvent } from './nativeMatrix';

export type MatrixPendingIntent = Readonly<{
  intentId: string; roomId: string; kind: 'text' | 'file'; body: string | null;
  state: 'unknown' | 'queued' | 'sdk-sent-needs-readback' | 'sdk-observed-needs-authenticated-readback';
  eventId: string | null;
}>;

export function checkedOriginals(entries: readonly MatrixPendingIntent[], roomId: string): readonly MatrixPendingIntent[] {
  const ids = new Set<string>();
  return Object.freeze(entries.map(entry => {
    if (!/^native-matrix-[a-f0-9]{32}$/.test(entry.intentId) || entry.roomId !== roomId || ids.has(entry.intentId)
      || !['text', 'file'].includes(entry.kind)
      || !['unknown', 'queued', 'sdk-sent-needs-readback', 'sdk-observed-needs-authenticated-readback'].includes(entry.state)
      || (entry.kind === 'text' && (typeof entry.body !== 'string' || !entry.body.trim() || entry.body.length > 16000))
      || (entry.kind === 'file' && entry.body !== null)
      || (entry.eventId !== null && !/^\$[^\s]+$/.test(entry.eventId))) throw new Error('MATRIX_ORIGINAL_JOURNAL_INVALID');
    ids.add(entry.intentId);
    return Object.freeze({ ...entry });
  }));
}

export function checkedOriginalObservation(suppliedOriginal: MatrixPendingIntent, suppliedEvent: MatrixEvent, self: string) {
  // Keep the checked scalar fields stable without freezing the native producer's
  // objects or retaining references that it can mutate after readback returns.
  const original = Object.freeze({ ...suppliedOriginal });
  const event = Object.freeze({ ...suppliedEvent });
  if (!original.eventId || event.eventId !== original.eventId || event.intentId !== original.intentId
    || !event.own || !event.remote || event.sender !== self || event.kind !== 'message'
    || (original.kind === 'text' && event.body !== original.body)) throw new Error('MATRIX_ORIGINAL_EVENT_CONFLICT');
  return Object.freeze({ original, event, sdkObserved: true as const, delivered: false as const,
    freshServerReadback: false as const, socialIndexConfirmed: false as const });
}
