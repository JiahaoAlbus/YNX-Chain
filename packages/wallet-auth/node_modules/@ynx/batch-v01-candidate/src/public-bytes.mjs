// Public byte operations only. No Node globals, key material or environment shims.
export function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
export function ordinaryBytes(value) {
  return value instanceof Uint8Array && value.buffer instanceof ArrayBuffer
    && !(typeof SharedArrayBuffer !== 'undefined' && value.buffer instanceof SharedArrayBuffer);
}
export function concatBytes(parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
// Exact bytes key the bounded cache; no digest or batch-id shortcut.
export function base64Bytes(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks = [];
  for (let i = 0; i < value.length; i += 3) {
    const a = value[i], b = value[i + 1] ?? 0, c = value[i + 2] ?? 0;
    chunks.push(alphabet[a >>> 2] + alphabet[((a & 3) << 4) | (b >>> 4)]
      + (i + 1 < value.length ? alphabet[((b & 15) << 2) | (c >>> 6)] : '=')
      + (i + 2 < value.length ? alphabet[c & 63] : '='));
  }
  return chunks.join('');
}
export const publicByteRuntime = Object.freeze({
  name: 'ordinary Uint8Array', isBytes: ordinaryBytes,
  copy: value => new Uint8Array(value), allocate: size => new Uint8Array(size),
});
