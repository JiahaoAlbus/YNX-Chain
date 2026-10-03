// Public opaque transport data only. No key, credential or trusted context here.
// Native CryptoEngine must verify the authenticated inner envelope independently.
export const VEIL_MATRIX_EVENT = 'com.ynx.social.veil.encrypted.v2';
const SUITE = 'signal-session-0.104.0';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CIPHER = 2 * 1024 * 1024;

export type VeilMatrixContent = Readonly<{
  version: 2; suite: typeof SUITE; ciphertext_type: 2 | 3;
  sender_message_id: string;
  ciphertext: Readonly<{ url: string; sha256: string; size: number }>;
}>;
export type VeilMatrixPending = Readonly<{
  localOperationId: string; senderMessageId: string; matrixTransactionId: string | null;
  roomId: string; senderUserId: string; contentJson: string;
  phase: 'prepared' | 'unknown' | 'observed'; eventId: string | null;
}>;

function fail(code: string): never { throw new Error(code); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VEIL_MATRIX_EVENT_INVALID');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) fail('VEIL_MATRIX_EVENT_INVALID');
  return record;
}
function text(value: unknown, maximum = 255): string {
  if (typeof value !== 'string' || !value || value.length > maximum
    || /[\u0000-\u001f\u007f]/.test(value)) fail('VEIL_MATRIX_EVENT_INVALID');
  for (let i = 0; i < value.length; i++) {
    const point = value.charCodeAt(i);
    if (point >= 0xd800 && point <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) fail('VEIL_MATRIX_EVENT_INVALID');
    } else if (point >= 0xdc00 && point <= 0xdfff) fail('VEIL_MATRIX_EVENT_INVALID');
  }
  if (new TextEncoder().encode(value).length > maximum) fail('VEIL_MATRIX_EVENT_INVALID');
  return value;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail('VEIL_MATRIX_EVENT_INVALID');
  return value;
}
function parse(raw: string, maximum: number): unknown {
  if (typeof raw !== 'string' || raw.length > maximum
    || new TextEncoder().encode(raw).length > maximum) fail('VEIL_MATRIX_EVENT_INVALID');
  try { return JSON.parse(raw) as unknown; } catch { return fail('VEIL_MATRIX_EVENT_INVALID'); }
}

// Always references opaque ciphertext in Matrix media storage. No inline text,
// private attachment key, identity pin, epoch or authorization claim on the wire.
export function checkedVeilMatrixContent(value: unknown): VeilMatrixContent {
  const source = object(value, ['version', 'suite', 'ciphertext_type', 'sender_message_id', 'ciphertext']);
  if (source.version !== 2) fail('VEIL_ENVELOPE_VERSION_UNSUPPORTED');
  if (source.suite !== SUITE) fail('VEIL_ENVELOPE_SUITE_UNSUPPORTED');
  if (source.ciphertext_type !== 2 && source.ciphertext_type !== 3) fail('VEIL_MATRIX_EVENT_INVALID');
  const cipher = object(source.ciphertext, ['url', 'sha256', 'size']);
  const url = text(cipher.url, 1024);
  // Native SDK downloads mxc media using its original session, never fetch(URL).
  if (!/^mxc:\/\/[A-Za-z0-9.:[\]-]+\/[A-Za-z0-9_-]+$/.test(url)) fail('VEIL_MATRIX_EVENT_INVALID');
  if (typeof cipher.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(cipher.sha256)
    || typeof cipher.size !== 'number' || !Number.isSafeInteger(cipher.size)
    || cipher.size < 1 || cipher.size > MAX_CIPHER) fail('VEIL_MATRIX_EVENT_INVALID');
  return Object.freeze({ version: 2, suite: SUITE, ciphertext_type: source.ciphertext_type,
    sender_message_id: uuid(source.sender_message_id),
    ciphertext: Object.freeze({ url, sha256: cipher.sha256, size: cipher.size }) });
}
export function encodeVeilMatrixContent(value: unknown): string {
  return JSON.stringify(checkedVeilMatrixContent(value));
}
export function decodeVeilMatrixContent(raw: string): VeilMatrixContent {
  return checkedVeilMatrixContent(parse(raw, 4096));
}

export type VeilReaderSelection =
  | Readonly<{ reader: 'veil-v2'; content: VeilMatrixContent }>
  | Readonly<{ reader: 'legacy-read-only'; algorithm: string; originalJson: string }>
  | Readonly<{ reader: 'not-encrypted' }>;

// Does not decrypt or rewrite legacy history. Original readers retain the exact
// old JSON. Unknown new versions/suites never route to a legacy sender/reader.
export function selectVeilMatrixReader(eventType: string, rawContent: string): VeilReaderSelection {
  if (eventType === VEIL_MATRIX_EVENT) return Object.freeze({ reader: 'veil-v2', content: decodeVeilMatrixContent(rawContent) });
  if (eventType.startsWith('com.ynx.social.veil.encrypted.')) fail('VEIL_ENVELOPE_VERSION_UNSUPPORTED');
  if (eventType !== 'm.room.encrypted') return Object.freeze({ reader: 'not-encrypted' });
  const value = parse(rawContent, 65536);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VEIL_MATRIX_EVENT_INVALID');
  const algorithm = (value as Record<string, unknown>).algorithm;
  if (algorithm !== 'm.olm.v1.curve25519-aes-sha2' && algorithm !== 'm.megolm.v1.aes-sha2'
    && algorithm !== 'x25519-hkdf-sha256-xchacha20poly1305') fail('VEIL_ENVELOPE_SUITE_UNSUPPORTED');
  return Object.freeze({ reader: 'legacy-read-only', algorithm, originalJson: rawContent });
}

// Namespace separation is structural: identifiers may coincide in value but
// are never substituted for each other. Native protected journal remains owner.
export function prepareVeilMatrixPending(input: Omit<VeilMatrixPending, 'phase' | 'eventId'>): VeilMatrixPending {
  const localOperationId = uuid(input.localOperationId);
  const senderMessageId = uuid(input.senderMessageId);
  const matrixTransactionId = input.matrixTransactionId === null ? null : text(input.matrixTransactionId);
  const roomId = text(input.roomId);
  const senderUserId = text(input.senderUserId);
  if (!roomId.startsWith('!') || !roomId.includes(':') || !senderUserId.startsWith('@') || !senderUserId.includes(':')) fail('VEIL_MATRIX_EVENT_INVALID');
  const content = decodeVeilMatrixContent(input.contentJson);
  if (content.sender_message_id !== senderMessageId) fail('VEIL_AUTHENTICATED_MESSAGE_REUSE');
  return Object.freeze({ localOperationId, senderMessageId, matrixTransactionId, roomId, senderUserId,
    contentJson: encodeVeilMatrixContent(content), phase: 'prepared', eventId: null });
}
export function markVeilMatrixAttempted(pending: VeilMatrixPending): VeilMatrixPending {
  if (pending.phase !== 'prepared' || pending.eventId !== null) fail('VEIL_MATRIX_ORIGINAL_READBACK_REQUIRED');
  return Object.freeze({ ...pending, phase: 'unknown' });
}
export function veilMatrixRetryDecision(pending: VeilMatrixPending): 'send-original' | 'readback-only' | 'already-observed' {
  if (pending.phase === 'prepared') return 'send-original';
  if (pending.phase === 'unknown') return 'readback-only';
  if (pending.phase === 'observed' && pending.eventId) return 'already-observed';
  return fail('VEIL_MATRIX_ORIGINAL_READBACK_REQUIRED');
}
// This is a transport observation, NOT an inner-envelope authentication proof
// or delivery/read receipt. Native receive authenticates all context separately.
export function observeVeilMatrixOriginal(pending: VeilMatrixPending, event: Readonly<{
  eventId: string; roomId: string; sender: string; type: string; contentJson: string;
}>): VeilMatrixPending {
  const eventId = text(event.eventId);
  if (!eventId.startsWith('$') || event.roomId !== pending.roomId || event.sender !== pending.senderUserId
    || event.type !== VEIL_MATRIX_EVENT || encodeVeilMatrixContent(decodeVeilMatrixContent(event.contentJson)) !== pending.contentJson)
    fail('VEIL_MATRIX_ORIGINAL_READBACK_MISMATCH');
  if (pending.phase === 'observed' && pending.eventId !== eventId) fail('VEIL_AUTHENTICATED_MESSAGE_REUSE');
  return Object.freeze({ ...pending, phase: 'observed', eventId });
}
