const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64Raw(value: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < value.length; offset += 3) {
    const first = value[offset] ?? 0;
    const second = value[offset + 1];
    const third = value[offset + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64[(combined >>> 18) & 63];
    output += BASE64[(combined >>> 12) & 63];
    if (second !== undefined) output += BASE64[(combined >>> 6) & 63];
    if (third !== undefined) output += BASE64[combined & 63];
  }
  return output;
}

export function base64RawToBytes(value: string, label = "value"): Uint8Array {
  if (!/^[A-Za-z0-9+/_-]+$/.test(value)) throw new Error(`${label} must be raw base64`);
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const output: number[] = [];
  for (let offset = 0; offset < normalized.length; offset += 4) {
    const chunk = normalized.slice(offset, offset + 4);
    const indexes = [...chunk].map((character) => BASE64.indexOf(character));
    if (indexes.some((index) => index < 0) || chunk.length === 1) throw new Error(`${label} must be raw base64`);
    const combined = ((indexes[0] ?? 0) << 18) | ((indexes[1] ?? 0) << 12) | ((indexes[2] ?? 0) << 6) | (indexes[3] ?? 0);
    output.push((combined >>> 16) & 255);
    if (chunk.length > 2) output.push((combined >>> 8) & 255);
    if (chunk.length > 3) output.push(combined & 255);
  }
  return Uint8Array.from(output);
}
