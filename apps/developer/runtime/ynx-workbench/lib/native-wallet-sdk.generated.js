var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod2) => __copyProps(__defProp({}, "__esModule", { value: true }), mod2);

// ynx-native-wallet-consumer-entry.ts
var ynx_native_wallet_consumer_entry_exports = {};
__export(ynx_native_wallet_consumer_entry_exports, {
  DEVELOPER_WALLET_V2_SOURCE: () => DEVELOPER_WALLET_V2_SOURCE,
  beginDeveloperWalletV2Connection: () => beginDeveloperWalletV2Connection,
  captureResourceOperation: () => captureResourceOperation,
  createDeveloperWalletV2Runtime: () => createDeveloperWalletV2Runtime,
  enterDeveloperWalletV2Guest: () => enterDeveloperWalletV2Guest,
  inspectDeveloperWalletV2Runtime: () => inspectDeveloperWalletV2Runtime,
  isDeveloperResourceReturn: () => isDeveloperResourceReturn,
  receiveResourceReturn: () => receiveResourceReturn,
  subscribeDeveloperWalletCallbacks: () => subscribeDeveloperWalletCallbacks
});
module.exports = __toCommonJS(ynx_native_wallet_consumer_entry_exports);

// frontend/src/wallet/resource-approval-return.ts
var callback = "ynxdeveloper://wallet-auth/callback?developerResourceResult=";
var expectedFields = "account deviceId sessionBinding projectId projectDigest resourceOrigin resourceId action bodyDigest";
var unsignedFields = expectedFields + " version purpose accountPublicKey productClientId bundleId platform origin requiredScope nonce issuedAt expiresAt";
var captured = /* @__PURE__ */ new WeakSet();
var fail = () => {
  throw new Error("DEVELOPER_RESOURCE_RETURN_INVALID");
};
var canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
function fields(v, list) {
  if (!v || Array.isArray(v) || typeof v !== "object" || Object.keys(v).sort().join(" ") !== list.split(" ").sort().join(" ")) fail();
}
function parse(raw, limit) {
  if (typeof raw !== "string" || raw.length > limit || new TextEncoder().encode(raw).length > limit) fail();
  try {
    return JSON.parse(raw);
  } catch {
    return fail();
  }
}
function decode(raw, limit) {
  if (typeof raw !== "string" || raw.length > limit || !/^[A-Za-z0-9_-]+$/.test(raw)) fail();
  try {
    const bytes = Uint8Array.from(atob(raw.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (encoded !== raw) fail();
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail();
  }
}
function captureResourceOperation(input) {
  fields(input, "operationId unsigned expected nonce reviewDigest projectId projectDigest bodyDigest");
  if (typeof input.operationId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.operationId) || !/^([0-9a-f]{64})$/.test(input.reviewDigest)) fail();
  if (typeof input.nonce !== "string" || input.nonce.length !== 43) fail();
  decode(input.nonce, 43);
  const u = parse(input.unsigned, 8192), e = parse(input.expected, 4096);
  fields(u, unsignedFields);
  fields(e, expectedFields);
  if (canonical(u) !== input.unsigned || canonical(e) !== input.expected) fail();
  for (const k of expectedFields.split(" ")) if (typeof e[k] !== "string" || u[k] !== e[k]) fail();
  if (u.version !== 1 || u.purpose !== "developer-project-resource/v1" || u.nonce !== input.nonce || u.productClientId !== "ynx-developer-v1" || u.bundleId !== "com.ynxweb4.developer.testnetpreview" || u.platform !== "macos" || u.origin !== "app://macos/com.ynxweb4.developer.testnetpreview") fail();
  for (const k of ["projectId", "projectDigest", "bodyDigest"]) if (u[k] !== input[k]) fail();
  const result = Object.freeze({ ...input });
  captured.add(result);
  return result;
}
function receiveResourceReturn(url2, pending, current) {
  if (!captured.has(pending) || !captured.has(current) || current !== pending) fail();
  if (typeof url2 !== "string" || url2.length > 16e3 || !url2.startsWith(callback)) fail();
  const text3 = decode(url2.slice(callback.length), 15900), packet = parse(text3, 12e3);
  fields(packet, "version purpose nonce reviewDigest status approval readOnly");
  if (JSON.stringify(packet) !== text3 || packet.version !== 1 || packet.purpose !== "developer-project-resource/v1" || packet.nonce !== pending.nonce || packet.reviewDigest !== pending.reviewDigest || typeof packet.readOnly !== "boolean" || !["signed", "rejected", "declined"].includes(packet.status)) fail();
  if (packet.status === "signed") {
    const proof = parse(packet.approval, 8192);
    fields(proof, unsignedFields + " signature");
    if (canonical(proof) !== packet.approval || typeof proof.signature !== "string" || !/^[0-9a-f]{128}$/.test(proof.signature)) fail();
    const { signature, ...unsigned } = proof;
    if (canonical(unsigned) !== pending.unsigned) fail();
  } else if (packet.approval !== null) fail();
  return Object.freeze({
    operationId: pending.operationId,
    status: packet.status,
    readOnly: packet.readOnly,
    approval: packet.approval,
    verification: packet.status === "signed" ? "supplier-unavailable" : "not-applicable",
    authorityGranted: false,
    projectResourceApproved: false,
    productSessionCreated: false,
    effectAllowed: false,
    settlesPending: false
  });
}
function isDeveloperResourceReturn(url2) {
  if (typeof url2 !== "string") return false;
  try {
    return new URL(url2).searchParams.has("developerResourceResult") || url2.includes("developerResourceResult");
  } catch {
    return url2.includes("developerResourceResult");
  }
}

// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
function anumber(n, title = "") {
  if (typeof n !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(`${prefix}expected number, got ${typeof n}`);
  }
  if (!Number.isSafeInteger(n) || n < 0) {
    const prefix = title && `"${title}" `;
    throw new RangeError(`${prefix}expected integer >= 0, got ${n}`);
  }
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  return value;
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("Hash must wrapped by utils.createHasher");
  anumber(h.outputLen);
  anumber(h.blockLen);
  if (h.outputLen < 1)
    throw new Error('"outputLen" must be >= 1');
  if (h.blockLen < 1)
    throw new Error('"blockLen" must be >= 1');
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "digestInto() output");
  const min = instance.outputLen;
  if (out.length < min) {
    throw new RangeError('"digestInto() output" expected to be of length >=' + min);
  }
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
  if (ch >= asciis._0 && ch <= asciis._9)
    return ch - asciis._0;
  if (ch >= asciis.A && ch <= asciis.F)
    return ch - (asciis.A - 10);
  if (ch >= asciis.a && ch <= asciis.f)
    return ch - (asciis.a - 10);
  return;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new TypeError("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function createHasher(hashCons, info = {}) {
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  anumber(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE2) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE2);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state2 = this.get();
    if (outLen > state2.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state2[i], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to ||= new this.constructor();
    to.set(...this.get());
    const { blockLen, buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (length % blockLen)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@noble/hashes/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;

// node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  constructor(outputLen) {
    super(64, outputLen, 8, false);
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  A = SHA256_IV[0] | 0;
  B = SHA256_IV[1] | 0;
  C = SHA256_IV[2] | 0;
  D = SHA256_IV[3] | 0;
  E = SHA256_IV[4] | 0;
  F = SHA256_IV[5] | 0;
  G = SHA256_IV[6] | 0;
  H = SHA256_IV[7] | 0;
  constructor() {
    super(32);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// node_modules/@noble/curves/utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var abytes2 = (value, length, title) => abytes(value, length, title);
var anumber2 = anumber;
var bytesToHex2 = bytesToHex;
var concatBytes2 = (...arrays) => concatBytes(...arrays);
var hexToBytes2 = (hex) => hexToBytes(hex);
var isBytes2 = isBytes;
var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
function abool(value, title = "") {
  if (typeof value !== "boolean") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected boolean, got type=" + typeof value);
  }
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber2(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function numberToHexUnpadded(num) {
  const hex = abignumber(num).toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber(len);
  if (len === 0)
    throw new RangeError("zero length");
  n = abignumber(n);
  const hex = n.toString(16);
  if (hex.length > len * 2)
    throw new RangeError("number too large");
  return hexToBytes(hex.padStart(len * 2, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes2(bytes));
}
var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n)
    throw new Error("expected non-negative bigint, got " + n);
  let len;
  for (len = 0; n > _0n; n >>= _1n, len += 1)
    ;
  return len;
}
var bitMask = (n) => (_1n << BigInt(n)) - _1n;
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  anumber(hashLen, "hashLen");
  anumber(qByteLen, "qByteLen");
  if (typeof hmacFn !== "function")
    throw new TypeError("hmacFn must be a function");
  const u8n = (len) => new Uint8Array(len);
  const NULL = Uint8Array.of();
  const byte0 = Uint8Array.of(0);
  const byte1 = Uint8Array.of(1);
  const _maxDrbgIters = 1e3;
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...msgs) => hmacFn(k, concatBytes2(v, ...msgs));
  const reseed = (seed = NULL) => {
    k = h(byte0, seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(byte1, seed);
    v = h();
  };
  const gen = () => {
    if (i++ >= _maxDrbgIters)
      throw new Error("drbg: tried max amount of iterations");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes2(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while ((res = pred(gen())) === void 0)
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
function validateObject(object2, fields2 = {}, optFields = {}) {
  if (Object.prototype.toString.call(object2) !== "[object Object]")
    throw new TypeError("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    if (!isOpt && expectedType !== "function" && !Object.hasOwn(object2, fieldName))
      throw new TypeError(`param "${fieldName}" is invalid: expected own property`);
    const val = object2[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields2, false);
  iter(optFields, true);
}

// node_modules/@noble/curves/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _16n = /* @__PURE__ */ BigInt(16);
function mod(a, b) {
  if (b <= _0n2)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n2 ? result : b + result;
}
function pow2(x, power, modulo) {
  if (power < _0n2)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n2) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n2)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _0n2)
    throw new Error("invert: expected positive modulus, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
  while (a !== _0n2) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    const n = y - v * q;
    b = a, a = r, x = u, y = v, u = m, v = n;
  }
  const gcd = b;
  if (gcd !== _1n2)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
  const F = Fp;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp, n) {
  const F = Fp;
  const p1div4 = (F.ORDER + _1n2) / _4n;
  const root = F.pow(n, p1div4);
  assertIsSquare(F, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const F = Fp;
  const p5div8 = (F.ORDER - _5n) / _8n;
  const n2 = F.mul(n, _2n);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare(F, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n) / _16n;
  return ((Fp, n) => {
    const F = Fp;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare(F, root, n);
    return root;
  });
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  let Q = P - _1n2;
  let S = 0;
  while (Q % _2n === _0n2) {
    Q /= _2n;
    S++;
  }
  let Z = _2n;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n2) / _2n;
  return function tonelliSlow(Fp, n) {
    const F = Fp;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        return F.ZERO;
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n2 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    BYTES: "number",
    BITS: "number"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  validateObject(field, opts);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n2)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpPow(Fp, num, power) {
  const F = Fp;
  if (power < _0n2)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n2)
    return F.ONE;
  if (power === _1n2)
    return num;
  let p = F.ONE;
  let d = num;
  while (power > _0n2) {
    if (power & _1n2)
      p = F.mul(p, d);
    d = F.sqr(d);
    power >>= _1n2;
  }
  return p;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  const F = Fp;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  const F = Fp;
  const p1mod2 = (F.ORDER - _1n2) / _2n;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber2(nBitLength);
  if (n <= _0n2)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected bit length (${bits}) >= n.length (${nBitLength})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n2;
  ONE = _1n2;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n2 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n2;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n2) === _1n2;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return FpPow(this, num, power);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes2(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE2, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE2 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE2 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool(condition, "condition");
    return condition ? b : a;
  }
};
Object.freeze(_Field.prototype);
function Field(ORDER, opts = {}) {
  return new _Field(ORDER, opts);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  if (fieldOrder <= _1n2)
    throw new Error("field order must be greater than 1");
  const bitLength = bitLen(fieldOrder - _1n2);
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE2 = false) {
  abytes2(key);
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = Math.max(getMinHashLength(fieldOrder), 16);
  if (len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE2 ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num, fieldOrder - _1n2) + _1n2;
  return isLE2 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// node_modules/@noble/curves/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
function negateCt(condition, item) {
  const neg = item.negate();
  return condition ? neg : item;
}
function normalizeZ(c, points) {
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
  if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
    throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
  validateW(W, scalarBits);
  const windows = Math.ceil(scalarBits / W) + 1;
  const windowSize = 2 ** (W - 1);
  const maxNumber = 2 ** W;
  const mask = bitMask(W);
  const shiftBy = BigInt(W);
  return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window2, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window2 * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window2 % 2 !== 0;
  const offsetF = offsetStart;
  return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
var pointPrecomputes = /* @__PURE__ */ new WeakMap();
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
  return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
  if (n !== _0n3)
    throw new Error("invalid wNAF");
}
var wNAF = class {
  BASE;
  ZERO;
  Fn;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, bits) {
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.Fn = Point.Fn;
    this.bits = bits;
  }
  // non-const time multiplication ladder
  _unsafeLadder(elm, n, p = this.ZERO) {
    let d = elm;
    while (n > _0n3) {
      if (n & _1n3)
        p = p.add(d);
      d = d.double();
      n >>= _1n3;
    }
    return p;
  }
  /**
   * Creates a wNAF precomputation window. Used for caching.
   * Default window size is set by `utils.precompute()` and is equal to 8.
   * Number of precomputed points depends on the curve size:
   * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
   * - 𝑊 is the window size
   * - 𝑛 is the bitlength of the curve order.
   * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
   * @param point - Point instance
   * @param W - window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(point, W) {
    const { windows, windowSize } = calcWOpts(W, this.bits);
    const points = [];
    let p = point;
    let base = p;
    for (let window2 = 0; window2 < windows; window2++) {
      base = p;
      points.push(base);
      for (let i = 1; i < windowSize; i++) {
        base = base.add(p);
        points.push(base);
      }
      p = base.double();
    }
    return points;
  }
  /**
   * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
   * More compact implementation:
   * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
   * @returns real and fake (for const-time) points
   */
  wNAF(W, precomputes, n) {
    if (!this.Fn.isValid(n))
      throw new Error("invalid scalar");
    let p = this.ZERO;
    let f = this.BASE;
    const wo = calcWOpts(W, this.bits);
    for (let window2 = 0; window2 < wo.windows; window2++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window2, wo);
      n = nextN;
      if (isZero) {
        f = f.add(negateCt(isNegF, precomputes[offsetF]));
      } else {
        p = p.add(negateCt(isNeg, precomputes[offset]));
      }
    }
    assert0(n);
    return { p, f };
  }
  /**
   * Implements unsafe EC multiplication using precomputed tables
   * and w-ary non-adjacent form.
   * @param acc - accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
    const wo = calcWOpts(W, this.bits);
    for (let window2 = 0; window2 < wo.windows; window2++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window2, wo);
      n = nextN;
      if (isZero) {
        continue;
      } else {
        const item = precomputes[offset];
        acc = acc.add(isNeg ? item.negate() : item);
      }
    }
    assert0(n);
    return acc;
  }
  getPrecomputes(W, point, transform) {
    let comp = pointPrecomputes.get(point);
    if (!comp) {
      comp = this.precomputeWindow(point, W);
      if (W !== 1) {
        if (typeof transform === "function")
          comp = transform(comp);
        pointPrecomputes.set(point, comp);
      }
    }
    return comp;
  }
  cached(point, scalar, transform) {
    const W = getW(point);
    return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
  }
  unsafe(point, scalar, transform, prev) {
    const W = getW(point);
    if (W === 1)
      return this._unsafeLadder(point, scalar, prev);
    return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
  }
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  createCache(P, W) {
    validateW(W, this.bits);
    pointWindowSizes.set(P, W);
    pointPrecomputes.delete(P);
  }
  hasCache(elm) {
    return getW(elm) !== 1;
  }
};
function mulEndoUnsafe(Point, point, k1, k2) {
  let acc = point;
  let p1 = Point.ZERO;
  let p2 = Point.ZERO;
  while (k1 > _0n3 || k2 > _0n3) {
    if (k1 & _1n3)
      p1 = p1.add(acc);
    if (k2 & _1n3)
      p2 = p2.add(acc);
    acc = acc.double();
    k1 >>= _1n3;
    k2 >>= _1n3;
  }
  return { p1, p2 };
}
function createField(order, field, isLE2) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE: isLE2 });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(typeof val === "bigint" && val > _0n3))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// node_modules/@noble/curves/abstract/weierstrass.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n2) / den;
function _splitEndoScalar(k, basis, n) {
  aInRange("scalar", k, _0n4, n);
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n4;
  const k2neg = k2 < _0n4;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
  if (k1 < _0n4 || k1 >= MAX_NUM || k2 < _0n4 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed for k");
  }
  return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
  if (!["compact", "recovered", "der"].includes(format))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return format;
}
function validateSigOpts(opts, def) {
  validateObject(opts);
  const optsn = {};
  for (let optName of Object.keys(def)) {
    optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
  }
  abool(optsn.lowS, "lowS");
  abool(optsn.prehash, "prehash");
  if (optsn.format !== void 0)
    validateSigFormat(optsn.format);
  return optsn;
}
var DERErr = class extends Error {
  constructor(m = "") {
    super(m);
  }
};
var DER = {
  // asn.1 DER encoding utils
  Err: DERErr,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = DER;
      asafenumber(tag, "tag");
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      if (typeof data !== "string")
        throw new TypeError('"data" expected string, got type=' + typeof data);
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded(tag);
      return t + lenLen + len + data;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data) {
      const { Err: E } = DER;
      data = abytes2(data, void 0, "DER data");
      let pos = 0;
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length = 0;
      if (!isLong)
        length = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length = length << 8 | b;
        pos += lenLen;
        if (length < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(num) {
      const { Err: E } = DER;
      abignumber(num);
      if (num < _0n4)
        throw new E("integer: negative integers are not allowed");
      let hex = numberToHexUnpadded(num);
      if (Number.parseInt(hex[0], 16) & 8)
        hex = "00" + hex;
      if (hex.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex;
    },
    decode(data) {
      const { Err: E } = DER;
      if (data.length < 1)
        throw new E("invalid signature integer: empty");
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data.length > 1 && data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE(data);
    }
  },
  toSig(bytes) {
    const { Err: E, _int: int, _tlv: tlv } = DER;
    const data = abytes2(bytes, void 0, "signature");
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = DER;
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
Object.freeze(DER._tlv);
Object.freeze(DER._int);
Object.freeze(DER);
var _0n4 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _4n2 = /* @__PURE__ */ BigInt(4);
function weierstrass(params, extraOpts = {}) {
  const validated = createCurveFields("weierstrass", params, extraOpts);
  const Fp = validated.Fp;
  const Fn = validated.Fn;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object"
  });
  const { endo, allowInfinityPoint } = extraOpts;
  if (endo) {
    if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const lengths = getWLengths(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    if (allowInfinityPoint && point.is0())
      return Uint8Array.of(0);
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    abool(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes2(pprefix(hasEvenY), bx);
    } else {
      return concatBytes2(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    abytes2(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (allowInfinityPoint && length === 1 && head === 0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const evenY = Fp.isOdd(y);
      const evenH = (head & 1) === 1;
      if (evenH !== evenY)
        y = Fp.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = extraOpts.toBytes === void 0 ? pointToBytes : extraOpts.toBytes;
  const decodePoint = extraOpts.fromBytes === void 0 ? pointFromBytes : extraOpts.fromBytes;
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n2);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("Weierstrass Point expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
    k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
    k1p = negateCt(k1neg, k1p);
    k2p = negateCt(k2neg, k2p);
    return k1p.add(k2p);
  }
  class Point {
    // base / generator point
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    // zero / infinity / identity point
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    // 0, 1, 0
    // math field
    static Fp = Fp;
    // scalar field
    static Fn = Fn;
    X;
    Y;
    Z;
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P = Point.fromAffine(decodePoint(abytes2(bytes, void 0, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(hexToBytes2(hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     *
     * @param windowSize
     * @param isLazy - true will defer table computation until the first multiplication
     * @returns
     */
    precompute(windowSize = 8, isLazy = true) {
      wnaf.createCache(this, windowSize);
      if (!isLazy)
        this.multiply(_3n2);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      const p = this;
      if (p.is0()) {
        if (extraOpts.allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
          return;
        throw new Error("bad point: ZERO");
      }
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a, b } = CURVE;
      const b3 = Fp.mul(b, _3n2);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = Fp.mul(a, Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = Fp.mul(a, t2);
      t3 = Fp.sub(t0, t2);
      t3 = Fp.mul(a, t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      const a = CURVE.a;
      const b3 = Fp.mul(CURVE.b, _3n2);
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = Fp.mul(a, t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = Fp.mul(a, t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = Fp.mul(a, t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      aprjpoint(other);
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar - by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      const { endo: endo2 } = extraOpts;
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: out of range");
      let point, fake;
      const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(Point, p));
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
        const { p: k1p, f: k1f } = mul(k1);
        const { p: k2p, f: k2f } = mul(k2);
        fake = k1f.add(k2f);
        point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
      } else {
        const { p, f } = mul(scalar);
        point = p;
        fake = f;
      }
      return normalizeZ(Point, [point, fake])[0];
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(scalar) {
      const { endo: endo2 } = extraOpts;
      const p = this;
      const sc = scalar;
      if (!Fn.isValid(sc))
        throw new RangeError("invalid scalar: out of range");
      if (sc === _0n4 || p.is0())
        return Point.ZERO;
      if (sc === _1n4)
        return p;
      if (wnaf.hasCache(this))
        return this.multiply(sc);
      if (endo2) {
        const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
        const { p1, p2 } = mulEndoUnsafe(Point, p, k1, k2);
        return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
      } else {
        return wnaf.unsafe(p, sc);
      }
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      const { isTorsionFree } = extraOpts;
      if (cofactor === _1n4)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.unsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      const { clearCofactor } = extraOpts;
      if (cofactor === _1n4)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      if (cofactor === _1n4)
        return this.is0();
      return this.clearCofactor().is0();
    }
    toBytes(isCompressed = true) {
      abool(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex2(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const bits = Fn.BITS;
  const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
  if (bits >= 8)
    Point.BASE.precompute(8);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    // Raw compact `(r || s)` signature width; DER and recovered signatures use
    // different lengths outside this helper.
    signature: 2 * Fn.BYTES
  };
}
function ecdh(Point, ecdhOpts = {}) {
  const { Fn } = Point;
  const randomBytes_ = ecdhOpts.randomBytes === void 0 ? randomBytes2 : ecdhOpts.randomBytes;
  const lengths = Object.assign(getWLengths(Point.Fp, Fn), {
    seed: Math.max(getMinHashLength(Fn.ORDER), 16)
  });
  function isValidSecretKey(secretKey) {
    try {
      const num = Fn.fromBytes(secretKey);
      return Fn.isValidNot0(num);
    } catch (error) {
      return false;
    }
  }
  function isValidPublicKey(publicKey, isCompressed) {
    const { publicKey: comp, publicKeyUncompressed } = lengths;
    try {
      const l = publicKey.length;
      if (isCompressed === true && l !== comp)
        return false;
      if (isCompressed === false && l !== publicKeyUncompressed)
        return false;
      return !!Point.fromBytes(publicKey);
    } catch (error) {
      return false;
    }
  }
  function randomSecretKey(seed) {
    seed = seed === void 0 ? randomBytes_(lengths.seed) : seed;
    return mapHashToField(abytes2(seed, lengths.seed, "seed"), Fn.ORDER);
  }
  function getPublicKey(secretKey, isCompressed = true) {
    return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
  }
  function isProbPub(item) {
    const { secretKey, publicKey, publicKeyUncompressed } = lengths;
    const allowedLengths = Fn._lengths;
    if (!isBytes2(item))
      return void 0;
    const l = abytes2(item, void 0, "key").length;
    const isPub = l === publicKey || l === publicKeyUncompressed;
    const isSec = l === secretKey || !!allowedLengths?.includes(l);
    if (isPub && isSec)
      return void 0;
    return isPub;
  }
  function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
    if (isProbPub(secretKeyA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicKeyB) === false)
      throw new Error("second arg must be public key");
    const s = Fn.fromBytes(secretKeyA);
    const b = Point.fromBytes(publicKeyB);
    return b.multiply(s).toBytes(isCompressed);
  }
  const utils = {
    isValidSecretKey,
    isValidPublicKey,
    randomSecretKey
  };
  const keygen = createKeygen(randomSecretKey, getPublicKey);
  Object.freeze(utils);
  Object.freeze(lengths);
  return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
function ecdsa(Point, hash, ecdsaOpts = {}) {
  const hash_ = hash;
  ahash(hash_);
  validateObject(ecdsaOpts, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  ecdsaOpts = Object.assign({}, ecdsaOpts);
  const randomBytes3 = ecdsaOpts.randomBytes === void 0 ? randomBytes2 : ecdsaOpts.randomBytes;
  const hmac2 = ecdsaOpts.hmac === void 0 ? (key, msg) => hmac(hash_, key, msg) : ecdsaOpts.hmac;
  const { Fp, Fn } = Point;
  const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
  const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts);
  const defaultSigOpts = {
    prehash: true,
    lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : true,
    format: "compact",
    extraEntropy: false
  };
  const hasLargeRecoveryLifts = CURVE_ORDER * _2n2 + _1n4 < Fp.ORDER;
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n4;
    return number > HALF;
  }
  function validateRS(title, num) {
    if (!Fn.isValidNot0(num))
      throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
    return num;
  }
  function assertRecoverableCurve() {
    if (hasLargeRecoveryLifts)
      throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
  }
  function validateSigLength(bytes, format) {
    validateSigFormat(format);
    const size = lengths.signature;
    const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
    return abytes2(bytes, sizer);
  }
  class Signature {
    r;
    s;
    recovery;
    constructor(r, s, recovery) {
      this.r = validateRS("r", r);
      this.s = validateRS("s", s);
      if (recovery != null) {
        assertRecoverableCurve();
        if (![0, 1, 2, 3].includes(recovery))
          throw new Error("invalid recovery id");
        this.recovery = recovery;
      }
      Object.freeze(this);
    }
    static fromBytes(bytes, format = defaultSigOpts.format) {
      validateSigLength(bytes, format);
      let recid;
      if (format === "der") {
        const { r: r2, s: s2 } = DER.toSig(abytes2(bytes));
        return new Signature(r2, s2);
      }
      if (format === "recovered") {
        recid = bytes[0];
        format = "compact";
        bytes = bytes.subarray(1);
      }
      const L = lengths.signature / 2;
      const r = bytes.subarray(0, L);
      const s = bytes.subarray(L, L * 2);
      return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
    }
    static fromHex(hex, format) {
      return this.fromBytes(hexToBytes2(hex), format);
    }
    assertRecovery() {
      const { recovery } = this;
      if (recovery == null)
        throw new Error("invalid recovery id: must be present");
      return recovery;
    }
    addRecoveryBit(recovery) {
      return new Signature(this.r, this.s, recovery);
    }
    // Unlike the top-level helper below, this method expects a digest that has
    // already been hashed to the curve's message representative.
    recoverPublicKey(messageHash) {
      const { r, s } = this;
      const recovery = this.assertRecovery();
      const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
      if (!Fp.isValid(radj))
        throw new Error("invalid recovery id: sig.r+curve.n != R.x");
      const x = Fp.toBytes(radj);
      const R = Point.fromBytes(concatBytes2(pprefix((recovery & 1) === 0), x));
      const ir = Fn.inv(radj);
      const h = bits2int_modN(abytes2(messageHash, void 0, "msgHash"));
      const u1 = Fn.create(-h * ir);
      const u2 = Fn.create(s * ir);
      const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
      if (Q.is0())
        throw new Error("invalid recovery: point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    toBytes(format = defaultSigOpts.format) {
      validateSigFormat(format);
      if (format === "der")
        return hexToBytes2(DER.hexFromSig(this));
      const { r, s } = this;
      const rb = Fn.toBytes(r);
      const sb = Fn.toBytes(s);
      if (format === "recovered") {
        assertRecoverableCurve();
        return concatBytes2(Uint8Array.of(this.assertRecovery()), rb, sb);
      }
      return concatBytes2(rb, sb);
    }
    toHex(format) {
      return bytesToHex2(this.toBytes(format));
    }
  }
  Object.freeze(Signature.prototype);
  Object.freeze(Signature);
  const bits2int = ecdsaOpts.bits2int === void 0 ? function bits2int_def(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE(bytes);
    const delta = bytes.length * 8 - fnBits;
    return delta > 0 ? num >> BigInt(delta) : num;
  } : ecdsaOpts.bits2int;
  const bits2int_modN = ecdsaOpts.bits2int_modN === void 0 ? function bits2int_modN_def(bytes) {
    return Fn.create(bits2int(bytes));
  } : ecdsaOpts.bits2int_modN;
  const ORDER_MASK = bitMask(fnBits);
  function int2octets(num) {
    aInRange("num < 2^" + fnBits, num, _0n4, ORDER_MASK);
    return Fn.toBytes(num);
  }
  function validateMsgAndHash(message, prehash) {
    abytes2(message, void 0, "message");
    return prehash ? abytes2(hash_(message), void 0, "prehashed message") : message;
  }
  function prepSig(message, secretKey, opts) {
    const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    const h1int = bits2int_modN(message);
    const d = Fn.fromBytes(secretKey);
    if (!Fn.isValidNot0(d))
      throw new Error("invalid private key");
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (extraEntropy != null && extraEntropy !== false) {
      const e = extraEntropy === true ? randomBytes3(lengths.secretKey) : extraEntropy;
      seedArgs.push(abytes2(e, void 0, "extraEntropy"));
    }
    const seed = concatBytes2(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!Fn.isValidNot0(k))
        return;
      const ik = Fn.inv(k);
      const q = Point.BASE.multiply(k).toAffine();
      const r = Fn.create(q.x);
      if (r === _0n4)
        return;
      const s = Fn.create(ik * Fn.create(m + r * d));
      if (s === _0n4)
        return;
      let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n4);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = Fn.neg(s);
        recovery ^= 1;
      }
      return new Signature(r, normS, hasLargeRecoveryLifts ? void 0 : recovery);
    }
    return { seed, k2sig };
  }
  function sign(message, secretKey, opts = {}) {
    const { seed, k2sig } = prepSig(message, secretKey, opts);
    const drbg = createHmacDrbg(hash_.outputLen, Fn.BYTES, hmac2);
    const sig = drbg(seed, k2sig);
    return sig.toBytes(opts.format);
  }
  function verify(signature, message, publicKey, opts = {}) {
    const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
    publicKey = abytes2(publicKey, void 0, "publicKey");
    message = validateMsgAndHash(message, prehash);
    if (!isBytes2(signature)) {
      const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
      throw new Error("verify expects Uint8Array signature" + end);
    }
    validateSigLength(signature, format);
    try {
      const sig = Signature.fromBytes(signature, format);
      const P = Point.fromBytes(publicKey);
      if (lowS && sig.hasHighS())
        return false;
      const { r, s } = sig;
      const h = bits2int_modN(message);
      const is = Fn.inv(s);
      const u1 = Fn.create(h * is);
      const u2 = Fn.create(r * is);
      const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
      if (R.is0())
        return false;
      const v = Fn.create(R.x);
      return v === r;
    } catch (e) {
      return false;
    }
  }
  function recoverPublicKey(signature, message, opts = {}) {
    const { prehash } = validateSigOpts(opts, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
  }
  return Object.freeze({
    keygen,
    getPublicKey,
    getSharedSecret,
    utils,
    lengths,
    Point,
    sign,
    verify,
    recoverPublicKey,
    Signature,
    hash: hash_
  });
}

// node_modules/@noble/curves/nist.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var p256_CURVE = /* @__PURE__ */ (() => ({
  p: BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"),
  n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
  h: BigInt(1),
  a: BigInt("0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc"),
  b: BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"),
  Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
  Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
}))();
var p256_Point = /* @__PURE__ */ weierstrass(p256_CURVE);
var p256 = /* @__PURE__ */ ecdsa(p256_Point, sha256);

// vendor/wallet-auth/src/protocol.js
var MAX_REQUEST_LIFETIME_MS = 5 * 60 * 1e3;

// node_modules/@noble/curves/secp256k1.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
var secp256k1_CURVE = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
  n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
  h: BigInt(1),
  a: BigInt(0),
  b: BigInt(7),
  Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
  Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
};
var secp256k1_ENDO = {
  beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
  basises: [
    [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
    [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
  ]
};
var _2n3 = /* @__PURE__ */ BigInt(2);
function sqrtMod(y) {
  const P = secp256k1_CURVE.p;
  const _3n3 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P;
  const b3 = b2 * b2 * y % P;
  const b6 = pow2(b3, _3n3, P) * b3 % P;
  const b9 = pow2(b6, _3n3, P) * b3 % P;
  const b11 = pow2(b9, _2n3, P) * b2 % P;
  const b22 = pow2(b11, _11n, P) * b11 % P;
  const b44 = pow2(b22, _22n, P) * b22 % P;
  const b88 = pow2(b44, _44n, P) * b44 % P;
  const b176 = pow2(b88, _88n, P) * b88 % P;
  const b220 = pow2(b176, _44n, P) * b44 % P;
  const b223 = pow2(b220, _3n3, P) * b3 % P;
  const t1 = pow2(b223, _23n, P) * b22 % P;
  const t2 = pow2(t1, _6n, P) * b2 % P;
  const root = pow2(t2, _2n3, P);
  if (!Fpk1.eql(Fpk1.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fpk1 = Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
var Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
  Fp: Fpk1,
  endo: secp256k1_ENDO
});
var secp256k1 = /* @__PURE__ */ ecdsa(Pointk1, sha256);

// node_modules/@noble/hashes/sha3.js
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n4 = BigInt(2);
var _7n2 = BigInt(7);
var _256n = BigInt(256);
var _0x71n = BigInt(113);
var SHA3_PI = [];
var SHA3_ROTL = [];
var _SHA3_IOTA = [];
for (let round = 0, R = _1n5, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n5;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n5 ^ (R >> _7n2) * _0x71n) % _256n;
    if (R & _2n4)
      t ^= _1n5 << (_1n5 << BigInt(j)) - _1n5;
  }
  _SHA3_IOTA.push(t);
}
var IOTAS = split(_SHA3_IOTA, true);
var SHA3_IOTA_H = IOTAS[0];
var SHA3_IOTA_L = IOTAS[1];
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
function keccakP(s, rounds = 24) {
  anumber(rounds, "rounds");
  if (rounds < 1 || rounds > 24)
    throw new Error('"rounds" expected integer 1..24');
  const B = new Uint32Array(5 * 2);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      const b0 = s[y], b1 = s[y + 1], b2 = s[y + 2], b3 = s[y + 3];
      s[y] ^= ~s[y + 2] & s[y + 4];
      s[y + 1] ^= ~s[y + 3] & s[y + 5];
      s[y + 2] ^= ~s[y + 4] & s[y + 6];
      s[y + 3] ^= ~s[y + 5] & s[y + 7];
      s[y + 4] ^= ~s[y + 6] & s[y + 8];
      s[y + 5] ^= ~s[y + 7] & s[y + 9];
      s[y + 6] ^= ~s[y + 8] & b0;
      s[y + 7] ^= ~s[y + 9] & b1;
      s[y + 8] ^= ~b0 & b2;
      s[y + 9] ^= ~b1 & b3;
    }
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
  clean(B);
}
var Keccak = class _Keccak {
  state;
  pos = 0;
  posOut = 0;
  finished = false;
  state32;
  destroyed = false;
  blockLen;
  suffix;
  outputLen;
  canXOF;
  enableXOF = false;
  rounds;
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.canXOF = enableXOF;
    this.rounds = rounds;
    anumber(outputLen, "outputLen");
    if (!(0 < blockLen && blockLen < 200))
      throw new Error("only keccak-f1600 function is supported");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  clone() {
    return this._cloneInto();
  }
  keccak() {
    swap32IfBE(this.state32);
    keccakP(this.state32, this.rounds);
    swap32IfBE(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { blockLen, state: state2 } = this;
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state2[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state: state2, suffix, pos, blockLen } = this;
    state2[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state2[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists(this, false);
    abytes(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out.subarray(0, this.outputLen));
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.outputLen);
    this.digestInto(out);
    return out;
  }
  destroy() {
    this.destroyed = true;
    clean(this.state);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to ||= new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds);
    to.blockLen = blockLen;
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.canXOF = this.canXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var genKeccak = (suffix, blockLen, outputLen, info = {}) => createHasher(() => new Keccak(blockLen, suffix, outputLen), info);
var keccak_256 = /* @__PURE__ */ genKeccak(1, 136, 32);

// vendor/wallet-auth/src/wallet-provider-discovery.js
var WALLET_PROVIDER_KIND = Object.freeze({ YNX: "ynx-wallet", METAMASK: "metamask" });

// vendor/wallet-auth/src/authorize-launcher.js
var AUTHORIZATION_LAUNCH_PLATFORM_MATRIX = Object.freeze({
  android: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  ios: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  macos: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  windows: Object.freeze({ strategy: "native-resolver", requiresPreflight: true }),
  web: Object.freeze({ strategy: "standard-provider-discovery", requiresPreflight: true }),
  extension: Object.freeze({ strategy: "standard-provider-discovery", requiresPreflight: true })
});

// vendor/wallet-auth/src/registry.js
var REGISTRY_V1_PRODUCT_IDS = Object.freeze([
  "ai",
  "browser",
  "calendar",
  "card",
  "cloud",
  "creator-studio",
  "developer",
  "dex",
  "docs",
  "exchange",
  "explorer",
  "finance",
  "mail",
  "merchant-console",
  "monitor",
  "music",
  "pay",
  "resource-market",
  "search",
  "seller-console",
  "shop",
  "social",
  "trust-center",
  "video",
  "wallet"
]);

// vendor/wallet-auth/src/credential.js
var ALLOWED = Object.freeze({
  "age-eligibility": ["eligible", "not-eligible"],
  "region-eligibility": ["eligible", "not-eligible"],
  merchant: ["verified", "not-verified"],
  institution: ["verified", "not-verified"],
  "kyc-completed-reference": ["completed", "not-completed"],
  "professional-classification-reference": ["accredited", "professional", "not-classified"]
});

// vendor/wallet-auth/src/gateway-adapter.js
var SNAPSHOT_V1_FIELDS = ["schemaVersion", "registryVersion", "sessionStore", "consumedProductProofs"];
var SNAPSHOT_FIELDS = [...SNAPSHOT_V1_FIELDS, "mandateStore"];

// vendor/wallet-auth/src/gateway-http.js
var RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8"
});
var ROUTES = Object.freeze({
  "/v1/wallet/sessions/complete": "complete",
  "/v1/wallet/authorizations/reject": "rejectAuthorization",
  "/v1/wallet/sessions/introspect": "introspect",
  "/v1/wallet/sessions": "sessionInventory",
  "/v1/wallet/sessions/revoke": "revokeSession",
  "/v1/wallet/approvals/revoke": "revokeApproval",
  "/v1/wallet/devices/revoke": "revokeDevice",
  "/v1/wallet/accounts/logout-all": "logoutAllDevices",
  "/v1/wallet/mandates/activate": "activateMandate",
  "/v1/wallet/mandates/authorize-action": "authorizeMandateAction",
  "/v1/wallet/mandates": "mandateInventory",
  "/v1/wallet/mandates/revoke": "revokeMandate",
  "/v1/wallet/mandates/kill": "killMandate",
  "/v1/wallet/mandates/emergency-exit": "emergencyExitMandate"
});

// vendor/wallet-auth/src/product-session-registry.js
var PRODUCT_SESSION_PLATFORMS = Object.freeze(["android", "ios", "macos", "web", "windows"]);
var PRODUCT_FIELDS = [
  "productId",
  "clientId",
  "displayName",
  "applicationId",
  "webOrigin",
  "nativeCallback",
  "legacyCallbacks",
  "scopes",
  "evmCompatible",
  "sessionDurationSeconds"
];
var EXPLICIT_WEB_PRODUCT_FIELDS = [...PRODUCT_FIELDS, "platforms", "webApplicationId", "webCallback"];

// vendor/wallet-auth/src/product-session-v2.js
var REQUEST_MAX_LIFETIME_MS = 5 * 6e4;

// vendor/wallet-auth/src/product-session-router.js
var WALLET_ROUTE_STATUS = Object.freeze({
  READY: "ready",
  WALLET_NOT_INSTALLED: "wallet-not-installed",
  SCHEME_NOT_REGISTERED: "scheme-not-registered",
  SESSION_EXPIRED: "session-expired",
  CALLBACK_MISMATCH: "callback-mismatch",
  USER_REJECTED: "user-rejected",
  NETWORK_UNAVAILABLE: "network-unavailable"
});

// vendor/wallet-auth/src/metamask-evm-adapter.js
var METAMASK_EVM_CONNECTION_STATUS = Object.freeze({
  CONNECTED: "connected-evm"
});
var METAMASK_EVM_CHAIN_QUANTITY = "0x1917";
var METAMASK_EVM_CHAIN = Object.freeze({
  chainId: METAMASK_EVM_CHAIN_QUANTITY,
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
  rpcUrls: Object.freeze(["https://evm.ynxweb4.com"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"])
});
var LIMITATIONS = Object.freeze([
  "evm-provider-only",
  "no-ynx-product-session",
  "no-wallet-ai-gateway-session",
  "no-native-ynx-account-authority"
]);

// vendor/wallet-auth/src/standard-wallet-connect-state.js
var STANDARD_WALLET_CONNECT_STATUS = Object.freeze({
  IDLE: "idle",
  DISCOVERING: "discovering",
  AWAITING_ACCOUNT: "awaiting-account",
  SWITCHING_CHAIN: "switching-chain",
  CONNECTED: "connected",
  WRONG_CHAIN: "wrong-chain",
  DISCONNECTED: "disconnected",
  FAILED: "failed"
});
var STANDARD_WALLET_PRIVATE_SERVICE = Object.freeze({
  NOT_REQUESTED: "not-requested",
  CONNECTING: "connecting",
  READY: "ready",
  DEGRADED: "degraded"
});
var STANDARD_WALLET_RPC_PROBE = Object.freeze({
  NOT_RUN: "not-run",
  READY: "ready",
  DEGRADED: "degraded"
});
var CONNECTED_ACTIONS = Object.freeze(["disconnect", "switch-account", "close"]);
var EMPTY = Object.freeze([]);

// vendor/wallet-auth/src/wallet-error-contract.js
var descriptor = (httpStatus, retryable, safeMessage, developerMessage, monitoringClass, userAction, providerCode = null) => Object.freeze({
  httpStatus,
  retryable,
  safeMessage,
  developerMessage,
  monitoringClass,
  userAction,
  providerCode
});
var WALLET_ERROR_CONTRACT = Object.freeze({
  USER_REJECTED: descriptor(400, false, "Wallet request was rejected.", "The user rejected the provider request.", "wallet-consent", "return-to-product", 4001),
  UNAUTHORIZED: descriptor(401, false, "Wallet permission is required.", "The provider refused the request because the caller is not authorized.", "wallet-permission", "reconnect-wallet", 4100),
  UNSUPPORTED_METHOD: descriptor(405, false, "This Wallet action is not supported.", "The provider does not implement the requested method.", "wallet-capability", "return-to-product", 4200),
  PROVIDER_DISCONNECTED: descriptor(503, true, "Wallet is disconnected.", "The provider is disconnected from every chain.", "wallet-transport", "reconnect-wallet", 4900),
  CHAIN_DISCONNECTED: descriptor(503, true, "Wallet is disconnected from this chain.", "The provider is not connected to the requested chain.", "chain-transport", "reconnect-wallet", 4901),
  UNKNOWN_CHAIN: descriptor(409, true, "YNX Testnet is not registered in this Wallet.", "The provider does not recognize the requested chain.", "chain-configuration", "add-chain", 4902),
  GATEWAY_UNAVAILABLE: descriptor(503, true, "Private YNX services are temporarily unavailable; your Wallet connection remains active.", "The Product Session Gateway could not be reached.", "gateway-transport", "retry"),
  ROUTE_NOT_MOUNTED: descriptor(503, true, "Private YNX services are temporarily unavailable.", "The canonical Product Session route is not mounted at the selected Gateway.", "gateway-routing", "retry"),
  DEVICE_NOT_REGISTERED: descriptor(403, false, "This device is not registered for the product.", "The selected product device is absent from the approved registry.", "device-registration", "register-device"),
  INVALID_DEVICE_PROOF: descriptor(403, false, "Device verification failed.", "The P-256 device proof did not verify against the registered key and canonical payload.", "device-proof", "register-device"),
  DEVICE_KEY_MISMATCH: descriptor(403, false, "This device key does not match the registered product device.", "The supplied device key differs from the registry or pending authorization binding.", "device-binding", "register-device"),
  REGISTRY_VERSION_MISMATCH: descriptor(409, true, "Product registration changed; reconnect to continue.", "The client and Gateway used different accepted registry versions.", "registry-version", "reconnect-wallet"),
  ORIGIN_NOT_REGISTERED: descriptor(403, false, "This website is not registered for Wallet access.", "The canonical HTTPS Origin is absent from the exact product registration.", "origin-registration", "return-to-product"),
  ORIGIN_MISMATCH: descriptor(403, false, "The Wallet return website does not match the request.", "The canonical Origin differs from the authorization, approval, session, or proof binding.", "origin-binding", "return-to-product"),
  CALLBACK_MISMATCH: descriptor(403, false, "The Wallet return target does not match the request.", "The callback differs from the registered pending authorization tuple.", "callback-binding", "return-to-product"),
  PACKAGE_MISMATCH: descriptor(403, false, "This application is not registered for the Wallet request.", "The package, bundle, application, product, or client tuple does not match the registry.", "application-binding", "return-to-product"),
  UNKNOWN_PRODUCT: descriptor(404, false, "This product is not registered for Wallet access.", "No accepted product registration matches the requested product and client.", "product-registration", "contact-product-support"),
  CLIENT_RETIRED: descriptor(410, false, "This application version has been retired.", "The exact product client is retired and cannot create or upgrade Product Sessions.", "client-retirement", "upgrade-client"),
  PRODUCT_SESSION_REQUIRED: descriptor(401, true, "Reconnect Wallet to use this private YNX service.", "The private route requires an active exact Product Session.", "session-required", "reconnect-wallet"),
  PRODUCT_SESSION_EXPIRED: descriptor(401, true, "Your private YNX session expired; reconnect to continue.", "The Product Session or authorization request is outside its accepted lifetime.", "session-expiry", "reconnect-wallet"),
  PRODUCT_SESSION_REVOKED: descriptor(401, false, "This private YNX session was revoked.", "The Product Session, approval, device, or account authority is terminally revoked.", "session-revocation", "reconnect-wallet"),
  SCOPE_NOT_ALLOWED: descriptor(403, false, "This Wallet permission is not allowed for the product.", "The requested scope is absent, reordered, widened, or outside the exact registry allowlist.", "scope-policy", "return-to-product"),
  REPLAY: descriptor(409, false, "This Wallet request was already used.", "The nonce, proof, challenge, callback, or request identifier was replayed.", "replay-detection", "reconnect-wallet"),
  CLOCK_SKEW: descriptor(400, true, "Device time is incorrect; correct it and retry.", "The issued-at or expiry value is outside the accepted clock-skew window.", "clock-skew", "sync-clock"),
  VERSION_INCOMPATIBLE: descriptor(409, false, "This Wallet protocol version is not compatible.", "The client and service protocol versions cannot interoperate safely.", "protocol-version", "upgrade-client"),
  UPGRADE_REQUIRED: descriptor(426, false, "Update this application before reconnecting Wallet.", "The retired or incompatible client must upgrade before authorization.", "client-upgrade", "upgrade-client")
});
var WALLET_PROVIDER_ERROR_CODES = Object.freeze({
  4001: "USER_REJECTED",
  4100: "UNAUTHORIZED",
  4200: "UNSUPPORTED_METHOD",
  4900: "PROVIDER_DISCONNECTED",
  4901: "CHAIN_DISCONNECTED",
  4902: "UNKNOWN_CHAIN"
});
var ALIASES = Object.freeze({
  NETWORK_UNAVAILABLE: "GATEWAY_UNAVAILABLE",
  INVALID_DEVICE_KEY: "DEVICE_KEY_MISMATCH",
  SESSION_EXPIRED: "PRODUCT_SESSION_EXPIRED",
  EXPIRED: "PRODUCT_SESSION_EXPIRED",
  SESSION_REVOKED: "PRODUCT_SESSION_REVOKED",
  REVOKED: "PRODUCT_SESSION_REVOKED",
  SCOPE_NOT_GRANTED: "SCOPE_NOT_ALLOWED",
  SCOPE_WIDENING: "SCOPE_NOT_ALLOWED",
  ISSUED_IN_FUTURE: "CLOCK_SKEW",
  INVALID_TIME: "CLOCK_SKEW",
  UNSUPPORTED_VERSION: "VERSION_INCOMPATIBLE"
});

// vendor/wallet-auth/src/product-session-recovery.js
var PRODUCT_SESSION_CLIENT_STATE = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  GUEST: "guest",
  NETWORK_UNAVAILABLE: "network-unavailable",
  RETRY_REQUIRED: "retry-required"
});

// vendor/wallet-auth/src/wallet-connection-coordinator.js
var WALLET_CONNECTION_COORDINATOR_STATUS = Object.freeze({
  OPTIONS_READY: "options-ready",
  SESSION_STATE: "session-state",
  WALLET_OPENED: "wallet-opened",
  WALLET_OPEN_FAILED: "wallet-open-failed",
  YNX_WALLET_PREFERRED: "ynx-wallet-preferred",
  EVM_CONNECTED: "evm-connected",
  EVM_UNAVAILABLE: "evm-unavailable"
});

// frontend/src/wallet/transport.ts
var binding = Object.freeze({
  version: "1",
  chainId: "ynx_6423-1",
  requestingProduct: "developer",
  productClientId: "ynx-developer-v1",
  bundleId: "com.ynxweb4.developer.testnetpreview",
  productDeviceAlgorithm: "p256-sha256",
  callback: "ynxdeveloper://wallet-auth/callback",
  scopes: Object.freeze(["account:read", "developer:deploy"])
});
function canonicalJSON2(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Wallet protocol numbers must be safe integers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON2).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Wallet request is not canonical JSON.");
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON2(record[key])}`).join(",")}}`;
}
function base64url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function desktopWalletBridge() {
  const candidate2 = typeof window === "undefined" ? void 0 : window.ynxDesktopWallet;
  return candidate2 && typeof candidate2.openAuthorization === "function" ? candidate2 : void 0;
}
function developerWalletV2Bridge() {
  const bridge = desktopWalletBridge(), storage = bridge?.protectedStorage;
  if (!bridge || typeof bridge.device !== "function" || typeof bridge.beginConnection !== "function" || typeof bridge.endConnection !== "function" || typeof bridge.walletAvailability !== "function" || storage?.securityLevel !== "os-protected" || typeof storage.get !== "function" || typeof storage.set !== "function" || typeof storage.remove !== "function") return void 0;
  return bridge;
}
async function developerWalletV2Device(bridge = developerWalletV2Bridge(), grantedDevice) {
  if (!bridge || bridge !== developerWalletV2Bridge()) throw new Error("A native OS-protected Developer Wallet device bridge is required.");
  const native = grantedDevice ?? await bridge.device();
  const purpose = "Connect YNX Developer to the approved testnet Developer account";
  if (!native || native.id !== "ynx-developer-macos-device-v2" || native.algorithm !== "p256-sha256" || native.securityLevel !== "os-protected" || native.purpose !== purpose || typeof native.sign !== "function" || !Array.isArray(native.scopes) || native.scopes.length !== 2 || new Set(native.scopes).size !== 2 || !native.scopes.includes("account:read") || !native.scopes.includes("developer:deploy") || typeof native.key !== "string" || !/^[A-Za-z0-9_-]{44}$/.test(native.key)) throw new Error("Native Developer Wallet device identity or capability is invalid.");
  const key = native.key, bytes = decodeBase64url2(key);
  if (bytes.length !== 33 || bytes[0] !== 2 && bytes[0] !== 3 || base64url(bytes) !== key) throw new Error("Native Developer Wallet public key is not canonical compressed P256.");
  if (bridge !== developerWalletV2Bridge()) throw new Error("The native Developer Wallet document changed while reading its device.");
  return Object.freeze({
    id: native.id,
    key,
    scopes: Object.freeze(["account:read", "developer:deploy"]),
    purpose,
    async sign(input) {
      if (bridge !== developerWalletV2Bridge() || !input || Object.keys(input).sort().join(",") !== "algorithm,deviceKey,payload,purpose" || input.purpose !== "challenge" && input.purpose !== "http-proof" || input.algorithm !== "p256-sha256" || input.deviceKey !== key || typeof input.payload !== "string" || !/^[A-Za-z0-9_-]{1,10923}$/.test(input.payload)) throw new Error("Developer Wallet v2 signer request is not bound to this native device.");
      const payload = decodeBase64url2(input.payload), text3 = new TextDecoder("utf-8", { fatal: true }).decode(payload), domain = input.purpose === "challenge" ? "YNX_PRODUCT_SESSION_CHALLENGE_V2\n" : "YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n";
      if (payload.length > 8192 || base64url(payload) !== input.payload || !text3.startsWith(domain)) throw new Error("Developer Wallet v2 signing domain or size is invalid.");
      const signature = await native.sign(Object.freeze({ ...input }));
      if (bridge !== developerWalletV2Bridge()) throw new Error("Native Developer Wallet document changed during signing.");
      if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{11,96}$/.test(signature)) throw new Error("Native Developer Wallet returned an invalid DER signature.");
      const der = decodeBase64url2(signature);
      if (!canonicalP256DER(der) || base64url(der) !== signature) throw new Error("Native Developer Wallet returned a noncanonical DER signature.");
      return signature;
    }
  });
}
function canonicalP256DER(der) {
  if (der.length < 8 || der.length > 72 || der[0] !== 48 || der[1] !== der.length - 2) return false;
  const order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
  let offset = 2;
  for (let part = 0; part < 2; part++) {
    if (offset + 2 > der.length || der[offset++] !== 2) return false;
    const length = der[offset++];
    if (length < 1 || length > 33 || offset + length > der.length || (der[offset] & 128) !== 0 || length > 1 && der[offset] === 0 && (der[offset + 1] & 128) === 0) return false;
    let integer = 0n;
    for (let i = 0; i < length; i++) integer = integer << 8n | BigInt(der[offset++]);
    if (integer === 0n || integer >= order) return false;
  }
  return offset === der.length;
}
function subscribeDeveloperWalletCallbacks(listener, resourceListener) {
  const handler = (event) => {
    const detail = event.detail;
    if (typeof detail === "string") {
      if (isDeveloperResourceReturn(detail)) {
        resourceListener?.(detail);
        return;
      }
      listener(detail);
    }
  };
  window.addEventListener("ynx-wallet-callback", handler);
  return () => window.removeEventListener("ynx-wallet-callback", handler);
}
function decodeBase64url2(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("YNX Wallet callback encoding is not canonical.");
  let binary;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4));
  } catch {
    throw new Error("YNX Wallet callback encoding is invalid.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error("YNX Wallet callback encoding is not canonical.");
  return bytes;
}

// vendor/wallet-auth-c5/src/canonical.js
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactFields2(value, expected, label) {
  if (!isPlainObject2(value)) throw new WalletAuthError2("INVALID_SHAPE", `${label} must be a JSON object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n")) throw new WalletAuthError2("UNKNOWN_OR_MISSING_FIELD", `${label} fields do not match the protocol schema`);
}
function canonicalJSON3(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new WalletAuthError2("INVALID_NUMBER", "Protocol numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON3).join(",")}]`;
  if (!isPlainObject2(value)) throw new WalletAuthError2("INVALID_SHAPE", "Protocol value is not canonical JSON");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON3(value[key])}`).join(",")}}`;
}
function digestHex2(domain, value) {
  return bytesToHex(sha256(utf8ToBytes(`${domain}
${canonicalJSON3(value)}`)));
}
var WalletAuthError2 = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
  }
};

// vendor/wallet-auth-c5/src/base64url.js
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeBase64url2(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new WalletAuthError2("INVALID_ENCODING", "Base64url input must be bytes");
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0, b = bytes[index + 1] ?? 0, c = bytes[index + 2] ?? 0;
    const value = a << 16 | b << 8 | c;
    output += ALPHABET[value >>> 18 & 63] + ALPHABET[value >>> 12 & 63] + (index + 1 < bytes.length ? ALPHABET[value >>> 6 & 63] : "=") + (index + 2 < bytes.length ? ALPHABET[value & 63] : "=");
  }
  return output.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function decodeBase64url3(value, label = "base64url value") {
  if (typeof value !== "string" || !/[A-Za-z0-9_-]/.test(value) || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new WalletAuthError2("INVALID_ENCODING", `${label} is invalid`);
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const output = [];
  for (let index = 0; index < padded.length; index += 4) {
    const chars = [padded[index], padded[index + 1], padded[index + 2], padded[index + 3]];
    const values = chars.map((character) => character === "=" ? 0 : ALPHABET.indexOf(character));
    if (values.some((item) => item < 0)) throw new WalletAuthError2("INVALID_ENCODING", `${label} is invalid`);
    const combined = values[0] << 18 | values[1] << 12 | values[2] << 6 | values[3];
    output.push(combined >>> 16 & 255);
    if (chars[2] !== "=") output.push(combined >>> 8 & 255);
    if (chars[3] !== "=") output.push(combined & 255);
  }
  return Uint8Array.from(output);
}

// vendor/wallet-auth-c5/src/protocol.js
var MAX_REQUEST_LIFETIME_MS2 = 5 * 60 * 1e3;

// vendor/wallet-auth-c5/src/crypto.js
var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function walletIdentityFromPublicKey2(publicKeyHex) {
  const point = secp256k1.Point.fromBytes(hexToBytes(publicKeyHex));
  const digest3 = keccak_256(point.toBytes(false).slice(1));
  return encodeYNX(digest3.slice(-20));
}
function encodeYNX(payload) {
  const data = convertBits(payload, 8, 5, true);
  const values = [...hrpExpand("ynx"), ...data, 0, 0, 0, 0, 0, 0];
  const checksum = polymod(values) ^ 1;
  const tail = Array.from({ length: 6 }, (_, index) => checksum >>> 5 * (5 - index) & 31);
  return `ynx1${[...data, ...tail].map((item) => CHARSET[item]).join("")}`;
}
function convertBits(data, fromBits, toBits, pad) {
  let accumulator = 0, bits = 0;
  const result = [], maxValue = (1 << toBits) - 1, maxAccumulator = (1 << fromBits + toBits - 1) - 1;
  for (const value of data) {
    accumulator = (accumulator << fromBits | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push(accumulator >> bits & maxValue);
    }
  }
  if (pad && bits > 0) result.push(accumulator << toBits - bits & maxValue);
  return result;
}
function hrpExpand(hrp) {
  return [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
}
function polymod(values) {
  const generators = [996825010, 642813549, 513874426, 1027748829, 705979059];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 33554431) << 5 ^ value) >>> 0;
    generators.forEach((generator, index) => {
      if (top >>> index & 1) checksum = (checksum ^ generator) >>> 0;
    });
  }
  return checksum >>> 0;
}

// vendor/wallet-auth-c5/src/product-session-registry.js
var PRODUCT_SESSION_REGISTRY_VERSION = 2;
var PRODUCT_SESSION_PLATFORMS2 = Object.freeze(["android", "ios", "linux", "macos", "web", "windows"]);
var DOCUMENT_FIELDS = ["schemaVersion", "chainId", "wallet", "products"];
var WALLET_FIELDS = ["authorizeCallback", "downloadUrl", "metaMaskDownloadUrl"];
var PRODUCT_FIELDS2 = [
  "productId",
  "clientId",
  "displayName",
  "applicationId",
  "webOrigin",
  "nativeCallback",
  "legacyCallbacks",
  "scopes",
  "evmCompatible",
  "sessionDurationSeconds"
];
var FORBIDDEN_CALLBACK_SCHEMES = /* @__PURE__ */ new Set(["data:", "file:", "http:", "javascript:"]);
function parseProductSessionRegistry2(input) {
  exactFields2(input, DOCUMENT_FIELDS, "Product Session router registry");
  if (input.schemaVersion !== PRODUCT_SESSION_REGISTRY_VERSION || input.chainId !== "ynx_6423-1") {
    fail2("INVALID_ROUTER_REGISTRY", "Product Session router registry version or chain is unsupported");
  }
  exactFields2(input.wallet, WALLET_FIELDS, "Product Session Wallet registration");
  const authorizeCallback = callback2(input.wallet.authorizeCallback, "wallet authorize callback", { allowHttps: false });
  const authorize = new URL(authorizeCallback);
  if (authorize.protocol !== "ynxwallet:" || authorize.hostname !== "authorize" || authorize.pathname !== "") {
    fail2("INVALID_ROUTER_REGISTRY", "Wallet authorize callback must be ynxwallet://authorize");
  }
  const downloadUrl = httpsURL(input.wallet.downloadUrl, "Wallet download URL", false);
  const metaMaskDownloadUrl = httpsURL(input.wallet.metaMaskDownloadUrl, "MetaMask download URL", false);
  if (downloadUrl !== "https://www.ynxweb4.com/dapp/download" || metaMaskDownloadUrl !== "https://metamask.io/download") {
    fail2("INVALID_ROUTER_REGISTRY", "Wallet download routes must match the approved official allowlist");
  }
  if (!Array.isArray(input.products) || input.products.length < 1 || input.products.length > 64) {
    fail2("INVALID_ROUTER_REGISTRY", "Product Session registry product count is invalid");
  }
  const products = input.products.map(parseProduct);
  uniqueSorted(products.map((item) => item.productId), "productId");
  unique(products.map((item) => item.clientId), "clientId");
  unique(products.map((item) => item.applicationId), "applicationId");
  unique(products.filter((item) => !item.platforms || item.platforms.includes("web")).map((item) => item.webOrigin), "webOrigin");
  unique(products.filter((item) => item.nativeCallback !== null).map((item) => new URL(item.nativeCallback).protocol), "native callback scheme");
  const legacy = products.flatMap((item) => item.legacyCallbacks.map((value) => `${value}
${item.productId}`));
  const legacyNames = legacy.map((value) => value.split("\n", 1)[0]);
  unique(legacyNames, "legacy callback");
  return Object.freeze({
    schemaVersion: PRODUCT_SESSION_REGISTRY_VERSION,
    chainId: input.chainId,
    wallet: Object.freeze({ authorizeCallback, downloadUrl, metaMaskDownloadUrl }),
    products: Object.freeze(products)
  });
}
function productPlatformBinding2(registryInput, productId, platform) {
  const registry = parseProductSessionRegistry2(registryInput);
  if (!PRODUCT_SESSION_PLATFORMS2.includes(platform)) fail2("INVALID_PLATFORM", "Product Session platform is unsupported");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail2("UNKNOWN_PRODUCT", "Product is not registered for Product Sessions");
  if (product.platforms && !product.platforms.includes(platform)) fail2("INVALID_PLATFORM", "Product Session platform is not registered for this product");
  const web = platform === "web";
  return Object.freeze({
    chainId: registry.chainId,
    productId: product.productId,
    clientId: product.clientId,
    displayName: product.displayName,
    platform,
    applicationId: web ? `${product.applicationId}.web` : product.applicationId,
    bundleId: ["ios", "macos"].includes(platform) ? product.applicationId : null,
    packageId: ["android", "linux", "windows"].includes(platform) ? product.applicationId : null,
    origin: web ? product.webOrigin : `app://${platform}/${product.applicationId}`,
    callback: web ? product.webCallback ?? `${product.webOrigin}/wallet-auth/callback` : product.nativeCallback,
    scopes: product.scopes,
    evmCompatible: product.evmCompatible,
    sessionDurationSeconds: product.sessionDurationSeconds,
    walletAuthorizeCallback: registry.wallet.authorizeCallback,
    walletDownloadUrl: registry.wallet.downloadUrl,
    metaMaskDownloadUrl: registry.wallet.metaMaskDownloadUrl
  });
}
function parseProduct(input) {
  const hasPlatforms = input !== null && typeof input === "object" && Object.hasOwn(input, "platforms");
  const hasWebCallback = input !== null && typeof input === "object" && Object.hasOwn(input, "webCallback");
  exactFields2(input, [...PRODUCT_FIELDS2, ...hasPlatforms ? ["platforms"] : [], ...hasWebCallback ? ["webCallback"] : []], "Product Session product registration");
  const platforms = hasPlatforms ? stringList(input.platforms, "platforms", 1, PRODUCT_SESSION_PLATFORMS2.length, (value) => {
    if (!PRODUCT_SESSION_PLATFORMS2.includes(value)) fail2("INVALID_ROUTER_REGISTRY", "Product platform is unsupported");
    return value;
  }) : PRODUCT_SESSION_PLATFORMS2;
  const productId = pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/);
  const clientId = pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/);
  const displayName = text(input.displayName, "displayName", 2, 64);
  const applicationId = pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/);
  const webOrigin = httpsURL(input.webOrigin, "webOrigin", true);
  let webCallback;
  if (hasWebCallback) {
    webCallback = callback2(input.webCallback, "webCallback", { allowHttps: true });
    const target = new URL(webCallback);
    if (!platforms.includes("web") || target.protocol !== "https:" || target.origin !== webOrigin || target.search || target.hash || target.pathname === "/" || target.pathname.split("/").some((part) => part === "." || part === "..") || target.pathname.includes("%")) {
      fail2("INVALID_ROUTER_REGISTRY", "Web callback requires an exact same-origin registered Web client route");
    }
  }
  let nativeCallback, legacyCallbacks;
  if (!platforms.some((platform) => platform !== "web")) {
    if (input.nativeCallback !== null || !Array.isArray(input.legacyCallbacks) || input.legacyCallbacks.length !== 0) {
      fail2("INVALID_ROUTER_REGISTRY", "Web-only products cannot register native or legacy callbacks");
    }
    nativeCallback = null;
    legacyCallbacks = [];
  } else {
    nativeCallback = callback2(input.nativeCallback, "nativeCallback", { allowHttps: false });
    const native = new URL(nativeCallback);
    if (native.search || native.hash || native.username || native.password || !native.hostname) {
      fail2("INVALID_ROUTER_REGISTRY", "Native callback must contain an exact host/path without query or fragment");
    }
    legacyCallbacks = stringList(input.legacyCallbacks, "legacyCallbacks", 1, 8, (value) => text(value, "legacy callback", 3, 512));
    if (!legacyCallbacks.includes(nativeCallback)) fail2("INVALID_ROUTER_REGISTRY", "Legacy callback list must include the canonical native callback");
  }
  const scopes2 = stringList(input.scopes, "scopes", 1, 8, (value) => pattern(value, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (scopes2.some((scope2) => scope2.includes("*"))) fail2("INVALID_ROUTER_REGISTRY", "Wildcard Product Session scope is forbidden");
  if (typeof input.evmCompatible !== "boolean") fail2("INVALID_ROUTER_REGISTRY", "evmCompatible must be boolean");
  if (!Number.isInteger(input.sessionDurationSeconds) || input.sessionDurationSeconds < 60 || input.sessionDurationSeconds > 300) {
    fail2("INVALID_ROUTER_REGISTRY", "Product Session duration must be between 60 and 300 seconds");
  }
  return Object.freeze({
    productId,
    clientId,
    displayName,
    applicationId,
    webOrigin,
    nativeCallback,
    ...hasPlatforms ? { platforms: Object.freeze(platforms) } : {},
    ...hasWebCallback ? { webCallback } : {},
    legacyCallbacks: Object.freeze(legacyCallbacks),
    scopes: Object.freeze(scopes2),
    evmCompatible: input.evmCompatible,
    sessionDurationSeconds: input.sessionDurationSeconds
  });
}
function callback2(value, label, options) {
  const normalized = text(value, label, 3, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail2("INVALID_ROUTER_REGISTRY", `${label} is not a URL with ://`);
  }
  if (parsed.toString() !== normalized || parsed.username || parsed.password || parsed.hash || FORBIDDEN_CALLBACK_SCHEMES.has(parsed.protocol)) {
    fail2("INVALID_ROUTER_REGISTRY", `${label} is not canonical or uses a forbidden scheme`);
  }
  if (parsed.protocol === "https:" && !options.allowHttps) fail2("INVALID_ROUTER_REGISTRY", `${label} must use its registered application scheme`);
  if (parsed.protocol !== "https:" && !/^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol)) fail2("INVALID_ROUTER_REGISTRY", `${label} scheme is invalid`);
  return normalized;
}
function httpsURL(value, label, originOnly) {
  const normalized = text(value, label, 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail2("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.port || !parsed.hostname || originOnly && (parsed.pathname !== "/" || parsed.search)) {
    fail2("INVALID_ROUTER_REGISTRY", `${label} must be a canonical HTTPS ${originOnly ? "origin" : "URL"}`);
  }
  return originOnly ? parsed.origin : parsed.toString().replace(/\/$/, "");
}
function stringList(value, label, minimum, maximum, normalize) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail2("INVALID_ROUTER_REGISTRY", `${label} item count is invalid`);
  const result = value.map(normalize);
  uniqueSorted(result, label);
  return result;
}
function uniqueSorted(values, label) {
  unique(values, label);
  if ([...values].sort().join("\n") !== values.join("\n")) fail2("INVALID_ROUTER_REGISTRY", `${label} must be sorted`);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) fail2("INVALID_ROUTER_REGISTRY", `${label} must be globally unique`);
}
function pattern(value, label, regex) {
  const result = text(value, label, 1, 512);
  if (!regex.test(result)) fail2("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  return result;
}
function text(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.trim() !== value) fail2("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  return value;
}
function fail2(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/product-session-finite-consent.js
var FINANCE_FINITE_CONSENT_PROFILE = "finance-private-finite-v1";
var FINANCE_FINITE_CONSENT_DEFAULT_SECONDS = 7200;
var FINANCE_FINITE_CONSENT_MAX_SECONDS = 7200;
var FIELDS = ["profile", "issuedAt", "expiresAt", "durationSeconds"];
var SCOPES = /* @__PURE__ */ new Set(["finance.ai.draft", "finance.pay.read", "finance.portfolio.read", "finance.profile.write"]);
var PLATFORMS = /* @__PURE__ */ new Set(["android", "ios", "linux", "macos", "web", "windows"]);
function createFinanceFiniteServiceConsent(context, durationSeconds = FINANCE_FINITE_CONSENT_DEFAULT_SECONDS) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 300 || durationSeconds > FINANCE_FINITE_CONSENT_MAX_SECONDS) fail3("INVALID_SERVICE_CONSENT_TIME");
  const issued = iso(context.issuedAt);
  return parseFinanceFiniteServiceConsent(context, {
    profile: FINANCE_FINITE_CONSENT_PROFILE,
    issuedAt: issued,
    expiresAt: new Date(Date.parse(issued) + durationSeconds * 1e3).toISOString(),
    durationSeconds
  }, { requestIssuedAt: issued });
}
function parseFinanceFiniteServiceConsent(context, input, { requestIssuedAt } = {}) {
  exactFields2(input, FIELDS, "Finite Product Session service consent");
  if (input.profile !== FINANCE_FINITE_CONSENT_PROFILE) fail3("UNKNOWN_SERVICE_CONSENT_PROFILE");
  const web = context.platform === "web";
  if (context.chainId !== "ynx_6423-1" || context.productId !== "finance" || context.clientId !== "ynx-finance-v1" || !PLATFORMS.has(context.platform) || context.applicationId !== (web ? "com.ynxweb4.finance.web" : "com.ynxweb4.finance") || context.origin !== (web ? "https://finance.ynxweb4.com" : `app://${context.platform}/com.ynxweb4.finance`) || context.callback !== (web ? "https://finance.ynxweb4.com/wallet-auth/callback" : "ynxfinance://wallet-auth/callback") || !Array.isArray(context.scopes) || !context.scopes.length || context.scopes.some((scope2) => !SCOPES.has(scope2))) fail3("SERVICE_CONSENT_BINDING_MISMATCH");
  const issuedAt = iso(input.issuedAt), expiresAt = iso(input.expiresAt);
  if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 300 || input.durationSeconds > FINANCE_FINITE_CONSENT_MAX_SECONDS || Date.parse(expiresAt) - Date.parse(issuedAt) !== input.durationSeconds * 1e3 || requestIssuedAt !== void 0 && issuedAt !== requestIssuedAt) fail3("INVALID_SERVICE_CONSENT_TIME");
  return Object.freeze({ profile: input.profile, issuedAt, expiresAt, durationSeconds: input.durationSeconds });
}
function iso(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail3("INVALID_SERVICE_CONSENT_TIME");
  return value;
}
function fail3(code) {
  throw new WalletAuthError2(code, "Finite private service consent is outside the reviewed Finance policy");
}

// vendor/wallet-auth-c5/src/product-session-v2.js
var PRODUCT_SESSION_PROTOCOL_VERSION = "2";
var PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION = 2;
var REQUEST_MAX_LIFETIME_MS2 = 5 * 6e4;
var CHALLENGE_MAX_LIFETIME_MS = 6e4;
var REQUEST_FIELDS = [
  "version",
  "chainId",
  "productId",
  "clientId",
  "platform",
  "applicationId",
  "bundleId",
  "packageId",
  "origin",
  "callback",
  "deviceId",
  "deviceAlgorithm",
  "deviceKey",
  "nonce",
  "state",
  "scopes",
  "purpose",
  "issuedAt",
  "expiresAt"
];
var APPROVAL_FIELDS = [
  "version",
  "result",
  "requestDigest",
  "chainId",
  "productId",
  "clientId",
  "platform",
  "applicationId",
  "bundleId",
  "packageId",
  "origin",
  "callback",
  "deviceId",
  "deviceAlgorithm",
  "deviceKey",
  "nonce",
  "state",
  "account",
  "accountPublicKey",
  "scopes",
  "issuedAt",
  "expiresAt",
  "walletSignature"
];
var CHALLENGE_FIELDS = [
  "version",
  "challenge",
  "requestDigest",
  "approvalDigest",
  "chainId",
  "productId",
  "clientId",
  "platform",
  "applicationId",
  "bundleId",
  "packageId",
  "origin",
  "callback",
  "deviceId",
  "deviceAlgorithm",
  "deviceKey",
  "nonce",
  "state",
  "account",
  "scopes",
  "issuedAt",
  "expiresAt",
  "sessionExpiresAt"
];
var COMPLETION_FIELDS = ["challenge", "deviceSignature"];
var SESSION_FIELDS = [
  "version",
  "sessionBinding",
  "chainId",
  "productId",
  "clientId",
  "platform",
  "applicationId",
  "bundleId",
  "packageId",
  "origin",
  "callback",
  "account",
  "deviceId",
  "deviceAlgorithm",
  "deviceKey",
  "deviceBinding",
  "nonce",
  "state",
  "scopes",
  "requestDigest",
  "approvalDigest",
  "issuedAt",
  "expiresAt"
];
var SNAPSHOT_FIELDS2 = ["schemaVersion", "sessions", "issuedChallenges", "consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices", "revokedAccounts"];
function createProductSessionRequest2(registryInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields2(input, ["productId", "platform", "deviceId", "deviceKey", "scopes", "purpose", "nonce", "state", ...Object.hasOwn(input, "finiteServiceSeconds") ? ["finiteServiceSeconds"] : []], "Product Session request input");
  const binding2 = productPlatformBinding2(registryInput, input.productId, input.platform);
  const now = validDate(at);
  const request = {
    version: PRODUCT_SESSION_PROTOCOL_VERSION,
    chainId: binding2.chainId,
    productId: binding2.productId,
    clientId: binding2.clientId,
    platform: binding2.platform,
    applicationId: binding2.applicationId,
    bundleId: binding2.bundleId,
    packageId: binding2.packageId,
    origin: binding2.origin,
    callback: binding2.callback,
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: "p256-sha256",
    deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"),
    state: token(input.state, "state"),
    scopes: scopes(input.scopes, binding2.scopes),
    purpose: text2(input.purpose, "purpose", 1, 180),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REQUEST_MAX_LIFETIME_MS2).toISOString()
  };
  if (Object.hasOwn(input, "finiteServiceSeconds")) request.serviceConsent = createFinanceFiniteServiceConsent(request, input.finiteServiceSeconds);
  return parseProductSessionRequest2(registryInput, request, now);
}
function parseProductSessionRequest2(registryInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields2(input, consentFields(input, REQUEST_FIELDS), "Product Session request");
  const now = validDate(at);
  if (input.version !== PRODUCT_SESSION_PROTOCOL_VERSION || input.chainId !== "ynx_6423-1" || !PRODUCT_SESSION_PLATFORMS2.includes(input.platform)) fail4("INVALID_SESSION_REQUEST", "Product Session protocol, chain or platform is unsupported");
  const binding2 = productPlatformBinding2(registryInput, input.productId, input.platform);
  const request = Object.freeze({
    version: input.version,
    chainId: input.chainId,
    productId: pattern2(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    clientId: pattern2(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/),
    platform: input.platform,
    applicationId: pattern2(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/),
    bundleId: platformIdentity(input.bundleId, "bundleId"),
    packageId: platformIdentity(input.packageId, "packageId"),
    origin: canonicalOrigin(input.origin),
    callback: canonicalCallback(input.callback),
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: pattern2(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/),
    deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"),
    state: token(input.state, "state"),
    scopes: Object.freeze(scopes(input.scopes, binding2.scopes)),
    purpose: text2(input.purpose, "purpose", 1, 180),
    ...parseConsent(input, input.issuedAt),
    issuedAt: time(input.issuedAt, "issuedAt"),
    expiresAt: time(input.expiresAt, "expiresAt")
  });
  validatePlatformIdentifiers(request);
  for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
    if (request[field] !== binding2[field]) fail4("SESSION_BINDING_MISMATCH", `Product Session request ${field} does not match the registry`);
  }
  const issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (expires <= issued || expires - issued > REQUEST_MAX_LIFETIME_MS2) fail4("INVALID_EXPIRY", "Product Session request lifetime is invalid");
  if (issued > now.getTime() + 3e4) fail4("ISSUED_IN_FUTURE", "Product Session request was issued in the future");
  if (expires <= now.getTime()) fail4("SESSION_EXPIRED", "Product Session request expired");
  return request;
}
function productSessionRequestDigest(registryInput, request, at = /* @__PURE__ */ new Date()) {
  return digestHex2("YNX_PRODUCT_SESSION_REQUEST_V2", parseProductSessionRequest2(registryInput, request, at));
}
function parseProductSessionApproval2(registryInput, requestInput, input, at = /* @__PURE__ */ new Date()) {
  const request = parseProductSessionRequest2(registryInput, requestInput, at);
  exactFields2(input, [...APPROVAL_FIELDS, ...request.serviceConsent ? ["serviceConsent"] : []], "Product Session approval");
  const approval = Object.freeze({
    ...input,
    version: pattern2(input.version, "version", /^2$/),
    result: pattern2(input.result, "result", /^approved$/),
    requestDigest: digest(input.requestDigest, "requestDigest"),
    productId: pattern2(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    clientId: pattern2(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/),
    applicationId: pattern2(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/),
    bundleId: platformIdentity(input.bundleId, "bundleId"),
    packageId: platformIdentity(input.packageId, "packageId"),
    origin: canonicalOrigin(input.origin),
    callback: canonicalCallback(input.callback),
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: pattern2(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/),
    deviceKey: deviceKey(input.deviceKey),
    nonce: token(input.nonce, "nonce"),
    state: token(input.state, "state"),
    account: pattern2(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    accountPublicKey: pattern2(input.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/),
    scopes: Object.freeze(scopes(input.scopes, request.scopes)),
    ...parseConsent(input, request.issuedAt),
    issuedAt: time(input.issuedAt, "issuedAt"),
    expiresAt: time(input.expiresAt, "expiresAt"),
    walletSignature: pattern2(input.walletSignature, "walletSignature", /^[0-9a-f]{128}$/)
  });
  validatePlatformIdentifiers(approval);
  if (canonicalJSON3(approval.serviceConsent ?? null) !== canonicalJSON3(request.serviceConsent ?? null)) fail4("SERVICE_CONSENT_BINDING_MISMATCH", "Wallet service consent differs from the signed request");
  const boundFields = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state"];
  if (approval.requestDigest !== productSessionRequestDigest(registryInput, request, at) || boundFields.some((field) => approval[field] !== request[field]) || approval.scopes.join("\n") !== request.scopes.join("\n")) fail4("SESSION_BINDING_MISMATCH", "Wallet approval does not match the exact Product Session request");
  if (approval.issuedAt < request.issuedAt || approval.issuedAt > validDate(at).toISOString() || approval.expiresAt > request.expiresAt || approval.expiresAt <= validDate(at).toISOString()) fail4("INVALID_APPROVAL_TIME", "Wallet approval is outside the request lifetime");
  let valid = false;
  try {
    valid = secp256k1.verify(hexToBytes(approval.walletSignature), sha256(utf8ToBytes(approvalSignBytes3(unsignedApproval3(approval)))), hexToBytes(approval.accountPublicKey), { prehash: false, format: "compact", lowS: true });
  } catch {
    valid = false;
  }
  if (!valid || walletIdentityFromPublicKey2(approval.accountPublicKey) !== approval.account) fail4("INVALID_SIGNATURE", "Wallet approval signature is invalid");
  return approval;
}
function createProductSessionChallenge2(registryInput, requestInput, approvalInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields2(input, ["challenge"], "Product Session challenge input");
  const request = parseProductSessionRequest2(registryInput, requestInput, at);
  const approval = parseProductSessionApproval2(registryInput, request, approvalInput, at);
  const binding2 = productPlatformBinding2(registryInput, request.productId, request.platform);
  const now = validDate(at);
  const expiresAt = new Date(Math.min(now.getTime() + CHALLENGE_MAX_LIFETIME_MS, Date.parse(approval.expiresAt))).toISOString();
  const sessionExpiresAt = request.serviceConsent ? request.serviceConsent.expiresAt : new Date(Math.min(Date.parse(approval.expiresAt), now.getTime() + binding2.sessionDurationSeconds * 1e3)).toISOString();
  return parseChallenge({
    version: PRODUCT_SESSION_PROTOCOL_VERSION,
    ...parseConsent(request, request.issuedAt),
    challenge: token(input.challenge, "challenge"),
    requestDigest: approval.requestDigest,
    approvalDigest: productSessionApprovalDigest(approval),
    chainId: request.chainId,
    productId: request.productId,
    clientId: request.clientId,
    platform: request.platform,
    applicationId: request.applicationId,
    bundleId: request.bundleId,
    packageId: request.packageId,
    origin: request.origin,
    callback: request.callback,
    deviceId: request.deviceId,
    deviceAlgorithm: request.deviceAlgorithm,
    deviceKey: request.deviceKey,
    nonce: request.nonce,
    state: request.state,
    account: approval.account,
    scopes: approval.scopes,
    issuedAt: now.toISOString(),
    expiresAt,
    sessionExpiresAt
  });
}
function signProductSessionChallenge2(challengeInput, deviceSecretInput) {
  const challenge = parseChallenge(challengeInput);
  const secret = deviceSecret(deviceSecretInput);
  if (encodeBase64url2(p256.getPublicKey(secret, true)) !== challenge.deviceKey) fail4("DEVICE_CHANGED", "Product device key changed before session completion");
  const signature = p256.sign(utf8ToBytes(challengeSignBytes(challenge)), secret, { format: "der" });
  return Object.freeze({ challenge, deviceSignature: encodeBase64url2(signature) });
}
async function signProductSessionChallengeWith2(challengeInput, signer) {
  const challenge = parseChallenge(challengeInput);
  if (typeof signer !== "function") fail4("INVALID_DEVICE", "Product Session requires a platform device signer");
  const payload = encodeBase64url2(utf8ToBytes(challengeSignBytes(challenge)));
  let deviceSignature;
  try {
    deviceSignature = await signer(Object.freeze({ purpose: "challenge", algorithm: "p256-sha256", deviceKey: challenge.deviceKey, payload }));
  } catch {
    fail4("DEVICE_SIGNING_FAILED", "Platform device signing failed closed");
  }
  if (typeof deviceSignature !== "string") fail4("INVALID_DEVICE_PROOF", "Platform device signature is invalid");
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url3(deviceSignature, "deviceSignature"), decodeBase64url3(payload, "device signing payload"), decodeBase64url3(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail4("INVALID_DEVICE_PROOF", "Platform device signature does not match the registered device key");
  return Object.freeze({ challenge, deviceSignature });
}
function parseProductSessionChallenge2(input) {
  return parseChallenge(input);
}
var ProductSessionAuthority2 = class {
  #registry;
  #state;
  constructor(registryInput, snapshot = emptySnapshot()) {
    this.#registry = parseProductSessionRegistry2(registryInput);
    this.#state = parseSnapshot(snapshot);
  }
  issueChallenge(input, at = /* @__PURE__ */ new Date()) {
    exactFields2(input, ["request", "approval", "challenge"], "Product Session challenge issuance");
    const request = parseProductSessionRequest2(this.#registry, input.request, at);
    const approval = parseProductSessionApproval2(this.#registry, request, input.approval, at);
    this.#assertApprovalNotRevoked(request, approval);
    if (this.#state.consumedRequests.includes(approval.requestDigest)) fail4("REPLAY", "Product Session request already completed; recover its original completion or obtain a new Wallet approval");
    const challenge = createProductSessionChallenge2(this.#registry, request, approval, { challenge: input.challenge }, at);
    if (this.#state.issuedChallenges.some((item) => item.challenge === challenge.challenge) || this.#state.consumedChallenges.includes(challenge.challenge)) fail4("REPLAY", "Product Session challenge already exists");
    const next = clone(this.#state);
    next.issuedChallenges.push(challenge);
    sortSnapshot(next);
    this.#state = parseSnapshot(next);
    return challenge;
  }
  complete(input, at = /* @__PURE__ */ new Date()) {
    exactFields2(input, ["request", "approval", "completion"], "Product Session completion");
    const request = parseProductSessionRequest2(this.#registry, input.request, at);
    const approval = parseProductSessionApproval2(this.#registry, request, input.approval, at);
    this.#assertApprovalNotRevoked(request, approval);
    exactFields2(input.completion, COMPLETION_FIELDS, "Product Session device completion");
    const challenge = parseChallenge(input.completion.challenge);
    const expected = createProductSessionChallenge2(this.#registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
    if (canonicalJSON3(challenge) !== canonicalJSON3(expected)) fail4("SESSION_BINDING_MISMATCH", "Gateway challenge fields were substituted");
    const issued = this.#state.issuedChallenges.find((item) => item.challenge === challenge.challenge);
    if (!issued || canonicalJSON3(issued) !== canonicalJSON3(challenge)) fail4("CHALLENGE_NOT_ISSUED", "Product Session challenge was not issued by this Gateway");
    if (challenge.expiresAt <= validDate(at).toISOString()) fail4("SESSION_EXPIRED", "Product Session challenge expired");
    let valid = false;
    try {
      valid = p256.verify(decodeBase64url3(input.completion.deviceSignature, "deviceSignature"), utf8ToBytes(challengeSignBytes(challenge)), decodeBase64url3(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
    } catch {
      valid = false;
    }
    if (!valid) fail4("INVALID_DEVICE_PROOF", "Product Session device proof is invalid");
    if (this.#state.consumedNonces.includes(request.nonce) || this.#state.consumedStates.includes(request.state) || this.#state.consumedRequests.includes(approval.requestDigest) || this.#state.consumedChallenges.includes(challenge.challenge)) fail4("REPLAY", "Product Session request, state or challenge was already consumed");
    const session = parseSession({
      version: PRODUCT_SESSION_PROTOCOL_VERSION,
      sessionBinding: digestHex2("YNX_PRODUCT_SESSION_BINDING_V2", challenge),
      chainId: request.chainId,
      productId: request.productId,
      clientId: request.clientId,
      platform: request.platform,
      applicationId: request.applicationId,
      bundleId: request.bundleId,
      packageId: request.packageId,
      origin: request.origin,
      callback: request.callback,
      account: approval.account,
      deviceId: request.deviceId,
      deviceAlgorithm: request.deviceAlgorithm,
      deviceKey: request.deviceKey,
      deviceBinding: deviceBinding(request, approval.account),
      nonce: request.nonce,
      state: request.state,
      scopes: approval.scopes,
      requestDigest: approval.requestDigest,
      approvalDigest: challenge.approvalDigest,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.sessionExpiresAt,
      ...parseConsent(request, request.issuedAt)
    });
    const next = clone(this.#state);
    next.issuedChallenges = next.issuedChallenges.filter((item) => item.challenge !== challenge.challenge);
    next.sessions.push(session);
    next.consumedNonces.push(request.nonce);
    next.consumedStates.push(request.state);
    next.consumedRequests.push(approval.requestDigest);
    next.consumedChallenges.push(challenge.challenge);
    sortSnapshot(next);
    this.#state = parseSnapshot(next);
    return session;
  }
  introspect(sessionBindingInput, context, at = /* @__PURE__ */ new Date()) {
    exactFields2(context, ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "requiredScopes"], "Product Session introspection context");
    const session = this.#state.sessions.find((item) => item.sessionBinding === digest(sessionBindingInput, "sessionBinding"));
    if (!session) fail4("SESSION_NOT_FOUND", "Product Session was not found");
    const now = validDate(at).toISOString();
    if (session.issuedAt > now) fail4("ISSUED_IN_FUTURE", "Product Session was issued in the future");
    if (session.expiresAt <= now) fail4("SESSION_EXPIRED", "Product Session expired");
    if (this.#state.revokedSessions.includes(session.sessionBinding) || this.#state.revokedDevices.includes(session.deviceBinding) || this.#state.revokedAccounts.some((item) => item.account === session.account && session.issuedAt <= item.before)) fail4("SESSION_REVOKED", "Product Session was revoked");
    validatePlatformIdentifiers(context, "CROSS_PRODUCT_SESSION");
    const exact = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey"];
    if (exact.some((field) => context[field] !== session[field])) fail4("CROSS_PRODUCT_SESSION", "Product Session cannot cross product, account, origin, callback or device boundaries");
    const required = requiredScopes(context.requiredScopes, session.scopes);
    if (required.some((scope2) => !session.scopes.includes(scope2))) fail4("SCOPE_WIDENING", "Product Session scope cannot be widened");
    return Object.freeze({ active: true, session });
  }
  revokeSession(sessionBindingInput) {
    const value = digest(sessionBindingInput, "sessionBinding");
    if (!this.#state.sessions.some((item) => item.sessionBinding === value)) fail4("SESSION_NOT_FOUND", "Product Session was not found");
    this.#revoke("revokedSessions", value);
    return value;
  }
  revokeDevice(deviceBindingInput) {
    const value = digest(deviceBindingInput, "deviceBinding");
    this.#revoke("revokedDevices", value);
    return value;
  }
  revokeAccount(account, at = /* @__PURE__ */ new Date()) {
    const record = { account: pattern2(account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: validDate(at).toISOString() };
    const previous = this.#state.revokedAccounts.find((item) => item.account === record.account);
    if (previous && previous.before >= record.before) return Object.freeze({ ...previous });
    const next = clone(this.#state);
    next.revokedAccounts = next.revokedAccounts.filter((item) => item.account !== record.account);
    next.revokedAccounts.push(record);
    sortSnapshot(next);
    this.#state = parseSnapshot(next);
    return Object.freeze(record);
  }
  snapshot() {
    return freezeSnapshot(clone(this.#state));
  }
  #assertApprovalNotRevoked(request, approval) {
    if (this.#state.revokedDevices.includes(deviceBinding(request, approval.account)) || this.#state.revokedAccounts.some((item) => item.account === approval.account && approval.issuedAt <= item.before)) fail4("SESSION_REVOKED", "Wallet approval or its product device binding was revoked");
  }
  #revoke(field, value) {
    if (this.#state[field].includes(value)) fail4("ALREADY_REVOKED", "Product Session revocation already exists");
    const next = clone(this.#state);
    next[field].push(value);
    sortSnapshot(next);
    this.#state = parseSnapshot(next);
  }
};
function parseProductSession2(input) {
  return parseSession(input);
}
function productSessionApprovalDigest(approval) {
  return digestHex2("YNX_PRODUCT_SESSION_APPROVAL_V2", approval);
}
function deviceBinding(requestOrSession, account) {
  return digestHex2("YNX_PRODUCT_SESSION_DEVICE_V2", { chainId: requestOrSession.chainId, productId: requestOrSession.productId, clientId: requestOrSession.clientId, platform: requestOrSession.platform, applicationId: requestOrSession.applicationId, bundleId: requestOrSession.bundleId, packageId: requestOrSession.packageId, origin: requestOrSession.origin, callback: requestOrSession.callback, account, deviceId: requestOrSession.deviceId, deviceAlgorithm: requestOrSession.deviceAlgorithm, deviceKey: requestOrSession.deviceKey });
}
function parseChallenge(input) {
  exactFields2(input, consentFields(input, CHALLENGE_FIELDS), "Product Session challenge");
  const value = Object.freeze({ ...input, ...parseConsent(input), version: pattern2(input.version, "version", /^2$/), challenge: token(input.challenge, "challenge"), requestDigest: digest(input.requestDigest, "requestDigest"), approvalDigest: digest(input.approvalDigest, "approvalDigest"), chainId: pattern2(input.chainId, "chainId", /^ynx_6423-1$/), productId: pattern2(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern2(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), platform: pattern2(input.platform, "platform", /^(android|ios|linux|macos|web|windows)$/), applicationId: pattern2(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: platformIdentity(input.bundleId, "bundleId"), packageId: platformIdentity(input.packageId, "packageId"), origin: canonicalOrigin(input.origin), callback: canonicalCallback(input.callback), deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern2(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey(input.deviceKey), nonce: token(input.nonce, "nonce"), state: token(input.state, "state"), account: pattern2(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), scopes: Object.freeze(scopes(input.scopes, input.scopes)), issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt"), sessionExpiresAt: time(input.sessionExpiresAt, "sessionExpiresAt") });
  validatePlatformIdentifiers(value);
  const serviceValid = value.serviceConsent ? value.sessionExpiresAt === value.serviceConsent.expiresAt && value.issuedAt >= value.serviceConsent.issuedAt && Date.parse(value.expiresAt) <= Date.parse(value.serviceConsent.issuedAt) + REQUEST_MAX_LIFETIME_MS2 : Date.parse(value.sessionExpiresAt) - Date.parse(value.issuedAt) <= REQUEST_MAX_LIFETIME_MS2;
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > CHALLENGE_MAX_LIFETIME_MS || value.sessionExpiresAt < value.expiresAt || !serviceValid) fail4("INVALID_EXPIRY", "Product Session challenge or session lifetime is invalid");
  return value;
}
function parseSession(input) {
  exactFields2(input, consentFields(input, SESSION_FIELDS), "Product Session");
  const value = Object.freeze({ ...input, ...parseConsent(input), version: pattern2(input.version, "version", /^2$/), sessionBinding: digest(input.sessionBinding, "sessionBinding"), chainId: pattern2(input.chainId, "chainId", /^ynx_6423-1$/), productId: pattern2(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern2(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), platform: pattern2(input.platform, "platform", /^(android|ios|linux|macos|web|windows)$/), applicationId: pattern2(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: platformIdentity(input.bundleId, "bundleId"), packageId: platformIdentity(input.packageId, "packageId"), origin: canonicalOrigin(input.origin), callback: canonicalCallback(input.callback), account: pattern2(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern2(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey(input.deviceKey), deviceBinding: digest(input.deviceBinding, "deviceBinding"), nonce: token(input.nonce, "nonce"), state: token(input.state, "state"), scopes: Object.freeze(scopes(input.scopes, input.scopes)), requestDigest: digest(input.requestDigest, "requestDigest"), approvalDigest: digest(input.approvalDigest, "approvalDigest"), issuedAt: time(input.issuedAt, "issuedAt"), expiresAt: time(input.expiresAt, "expiresAt") });
  validatePlatformIdentifiers(value);
  if (value.serviceConsent && (value.expiresAt !== value.serviceConsent.expiresAt || value.issuedAt < value.serviceConsent.issuedAt || Date.parse(value.issuedAt) >= Date.parse(value.serviceConsent.issuedAt) + REQUEST_MAX_LIFETIME_MS2)) fail4("INVALID_SERVICE_CONSENT_TIME", "Stored finite service session is outside its approved window");
  if (value.expiresAt <= value.issuedAt || value.deviceBinding !== deviceBinding(value, value.account)) fail4("INVALID_SESSION", "Product Session security binding or lifetime is invalid");
  return value;
}
function parseSnapshot(input) {
  exactFields2(input, SNAPSHOT_FIELDS2, "Product Session authority snapshot");
  if (input.schemaVersion !== PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION) fail4("INVALID_SESSION_STORE", "Product Session authority snapshot version is unsupported");
  const value = { schemaVersion: input.schemaVersion, sessions: sortedUnique(input.sessions.map(parseSession), (item) => item.sessionBinding, "sessions"), issuedChallenges: sortedUnique(input.issuedChallenges.map(parseChallenge), (item) => item.challenge, "issuedChallenges"), consumedNonces: stringSet(input.consumedNonces, /^[A-Za-z0-9_-]{32,64}$/, "consumedNonces"), consumedStates: stringSet(input.consumedStates, /^[A-Za-z0-9_-]{32,64}$/, "consumedStates"), consumedRequests: stringSet(input.consumedRequests, /^[0-9a-f]{64}$/, "consumedRequests"), consumedChallenges: stringSet(input.consumedChallenges, /^[A-Za-z0-9_-]{32,64}$/, "consumedChallenges"), revokedSessions: stringSet(input.revokedSessions, /^[0-9a-f]{64}$/, "revokedSessions"), revokedDevices: stringSet(input.revokedDevices, /^[0-9a-f]{64}$/, "revokedDevices"), revokedAccounts: sortedUnique(input.revokedAccounts.map((item) => {
    exactFields2(item, ["account", "before"], "revoked account");
    return Object.freeze({ account: pattern2(item.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: time(item.before, "before") });
  }), (item) => item.account, "revokedAccounts") };
  if (value.sessions.length !== value.consumedNonces.length || value.sessions.length !== value.consumedStates.length || value.sessions.length !== value.consumedRequests.length || value.sessions.length !== value.consumedChallenges.length || value.issuedChallenges.some((item) => value.consumedChallenges.includes(item.challenge))) fail4("INVALID_SESSION_STORE", "Issued and consumed records must exactly cover Product Sessions without overlap");
  return freezeSnapshot(value);
}
function emptySnapshot() {
  return { schemaVersion: PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION, sessions: [], issuedChallenges: [], consumedNonces: [], consumedStates: [], consumedRequests: [], consumedChallenges: [], revokedSessions: [], revokedDevices: [], revokedAccounts: [] };
}
function sortSnapshot(value) {
  value.sessions.sort((a, b) => compareSnapshotKey(a.sessionBinding, b.sessionBinding));
  value.issuedChallenges.sort((a, b) => compareSnapshotKey(a.challenge, b.challenge));
  for (const field of ["consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices"]) value[field].sort();
  value.revokedAccounts.sort((a, b) => compareSnapshotKey(a.account, b.account));
}
function compareSnapshotKey(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function freezeSnapshot(value) {
  return Object.freeze({ ...value, sessions: Object.freeze(value.sessions), issuedChallenges: Object.freeze(value.issuedChallenges), consumedNonces: Object.freeze(value.consumedNonces), consumedStates: Object.freeze(value.consumedStates), consumedRequests: Object.freeze(value.consumedRequests), consumedChallenges: Object.freeze(value.consumedChallenges), revokedSessions: Object.freeze(value.revokedSessions), revokedDevices: Object.freeze(value.revokedDevices), revokedAccounts: Object.freeze(value.revokedAccounts) });
}
function stringSet(value, regex, label) {
  if (!Array.isArray(value) || value.length > 1e4 || value.some((item) => typeof item !== "string" || !regex.test(item))) fail4("INVALID_SESSION_STORE", `${label} is invalid`);
  return sortedUnique(value, (item) => item, label);
}
function sortedUnique(value, key, label) {
  const keys = value.map(key);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) fail4("INVALID_SESSION_STORE", `${label} must be unique and sorted`);
  return Object.freeze(value);
}
function consentFields(value, fields2) {
  return [...fields2, ...Object.hasOwn(value, "serviceConsent") ? ["serviceConsent"] : []];
}
function parseConsent(value, requestIssuedAt) {
  return Object.hasOwn(value, "serviceConsent") ? { serviceConsent: parseFinanceFiniteServiceConsent(value, value.serviceConsent, { requestIssuedAt }) } : {};
}
function unsignedApproval3(value) {
  const { walletSignature: _signature, ...unsigned } = value;
  return unsigned;
}
function approvalSignBytes3(value) {
  return `YNX_PRODUCT_SESSION_APPROVAL_V2
${canonicalJSON3(value)}`;
}
function challengeSignBytes(value) {
  return `YNX_PRODUCT_SESSION_CHALLENGE_V2
${canonicalJSON3(value)}`;
}
function scopes(value, allowlist) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) fail4("INVALID_SCOPES", "Product Session scopes are invalid");
  const result = value.map((item) => pattern2(item, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (new Set(result).size !== result.length || [...result].sort().join("\n") !== result.join("\n") || result.some((item) => !allowlist.includes(item))) fail4("SCOPE_WIDENING", "Product Session scope is duplicated, unsorted or outside the registry");
  return result;
}
function requiredScopes(value, allowlist) {
  if (!Array.isArray(value) || value.length > 8) fail4("INVALID_SCOPES", "Required Product Session scopes are invalid");
  if (value.length === 0) return [];
  return scopes(value, allowlist);
}
function platformIdentity(value, label) {
  return value === null ? null : pattern2(value, label, /^[A-Za-z][A-Za-z0-9.-]{2,131}$/);
}
function validatePlatformIdentifiers(value, errorCode = "SESSION_BINDING_MISMATCH") {
  const expectsBundle = value.platform === "ios" || value.platform === "macos";
  const expectsPackage = value.platform === "android" || value.platform === "linux" || value.platform === "windows";
  if (value.bundleId !== null !== expectsBundle || value.packageId !== null !== expectsPackage || value.bundleId !== null && value.bundleId !== value.applicationId || value.packageId !== null && value.packageId !== value.applicationId) fail4(errorCode, "Product Session bundleId/packageId does not match its registered platform identity");
}
function canonicalOrigin(value) {
  const normalized = text2(value, "origin", 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail4("INVALID_ORIGIN", "Product Session origin is invalid");
  }
  if (parsed.protocol === "https:" && parsed.origin === normalized && !parsed.port) return normalized;
  if (parsed.protocol === "app:" && /^app:\/\/(android|ios|linux|macos|windows)\/[A-Za-z][A-Za-z0-9.-]{2,127}$/.test(normalized)) return normalized;
  fail4("INVALID_ORIGIN", "Product Session origin must be an exact HTTPS or registered native origin");
}
function canonicalCallback(value) {
  const normalized = text2(value, "callback", 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail4("CALLBACK_MISMATCH", "Product Session callback is invalid");
  }
  if (["data:", "file:", "http:", "javascript:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.search || parsed.toString() !== normalized) fail4("CALLBACK_MISMATCH", "Product Session callback is unsafe or non-canonical");
  return normalized;
}
function deviceKey(value) {
  const normalized = pattern2(value, "deviceKey", /^[A-Za-z0-9_-]{44}$/);
  const bytes = decodeBase64url3(normalized, "deviceKey");
  if (bytes.length !== 33 || encodeBase64url2(bytes) !== normalized) fail4("INVALID_DEVICE_KEY", "Product Session device key is invalid");
  try {
    p256.Point.fromBytes(bytes);
  } catch {
    fail4("INVALID_DEVICE_KEY", "Product Session device key is not P-256");
  }
  return normalized;
}
function deviceSecret(value) {
  const bytes = decodeBase64url3(value, "deviceSecret");
  if (bytes.length !== 32 || !p256.utils.isValidSecretKey(bytes)) fail4("INVALID_SECRET", "Product device secret is invalid");
  return bytes;
}
function token(value, label) {
  return pattern2(value, label, /^[A-Za-z0-9_-]{32,64}$/);
}
function opaque(value, label) {
  return pattern2(value, label, /^[A-Za-z0-9._:-]{8,128}$/);
}
function digest(value, label) {
  return pattern2(value, label, /^[0-9a-f]{64}$/);
}
function pattern2(value, label, regex) {
  const normalized = text2(value, label, 1, 512);
  if (!regex.test(normalized)) fail4("INVALID_FIELD", `${label} is invalid`);
  return normalized;
}
function text2(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.trim() !== value) fail4("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time(value, label) {
  const normalized = pattern2(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail4("INVALID_TIME", `${label} is invalid`);
  return normalized;
}
function validDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail4("INVALID_TIME", "Product Session time is invalid");
  return value;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function fail4(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/product-session-proof-v2.js
var PROOF_FIELDS = ["version", "sessionBinding", "productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt", "signature"];
var INPUT_FIELDS = ["method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];
function createProductSessionProofV22(sessionInput, input, deviceSecretInput) {
  const session = parseProductSession2(sessionInput);
  exactFields2(input, INPUT_FIELDS, "Product Session v2 proof input");
  const secret = decodeBase64url3(deviceSecretInput, "deviceSecret");
  if (secret.length !== 32 || encodeBase64url2(p256.getPublicKey(secret, true)) !== session.deviceKey) fail5("DEVICE_CHANGED", "Product Session proof device changed");
  const unsigned = parseUnsigned({ version: "2", sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, ...input });
  const signature = encodeBase64url2(p256.sign(utf8ToBytes(productSessionProofV2SignBytes(unsigned)), secret, { format: "der" }));
  return parseProductSessionProofV22({ ...unsigned, signature });
}
async function createProductSessionProofV2With2(sessionInput, input, signer) {
  const session = parseProductSession2(sessionInput);
  exactFields2(input, INPUT_FIELDS, "Product Session v2 proof input");
  if (typeof signer !== "function") fail5("INVALID_DEVICE", "Product Session proof requires a platform device signer");
  const unsigned = parseUnsigned({ version: "2", sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, ...input });
  const payload = encodeBase64url2(utf8ToBytes(productSessionProofV2SignBytes(unsigned)));
  let signature;
  try {
    signature = await signer(Object.freeze({ purpose: "http-proof", algorithm: "p256-sha256", deviceKey: session.deviceKey, payload }));
  } catch {
    fail5("DEVICE_SIGNING_FAILED", "Platform device proof signing failed closed");
  }
  const proof = parseProductSessionProofV22({ ...unsigned, signature });
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url3(proof.signature, "signature"), decodeBase64url3(payload, "device signing payload"), decodeBase64url3(session.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail5("INVALID_DEVICE_PROOF", "Platform device proof signature does not match the registered device key");
  return proof;
}
function parseProductSessionProofV22(input) {
  exactFields2(input, PROOF_FIELDS, "Product Session v2 proof");
  const { signature, ...unsigned } = input;
  const bytes = decodeBase64url3(pattern3(signature, "signature", /^[A-Za-z0-9_-]{90,96}$/), "signature");
  if (bytes.length < 68 || bytes.length > 72 || encodeBase64url2(bytes) !== signature) fail5("INVALID_DEVICE_PROOF", "Product Session proof signature is invalid");
  return Object.freeze({ ...parseUnsigned(unsigned), signature });
}
function productSessionProofV2SignBytes(input) {
  return `YNX_PRODUCT_SESSION_HTTP_PROOF_V2
${canonicalJSON3(parseUnsigned(input))}`;
}
function parseUnsigned(input) {
  exactFields2(input, PROOF_FIELDS.filter((field) => field !== "signature"), "Unsigned Product Session v2 proof");
  const value = Object.freeze({ version: pattern3(input.version, "version", /^2$/), sessionBinding: digest2(input.sessionBinding, "sessionBinding"), productId: pattern3(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern3(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), applicationId: pattern3(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: nullableIdentity(input.bundleId, "bundleId"), packageId: nullableIdentity(input.packageId, "packageId"), origin: url(input.origin, "origin"), callback: url(input.callback, "callback"), account: pattern3(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), deviceId: pattern3(input.deviceId, "deviceId", /^[A-Za-z0-9._:-]{8,128}$/), deviceKey: pattern3(input.deviceKey, "deviceKey", /^[A-Za-z0-9_-]{44}$/), method: method(input.method), path: path(input.path), bodyDigest: digest2(input.bodyDigest, "bodyDigest"), nonce: pattern3(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/), issuedAt: time2(input.issuedAt, "issuedAt"), expiresAt: time2(input.expiresAt, "expiresAt") });
  if (value.bundleId !== null && value.bundleId !== value.applicationId || value.packageId !== null && value.packageId !== value.applicationId || value.bundleId !== null && value.packageId !== null) fail5("INVALID_FIELD", "Product Session proof application identity is inconsistent");
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 6e4) fail5("INVALID_EXPIRY", "Product Session proof lifetime must be at most sixty seconds");
  return value;
}
function url(value, label) {
  const normalized = pattern3(value, label, /^(https|app|[a-z][a-z0-9+.-]*):\/\/[^\s#?]+$/);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail5("INVALID_FIELD", `${label} is invalid`);
  }
  const canonical2 = label === "origin" && parsed.protocol === "https:" ? parsed.origin === normalized : parsed.toString() === normalized;
  if (!canonical2 || ["http:", "file:", "javascript:", "data:"].includes(parsed.protocol)) fail5("INVALID_FIELD", `${label} is unsafe`);
  return normalized;
}
function method(value) {
  return pattern3(value, "method", /^(DELETE|GET|PATCH|POST|PUT)$/);
}
function path(value) {
  const normalized = pattern3(value, "path", /^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/);
  if (normalized.includes("//") || normalized.endsWith("/") || normalized.includes("?") || normalized.includes("#")) fail5("INVALID_PATH", "Product Session proof path is non-canonical");
  return normalized;
}
function digest2(value, label) {
  return pattern3(value, label, /^[0-9a-f]{64}$/);
}
function nullableIdentity(value, label) {
  return value === null ? null : pattern3(value, label, /^[A-Za-z][A-Za-z0-9.-]{2,131}$/);
}
function pattern3(value, label, regex) {
  if (typeof value !== "string" || value.trim() !== value || !regex.test(value)) fail5("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time2(value, label) {
  const normalized = pattern3(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail5("INVALID_TIME", `${label} is invalid`);
  return normalized;
}
function fail5(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/product-session-gateway-snapshot-v2.js
var PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION2 = 2;

// vendor/wallet-auth-c5/src/wallet-session-control.js
var WALLET_SESSION_CONTROL_PATHS = Object.freeze(["/v2/product-sessions/wallet/sessions", "/v2/product-sessions/wallet/sessions/revoke"]);
var WALLET_SESSION_CONTROL_INTENT_PATHS = Object.freeze(["/v2/product-sessions/wallet/sessions/revoke-all", "/v2/product-sessions/wallet/devices/revoke"]);
var CLOCK_ANCHOR_PREFIX = "e4ab6187c05d932f";
var CLOCK_ANCHOR_PATTERN = new RegExp(`^${CLOCK_ANCHOR_PREFIX}[0-9a-f]{12}0{36}$`);

// vendor/wallet-auth-c5/src/product-session-control-capacity.js
var DEFAULT_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY = Object.freeze({ maxOwners: 256, intentsPerOwner: 32 });

// vendor/wallet-auth-c5/src/product-session-control-intent.js
var PATHS = Object.freeze({
  "account-logout": "/v2/product-sessions/wallet/sessions/revoke-all",
  "device-logout": "/v2/product-sessions/wallet/devices/revoke"
});

// vendor/wallet-auth-c5/src/integration.js
var REGISTRY_V2_FIELDS = ["schemaVersion", "productClientId", "requestingProduct", "bundleId", "callbacks", "scopes", "maxScopes", "productDeviceAlgorithms"];
var REGISTRY_V3_FIELDS = [...REGISTRY_V2_FIELDS, "origins"];
var SESSION_V1_BASE_FIELDS = [
  "verifierVersion",
  "sessionBinding",
  "chainId",
  "requestingProduct",
  "productClientId",
  "bundleId",
  "callback",
  "productDeviceAlgorithm",
  "productDeviceKey",
  "deviceBinding",
  "account",
  "scopes",
  "nonce",
  "purpose",
  "requestDigest",
  "approvalDigest",
  "issuedAt",
  "expiresAt"
];
var SESSION_V1_FIELDS = [...SESSION_V1_BASE_FIELDS, "accountPublicKey"];

// vendor/wallet-auth-c5/src/session-proof.js
function httpBodyDigest2(body) {
  if (typeof body !== "string" && !(body instanceof Uint8Array)) fail6("INVALID_BODY", "HTTP proof body must be a string or bytes");
  return bytesToHex(sha256(typeof body === "string" ? utf8ToBytes(body) : body));
}
function fail6(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/product-session-gateway-client.js
var PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 = "x-ynx-product-session-proof-v2";
var MAX_RESPONSE_BYTES = 1048576;
var gatewayAuthorities = /* @__PURE__ */ new WeakMap();
var ProductSessionGatewayFetchAdapter2 = class {
  #endpoint;
  #fetch;
  #walletInstalled;
  #schemeRegistered;
  #timeoutMs;
  constructor(config) {
    exactFields2(config, ["endpoint", "fetch", "walletInstalled", "schemeRegistered", "timeoutMs"], "Product Session Gateway fetch adapter configuration");
    this.#endpoint = endpoint(config.endpoint);
    if (typeof config.fetch !== "function" || typeof config.walletInstalled !== "function" || typeof config.schemeRegistered !== "function") fail7("INVALID_GATEWAY", "Product Session Gateway fetch adapter dependencies are invalid");
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1e3 || config.timeoutMs > 3e4) fail7("INVALID_GATEWAY", "Product Session Gateway timeout must be between one and thirty seconds");
    this.#fetch = config.fetch;
    this.#walletInstalled = config.walletInstalled;
    this.#schemeRegistered = config.schemeRegistered;
    this.#timeoutMs = config.timeoutMs;
    gatewayAuthorities.set(this, this.#endpoint);
  }
  async walletInstalled() {
    return capability(await this.#walletInstalled(), "Wallet installation detection");
  }
  async schemeRegistered() {
    return capability(await this.#schemeRegistered(), "Wallet scheme detection");
  }
  // Use a fresh HTTPS authority sample, without extrapolating the device clock or
  // adding half the network RTT. This instant has already passed at the authority.
  async currentTime(input) {
    exactFields2(input, ["requestId"], "Product Session Gateway time request");
    try {
      const result = await this.#request(input.requestId, "/v2/product-sessions/time", null, null, "GET");
      exactFields2(result, ["serverTime"], "Product Session Gateway time response");
      const now = new Date(result.serverTime);
      if (typeof result.serverTime !== "string" || !Number.isFinite(now.getTime()) || now.toISOString() !== result.serverTime) fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway time is invalid");
      return now;
    } catch (error) {
      if (error instanceof WalletAuthError2 && error.code === "NETWORK_UNAVAILABLE") throw error;
      fail7("CLOCK_UNAVAILABLE", "Product Session authority time could not be verified; Retry when Auth is available");
    }
  }
  async challenge(input) {
    exactFields2(input, ["requestId", "request", "approval"], "Product Session Gateway challenge request");
    return this.#request(input.requestId, "/v2/product-sessions/challenge", { request: input.request, approval: input.approval }, null);
  }
  async complete(input) {
    exactFields2(input, ["requestId", "request", "approval", "completion"], "Product Session Gateway completion request");
    return this.#request(input.requestId, "/v2/product-sessions/complete", { request: input.request, approval: input.approval, completion: input.completion }, null);
  }
  async introspect(input) {
    exactFields2(input, ["requestId", "sessionBinding", "requiredScopes", "proof"], "Product Session Gateway introspection request");
    const proof = parseProductSessionProofV22(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail7("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/introspect", { requiredScopes: input.requiredScopes }, proof);
  }
  async revoke(input) {
    exactFields2(input, ["requestId", "sessionBinding", "proof"], "Product Session Gateway revoke request");
    const proof = parseProductSessionProofV22(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail7("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/revoke", {}, proof);
  }
  async #request(requestId, path2, body, proof, method2 = "POST") {
    if (typeof requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(requestId)) fail7("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid");
    const encodedBody = method2 === "GET" ? void 0 : canonicalJSON3(body);
    const headers = { "accept": "application/json", "x-request-id": requestId };
    if (method2 === "POST") headers["content-type"] = "application/json";
    if (proof !== null) headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] = encodeProductSessionGatewayProofHeaderV2(proof);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      const fetch2 = this.#fetch;
      response = await fetch2(`${this.#endpoint}${path2}`, { method: method2, headers, body: encodedBody, cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal });
    } catch {
      clearTimeout(timeout);
      fail7("NETWORK_UNAVAILABLE", "Product Session Gateway is unavailable; no local response was substituted");
    }
    try {
      if (!response || typeof response.status !== "number" || !response.headers || typeof response.headers.get !== "function" || typeof response.text !== "function") fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is invalid");
      const contentType = response.headers.get("content-type") ?? "";
      const responseRequestId = response.headers.get("x-request-id");
      const cacheControl = response.headers.get("cache-control") ?? "";
      const contentLength = response.headers.get("content-length");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) || responseRequestId !== requestId || !/(^|,)\s*no-store\s*(,|$)/i.test(cacheControl)) fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response headers are invalid");
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let text3;
      try {
        text3 = await response.text();
      } catch {
        fail7("NETWORK_UNAVAILABLE", "Product Session Gateway response stream was interrupted; no local response was substituted");
      }
      if (new TextEncoder().encode(text3).length > MAX_RESPONSE_BYTES) fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let payload;
      try {
        payload = JSON.parse(text3);
      } catch {
        fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not JSON");
      }
      if (canonicalJSON3(payload) !== text3) fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not canonical JSON");
      if (response.status >= 200 && response.status < 300) {
        exactFields2(payload, ["ok", "requestId", "result", "schemaVersion"], "Product Session Gateway success response");
        if (payload.ok !== true || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION2) fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway success response binding is invalid");
        return payload.result;
      }
      exactFields2(payload, ["error", "ok", "requestId", "schemaVersion"], "Product Session Gateway error response");
      exactFields2(payload.error, ["code", "message"], "Product Session Gateway public error");
      if (payload.ok !== false || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION2 || typeof payload.error.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code) || typeof payload.error.message !== "string" || payload.error.message.length > 300) fail7("INVALID_GATEWAY_RESPONSE", "Product Session Gateway error response binding is invalid");
      throw new WalletAuthError2(payload.error.code, payload.error.message);
    } finally {
      clearTimeout(timeout);
    }
  }
};
function encodeProductSessionGatewayProofHeaderV2(value) {
  const proof = parseProductSessionProofV22(value);
  const encoded = encodeBase64url2(new TextEncoder().encode(canonicalJSON3(proof)));
  if (encoded.length > 16384) fail7("INVALID_PROOF_HEADER", "Product Session proof header exceeds policy");
  return encoded;
}
function endpoint(value) {
  if (typeof value !== "string" || value.length > 512) fail7("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail7("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || parsed.pathname !== "/" || value !== parsed.origin) fail7("INVALID_GATEWAY", "Product Session Gateway endpoint must be a canonical HTTPS origin");
  return parsed.origin;
}
function capability(value, label) {
  if (typeof value !== "boolean") fail7("INVALID_GATEWAY", `${label} must return a boolean`);
  return value;
}
function fail7(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/product-session-router.js
var WALLET_ROUTE_STATUS2 = Object.freeze({
  READY: "ready",
  WALLET_NOT_INSTALLED: "wallet-not-installed",
  SCHEME_NOT_REGISTERED: "scheme-not-registered",
  SESSION_EXPIRED: "session-expired",
  CALLBACK_MISMATCH: "callback-mismatch",
  USER_REJECTED: "user-rejected",
  NETWORK_UNAVAILABLE: "network-unavailable"
});
function walletConnectionChoices2(registryInput, productId, availability) {
  const registry = parseProductSessionRegistry2(registryInput);
  exactFields2(availability, ["ynxWalletInstalled", "metaMaskAvailable"], "Wallet availability");
  if (typeof availability.ynxWalletInstalled !== "boolean" || typeof availability.metaMaskAvailable !== "boolean") fail8("INVALID_WALLET_AVAILABILITY", "Wallet availability flags must be boolean");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail8("UNKNOWN_PRODUCT", "Product is not registered for Wallet connection");
  const choices = [];
  if (availability.ynxWalletInstalled) {
    choices.push(Object.freeze({ id: "ynx-wallet", action: "open", label: "Open YNX Wallet", authoritative: true }));
  } else {
    choices.push(Object.freeze({ id: "download-ynx-wallet", action: "download", label: "Download YNX Wallet", url: registry.wallet.downloadUrl, authoritative: true }));
  }
  if (product.evmCompatible) choices.push(Object.freeze(availability.metaMaskAvailable ? { id: "metamask", action: "open-evm", label: "Use MetaMask", chainId: 6423, installed: true, authoritative: true, connectionMode: "evm-only", authority: "eip-1193-provider-only", ynxProductSession: false } : { id: "metamask", action: "download-evm-wallet", label: "Use MetaMask (install if needed)", url: registry.wallet.metaMaskDownloadUrl, chainId: 6423, installed: false, authoritative: true, connectionMode: "evm-only", authority: "none", ynxProductSession: false }));
  choices.push(Object.freeze({
    id: "guest",
    action: "guest",
    label: "Continue in Guest / Try mode",
    authoritative: false,
    limitations: Object.freeze(["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"])
  }));
  return Object.freeze(choices);
}
function encodeProductSessionWalletURL(registryInput, requestInput, at = /* @__PURE__ */ new Date()) {
  const registry = parseProductSessionRegistry2(registryInput);
  const request = parseProductSessionRequest2(registry, requestInput, at);
  const target = new URL(registry.wallet.authorizeCallback);
  target.searchParams.set("request", encodeBase64url2(new TextEncoder().encode(canonicalJSON3(request))));
  return target.toString();
}
function prepareWalletOpen2(registryInput, requestInput, environment, at = /* @__PURE__ */ new Date()) {
  exactFields2(environment, ["networkAvailable", "walletInstalled", "schemeRegistered"], "Wallet open environment");
  if (!environment.networkAvailable) return routeState(WALLET_ROUTE_STATUS2.NETWORK_UNAVAILABLE, "Retry when network connectivity returns", ["retry", "return-to-product"]);
  let request;
  try {
    request = parseProductSessionRequest2(registryInput, requestInput, at);
  } catch (error) {
    if (error instanceof WalletAuthError2 && (error.code === "SESSION_EXPIRED" || error.code === "EXPIRED")) return routeState(WALLET_ROUTE_STATUS2.SESSION_EXPIRED, "Start a new Wallet connection request", ["retry", "return-to-product"]);
    throw error;
  }
  if (!environment.walletInstalled) return routeState(WALLET_ROUTE_STATUS2.WALLET_NOT_INSTALLED, "Install YNX Wallet or return to Guest / Try mode", ["download", "guest", "return-to-product"]);
  if (!environment.schemeRegistered) return routeState(WALLET_ROUTE_STATUS2.SCHEME_NOT_REGISTERED, "Repair or reinstall YNX Wallet, then retry", ["download", "retry", "return-to-product"]);
  return Object.freeze({ status: WALLET_ROUTE_STATUS2.READY, url: encodeProductSessionWalletURL(registryInput, request, at), request, actions: Object.freeze([]) });
}
function prepareWalletAttempt(registryInput, requestInput, at = /* @__PURE__ */ new Date()) {
  const request = parseProductSessionRequest2(registryInput, requestInput, at);
  return Object.freeze({
    status: WALLET_ROUTE_STATUS2.READY,
    url: encodeProductSessionWalletURL(registryInput, request, at),
    request,
    installation: "unverified",
    automatic: false,
    actions: Object.freeze([])
  });
}
function parseProductSessionReturnURL2(registryInput, pendingRequest, url2, at = /* @__PURE__ */ new Date()) {
  let request;
  try {
    request = parseProductSessionRequest2(registryInput, pendingRequest, at);
  } catch (error) {
    if (error instanceof WalletAuthError2 && error.code === "SESSION_EXPIRED") return routeState(WALLET_ROUTE_STATUS2.SESSION_EXPIRED, "The Wallet approval request expired", ["retry", "return-to-product"]);
    throw error;
  }
  const parsed = safeURL(url2, "CALLBACK_MISMATCH", "Wallet callback is invalid");
  const expected = new URL(request.callback);
  const result = parsed.searchParams.get("result");
  const allowed = result === "approved" ? ["approval", "nonce", "result", "state"] : ["nonce", "reason", "result", "state"];
  const keys = [...parsed.searchParams.keys()].sort();
  parsed.search = "";
  if (parsed.toString() !== expected.toString() || parsed.hash || parsed.username || parsed.password || keys.join("\n") !== allowed.join("\n") || parsed.protocol === "http:" || parsed.protocol === "file:" || parsed.protocol === "javascript:") return routeState(WALLET_ROUTE_STATUS2.CALLBACK_MISMATCH, "Return to the product and start a new Wallet request", ["retry", "return-to-product"]);
  if (new URL(url2).searchParams.get("nonce") !== request.nonce || new URL(url2).searchParams.get("state") !== request.state) return routeState(WALLET_ROUTE_STATUS2.CALLBACK_MISMATCH, "Wallet callback nonce or state did not match", ["retry", "return-to-product"]);
  if (result === "rejected" && new URL(url2).searchParams.get("reason") === "user_rejected") return routeState(WALLET_ROUTE_STATUS2.USER_REJECTED, "No Product Session was created", ["guest", "retry", "return-to-product"]);
  if (result !== "approved") return routeState(WALLET_ROUTE_STATUS2.CALLBACK_MISMATCH, "Wallet callback result was not recognized", ["retry", "return-to-product"]);
  try {
    const approval = parseProductSessionApproval2(registryInput, request, decodeJSON(new URL(url2).searchParams.get("approval"), "Wallet approval"), at);
    return Object.freeze({ status: WALLET_ROUTE_STATUS2.READY, request, approval, actions: Object.freeze([]) });
  } catch (error) {
    if (error instanceof WalletAuthError2) return routeState(WALLET_ROUTE_STATUS2.CALLBACK_MISMATCH, "Wallet approval did not match the pending product request", ["retry", "return-to-product"]);
    throw error;
  }
}
function routeState(status, message, actions) {
  return Object.freeze({ status, message, actions: Object.freeze(actions) });
}
function decodeJSON(value, label) {
  try {
    const bytes = decodeBase64url3(value ?? "", label);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail8("INVALID_ROUTE_PAYLOAD", `${label} encoding is invalid`);
  }
}
function safeURL(value, code, message) {
  if (typeof value !== "string" || value.length > 4096) fail8(code, message);
  try {
    return new URL(value);
  } catch {
    fail8(code, message);
  }
}
function fail8(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/product-session-revocation-intent.js
var BINDING_FIELDS = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"];
function createRevocationIntent(binding2, device2, intentId, session) {
  return parseRevocationIntent(canonicalJSON3({ version: 1, intentId, scope: scope(binding2, device2), session }), binding2, device2);
}
function parseRevocationIntent(raw, binding2, device2) {
  if (typeof raw !== "string" || raw.length > 16384) fail9("INVALID_SESSION_STORE", "Pending revocation intent is invalid");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail9("INVALID_SESSION_STORE", "Pending revocation intent is not valid JSON");
  }
  exactFields2(value, ["version", "intentId", "scope", "session"], "Pending Product Session revocation intent");
  if (value.version !== 1 || !/^[A-Za-z0-9_-]{32,64}$/.test(value.intentId) || value.scope !== scope(binding2, device2)) fail9("CROSS_PRODUCT_SESSION", "Pending revocation intent does not match this product device");
  const session = value.session === null ? null : parseProductSession2(value.session);
  if (session && (BINDING_FIELDS.some((field) => session[field] !== binding2[field]) || session.deviceId !== device2.id || session.deviceKey !== device2.key || canonicalJSON3(session.scopes) !== canonicalJSON3(device2.scopes))) fail9("CROSS_PRODUCT_SESSION", "Pending revocation target does not match this product device");
  return Object.freeze({ version: 1, intentId: value.intentId, scope: value.scope, session });
}
function revocationSessionMatches(raw, session) {
  if (raw === null || session === null) return false;
  try {
    return canonicalJSON3(parseProductSession2(JSON.parse(raw))) === canonicalJSON3(session);
  } catch {
    return false;
  }
}
function scope(binding2, device2) {
  return digestHex2("YNX_PRODUCT_SESSION_LOCAL_REVOCATION_SCOPE_V1", { ...Object.fromEntries(BINDING_FIELDS.map((field) => [field, binding2[field]])), deviceId: device2.id, deviceKey: device2.key, scopes: device2.scopes });
}
function fail9(code, message) {
  throw new WalletAuthError2(code, message);
}
function createRevocationCompletion(rawIntent, binding2, device2, outcome) {
  const intent = parseRevocationIntent(rawIntent, binding2, device2);
  const raw = canonicalJSON3({
    version: 1,
    intentId: intent.intentId,
    scope: intent.scope,
    targetDigest: intent.session === null ? null : digestHex2("YNX_PRODUCT_SESSION_REVOKED_TARGET_V1", intent.session),
    sessionBinding: intent.session?.sessionBinding ?? null,
    outcome
  });
  return parseRevocationCompletion(raw, binding2, device2);
}
function parseRevocationCompletion(raw, binding2, device2) {
  if (typeof raw !== "string" || raw.length > 2048) fail9("INVALID_SESSION_STORE", "Revocation completion is invalid");
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    fail9("INVALID_SESSION_STORE", "Revocation completion is not JSON");
  }
  exactFields2(v, ["version", "intentId", "scope", "targetDigest", "sessionBinding", "outcome"], "Revocation completion");
  if (v.version !== 1 || !/^[A-Za-z0-9_-]{32,64}$/.test(v.intentId) || v.scope !== scope(binding2, device2) || !["server-revoked", "authority-expired", "local-only"].includes(v.outcome)) fail9("CROSS_PRODUCT_SESSION", "Revocation completion crosses its original intent or scope");
  if (v.outcome === "local-only" ? v.targetDigest !== null || v.sessionBinding !== null : typeof v.targetDigest !== "string" || !/^[0-9a-f]{64}$/.test(v.targetDigest) || typeof v.sessionBinding !== "string" || !/^[0-9a-f]{64}$/.test(v.sessionBinding)) fail9("INVALID_SESSION_STORE", "Revocation completion target is invalid");
  if (canonicalJSON3(v) !== raw) fail9("INVALID_SESSION_STORE", "Revocation completion is not canonical");
  return Object.freeze(v);
}
function readRevocationCompletions(raw, binding2, device2) {
  if (raw === null) return [];
  if (typeof raw !== "string" || raw.length > 131072) fail9("INVALID_SESSION_STORE", "Revocation completion history is invalid");
  let values;
  try {
    values = JSON.parse(raw);
  } catch {
    fail9("INVALID_SESSION_STORE", "Revocation history is not JSON");
  }
  if (!Array.isArray(values) || values.length > 64 || canonicalJSON3(values) !== raw) fail9("INVALID_SESSION_STORE", "Revocation completion history is not bounded canonical JSON");
  const seen = /* @__PURE__ */ new Set();
  return values.map((value) => {
    const parsed = parseRevocationCompletion(canonicalJSON3(value), binding2, device2);
    if (seen.has(parsed.intentId)) fail9("INVALID_SESSION_STORE", "Duplicate revocation completion");
    seen.add(parsed.intentId);
    return parsed;
  });
}

// vendor/wallet-auth-c5/src/product-session-completion-record.js
function parseCompletionRecord(registry, raw, at) {
  if (typeof raw !== "string" || raw.length > 16384) fail10("INVALID_SESSION_STORE", "Protected completion record is invalid");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail10("INVALID_SESSION_STORE", "Protected completion record is not valid JSON");
  }
  exactFields2(value, ["request", "approval", "completion"], "Protected Product Session completion");
  const request = parseProductSessionRequest2(registry, value.request, at);
  const approval = parseProductSessionApproval2(registry, request, value.approval, at);
  exactFields2(value.completion, ["challenge", "deviceSignature"], "Protected Product Session device completion");
  const challenge = parseProductSessionChallenge2(value.completion.challenge);
  const expected = createProductSessionChallenge2(registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
  if (canonicalJSON3(challenge) !== canonicalJSON3(expected)) fail10("SESSION_BINDING_MISMATCH", "Protected completion challenge changed");
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url3(value.completion.deviceSignature, "deviceSignature"), new TextEncoder().encode(`YNX_PRODUCT_SESSION_CHALLENGE_V2
${canonicalJSON3(challenge)}`), decodeBase64url3(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail10("INVALID_DEVICE_PROOF", "Protected completion signature is invalid");
  return Object.freeze({ request, approval, completion: Object.freeze({ challenge, deviceSignature: value.completion.deviceSignature }) });
}
function deriveCompletionTarget(registry, raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail10("INVALID_SESSION_STORE", "Protected completion record is not valid JSON");
  }
  const at = new Date(value?.completion?.challenge?.issuedAt);
  const record = parseCompletionRecord(registry, raw, at);
  const verifier = new ProductSessionAuthority2(registry);
  verifier.issueChallenge({ request: record.request, approval: record.approval, challenge: record.completion.challenge.challenge }, at);
  return verifier.complete(record, at);
}
function fail10(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/product-session-recovery.js
var PRODUCT_SESSION_CLIENT_STATE2 = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  GUEST: "guest",
  EXPIRED: "expired",
  NETWORK_UNAVAILABLE: "network-unavailable",
  RETRY_REQUIRED: "retry-required"
});
var REVOCATION_PENDING = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, "Product Session revocation is pending; API authorization is suspended", { actions: ["retry"], revocationPending: true });
var RecoverableProductSessionClient2 = class {
  #finiteServiceSeconds;
  #registry;
  #binding;
  #storage;
  #gateway;
  #device;
  #tokens;
  #clock;
  #state;
  #autoReconnectAttempted;
  #networkAvailable;
  #networkEpoch;
  #disconnectPromise;
  #returnOperation;
  #recoveryPromise;
  #revocationRequested = false;
  #revocationIntent = null;
  #beginEpoch = 0;
  #beginMutation = Promise.resolve();
  constructor(config) {
    exactFields2(config, ["registry", "productId", "platform", "storage", "gateway", "device", "tokenFactory", "clock", ...Object.hasOwn(config ?? {}, "finiteServiceSeconds") ? ["finiteServiceSeconds"] : []], "Recoverable Product Session client configuration");
    this.#registry = parseProductSessionRegistry2(config.registry);
    this.#binding = productPlatformBinding2(this.#registry, config.productId, config.platform);
    this.#storage = secureStorage(config.storage, config.platform, config.device);
    this.#revocationRequested = this.#storage.revocationRequested?.() === true;
    this.#gateway = gateway(config.gateway);
    this.#device = device(config.device);
    this.#tokens = tokenFactory(config.tokenFactory);
    this.#clock = clock(config.clock);
    if (Object.hasOwn(config, "finiteServiceSeconds")) {
      if (!Number.isInteger(config.finiteServiceSeconds) || config.finiteServiceSeconds < 300 || config.finiteServiceSeconds > 7200) fail11("INVALID_SERVICE_CONSENT_TIME", "Explicit finite service duration is outside the approved bounds");
      this.#finiteServiceSeconds = config.finiteServiceSeconds;
    }
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.DISCONNECTED, "No authoritative Product Session is active");
    this.#autoReconnectAttempted = false;
    this.#networkAvailable = true;
    this.#networkEpoch = 0;
    this.#disconnectPromise = null;
    this.#returnOperation = null;
    this.#recoveryPromise = null;
  }
  // Suspend outward authority as soon as disconnect starts, including while its
  // clock lookup or a prior recovery is pending. Keep protected state for Retry.
  get current() {
    if (this.#storage.revocationRequested?.() === true) this.#revocationRequested = true;
    return this.#disconnectPromise !== null || this.#revocationRequested && [PRODUCT_SESSION_CLIENT_STATE2.DISCONNECTED, PRODUCT_SESSION_CLIENT_STATE2.CONNECTED, PRODUCT_SESSION_CLIENT_STATE2.CONNECTING, PRODUCT_SESSION_CLIENT_STATE2.GUEST].includes(this.#state.status) ? REVOCATION_PENDING : this.#state;
  }
  get storageKey() {
    return `ynx.product-session.v2:${this.#binding.productId}:${this.#binding.platform}:${this.#binding.applicationId}`;
  }
  get connectionBinding() {
    return Object.freeze({ productId: this.#binding.productId, platform: this.#binding.platform, applicationId: this.#binding.applicationId });
  }
  async detectWalletEnvironment() {
    let walletInstalled, schemeRegistered;
    try {
      [walletInstalled, schemeRegistered] = await Promise.all([this.#gateway.walletInstalled(), this.#gateway.schemeRegistered()]);
    } catch (error) {
      if (error instanceof WalletAuthError2) throw error;
      fail11("WALLET_UNAVAILABLE", "Wallet availability detection failed closed");
    }
    if (typeof walletInstalled !== "boolean" || typeof schemeRegistered !== "boolean") fail11("INVALID_GATEWAY_RESPONSE", "Wallet availability detection returned invalid values");
    return Object.freeze({ walletInstalled, schemeRegistered });
  }
  async beginDetected(automatic = false) {
    const epoch = ++this.#beginEpoch;
    let environment;
    try {
      environment = await this.detectWalletEnvironment();
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      throw error;
    }
    if (epoch !== this.#beginEpoch) return this.current;
    return this.#begin(environment, automatic, false, epoch);
  }
  async beginExplicit() {
    return this.#begin(null, false, true, ++this.#beginEpoch);
  }
  async retryDetected() {
    const epoch = ++this.#beginEpoch;
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) {
      this.#networkAvailable = true;
      return this.disconnect();
    }
    let environment;
    try {
      environment = await this.detectWalletEnvironment();
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      throw error;
    }
    if (epoch !== this.#beginEpoch) return this.current;
    return this.retry(environment);
  }
  async restore(networkAvailable = true) {
    const epoch = this.#beginEpoch;
    await this.#recover(() => this.#restore(networkAvailable, epoch));
    return this.current;
  }
  async #restore(networkAvailable, epoch) {
    this.#networkAvailable = Boolean(networkAvailable);
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const restored = await this.#restoreStoredSession(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (restored !== null) return restored;
    const pendingReturn = await this.#storage.get(`${this.storageKey}:return`);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingReturn !== null) return this.handleReturn(pendingReturn);
    const pending = await this.#restorePendingRequest(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pending !== null) return pending;
    if (!this.#autoReconnectAttempted) {
      this.#autoReconnectAttempted = true;
      return this.beginDetected(true);
    }
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, "Stored Product Session is invalid; explicit Retry is required", { actions: ["retry", "guest"] });
    return this.#state;
  }
  async begin(environment, automatic = false) {
    exactFields2(environment, ["walletInstalled", "schemeRegistered"], "Product Session connection environment");
    return this.#begin(environment, automatic, false, ++this.#beginEpoch);
  }
  async #restorePendingRequest(epoch) {
    await this.#beginMutation;
    if (epoch !== this.#beginEpoch) return this.current;
    const key = `${this.storageKey}:pending`, raw = await this.#storage.get(key);
    if (epoch !== this.#beginEpoch) return this.current;
    if (raw === null) return null;
    if (this.#revocationRequested) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const networkEpoch = this.#networkEpoch;
    const retained = (message) => {
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, message, { actions: ["retry", "guest"] });
      return this.#state;
    };
    let request;
    try {
      if (typeof raw !== "string" || raw.length > 16384) fail11("INVALID_SESSION_STORE", "Pending Wallet request exceeds policy");
      const input = JSON.parse(raw);
      request = parseProductSessionRequest2(this.#registry, input, new Date(input?.issuedAt));
      for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
        if (request[field] !== this.#binding[field]) fail11("SESSION_BINDING_MISMATCH", "Pending Wallet request belongs to another product binding");
      }
      if (request.deviceId !== this.#device.id || request.deviceKey !== this.#device.key || canonicalJSON3(request.scopes) !== canonicalJSON3(this.#device.scopes)) fail11("SESSION_BINDING_MISMATCH", "Pending Wallet request belongs to another device or scope selection");
    } catch {
      return retained("The saved Wallet request is invalid or belongs to another binding; it was retained. Start a new explicit request to replace it.");
    }
    let now;
    try {
      if (typeof this.#gateway.currentTime !== "function") fail11("CLOCK_UNAVAILABLE", "Pending request recovery requires authority time");
      now = await this.#now();
    } catch {
      if (epoch !== this.#beginEpoch) return this.current;
      return this.#offline("Authority time is unavailable; the original Wallet request was retained for Retry");
    }
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while checking the original Wallet request; it was retained for Retry");
    try {
      request = parseProductSessionRequest2(this.#registry, request, now);
    } catch {
      return retained("The saved Wallet request expired or is invalid; it was retained. Start a new explicit request to replace it.");
    }
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    const readback = await this.#storage.get(key);
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading the original Wallet request; explicit Retry is required");
    if (readback !== raw) return retained("The saved Wallet request changed during recovery; no replacement request was created");
    const route = prepareWalletAttempt(this.#registry, request, now);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.CONNECTING, "The original Wallet approval is still pending; explicitly open the same request", { request, route, automatic: false, installation: "unverified" });
    return this.#state;
  }
  async #begin(environment, automatic, explicit, epoch) {
    try {
      return await this.#beginRequest(environment, automatic, explicit, epoch);
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      throw error;
    }
  }
  async #beginRequest(environment, automatic, explicit, epoch) {
    if (this.#finiteServiceSeconds !== void 0 && automatic) {
      if (this.#state.status !== PRODUCT_SESSION_CLIENT_STATE2.EXPIRED) this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, "Finite service access requires explicit Wallet approval", { actions: ["retry", "guest"] });
      return this.current;
    }
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const networkEpoch = this.#networkEpoch;
    let now;
    try {
      if (explicit && typeof this.#gateway.currentTime !== "function") fail11("CLOCK_UNAVAILABLE", "Explicit Wallet opening requires the authority-time adapter");
      now = await this.#now();
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      if (isNetworkUnavailable(error) || explicit && !(error instanceof WalletAuthError2)) return this.#offline("Authority time is unavailable; Retry before opening Wallet");
      throw error;
    }
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading authority time; explicit Retry is required");
    const pendingRevocation = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingRevocation) return this.#pendingRevocation();
    const request = createProductSessionRequest2(this.#registry, {
      productId: this.#binding.productId,
      platform: this.#binding.platform,
      deviceId: this.#device.id,
      deviceKey: this.#device.key,
      scopes: this.#device.scopes,
      purpose: this.#device.purpose,
      nonce: this.#tokens(),
      state: this.#tokens(),
      ...this.#finiteServiceSeconds === void 0 ? {} : { finiteServiceSeconds: this.#finiteServiceSeconds }
    }, now);
    const mutation = this.#beginMutation.then(async () => {
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while preparing the Wallet request; explicit Retry is required");
      const key = `${this.storageKey}:pending`, raw = canonicalJSON3(request);
      let wrote = false;
      const cancelled = async () => {
        if (wrote && await this.#storage.get(key) === raw) await this.#storage.remove(key);
        return this.current;
      };
      try {
        for (const suffix of ["pending", "return", "completion"]) {
          if (epoch !== this.#beginEpoch) return cancelled();
          await this.#storage.remove(`${this.storageKey}:${suffix}`);
        }
        if (epoch !== this.#beginEpoch) return cancelled();
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while preparing the Wallet request; explicit Retry is required");
        wrote = true;
        await this.#storage.set(key, raw);
        if (epoch !== this.#beginEpoch) return cancelled();
        const stored = await this.#storage.get(key);
        if (epoch !== this.#beginEpoch) return cancelled();
        if (stored !== raw) fail11("INSECURE_STORAGE", "Pending Wallet request did not read back exactly");
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while protecting the Wallet request; explicit Retry is required");
        const route = explicit ? prepareWalletAttempt(this.#registry, request, now) : prepareWalletOpen2(this.#registry, request, { networkAvailable: true, walletInstalled: environment.walletInstalled, schemeRegistered: environment.schemeRegistered }, now);
        this.#state = route.status === WALLET_ROUTE_STATUS2.READY ? state(PRODUCT_SESSION_CLIENT_STATE2.CONNECTING, automatic ? "Controlled reconnect requires Wallet approval" : "Wallet approval is pending", { request, route, automatic, ...explicit ? { installation: "unverified" } : {} }) : state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, route.message, { request, route, automatic, actions: route.actions });
        return this.#state;
      } catch (error) {
        if (epoch !== this.#beginEpoch) return cancelled();
        throw error;
      }
    });
    this.#beginMutation = mutation.catch(() => {
    });
    return mutation;
  }
  async handleReturn(url2) {
    if (this.#returnOperation !== null) {
      if (this.#returnOperation.url !== url2) fail11("CONCURRENT_CALLBACK", "A different Wallet callback is already being verified");
      await this.#returnOperation.promise;
      return this.current;
    }
    const operation = this.#handleReturn(url2);
    this.#returnOperation = { url: url2, promise: operation };
    try {
      await operation;
      return this.current;
    } finally {
      if (this.#returnOperation?.promise === operation) this.#returnOperation = null;
    }
  }
  async #handleReturn(url2) {
    if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
    if (!this.#networkAvailable) {
      if (typeof url2 === "string" && url2.length <= 16384 && await this.#storage.get(`${this.storageKey}:pending`) !== null) await this.#storage.set(`${this.storageKey}:return`, url2);
      return this.#offline();
    }
    const networkEpoch = this.#networkEpoch;
    const raw = await this.#storage.get(`${this.storageKey}:pending`);
    if (raw === null) {
      await this.#storage.remove(`${this.storageKey}:return`);
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, "No pending Wallet request matches this callback", { actions: ["retry", "guest"] });
      return this.#state;
    }
    let now;
    try {
      now = await this.#now();
    } catch (error) {
      if (isNetworkUnavailable(error)) {
        if (typeof url2 === "string" && url2.length <= 16384) await this.#storage.set(`${this.storageKey}:return`, url2);
        return this.#offline("Authority time is unavailable; the pending Wallet callback was retained for Retry");
      }
      throw error;
    }
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) {
      if (typeof url2 === "string" && url2.length <= 16384) await this.#storage.set(`${this.storageKey}:return`, url2);
      return this.#networkTransition("Network changed while reading authority time; Wallet callback was retained for Retry");
    }
    let request;
    try {
      request = parseProductSessionRequest2(this.#registry, JSON.parse(raw), now);
    } catch {
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, "Pending Wallet request expired or is invalid", { actions: ["retry", "guest"] });
      return this.#state;
    }
    const returned = parseProductSessionReturnURL2(this.#registry, request, url2, now);
    if (returned.status === WALLET_ROUTE_STATUS2.USER_REJECTED) {
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.DISCONNECTED, "Wallet approval was rejected; no session was created", { actions: returned.actions });
      return this.#state;
    }
    if (returned.status !== WALLET_ROUTE_STATUS2.READY) {
      await this.#storage.remove(`${this.storageKey}:return`);
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, returned.message, { actions: returned.actions });
      return this.#state;
    }
    await this.#storage.set(`${this.storageKey}:return`, url2);
    try {
      const storedCompletion = await this.#storage.get(`${this.storageKey}:completion`);
      let completion;
      if (storedCompletion !== null) {
        const record = parseCompletionRecord(this.#registry, storedCompletion, now);
        if (canonicalJSON3(record.request) !== canonicalJSON3(request) || canonicalJSON3(record.approval) !== canonicalJSON3(returned.approval) || record.completion.challenge.deviceId !== this.#device.id || record.completion.challenge.deviceKey !== this.#device.key) fail11("SESSION_BINDING_MISMATCH", "Protected completion belongs to another exact Wallet approval");
        if (record.completion.challenge.sessionExpiresAt <= now.toISOString()) fail11("SESSION_EXPIRED", "Previously completed Product Session has expired");
        completion = record.completion;
      } else {
        const challenge = parseProductSessionChallenge2(await this.#gateway.challenge({ requestId: gatewayRequestId("c", request.nonce), request, approval: returned.approval }));
        if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while receiving the Gateway challenge; protected callback was retained for Retry");
        const expectedChallenge = createProductSessionChallenge2(this.#registry, request, returned.approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
        if (canonicalJSON3(challenge) !== canonicalJSON3(expectedChallenge)) fail11("SESSION_BINDING_MISMATCH", "Gateway challenge did not match the exact product request and Wallet approval");
        if (challenge.expiresAt <= (await this.#now()).toISOString()) fail11("SESSION_EXPIRED", "Gateway challenge expired before product device signing");
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading challenge time; protected callback was retained for Retry");
        if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
        completion = this.#device.sign ? await signProductSessionChallengeWith2(challenge, this.#device.sign) : signProductSessionChallenge2(challenge, this.#device.secret);
        await this.#storage.set(`${this.storageKey}:completion`, canonicalJSON3({ request, approval: returned.approval, completion }));
      }
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during platform challenge signing; protected callback was retained for Retry");
      if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
      const session = parseProductSession2(await this.#gateway.complete({ requestId: gatewayRequestId("f", request.state), request, approval: returned.approval, completion }));
      await this.#storage.set(this.storageKey, JSON.stringify(session));
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while protecting the issued Product Session; authoritative Retry is required");
      try {
        await this.#introspect(session);
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while confirming the issued Product Session; protected state was retained for Retry");
        throw error;
      }
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while confirming the Product Session; authoritative Retry is required");
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.CONNECTED, "Authoritative Product Session connected", { session });
      return this.#state;
    } catch (error) {
      if (this.#revocationRequested || error?.code === "REVOCATION_PENDING") return this.#pendingRevocation();
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while completing Wallet approval; the protected callback was retained for Retry");
      await this.#storage.remove(this.storageKey);
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, "Gateway did not issue or confirm a valid Product Session", { actions: ["retry", "guest"] });
      return this.#state;
    }
  }
  async retry(environment) {
    const epoch = ++this.#beginEpoch;
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) {
      this.#networkAvailable = true;
      return this.disconnect();
    }
    await this.#recover(() => this.#retry(environment, epoch));
    return this.current;
  }
  async #retry(environment, epoch) {
    this.#networkAvailable = true;
    const restored = await this.#restoreStoredSession(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (restored !== null) return restored;
    const pendingReturn = await this.#storage.get(`${this.storageKey}:return`);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingReturn !== null) return this.handleReturn(pendingReturn);
    const pending = await this.#restorePendingRequest(epoch);
    if (epoch !== this.#beginEpoch) return this.current;
    if (pending !== null) return pending;
    this.#autoReconnectAttempted = false;
    return this.begin(environment, false);
  }
  connectionChoices(availability) {
    return walletConnectionChoices2(this.#registry, this.#binding.productId, availability);
  }
  setNetworkAvailable(available) {
    this.#networkEpoch += 1;
    this.#networkAvailable = Boolean(available);
    if (!this.#networkAvailable) return this.#offline();
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, "Network restored; authoritative re-introspection is required", { actions: ["retry"] });
    return this.#state;
  }
  enterGuest() {
    this.#beginEpoch += 1;
    if (this.#revocationRequested) return this.#pendingRevocation();
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.GUEST, "Guest / Try mode: not signed in; balances, transactions and Chain authority are unavailable", { limitations: ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"] });
    return this.#state;
  }
  async disconnect() {
    if (this.#disconnectPromise !== null) return this.#disconnectPromise;
    this.#beginEpoch += 1;
    this.#revocationRequested = true;
    try {
      this.#storage.requestRevocation?.();
    } catch {
      return this.#pendingRevocation("Sign-out could not be saved synchronously; authorization remains suspended.");
    }
    const operation = this.#disconnect();
    this.#disconnectPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.#disconnectPromise === operation) this.#disconnectPromise = null;
    }
  }
  async #disconnect() {
    try {
      await this.#prepareRevocationIntent();
    } catch {
      return this.#pendingRevocation("Sign-out could not be saved securely; authorization remains suspended. Retry to save the same target.");
    }
    await this.#beginMutation;
    const pendingRecovery = this.#recoveryPromise;
    if (pendingRecovery !== null) {
      try {
        await pendingRecovery;
      } catch {
      }
    }
    const pendingReturn = this.#returnOperation?.promise ?? null;
    if (pendingReturn !== null) {
      try {
        await pendingReturn;
      } catch {
      }
    }
    await this.#loadRevocationIntent();
    let session = this.#revocationIntent.session;
    if (session === null) {
      const raw = await this.#storage.get(this.storageKey);
      if (raw !== null) {
        try {
          session = parseProductSession2(JSON.parse(raw));
        } catch {
          return this.#pendingRevocation("The pending sign-out target is unavailable; secure storage requires repair.");
        }
        await this.#saveRevocationIntent(createRevocationIntent(this.#binding, this.#device, this.#revocationIntent.intentId, session));
      }
    }
    let sessionExpired = false;
    if (session !== null) {
      try {
        const networkEpoch = this.#networkEpoch;
        if (!this.#networkAvailable) fail11("NETWORK_UNAVAILABLE", "Network unavailable before Product Session revocation");
        const now = await this.#now();
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail11("NETWORK_UNAVAILABLE", "Network changed while reading revocation authority time");
        sessionExpired = typeof this.#gateway.currentTime === "function" && session.expiresAt <= now.toISOString();
        if (!sessionExpired) {
          const body = {};
          const proof = await this.#proof(session, "/v2/product-sessions/revoke", body, now);
          if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail11("NETWORK_UNAVAILABLE", "Network changed during Product Session revocation signing");
          const result = await this.#gateway.revoke({ requestId: gatewayRequestId("r", proof.nonce), sessionBinding: session.sessionBinding, proof });
          if (result?.revoked !== session.sessionBinding) fail11("INVALID_GATEWAY_RESPONSE", "Gateway did not confirm the exact Product Session revocation");
        }
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while revoking the Product Session; protected state was retained for Retry");
        if (!(error instanceof WalletAuthError2) || error.code !== "SESSION_REVOKED") {
          this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, "Gateway did not confirm Product Session revocation; protected state was retained", { actions: ["retry"] });
          return this.#state;
        }
      }
    }
    if (session === null && await this.#storage.get(`${this.storageKey}:return`) !== null) return this.#pendingRevocation("A prior completion has not yielded its exact target; sign-out confirmation is still pending.");
    let revocationCompletion;
    try {
      revocationCompletion = await this.#finishRevocationIntent(session === null ? "local-only" : sessionExpired ? "authority-expired" : "server-revoked");
    } catch {
      return this.#pendingRevocation("The authority result was received but secure cleanup is pending; Retry the same sign-out target.");
    }
    this.#revocationRequested = false;
    this.#revocationIntent = null;
    this.#state = state(sessionExpired ? PRODUCT_SESSION_CLIENT_STATE2.EXPIRED : PRODUCT_SESSION_CLIENT_STATE2.DISCONNECTED, session === null ? "No authoritative Product Session was present; local connection request was removed" : sessionExpired ? "Auth confirmed that the exact Product Session expired; no revocation receipt was claimed" : "Auth confirmed revocation of the exact Product Session", { ...revocationCompletion ? { revocationCompletion } : {}, revocationConfirmed: session !== null && !sessionExpired, ...session ? { sessionBinding: session.sessionBinding } : {} });
    return this.#state;
  }
  async createIntrospectionProof(requiredScopes2) {
    return this.#createAPIProof(requiredScopes2);
  }
  // Two separate proofs: fresh identity introspection and the exact business body.
  // The server must atomically consume the action nonce with its own transaction.
  async createSocialAudienceProof(input) {
    exactFields2(input, ["path", "body"], "Social audience action");
    const path2 = input.path, raw = input.body;
    if (this.#binding.productId !== "social" || !["/social/v3/matrix/audience/resolve", "/social/v3/matrix/audience/authorize"].includes(path2)) fail11("HTTP_BINDING_MISMATCH", "Social audience proof requires an exact registered action path");
    if (typeof raw !== "string" || new TextEncoder().encode(raw).length > 16384) fail11("INVALID_FIELD", "Social action body must be bounded canonical JSON");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      fail11("INVALID_FIELD", "Social action body is invalid JSON");
    }
    if (body === null || typeof body !== "object" || Array.isArray(body) || canonicalJSON3(body) !== raw) fail11("INVALID_FIELD", "Social action body must be a canonical JSON object");
    assertActionUnicode(body);
    return this.#createAPIProof(["social.contacts", "social.feed", "social.messaging", "social.profile"], Object.freeze({ path: path2, body }));
  }
  // Generic business request proof: independent from one-shot introspection.
  // The server supplies route-required scopes and consumes the returned nonce
  // with its original actor/object transaction; proof alone is not permission.
  async createBusinessProof(input) {
    exactFields2(input, ["method", "path", "body", "requiredScopes"], "Product business request");
    const method2 = input.method, path2 = input.path, raw = input.body instanceof Uint8Array ? Uint8Array.from(input.body) : input.body;
    if (typeof method2 !== "string" || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method2) || typeof path2 !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(path2) || path2.includes("//") || path2.endsWith("/") || path2.split("/").some((part) => part === "." || part === "..") || path2.startsWith("/v2/product-sessions/") || path2.startsWith("/v2/browser-sessions/")) fail11("HTTP_BINDING_MISMATCH", "Business proof requires an exact product route");
    if (typeof raw !== "string" && !(raw instanceof Uint8Array) || (typeof raw === "string" ? new TextEncoder().encode(raw).length : raw.length) > 16777216) fail11("INVALID_FIELD", "Business request body is not bounded");
    if (method2 === "GET") {
      if (raw.length !== 0) fail11("HTTP_BINDING_MISMATCH", "GET business proof binds an empty HTTP body");
    }
    return this.#createAPIProof(input.requiredScopes, Object.freeze({ method: method2, path: path2, body: null, rawBody: raw }));
  }
  // Hash FINAL wire serialization, including multipart boundaries. The server
  // hashes its bounded actual incoming stream before accepting the proof.
  // A caller-supplied hash is never evidence that actual bytes were delivered.
  async createBusinessProofCommitment(input) {
    exactFields2(input, ["method", "path", "bodyDigest", "bodyBytes", "requiredScopes"], "Product business commitment");
    const { method: method2, path: path2, bodyDigest, bodyBytes } = input;
    if (typeof method2 !== "string" || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(method2) || typeof path2 !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(path2) || path2.includes("//") || path2.endsWith("/") || path2.split("/").some((part) => part === "." || part === "..") || path2.startsWith("/v2/product-sessions/") || path2.startsWith("/v2/browser-sessions/")) fail11("HTTP_BINDING_MISMATCH", "Business proof requires an exact product route");
    if (typeof bodyDigest !== "string" || !/^[0-9a-f]{64}$/.test(bodyDigest) || !Number.isSafeInteger(bodyBytes) || bodyBytes < 0 || bodyBytes > 536870912) fail11("INVALID_FIELD", "Commitment requires SHA-256 and bounded final wire byte count");
    if (method2 === "GET" && (bodyBytes !== 0 || bodyDigest !== httpBodyDigest2(""))) fail11("HTTP_BINDING_MISMATCH", "GET commitment must bind an empty body");
    return this.#createAPIProof(input.requiredScopes, Object.freeze({ method: method2, path: path2, body: null, bodyDigest, bodyBytes }));
  }
  async #createAPIProof(requiredScopes2, action = null) {
    const expected = this.current, epoch = this.#beginEpoch, networkEpoch = this.#networkEpoch;
    const active = () => {
      if (this.#revocationRequested || this.#disconnectPromise !== null) fail11("REVOCATION_PENDING", "Pending sign-out blocks Product Session API proofs");
      if (!this.#networkAvailable || networkEpoch !== this.#networkEpoch) fail11("NETWORK_UNAVAILABLE", "Network changed during Product Session API authorization");
      if (this.current !== expected || epoch !== this.#beginEpoch || expected.status !== PRODUCT_SESSION_CLIENT_STATE2.CONNECTED || !expected.session) fail11("SESSION_INACTIVE", "Connect and verify the same Product Session before signing an API proof");
    };
    active();
    const session = parseProductSession2(expected.session);
    for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
      if (session[field] !== this.#binding[field]) fail11("SESSION_BINDING_MISMATCH", "API proof session belongs to another product binding");
    }
    if (session.deviceId !== this.#device.id || session.deviceKey !== this.#device.key) fail11("SESSION_BINDING_MISMATCH", "API proof session belongs to another product device");
    const scopeCount = Array.isArray(requiredScopes2) ? requiredScopes2.length : 0;
    if (!Number.isInteger(scopeCount) || scopeCount < 1 || scopeCount > 8) fail11("SCOPE_WIDENING", "API proof scopes must be a nonempty sorted unique subset of the granted session");
    const scopes2 = Object.freeze(Array.from({ length: scopeCount }, (_, index) => requiredScopes2[index]));
    if (scopes2.some((scope2) => typeof scope2 !== "string" || !session.scopes.includes(scope2) || !this.#device.scopes.includes(scope2) || !this.#binding.scopes.includes(scope2)) || new Set(scopes2).size !== scopes2.length || [...scopes2].sort().join("\n") !== scopes2.join("\n")) fail11("SCOPE_WIDENING", "API proof scopes must be a nonempty sorted unique subset of the granted session");
    const body = Object.freeze({ requiredScopes: scopes2 });
    let originalRaw;
    const readback = async () => {
      active();
      if (await this.#loadRevocationIntent()) fail11("REVOCATION_PENDING", "Pending sign-out blocks Product Session API proofs");
      active();
      const raw = await this.#storage.get(this.storageKey);
      active();
      let stored;
      try {
        if (typeof raw !== "string" || raw.length > 16384) fail11("SESSION_INACTIVE", "Stored Product Session is unavailable");
        stored = parseProductSession2(JSON.parse(raw));
      } catch {
        fail11("SESSION_INACTIVE", "Stored Product Session is invalid; no API proof was released");
      }
      if (canonicalJSON3(stored) !== canonicalJSON3(session) || originalRaw !== void 0 && raw !== originalRaw) fail11("SESSION_INACTIVE", "Stored Product Session changed during API authorization");
      originalRaw = raw;
      if (await this.#loadRevocationIntent()) fail11("REVOCATION_PENDING", "Sign-out started during Product Session API authorization");
      active();
    };
    await readback();
    active();
    if (typeof this.#gateway.currentTime !== "function") fail11("CLOCK_UNAVAILABLE", "Product Session API proofs require authority time");
    let now;
    try {
      now = new Date((await this.#now()).getTime());
    } catch (error) {
      active();
      if (isNetworkUnavailable(error)) throw error;
      fail11("CLOCK_UNAVAILABLE", "Product Session authority time is unavailable");
    }
    active();
    if (now.toISOString() < session.issuedAt || now.toISOString() >= session.expiresAt) fail11("SESSION_EXPIRED", "Product Session is outside its authority-time validity window");
    const proof = await this.#proof(session, "/v2/product-sessions/introspect", body, now, { active, readback });
    const result = Object.freeze({ proof, proofHeader: encodeProductSessionGatewayProofHeaderV2(proof), requestId: gatewayRequestId("i", this.#tokens()), body: canonicalJSON3(body) });
    const actionProof = action === null ? null : await this.#proof(session, action.path, action.body, now, { active, readback }, action.method ?? "POST", action.rawBody ?? null, action.bodyDigest ?? null);
    await readback();
    active();
    if (actionProof !== null) return Object.freeze({ introspection: result, proof: actionProof, proofHeader: encodeProductSessionGatewayProofHeaderV2(actionProof), body: action.bodyDigest ? null : action.rawBody ?? canonicalJSON3(action.body), ...action.bodyDigest ? { commitment: Object.freeze({ bodyDigest: action.bodyDigest, bodyBytes: action.bodyBytes }) } : {} });
    return result;
  }
  async #introspect(session) {
    if (await this.#loadRevocationIntent()) fail11("REVOCATION_PENDING", "Pending sign-out blocks Product Session authorization");
    const networkEpoch = this.#networkEpoch;
    if (!this.#networkAvailable) fail11("NETWORK_UNAVAILABLE", "Network unavailable before Product Session introspection");
    const body = { requiredScopes: session.scopes };
    const proof = await this.#proof(session, "/v2/product-sessions/introspect", body);
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail11("NETWORK_UNAVAILABLE", "Network changed during Product Session introspection signing");
    const result = await this.#gateway.introspect({ requestId: gatewayRequestId("i", proof.nonce), sessionBinding: session.sessionBinding, requiredScopes: session.scopes, proof });
    if (await this.#loadRevocationIntent()) fail11("REVOCATION_PENDING", "Sign-out started during Product Session authorization");
    if (result?.active !== true || canonicalJSON3(parseProductSession2(result.session)) !== canonicalJSON3(session)) fail11("SESSION_INACTIVE", "Gateway did not confirm the exact Product Session");
    return result;
  }
  async #proof(session, path2, body, authorityTime, guard = null, method2 = "POST", rawBody = null, committedDigest = null) {
    if (path2 !== "/v2/product-sessions/revoke" && await this.#loadRevocationIntent()) fail11("REVOCATION_PENDING", "Pending sign-out blocks Product Session authorization");
    const networkEpoch = this.#networkEpoch;
    const now = authorityTime ?? await this.#now();
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail11("NETWORK_UNAVAILABLE", "Network changed while reading proof authority time");
    const expiresAt = new Date(Math.min(now.getTime() + 3e4, Date.parse(session.expiresAt))).toISOString();
    if (expiresAt <= now.toISOString()) fail11("SESSION_EXPIRED", "Product Session expired before sender-constrained authorization");
    const input = {
      method: method2,
      path: path2,
      bodyDigest: committedDigest ?? httpBodyDigest2(rawBody ?? canonicalJSON3(body)),
      nonce: this.#tokens(),
      issuedAt: now.toISOString(),
      expiresAt
    };
    if (guard !== null) {
      await guard.readback();
      guard.active();
    }
    const proof = this.#device.sign ? await createProductSessionProofV2With2(session, input, this.#device.sign) : createProductSessionProofV22(session, input, this.#device.secret);
    if (guard !== null) {
      await guard.readback();
      guard.active();
    }
    return proof;
  }
  async #now() {
    const value = typeof this.#gateway.currentTime === "function" ? await this.#gateway.currentTime({ requestId: gatewayRequestId("t", this.#tokens()) }) : this.#clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail11("CLOCK_UNAVAILABLE", "Product Session authority time is invalid");
    return value;
  }
  async #restoreStoredSession(epoch) {
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    const raw = await this.#storage.get(this.storageKey);
    if (epoch !== this.#beginEpoch) return this.current;
    if (raw === null) return null;
    const networkEpoch = this.#networkEpoch;
    try {
      const session = parseProductSession2(JSON.parse(raw));
      await this.#introspect(session);
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during Product Session re-introspection; protected state was retained for Retry");
      await this.#clearPending(epoch);
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while restoring the Product Session; protected state was retained for Retry");
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.CONNECTED, "Authoritative Product Session restored", { session });
      return this.#state;
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      if (this.#revocationRequested || error?.code === "REVOCATION_PENDING") return this.#pendingRevocation();
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable during Product Session re-introspection; protected state was retained but is not authoritative");
      await this.#storage.remove(this.storageKey);
      return null;
    }
  }
  async #clearPending(epoch) {
    const mutation = this.#beginMutation.then(async () => {
      for (const suffix of ["pending", "return", "completion"]) {
        if (epoch !== void 0 && epoch !== this.#beginEpoch) return;
        await this.#storage.remove(`${this.storageKey}:${suffix}`);
      }
    });
    this.#beginMutation = mutation.catch(() => {
    });
    return mutation;
  }
  async #loadRevocationIntent() {
    if (this.#storage.revocationRequested?.() === true) this.#revocationRequested = true;
    const raw = await this.#storage.get(`${this.storageKey}:revoke`);
    if (raw !== null) {
      this.#revocationRequested = true;
      this.#revocationIntent = parseRevocationIntent(raw, this.#binding, this.#device);
    }
    return this.#revocationRequested;
  }
  async #prepareRevocationIntent() {
    await this.#loadRevocationIntent();
    if (this.#revocationIntent !== null) {
      let intent2 = this.#revocationIntent;
      if (intent2.session === null) {
        const completion = await this.#storage.get(`${this.storageKey}:completion`);
        if (completion !== null) intent2 = createRevocationIntent(this.#binding, this.#device, intent2.intentId, deriveCompletionTarget(this.#registry, completion));
      }
      await this.#saveRevocationIntent(intent2);
      return;
    }
    let session = this.#state.session ?? null;
    if (session === null) {
      const raw = await this.#storage.get(this.storageKey);
      if (raw !== null) session = parseProductSession2(JSON.parse(raw));
    }
    if (session === null) {
      const raw = await this.#storage.get(`${this.storageKey}:completion`);
      if (raw !== null) session = deriveCompletionTarget(this.#registry, raw);
    }
    const intent = createRevocationIntent(this.#binding, this.#device, this.#tokens(), session);
    this.#revocationIntent = intent;
    await this.#saveRevocationIntent(intent);
  }
  async #saveRevocationIntent(intent) {
    const raw = canonicalJSON3(intent), key = `${this.storageKey}:revoke`;
    if (typeof this.#storage.saveRevocationIntent === "function") {
      this.#revocationIntent = parseRevocationIntent(await this.#storage.saveRevocationIntent(key, raw), this.#binding, this.#device);
    } else {
      await this.#storage.set(key, raw);
      if (await this.#storage.get(key) !== raw) fail11("INSECURE_STORAGE", "Pending sign-out intent did not read back exactly");
      this.#revocationIntent = intent;
    }
  }
  async getRevocationCompletions() {
    if (typeof this.#storage.getRevocationCompletions !== "function") fail11("DURABLE_REVOCATION_COMPLETION_UNSUPPORTED", "This protected runtime has no atomic completion history");
    return Object.freeze(readRevocationCompletions(await this.#storage.getRevocationCompletions(`${this.storageKey}:revoke-completions`), this.#binding, this.#device));
  }
  async getRevocationCompletion(intentId) {
    if (typeof intentId !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(intentId)) fail11("INVALID_FIELD", "Original revocation intent ID is required");
    if (typeof this.#storage.getRevocationCompletion !== "function") fail11("DURABLE_REVOCATION_COMPLETION_UNSUPPORTED", "This protected runtime has no atomic completion readback");
    const raw = await this.#storage.getRevocationCompletion(`${this.storageKey}:revoke-completions`, intentId);
    if (raw === null) return null;
    const receipt = parseRevocationCompletion(raw, this.#binding, this.#device);
    if (receipt.intentId !== intentId) fail11("REVOCATION_CHANGED", "Completion readback returned another intent");
    return receipt;
  }
  async acknowledgeRevocationCompletion(receipt) {
    const raw = canonicalJSON3(receipt);
    parseRevocationCompletion(raw, this.#binding, this.#device);
    if (typeof this.#storage.acknowledgeRevocationCompletion !== "function") fail11("DURABLE_REVOCATION_COMPLETION_UNSUPPORTED", "This runtime cannot acknowledge an exact completion");
    const parsed = parseRevocationCompletion(raw, this.#binding, this.#device);
    const current = await this.getRevocationCompletion(parsed.intentId);
    if (current === null) return;
    if (canonicalJSON3(current) !== raw) fail11("REVOCATION_CHANGED", "Cannot acknowledge a different original completion");
    await this.#storage.acknowledgeRevocationCompletion(`${this.storageKey}:revoke-completions`, raw);
  }
  async #finishRevocationIntent(outcome) {
    const intent = this.#revocationIntent, key = `${this.storageKey}:revoke`, raw = canonicalJSON3(intent);
    if (typeof this.#storage.finishRevocationIntentWithCompletion === "function") {
      const receiptRaw = canonicalJSON3(createRevocationCompletion(raw, this.#binding, this.#device, outcome));
      const saved = await this.#storage.finishRevocationIntentWithCompletion(key, raw, receiptRaw);
      if (saved !== receiptRaw || canonicalJSON3(await this.getRevocationCompletion(intent.intentId)) !== receiptRaw) fail11("REVOCATION_CHANGED", "Atomic cleanup did not preserve the exact completion");
      return parseRevocationCompletion(receiptRaw, this.#binding, this.#device);
    }
    if (typeof this.#storage.finishRevocationIntent === "function") return this.#storage.finishRevocationIntent(key, raw);
    if (await this.#storage.get(key) !== raw) fail11("REVOCATION_CHANGED", "Pending sign-out target changed during confirmation");
    if (revocationSessionMatches(await this.#storage.get(this.storageKey), intent.session)) await this.#storage.remove(this.storageKey);
    await this.#clearPending();
    await this.#storage.remove(key);
  }
  #pendingRevocation(message = "Sign-out confirmation is pending; only explicit Retry may contact Auth. Product authorization is suspended.") {
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, message, { actions: ["retry"], revocationPending: true });
    return this.#state;
  }
  async #recover(operation) {
    if (this.#recoveryPromise !== null) return this.#recoveryPromise;
    const pending = operation();
    this.#recoveryPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.#recoveryPromise === pending) this.#recoveryPromise = null;
    }
  }
  #offline(message = "Network unavailable; cached Product Session is not treated as authoritative") {
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.NETWORK_UNAVAILABLE, message, { actions: this.#revocationRequested ? ["retry"] : ["retry", "guest"], ...this.#revocationRequested ? { revocationPending: true } : {} });
    return this.#state;
  }
  #networkTransition(message) {
    if (!this.#networkAvailable) return this.#offline(message);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE2.RETRY_REQUIRED, message, { actions: ["retry", "guest"] });
    return this.#state;
  }
};
function state(status, message, extra = {}) {
  return Object.freeze({ status, message, ...extra, ...extra.actions ? { actions: Object.freeze(extra.actions) } : {}, ...extra.limitations ? { limitations: Object.freeze(extra.limitations) } : {} });
}
function secureStorage(value, platform, device2) {
  const nativeProtected = value && ["hardware-backed", "os-protected"].includes(value.securityLevel);
  const browserProtected = value?.securityLevel === "webcrypto-nonextractable" && platform === "web" && typeof device2?.sign === "function" && !("secret" in device2);
  if (!nativeProtected && !browserProtected || ["get", "set", "remove"].some((name) => typeof value[name] !== "function")) fail11("INSECURE_STORAGE", "Product Sessions require OS/hardware protection or a Web-only non-extractable device signer");
  return value;
}
function gateway(value) {
  if (!value || ["challenge", "complete", "introspect", "revoke", "walletInstalled", "schemeRegistered"].some((name) => typeof value[name] !== "function")) fail11("INVALID_GATEWAY", "Product Session client requires a real Gateway adapter");
  return value;
}
function device(value) {
  const fields2 = Object.keys(value ?? {}).sort().join("\n");
  const secretFields = ["id", "key", "secret", "scopes", "purpose"].sort().join("\n");
  const signerFields = ["id", "key", "sign", "scopes", "purpose"].sort().join("\n");
  if (fields2 !== secretFields && fields2 !== signerFields) fail11("UNKNOWN_OR_MISSING_FIELD", "Product Session device configuration fields do not match the protocol schema");
  if (typeof value.id !== "string" || typeof value.key !== "string" || !Array.isArray(value.scopes) || typeof value.purpose !== "string" || (fields2 === secretFields ? typeof value.secret !== "string" : typeof value.sign !== "function")) fail11("INVALID_DEVICE", "Product Session device configuration is invalid");
  return Object.freeze({ ...value, scopes: Object.freeze([...value.scopes]) });
}
function tokenFactory(value) {
  if (typeof value !== "function") fail11("INVALID_RANDOM_SOURCE", "Product Session client requires a cryptographic token factory");
  return () => {
    const token2 = value();
    if (typeof token2 !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(token2)) fail11("INVALID_RANDOM_SOURCE", "Product Session token factory returned an invalid token");
    return token2;
  };
}
function clock(value) {
  if (typeof value !== "function") fail11("INVALID_TIME", "Product Session client requires a clock");
  return () => {
    const result = value();
    if (!(result instanceof Date) || !Number.isFinite(result.getTime())) fail11("INVALID_TIME", "Product Session clock returned invalid time");
    return result;
  };
}
function isNetworkUnavailable(error) {
  return error instanceof WalletAuthError2 && ["NETWORK_UNAVAILABLE", "CLOCK_UNAVAILABLE"].includes(error.code);
}
function gatewayRequestId(kind, token2) {
  return `req_ps_${kind}_${token2}`;
}
function fail11(code, message) {
  throw new WalletAuthError2(code, message);
}
function assertActionUnicode(value) {
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 55296 && code <= 56319) {
        const next = value.charCodeAt(++i);
        if (!(next >= 56320 && next <= 57343)) fail11("INVALID_FIELD", "Social action body contains an unpaired Unicode surrogate");
      } else if (code >= 56320 && code <= 57343) fail11("INVALID_FIELD", "Social action body contains an unpaired Unicode surrogate");
    }
  } else if (Array.isArray(value)) {
    for (const child of value) assertActionUnicode(child);
  } else if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      assertActionUnicode(key);
      assertActionUnicode(value[key]);
    }
  }
}

// vendor/wallet-auth-c5/src/metamask-evm-adapter.js
var METAMASK_EVM_CONNECTION_STATUS2 = Object.freeze({
  CONNECTED: "connected-evm"
});
var METAMASK_EVM_CHAIN_ID = 6423;
var METAMASK_EVM_CHAIN_QUANTITY2 = "0x1917";
var METAMASK_EVM_CHAIN2 = Object.freeze({
  chainId: METAMASK_EVM_CHAIN_QUANTITY2,
  chainName: "YNX Testnet",
  nativeCurrency: Object.freeze({ name: "YNX Testnet", symbol: "YNXT", decimals: 18 }),
  rpcUrls: Object.freeze(["https://rpc-testnet.ynxweb4.com", "https://evm.ynxweb4.com"]),
  blockExplorerUrls: Object.freeze(["https://explorer.ynxweb4.com"])
});
var LIMITATIONS2 = Object.freeze([
  "evm-provider-only",
  "no-ynx-product-session",
  "no-wallet-ai-gateway-session",
  "no-native-ynx-account-authority"
]);
var MetaMaskEvmConnectionAdapter2 = class {
  #productId;
  #provider;
  constructor(config) {
    exactFields2(config, ["registry", "productId", "provider"], "MetaMask EVM adapter configuration");
    const registry = parseProductSessionRegistry2(config.registry);
    const product = registry.products.find((item) => item.productId === config.productId);
    if (!product) fail12("UNKNOWN_PRODUCT", "Product is not registered for Wallet connection");
    if (!product.evmCompatible) fail12("EVM_NOT_SUPPORTED", "Product is not registered for an EVM Wallet connection");
    if (typeof config.productId !== "string") fail12("INVALID_METAMASK_CONFIG", "MetaMask productId is invalid");
    this.#productId = product.productId;
    this.#provider = config.provider;
  }
  async connect() {
    const provider = this.#provider;
    if (provider === null || provider === void 0) fail12("METAMASK_NOT_INSTALLED", "MetaMask EIP-1193 provider was not detected");
    if (!isExplicitMetaMaskProvider(provider)) {
      fail12("INVALID_METAMASK_PROVIDER", "Detected provider is not an explicit MetaMask EIP-1193 provider");
    }
    let chainId = parseChainQuantity(await providerRequest(provider, "eth_chainId"));
    if (chainId !== METAMASK_EVM_CHAIN_ID) {
      try {
        await providerRequest(provider, "wallet_switchEthereumChain", [{ chainId: METAMASK_EVM_CHAIN_QUANTITY2 }], true);
      } catch (error) {
        if (!(error instanceof WalletAuthError2) || error.code !== "CHAIN_NOT_AVAILABLE") throw error;
        try {
          await providerRequest(provider, "wallet_addEthereumChain", [METAMASK_EVM_CHAIN2]);
        } catch (addError) {
          if (addError instanceof WalletAuthError2 && addError.code === "USER_REJECTED") throw addError;
          fail12("CHAIN_NOT_AVAILABLE", "YNX EVM chain 6423 could not be added to MetaMask");
        }
        await providerRequest(provider, "wallet_switchEthereumChain", [{ chainId: METAMASK_EVM_CHAIN_QUANTITY2 }], true);
      }
      chainId = parseChainQuantity(await providerRequest(provider, "eth_chainId"));
    }
    if (chainId !== METAMASK_EVM_CHAIN_ID) fail12("WRONG_NETWORK", "MetaMask did not switch to YNX EVM chain 6423");
    const address = firstAccount(await providerRequest(provider, "eth_requestAccounts"));
    chainId = parseChainQuantity(await providerRequest(provider, "eth_chainId"));
    if (chainId !== METAMASK_EVM_CHAIN_ID) fail12("WRONG_NETWORK", "MetaMask changed networks during account approval");
    return Object.freeze({
      status: METAMASK_EVM_CONNECTION_STATUS2.CONNECTED,
      wallet: "metamask",
      connectionMode: "evm-only",
      authority: "eip-1193-provider-only",
      productId: this.#productId,
      chainId: METAMASK_EVM_CHAIN_ID,
      chainQuantity: METAMASK_EVM_CHAIN_QUANTITY2,
      address,
      ynxProductSession: false,
      productSession: null,
      limitations: LIMITATIONS2
    });
  }
};
async function providerRequest(provider, method2, params, switching = false) {
  try {
    return await provider.request(params === void 0 ? { method: method2 } : { method: method2, params });
  } catch (error) {
    if (error instanceof WalletAuthError2) throw error;
    const code = providerErrorCode(error);
    if (code === 4001 || code === "4001") fail12("USER_REJECTED", "MetaMask connection was rejected by the user");
    if (switching && (code === 4902 || code === "4902")) fail12("CHAIN_NOT_AVAILABLE", "YNX EVM chain 6423 is not configured in MetaMask");
    if (code === 4900 || code === "4900" || code === 4901 || code === "4901") fail12("WALLET_UNAVAILABLE", "MetaMask is disconnected from the requested chain");
    fail12("WALLET_UNAVAILABLE", "MetaMask EIP-1193 request failed closed");
  }
}
function isExplicitMetaMaskProvider(provider) {
  if (typeof provider !== "object" || provider === null) return false;
  try {
    const rdns = provider.providerInfo?.rdns ?? provider.rdns;
    return typeof provider.request === "function" && provider.isMetaMask === true && provider.isYNXWallet !== true && provider.isYnxWallet !== true && (rdns === void 0 || rdns === "io.metamask" || rdns === "io.metamask.flask");
  } catch {
    return false;
  }
}
function providerErrorCode(error) {
  if (typeof error !== "object" || error === null) return void 0;
  try {
    return error.code;
  } catch {
    return void 0;
  }
}
function parseChainQuantity(value) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    fail12("INVALID_WALLET_RESPONSE", "MetaMask returned a non-canonical chain quantity");
  }
  const chainId = Number(BigInt(value));
  if (!Number.isSafeInteger(chainId)) fail12("INVALID_WALLET_RESPONSE", "MetaMask returned an unsupported chain quantity");
  return chainId;
}
function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail12("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid EVM account address");
  }
  return value.toLowerCase();
}
function firstAccount(value) {
  try {
    if (!Array.isArray(value) || value.length < 1 || value.length > 1024) fail12("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid account list");
    return normalizeAddress(value[0]);
  } catch (error) {
    if (error instanceof WalletAuthError2) throw error;
    fail12("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid account list");
  }
}
function fail12(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/wallet-provider-discovery.js
var WALLET_PROVIDER_DISCOVERY_AUTHORITY = "unverified-injected-candidate";
var WALLET_PROVIDER_KIND2 = Object.freeze({ YNX: "ynx-wallet", METAMASK: "metamask" });
var YNX_RDNS = /* @__PURE__ */ new Set(["com.ynx.wallet", "com.ynx.wallet.companion"]);
var METAMASK_RDNS = /* @__PURE__ */ new Set(["io.metamask", "io.metamask.flask"]);
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var discoveryStates = /* @__PURE__ */ new WeakMap();
function discoverInjectedWalletProviders(scope2 = globalThis) {
  const ethereum = safely(() => scope2?.ethereum);
  const declaredProviders = safely(() => ethereum?.providers);
  const raw = Array.isArray(declaredProviders) ? declaredProviders : ethereum === void 0 ? [] : [ethereum];
  return selectWalletProviderCandidates(raw.map((provider) => candidate(provider, safely(() => provider?.providerInfo), "legacy-injected")).filter(Boolean));
}
async function discoverEip6963WalletProviders(scope2 = globalThis, waitMs = 160) {
  validWait(waitMs);
  const add = safely(() => scope2?.addEventListener), dispatch = safely(() => scope2?.dispatchEvent);
  if (typeof add !== "function" || typeof dispatch !== "function") return selectWalletProviderCandidates([]);
  let state2 = discoveryStates.get(scope2);
  try {
    if (!state2) {
      state2 = { byUuid: /* @__PURE__ */ new Map(), conflicted: /* @__PURE__ */ new Set(), announcedProviders: /* @__PURE__ */ new WeakSet() };
      const { byUuid, conflicted, announcedProviders } = state2;
      const listener = (event) => {
        const detail = safely(() => event?.detail), info = safely(() => detail?.info), provider = safely(() => detail?.provider);
        if (validProvider(provider)) announcedProviders.add(provider);
        const item = candidate(provider, info, "eip6963");
        const uuid = canonicalUuid(safely(() => info?.uuid));
        if (!item || uuid === null || conflicted.has(uuid)) return;
        const previous = byUuid.get(uuid);
        if (previous && previous.provider !== provider) {
          byUuid.delete(uuid);
          conflicted.add(uuid);
          return;
        }
        byUuid.set(uuid, item);
      };
      add.call(scope2, "eip6963:announceProvider", listener);
      discoveryStates.set(scope2, state2);
    }
    const EventConstructor = safely(() => scope2?.Event) ?? globalThis.Event;
    if (typeof EventConstructor !== "function") return selectWalletProviderCandidates([]);
    dispatch.call(scope2, new EventConstructor("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  } catch {
    return selectWalletProviderCandidates([]);
  }
  return selectWalletProviderCandidates([...state2.byUuid.values()], state2.conflicted.size);
}
async function discoverWalletProviders2(scope2 = globalThis, waitMs = 160) {
  const announced = await discoverEip6963WalletProviders(scope2, waitMs);
  const injected = discoverInjectedWalletProviders(scope2);
  const announcedProviders = discoveryStates.get(scope2)?.announcedProviders;
  return selectWalletProviderCandidates(uniqueProviders([
    announced.ynx,
    announced.metamask,
    ...announced.candidates,
    ...injected.candidates.filter((item) => !announcedProviders?.has(item.provider))
  ].filter(Boolean)), announced.conflictedAnnouncements + injected.conflictedAnnouncements);
}
function selectWalletProviderCandidates(input, conflictedAnnouncements = 0) {
  if (!Array.isArray(input) || !Number.isSafeInteger(conflictedAnnouncements) || conflictedAnnouncements < 0) throw new TypeError("Wallet provider candidates are invalid");
  const candidates = uniqueProviders(input.filter(validCandidate));
  const ynxCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND2.YNX);
  const metaMaskCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND2.METAMASK);
  const ambiguities = [];
  if (ynxCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND2.YNX);
  if (metaMaskCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND2.METAMASK);
  return Object.freeze({
    ynx: ynxCandidates.length === 1 ? ynxCandidates[0] : null,
    metamask: metaMaskCandidates.length === 1 ? metaMaskCandidates[0] : null,
    candidates: Object.freeze(candidates),
    ambiguities: Object.freeze(ambiguities),
    conflictedAnnouncements,
    authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY
  });
}
function walletAvailabilityFromDiscovery2(discovery) {
  if (!validDiscovery(discovery)) throw new TypeError("Wallet provider discovery result is invalid");
  return Object.freeze({ ynxWalletInstalled: discovery.ynx !== null, metaMaskAvailable: discovery.metamask !== null });
}
function candidate(provider, info, source) {
  if (!validProvider(provider) || source !== "eip6963" && source !== "legacy-injected") return null;
  const providerInfo = object(info) ? info : null;
  const announcedRdns = canonicalRdns(safely(() => providerInfo?.rdns));
  const embeddedRdnsValue = safely(() => provider?.providerInfo?.rdns) ?? safely(() => provider?.rdns);
  const embeddedRdns = canonicalRdns(embeddedRdnsValue);
  if (embeddedRdnsValue !== void 0 && embeddedRdnsValue !== null && embeddedRdns === null) return null;
  if (source === "eip6963" && announcedRdns !== null && embeddedRdns !== null && announcedRdns !== embeddedRdns) return null;
  const rdns = source === "eip6963" ? announcedRdns : embeddedRdns;
  const ynxFlag = safely(() => provider?.isYNXWallet) === true || safely(() => provider?.isYnxWallet) === true;
  const metaMaskFlag = safely(() => provider?.isMetaMask) === true;
  if (rdns !== null && YNX_RDNS.has(rdns) && !ynxFlag || rdns !== null && METAMASK_RDNS.has(rdns) && ynxFlag) return null;
  const ynx = rdns !== null && YNX_RDNS.has(rdns) && ynxFlag;
  const metamask = !ynx && !ynxFlag && (rdns !== null && METAMASK_RDNS.has(rdns) || source === "legacy-injected" && rdns === null && metaMaskFlag);
  if (!ynx && !metamask) return null;
  if (ynxFlag && metaMaskFlag) return null;
  const uuid = source === "eip6963" ? canonicalUuid(safely(() => providerInfo?.uuid)) : null;
  if (source === "eip6963" && uuid === null) return null;
  return Object.freeze({
    kind: ynx ? WALLET_PROVIDER_KIND2.YNX : WALLET_PROVIDER_KIND2.METAMASK,
    provider,
    source,
    uuid,
    rdns,
    name: canonicalName(safely(() => providerInfo?.name)),
    authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY
  });
}
function uniqueProviders(input) {
  const seen = /* @__PURE__ */ new Set(), output = [];
  for (const item of input) if (validCandidate(item) && !seen.has(item.provider)) {
    seen.add(item.provider);
    output.push(item);
  }
  return output;
}
function validCandidate(value) {
  return object(value) && validProvider(safely(() => value.provider)) && Object.values(WALLET_PROVIDER_KIND2).includes(safely(() => value.kind)) && safely(() => value.authority) === WALLET_PROVIDER_DISCOVERY_AUTHORITY;
}
function validDiscovery(value) {
  const ynx = safely(() => value?.ynx), metamask = safely(() => value?.metamask), ambiguities = safely(() => value?.ambiguities), authority = safely(() => value?.authority), conflicts = safely(() => value?.conflictedAnnouncements);
  return object(value) && (ynx === null || validCandidate(ynx) && ynx.kind === WALLET_PROVIDER_KIND2.YNX) && (metamask === null || validCandidate(metamask) && metamask.kind === WALLET_PROVIDER_KIND2.METAMASK) && Array.isArray(ambiguities) && new Set(ambiguities).size === ambiguities.length && ambiguities.every((item) => Object.values(WALLET_PROVIDER_KIND2).includes(item)) && Number.isSafeInteger(conflicts) && conflicts >= 0 && authority === WALLET_PROVIDER_DISCOVERY_AUTHORITY;
}
function validProvider(value) {
  return object(value) && typeof safely(() => value.request) === "function";
}
function canonicalUuid(value) {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
function canonicalRdns(value) {
  return typeof value === "string" && value === value.toLowerCase() && /^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/.test(value) && value.length <= 253 ? value : null;
}
function canonicalName(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 64 && value.trim() === value ? value : null;
}
function validWait(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2e3) throw new TypeError("Wallet provider discovery wait must be between 0 and 2000 milliseconds");
}
function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safely(read) {
  try {
    return read();
  } catch {
    return void 0;
  }
}

// vendor/wallet-auth-c5/src/wallet-connection-coordinator.js
var WALLET_CONNECTION_COORDINATOR_STATUS2 = Object.freeze({
  OPTIONS_READY: "options-ready",
  SESSION_STATE: "session-state",
  WALLET_OPENED: "wallet-opened",
  WALLET_OPEN_FAILED: "wallet-open-failed",
  YNX_WALLET_PREFERRED: "ynx-wallet-preferred",
  EVM_CONNECTED: "evm-connected",
  EVM_UNAVAILABLE: "evm-unavailable"
});
var WalletConnectionCoordinator2 = class {
  #registry;
  #productId;
  #client;
  #scope;
  #waitMs;
  #openWallet;
  #openTimeoutMs;
  #evmGeneration = 0;
  constructor(config) {
    exactFields2(config, ["registry", "productId", "sessionClient", "scope", "discoveryWaitMs", "openWallet", "openTimeoutMs"], "Wallet connection coordinator configuration");
    this.#registry = parseProductSessionRegistry2(config.registry);
    if (typeof config.productId !== "string" || !this.#registry.products.some((item) => item.productId === config.productId)) fail13("UNKNOWN_PRODUCT", "Wallet connection product is not registered");
    if (!(config.sessionClient instanceof RecoverableProductSessionClient2) || config.sessionClient.connectionBinding.productId !== config.productId) fail13("CROSS_PRODUCT_REUSE", "Wallet connection coordinator requires the exact product session client");
    if (typeof config.scope !== "object" && typeof config.scope !== "function" || config.scope === null) fail13("INVALID_WALLET_SCOPE", "Wallet provider discovery scope is invalid");
    if (!Number.isSafeInteger(config.discoveryWaitMs) || config.discoveryWaitMs < 0 || config.discoveryWaitMs > 2e3) fail13("INVALID_WALLET_SCOPE", "Wallet provider discovery wait is invalid");
    if (typeof config.openWallet !== "function") fail13("INVALID_WALLET_OPENER", "Wallet connection coordinator requires a platform opener");
    if (!Number.isSafeInteger(config.openTimeoutMs) || config.openTimeoutMs < 10 || config.openTimeoutMs > 3e4) fail13("INVALID_WALLET_OPENER", "Wallet opener timeout is invalid");
    this.#productId = config.productId;
    this.#client = config.sessionClient;
    this.#scope = config.scope;
    this.#waitMs = config.discoveryWaitMs;
    this.#openWallet = config.openWallet;
    this.#openTimeoutMs = config.openTimeoutMs;
  }
  get current() {
    return this.#client.current;
  }
  get storageKey() {
    return this.#client.storageKey;
  }
  get connectionBinding() {
    return this.#client.connectionBinding;
  }
  async options() {
    const [discovery, environment] = await Promise.all([discoverWalletProviders2(this.#scope, this.#waitMs), this.#client.detectWalletEnvironment()]);
    const injected = walletAvailabilityFromDiscovery2(discovery);
    const availability = Object.freeze({ ynxWalletInstalled: environment.walletInstalled || injected.ynxWalletInstalled, metaMaskAvailable: injected.metaMaskAvailable });
    const choices = this.#client.connectionChoices(availability);
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.OPTIONS_READY, discovery, environment, availability, choices });
  }
  async restore(networkAvailable = true) {
    const sessionState = await this.#client.restore(networkAvailable);
    if (sessionState.automatic !== true) return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.SESSION_STATE, sessionState });
    return this.#openIfConnecting(sessionState);
  }
  async beginYNX() {
    this.#evmGeneration += 1;
    return this.#openIfConnecting(await this.#client.beginDetected(false));
  }
  async retryYNX() {
    this.#evmGeneration += 1;
    return this.#openIfConnecting(await this.#client.retryDetected());
  }
  async handleReturn(url2) {
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.SESSION_STATE, sessionState: await this.#client.handleReturn(url2) });
  }
  setNetworkAvailable(available) {
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.SESSION_STATE, sessionState: this.#client.setNetworkAvailable(available) });
  }
  enterGuest() {
    this.#evmGeneration += 1;
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.SESSION_STATE, sessionState: this.#client.enterGuest() });
  }
  async disconnect() {
    this.#evmGeneration += 1;
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.SESSION_STATE, sessionState: await this.#client.disconnect() });
  }
  // Passive protected receipt readback: preserve the original client validation
  // and exact consumer-journal acknowledgement; no disconnect or new authority.
  async getRevocationCompletions() {
    return this.#client.getRevocationCompletions();
  }
  async getRevocationCompletion(intentId) {
    return this.#client.getRevocationCompletion(intentId);
  }
  async acknowledgeRevocationCompletion(receipt) {
    return this.#client.acknowledgeRevocationCompletion(receipt);
  }
  async connectMetaMask() {
    const generation = ++this.#evmGeneration;
    const discovery = await discoverWalletProviders2(this.#scope, this.#waitMs);
    const environment = null;
    const choices = this.#client.connectionChoices(walletAvailabilityFromDiscovery2(discovery));
    if (generation !== this.#evmGeneration) return cancelledEvmConnection();
    if (discovery.metamask === null) {
      const ambiguous = discovery.ambiguities.includes("metamask"), download = choices.find((item) => item.id === "metamask" && item.action === "download-evm-wallet");
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.EVM_UNAVAILABLE, code: ambiguous ? "AMBIGUOUS_WALLET_PROVIDER" : "METAMASK_NOT_INSTALLED", message: ambiguous ? "Multiple MetaMask providers require an explicit platform chooser" : "MetaMask is not installed", actions: ambiguous ? ["retry", "guest", "return-to-product"] : ["download-metamask", "guest", "return-to-product"], ...download ? { downloadUrl: download.url } : {}, discovery, environment, choices });
    }
    try {
      const connection = await new MetaMaskEvmConnectionAdapter2({ registry: this.#registry, productId: this.#productId, provider: discovery.metamask.provider }).connect();
      if (generation !== this.#evmGeneration) return cancelledEvmConnection();
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.EVM_CONNECTED, connection, discovery, environment, choices });
    } catch (error) {
      if (generation !== this.#evmGeneration) return cancelledEvmConnection();
      const code = error instanceof WalletAuthError2 ? error.code : "WALLET_UNAVAILABLE";
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.EVM_UNAVAILABLE, code, message: coordinatorErrorMessage(code), actions: coordinatorActions(code), discovery, environment, choices });
    }
  }
  async #openIfConnecting(sessionState) {
    if (sessionState.status !== PRODUCT_SESSION_CLIENT_STATE2.CONNECTING) return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.SESSION_STATE, sessionState });
    const route = sessionState.route, requestId = `req_ps_open_${sessionState.request.nonce}`;
    try {
      const result = await withTimeout(this.#openWallet(Object.freeze({ url: route.url, request: sessionState.request, requestId, automatic: sessionState.automatic === true, productId: this.#productId, platform: this.#client.connectionBinding.platform })), this.#openTimeoutMs);
      exactFields2(result, result?.opened === true ? ["opened"] : ["opened", "code"], "Wallet opener result");
      if (result.opened !== true) fail13(openerCode(result.code), "Platform did not open the registered Wallet route");
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.WALLET_OPENED, requestId, url: route.url, automatic: sessionState.automatic === true, sessionState });
    } catch (error) {
      const code = error instanceof WalletAuthError2 ? error.code : "WALLET_OPEN_FAILED";
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.WALLET_OPEN_FAILED, requestId, code, message: coordinatorErrorMessage(code), actions: coordinatorActions(code), sessionState });
    }
  }
};
function cancelledEvmConnection() {
  return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS2.EVM_UNAVAILABLE, code: "WALLET_CONNECTION_CANCELLED", message: "Wallet connection was cancelled", actions: ["retry", "return-to-product"] });
}
function openerCode(value) {
  return ["WALLET_NOT_INSTALLED", "SCHEME_NOT_REGISTERED", "NETWORK_UNAVAILABLE", "USER_REJECTED"].includes(value) ? value : "WALLET_OPEN_FAILED";
}
function coordinatorActions(code) {
  if (code === "WALLET_NOT_INSTALLED" || code === "METAMASK_NOT_INSTALLED") return ["download", "guest", "return-to-product"];
  if (code === "SCHEME_NOT_REGISTERED") return ["download", "retry", "return-to-product"];
  if (code === "USER_REJECTED") return ["guest", "retry", "return-to-product"];
  return ["retry", "return-to-product"];
}
function coordinatorErrorMessage(code) {
  return { WALLET_NOT_INSTALLED: "Wallet is not installed", SCHEME_NOT_REGISTERED: "Wallet scheme is not registered", NETWORK_UNAVAILABLE: "Network is unavailable", USER_REJECTED: "Wallet connection was rejected; no session was created", WALLET_OPEN_TIMEOUT: "Wallet did not answer before the platform timeout", METAMASK_NOT_INSTALLED: "MetaMask is not installed", AMBIGUOUS_WALLET_PROVIDER: "Wallet provider selection is ambiguous", EVM_NOT_SUPPORTED: "This product is not registered for an EVM Wallet connection", WRONG_NETWORK: "Wallet did not switch to YNX EVM chain 6423", WALLET_UNAVAILABLE: "Wallet provider is unavailable" }[code] ?? "Wallet route could not be opened";
}
async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new WalletAuthError2("WALLET_OPEN_TIMEOUT", "Wallet opener timed out")), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
function frozen(input) {
  const output = { ...input };
  if (Array.isArray(output.actions)) output.actions = Object.freeze([...output.actions]);
  return Object.freeze(output);
}
function fail13(code, message) {
  throw new WalletAuthError2(code, message);
}

// vendor/wallet-auth-c5/src/product-wallet-connection.js
var CONFIG_FIELDS = [
  "registry",
  "productId",
  "platform",
  "walletInstalled",
  "schemeRegistered",
  "gatewayTimeoutMs",
  "storage",
  "device",
  "scope",
  "discoveryWaitMs",
  "openWallet",
  "openTimeoutMs"
];
var PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN = "https://wallet-auth.ynxweb4.com";
function createProductWalletConnection(config) {
  exactFields2(config, CONFIG_FIELDS, "Product Wallet connection configuration");
  assertProductRuntime();
  exactFields2(config.device, ["id", "key", "sign", "scopes", "purpose"], "Product Wallet secure device signer");
  if (typeof config.device.sign !== "function") throw new WalletAuthError2("INVALID_DEVICE", "Product Wallet connection requires a platform secure device signer");
  const gateway2 = new ProductSessionGatewayFetchAdapter2({
    endpoint: PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN,
    fetch: globalThis.fetch.bind(globalThis),
    walletInstalled: config.walletInstalled,
    schemeRegistered: config.schemeRegistered,
    timeoutMs: config.gatewayTimeoutMs
  });
  if (typeof gateway2.currentTime !== "function") throw new WalletAuthError2("CLOCK_UNAVAILABLE", "Product Wallet connection requires the authority-time adapter");
  const sessionClient = new RecoverableProductSessionClient2({
    registry: config.registry,
    productId: config.productId,
    platform: config.platform,
    storage: config.storage,
    gateway: gateway2,
    device: config.device,
    tokenFactory: secureToken,
    clock: authorityClockRequired
  });
  return new WalletConnectionCoordinator2({
    registry: config.registry,
    productId: config.productId,
    sessionClient,
    scope: config.scope,
    discoveryWaitMs: config.discoveryWaitMs,
    openWallet: config.openWallet,
    openTimeoutMs: config.openTimeoutMs
  });
}
function secureToken() {
  assertProductRuntime();
  return encodeBase64url2(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}
function authorityClockRequired() {
  throw new WalletAuthError2("CLOCK_UNAVAILABLE", "Product Wallet connection requires verified Gateway authority time");
}
function assertProductRuntime() {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") throw new WalletAuthError2("INVALID_RANDOM_SOURCE", "Product Wallet connection requires a cryptographic runtime");
  if (typeof globalThis.fetch !== "function") throw new WalletAuthError2("INVALID_GATEWAY", "Product Wallet connection requires the platform HTTPS transport");
}

// vendor/wallet-auth-c5/product-session-registry.json
var product_session_registry_default = {
  schemaVersion: 2,
  chainId: "ynx_6423-1",
  wallet: {
    authorizeCallback: "ynxwallet://authorize",
    downloadUrl: "https://www.ynxweb4.com/dapp/download",
    metaMaskDownloadUrl: "https://metamask.io/download"
  },
  products: [
    {
      productId: "ai",
      clientId: "ynx-ai-v1",
      displayName: "YNX AI",
      applicationId: "com.ynxweb4.ai",
      webOrigin: "https://assistant.ynxweb4.com",
      nativeCallback: "ynxai://wallet-auth/callback",
      legacyCallbacks: [
        "ynxai://wallet-auth/callback"
      ],
      scopes: [
        "ai:actions",
        "ai:attachments",
        "ai:conversations",
        "ai:data-control",
        "ai:generate",
        "ai:permissions"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "calendar",
      clientId: "ynx-calendar-v1",
      displayName: "YNX Calendar",
      applicationId: "com.ynxweb4.calendar",
      webOrigin: "https://calendar.ynxweb4.com",
      nativeCallback: "ynxcalendar://wallet-auth/callback",
      legacyCallbacks: [
        "ynxcalendar",
        "ynxcalendar://wallet-auth/callback"
      ],
      scopes: [
        "calendar:account",
        "calendar:recover"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "card",
      clientId: "ynx-card-v1",
      displayName: "YNX Card",
      applicationId: "com.ynxweb4.card",
      webOrigin: "https://card.ynxweb4.com",
      nativeCallback: "ynxcard://wallet-auth/callback",
      legacyCallbacks: [
        "ynxcard",
        "ynxcard://wallet-auth/callback"
      ],
      scopes: [
        "account:read",
        "card:application:write",
        "card:controls:write",
        "card:dispute:write",
        "card:simulation:write",
        "card:topup:write"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "cloud",
      clientId: "ynx-cloud-web-v1",
      displayName: "YNX Cloud",
      applicationId: "com.ynxweb4.cloud",
      webOrigin: "https://web4.ynxweb4.com",
      platforms: [
        "web"
      ],
      nativeCallback: null,
      legacyCallbacks: [],
      scopes: [
        "files.read",
        "files.write"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 300
    },
    {
      productId: "creator-studio",
      clientId: "ynx-creator-studio-web-v1",
      displayName: "YNX Creator Studio",
      applicationId: "com.ynxweb4.creator-studio",
      webOrigin: "https://creator.ynxweb4.com",
      nativeCallback: "ynxcreator://wallet-auth/callback",
      legacyCallbacks: [
        "ynxcreator",
        "ynxcreator://wallet-auth/callback"
      ],
      scopes: [
        "creator:account",
        "creator:publish",
        "creator:revenue"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "developer",
      clientId: "ynx-developer-v1",
      displayName: "YNX Developer",
      applicationId: "com.ynxweb4.developer.testnetpreview",
      webOrigin: "https://developer.ynxweb4.com",
      nativeCallback: "ynxdeveloper://wallet-auth/callback",
      legacyCallbacks: [
        "ynxdeveloper",
        "ynxdeveloper://wallet-auth/callback"
      ],
      scopes: [
        "account:read",
        "developer:deploy"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "dex",
      clientId: "ynx-dex-v1",
      displayName: "YNX DEX",
      applicationId: "com.ynxweb4.dex",
      webOrigin: "https://dex.ynxweb4.com",
      nativeCallback: "ynxdex://wallet-auth/callback",
      legacyCallbacks: [
        "ynxdex",
        "ynxdex://wallet-auth/callback"
      ],
      scopes: [
        "dex:account",
        "dex:orders",
        "dex:trade"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "docs",
      clientId: "ynx-docs-mobile-v1",
      displayName: "YNX Docs",
      applicationId: "com.ynxweb4.docs",
      webOrigin: "https://docs.ynxweb4.com",
      nativeCallback: "ynxdocs://wallet-auth/callback",
      legacyCallbacks: [
        "ynxdocs://wallet-auth/callback"
      ],
      scopes: [
        "docs.read",
        "docs.write",
        "files.read",
        "files.write"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 300
    },
    {
      productId: "exchange",
      clientId: "ynx-exchange-v1",
      displayName: "YNX Exchange",
      applicationId: "com.ynxweb4.exchange",
      webOrigin: "https://exchange.ynxweb4.com",
      nativeCallback: "ynxexchange://wallet-auth/callback",
      legacyCallbacks: [
        "ynxexchange",
        "ynxexchange://wallet-auth/callback"
      ],
      scopes: [
        "exchange:ai",
        "exchange:deposit",
        "exchange:read",
        "exchange:trade",
        "exchange:withdrawal-review"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "finance",
      clientId: "ynx-finance-v1",
      displayName: "YNX Finance",
      applicationId: "com.ynxweb4.finance",
      webOrigin: "https://finance.ynxweb4.com",
      nativeCallback: "ynxfinance://wallet-auth/callback",
      legacyCallbacks: [
        "ynxfinance",
        "ynxfinance://wallet-auth/callback"
      ],
      scopes: [
        "finance.ai.draft",
        "finance.pay.read",
        "finance.portfolio.read",
        "finance.profile.write"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 240
    },
    {
      productId: "mail",
      clientId: "ynx-mail-v1",
      displayName: "YNX Mail",
      applicationId: "com.ynxweb4.mail",
      webOrigin: "https://mail.ynxweb4.com",
      nativeCallback: "ynxmail://wallet-auth/callback",
      legacyCallbacks: [
        "ynxmail://wallet-auth/callback"
      ],
      scopes: [
        "mail:account",
        "mail:recover"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "music",
      clientId: "ynx-music-v1",
      displayName: "YNX Music",
      applicationId: "com.ynxweb4.music",
      webOrigin: "https://music.ynxweb4.com",
      platforms: [
        "android",
        "ios",
        "macos",
        "web"
      ],
      nativeCallback: "ynxmusic://auth/callback",
      legacyCallbacks: [
        "ynxmusic://auth/callback"
      ],
      scopes: [
        "music.creator",
        "music.library",
        "music.playback",
        "music.profile"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 300
    },
    {
      productId: "pay",
      clientId: "ynx-pay-v1",
      displayName: "YNX Pay",
      applicationId: "com.ynxweb4.pay",
      webOrigin: "https://pay.ynxweb4.com",
      nativeCallback: "ynxpay://wallet-auth/callback",
      legacyCallbacks: [
        "ynxpay",
        "ynxpay://wallet-auth/callback"
      ],
      scopes: [
        "account:read",
        "pay:case:create",
        "pay:settlement:submit"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 180,
      platforms: [
        "android",
        "ios",
        "linux",
        "macos",
        "windows"
      ]
    },
    {
      productId: "pay-merchant",
      clientId: "ynx-merchant-console-v1",
      displayName: "YNX Merchant Console",
      applicationId: "com.ynxweb4.merchant-console",
      webOrigin: "https://pay.ynxweb4.com",
      webCallback: "https://pay.ynxweb4.com/merchant/wallet-auth/callback",
      platforms: [
        "web"
      ],
      nativeCallback: null,
      legacyCallbacks: [],
      scopes: [
        "account:read",
        "merchant:session:create"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 240
    },
    {
      productId: "quant",
      clientId: "ynx-quant-v1",
      displayName: "YNX Quant",
      applicationId: "com.ynxweb4.quant",
      webOrigin: "https://quant.ynxweb4.com",
      nativeCallback: "ynxquant://wallet-auth/callback",
      legacyCallbacks: [
        "ynxquant",
        "ynxquant://wallet-auth/callback"
      ],
      scopes: [
        "quant:account",
        "quant:mandate:create",
        "quant:mandate:execute",
        "quant:mandate:revoke",
        "quant:paper:workspace",
        "quant:records:read"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 180
    },
    {
      productId: "shop",
      clientId: "ynx-shop-v1",
      displayName: "YNX Shop",
      applicationId: "com.ynxweb4.shop",
      webOrigin: "https://shop.ynxweb4.com",
      nativeCallback: "ynxshop://wallet-auth/callback",
      legacyCallbacks: [
        "ynxshop",
        "ynxshop://wallet-auth/callback"
      ],
      scopes: [
        "account:read",
        "shop:orders:write",
        "shop:profile:write",
        "shop:seller:operate"
      ],
      evmCompatible: true,
      sessionDurationSeconds: 240
    },
    {
      productId: "social",
      clientId: "ynx-social-v1",
      displayName: "YNX Social",
      applicationId: "com.ynx.social",
      webOrigin: "https://social.ynxweb4.com",
      nativeCallback: "ynx-social://com.ynx.social",
      legacyCallbacks: [
        "ynx-social",
        "ynx-social://com.ynx.social"
      ],
      scopes: [
        "account:read",
        "profile:link",
        "social.ai",
        "social.contacts",
        "social.feed",
        "social.messaging",
        "social.profile"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 240
    },
    {
      productId: "video",
      clientId: "ynx-video-mobile-v1",
      displayName: "YNX Video",
      applicationId: "com.ynxweb4.video",
      webOrigin: "https://video.ynxweb4.com",
      nativeCallback: "ynxvideo://wallet-auth/callback",
      legacyCallbacks: [
        "ynxvideo",
        "ynxvideo://wallet-auth/callback"
      ],
      scopes: [
        "video:account",
        "video:library",
        "video:playback"
      ],
      evmCompatible: false,
      sessionDurationSeconds: 300
    }
  ]
};

// frontend/src/wallet/product-session-v2.ts
var ACCEPTED_PUBLIC_GATEWAY_ORIGIN = "https://wallet-auth.ynxweb4.com";
if (PRODUCT_SESSION_PUBLIC_GATEWAY_ORIGIN !== ACCEPTED_PUBLIC_GATEWAY_ORIGIN) throw new Error("The accepted Wallet Product Session v2 origin was not preserved.");
var DEVELOPER_WALLET_V2_SOURCE = Object.freeze({
  sourceCommit: "c5e4178bb548baa05f552e8e1bc0f566ddc6f72d",
  sourceTree: "01ec8a64f1472fefa99d9c20a733a23ac20d7b65",
  supplierManifest: "501c20f6c3a81617a1c3e69fa0ceb3749fb20072d2b8b0589948f2463b7f3aff",
  sourceClosure: "1a64e5483a4b9c895e19ff36aec17de3e8433cab455d19e13d0a349179c17f29",
  factorySource: "3d35e858f68d39a142e8a7798670b8d4a09e8f41f21476e3e692e3a06128f1f7",
  gatewayOrigin: ACCEPTED_PUBLIC_GATEWAY_ORIGIN,
  migrated: false
});
var explicitNativeOwner = null;
async function createDeveloperWalletV2Runtime() {
  const bridge = developerWalletV2Bridge();
  if (!bridge) return null;
  return createNativeRuntime(bridge);
}
async function beginDeveloperWalletV2Connection(journal) {
  const bridge = developerWalletV2Bridge();
  if (!bridge) throw new Error("A native OS-protected Developer Wallet device and storage bridge is required.");
  if (explicitNativeOwner !== null) throw new Error("Finish the current native Developer Wallet operation before starting another.");
  const owner = /* @__PURE__ */ Symbol("native-wallet-operation");
  explicitNativeOwner = owner;
  try {
    const grantedDevice = await bridge.beginConnection();
    const currentDevice = await developerWalletV2Device(bridge);
    if (currentDevice.key !== grantedDevice?.key) throw new Error("Native Developer Wallet device changed during connection approval.");
    return await createNativeRuntime(bridge, grantedDevice, owner, journal);
  } catch (error) {
    try {
      await bridge.endConnection();
    } catch {
    }
    if (explicitNativeOwner === owner) explicitNativeOwner = null;
    throw error;
  }
}
async function createNativeRuntime(bridge, grantedDevice, owner, journal) {
  const nativeDevice = await developerWalletV2Device(bridge, grantedDevice);
  const availability = await bridge.walletAvailability();
  if (!availability || typeof availability.walletInstalled !== "boolean" || typeof availability.schemeRegistered !== "boolean" || bridge !== developerWalletV2Bridge()) throw new Error("Native Developer Wallet availability or document binding is invalid.");
  let active = grantedDevice !== void 0;
  const assertActive = () => {
    if (!active || bridge !== developerWalletV2Bridge()) throw new Error("Explicit native Developer Wallet connection approval is required.");
  };
  if (!journal && bridge.protectedStorage?.consumerJournalPersist && bridge.protectedStorage.consumerJournalRead) {
    const storage = bridge.protectedStorage;
    journal = {
      persist: async (receipt) => {
        assertActive();
        const raw = canonicalJSON2(receipt);
        const saved = await storage.consumerJournalPersist(raw);
        if (saved !== raw) throw new Error("Native Developer journal commit did not return the exact receipt.");
      },
      read: async (intentId) => {
        if (bridge !== developerWalletV2Bridge()) throw new Error("Native Wallet document changed.");
        const raw = await storage.consumerJournalRead(intentId);
        if (raw === null) return null;
        if (typeof raw !== "string" || raw.length > 2048) throw new Error("Native Developer journal readback is invalid.");
        const receipt = JSON.parse(raw);
        if (canonicalJSON2(receipt) !== raw) throw new Error("Native Developer journal readback is not canonical.");
        return receipt;
      }
    };
  }
  let pendingOperation = false;
  let expirationTimer;
  const releaseNativeOperation = async () => {
    if (!active) return;
    active = false;
    clearTimeout(expirationTimer);
    try {
      await bridge.endConnection();
    } finally {
      if (explicitNativeOwner === owner) explicitNativeOwner = null;
    }
  };
  const endNativeOperation = async () => {
    if (active && pendingOperation) sdk.setNetworkAvailable(false);
    await releaseNativeOperation();
  };
  const sdk = createProductWalletConnection({
    registry: product_session_registry_default,
    productId: "developer",
    platform: "macos",
    walletInstalled: async () => availability.walletInstalled,
    schemeRegistered: async () => availability.schemeRegistered,
    gatewayTimeoutMs: 1e4,
    storage: {
      securityLevel: "os-protected",
      get: (key) => bridge.protectedStorage.get(key),
      set: async (key, value) => {
        assertActive();
        await bridge.protectedStorage.set(key, value);
      },
      remove: async (key) => {
        assertActive();
        await bridge.protectedStorage.remove(key);
      },
      saveRevocationIntent: async (key, rawIntent) => {
        assertActive();
        const method2 = bridge.protectedStorage.saveRevocationIntent;
        if (!method2) throw new Error("Native Wallet atomic completion support requires an updated app.");
        return method2(key, rawIntent);
      },
      finishRevocationIntentWithCompletion: async (key, expectedRawIntent, receiptRaw) => {
        assertActive();
        const method2 = bridge.protectedStorage.finishRevocationIntentWithCompletion;
        if (!method2) throw new Error("Native Wallet atomic completion support requires an updated app.");
        return method2(key, expectedRawIntent, receiptRaw);
      },
      getRevocationCompletions: async (key) => {
        const method2 = bridge.protectedStorage.getRevocationCompletions;
        if (!method2) throw new Error("Native Wallet atomic completion support requires an updated app.");
        return method2(key);
      },
      getRevocationCompletion: async (key, intentId) => {
        const method2 = bridge.protectedStorage.getRevocationCompletion;
        if (!method2) throw new Error("Native Wallet atomic completion support requires an updated app.");
        return method2(key, intentId);
      },
      acknowledgeRevocationCompletion: async (key, expectedReceiptRaw) => {
        assertActive();
        const method2 = bridge.protectedStorage.acknowledgeRevocationCompletion;
        if (!method2) throw new Error("Native Wallet atomic completion support requires an updated app.");
        await method2(key, expectedReceiptRaw);
      }
    },
    device: Object.freeze({ ...nativeDevice, sign: async (input) => {
      assertActive();
      return nativeDevice.sign(input);
    } }),
    scope: window,
    discoveryWaitMs: 250,
    openWallet: async ({ url: url2 }) => {
      try {
        assertActive();
        await bridge.openAuthorization(url2);
        return { opened: true };
      } catch {
        return { opened: false, code: "WALLET_OPEN_FAILED" };
      }
    },
    openTimeoutMs: 1e4
  });
  const operate = async (method2, args, alwaysEnd = false) => {
    assertActive();
    if (pendingOperation) throw new Error("Finish the pending Developer Wallet operation before starting another.");
    pendingOperation = true;
    try {
      const execute = sdk[method2];
      const result = await execute.apply(sdk, args);
      if (alwaysEnd || result?.status !== "wallet-opened") await releaseNativeOperation();
      return result;
    } catch (error) {
      try {
        await releaseNativeOperation();
      } catch {
      }
      throw error;
    } finally {
      pendingOperation = false;
    }
  };
  const connection = Object.freeze({
    get current() {
      return sdk.current;
    },
    get storageKey() {
      return sdk.storageKey;
    },
    get connectionBinding() {
      return sdk.connectionBinding;
    },
    options: () => sdk.options(),
    getRevocationCompletions: () => {
      if (bridge !== developerWalletV2Bridge()) throw new Error("Native Wallet document changed.");
      return sdk.getRevocationCompletions();
    },
    getRevocationCompletion: (intentId) => {
      if (bridge !== developerWalletV2Bridge()) throw new Error("Native Wallet document changed.");
      return sdk.getRevocationCompletion(intentId);
    },
    acknowledgeRevocationCompletion: async (receipt) => {
      assertActive();
      if (!journal) throw new Error("A durable Developer revocation journal is required before acknowledgement.");
      if (pendingOperation) throw new Error("Finish the pending Developer Wallet operation before acknowledgement.");
      pendingOperation = true;
      try {
        const raw = canonicalJSON2(receipt);
        const snapshot = Object.freeze(JSON.parse(raw));
        const original = await sdk.getRevocationCompletion(snapshot.intentId);
        if (!original || canonicalJSON2(original) !== raw) throw new Error("The exact pending revocation receipt is required.");
        assertActive();
        await journal.persist(snapshot);
        const saved = await journal.read(snapshot.intentId);
        if (!saved || canonicalJSON2(saved) !== raw) throw new Error("Developer revocation journal did not read back the exact durable receipt.");
        assertActive();
        await sdk.acknowledgeRevocationCompletion(snapshot);
      } finally {
        pendingOperation = false;
      }
    },
    enterGuest: async () => {
      if (pendingOperation) throw new Error("Finish the pending Developer Wallet operation before entering Guest.");
      const result = sdk.enterGuest();
      await releaseNativeOperation();
      return result;
    },
    setNetworkAvailable: (available) => sdk.setNetworkAvailable(available),
    beginYNX: () => operate("beginYNX", []),
    retryYNX: () => operate("retryYNX", []),
    restore: (networkAvailable = true) => operate("restore", [networkAvailable]),
    handleReturn: (url2) => operate("handleReturn", [url2], true),
    disconnect: () => operate("disconnect", [], true)
  });
  if (active) expirationTimer = setTimeout(() => {
    void endNativeOperation().catch(() => {
    });
  }, 3e5);
  return Object.freeze({ connection, source: DEVELOPER_WALLET_V2_SOURCE, endNativeOperation });
}
async function inspectDeveloperWalletV2Runtime() {
  try {
    const bridge = developerWalletV2Bridge();
    return Object.freeze({
      available: Boolean(bridge),
      bridgeContract: bridge ? "present" : "missing",
      deviceStatus: "not-observed",
      authoritative: false,
      requiresExplicitConnection: true,
      options: void 0,
      source: DEVELOPER_WALLET_V2_SOURCE,
      reason: bridge ? void 0 : "The native Wallet interface is unavailable in this document."
    });
  } catch {
    return Object.freeze({
      available: false,
      bridgeContract: "check-failed",
      deviceStatus: "not-observed",
      authoritative: false,
      requiresExplicitConnection: true,
      options: void 0,
      source: DEVELOPER_WALLET_V2_SOURCE,
      reason: "The native Wallet interface could not be inspected."
    });
  }
}
async function enterDeveloperWalletV2Guest() {
  const guest = walletConnectionChoices2(product_session_registry_default, "developer", { ynxWalletInstalled: false, metaMaskAvailable: false }).find((choice) => choice.id === "guest");
  if (!guest || guest.authoritative !== false || !Array.isArray(guest.limitations)) return unavailable(new Error("The accepted SDK did not provide a non-authoritative Guest choice."));
  const sessionState = Object.freeze({ status: PRODUCT_SESSION_CLIENT_STATE2.GUEST, message: guest.label, limitations: Object.freeze([...guest.limitations]) });
  return Object.freeze({ available: true, connectionMode: "local-guest", authoritative: false, sessionState, source: DEVELOPER_WALLET_V2_SOURCE });
}
function unavailable(error) {
  return Object.freeze({ available: false, reason: error instanceof Error ? error.message : "Native Developer Wallet is unavailable.", requiresExplicitConnection: true, source: DEVELOPER_WALLET_V2_SOURCE });
}
