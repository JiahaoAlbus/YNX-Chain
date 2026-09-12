// packages/wallet-auth/node_modules/@noble/hashes/utils.js
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
  let hex2 = "";
  for (let i = 0; i < bytes.length; i++) {
    hex2 += hexes[bytes[i]];
  }
  return hex2;
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
function hexToBytes(hex2) {
  if (typeof hex2 !== "string")
    throw new TypeError("hex string expected, got " + typeof hex2);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex2);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex2.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex2.charCodeAt(hi));
    const n2 = asciiToBase16(hex2.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex2[hi] + hex2[hi + 1];
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

// packages/wallet-auth/node_modules/@noble/hashes/_md.js
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
  update(data2) {
    aexists(this);
    abytes(data2);
    const { view, buffer, blockLen } = this;
    const len = data2.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data2);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer.set(data2.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data2.length;
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

// packages/wallet-auth/node_modules/@noble/hashes/_u64.js
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

// packages/wallet-auth/node_modules/@noble/hashes/sha2.js
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

// packages/wallet-auth/src/canonical.js
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactFields(value, expected, label) {
  if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", `${label} must be a JSON object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\n") !== wanted.join("\n")) throw new WalletAuthError("UNKNOWN_OR_MISSING_FIELD", `${label} fields do not match the protocol schema`);
}
function canonicalJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new WalletAuthError("INVALID_NUMBER", "Protocol numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (!isPlainObject(value)) throw new WalletAuthError("INVALID_SHAPE", "Protocol value is not canonical JSON");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}
function digestHex(domain, value) {
  return bytesToHex(sha256(utf8ToBytes(`${domain}
${canonicalJSON(value)}`)));
}
var WalletAuthError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
  }
};

// packages/wallet-auth/src/base64url.js
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeBase64url(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new WalletAuthError("INVALID_ENCODING", "Base64url input must be bytes");
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0, b = bytes[index + 1] ?? 0, c = bytes[index + 2] ?? 0;
    const value = a << 16 | b << 8 | c;
    output += ALPHABET[value >>> 18 & 63] + ALPHABET[value >>> 12 & 63] + (index + 1 < bytes.length ? ALPHABET[value >>> 6 & 63] : "=") + (index + 2 < bytes.length ? ALPHABET[value & 63] : "=");
  }
  return output.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function decodeBase64url(value, label = "base64url value") {
  if (typeof value !== "string" || !/[A-Za-z0-9_-]/.test(value) || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new WalletAuthError("INVALID_ENCODING", `${label} is invalid`);
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const output = [];
  for (let index = 0; index < padded.length; index += 4) {
    const chars = [padded[index], padded[index + 1], padded[index + 2], padded[index + 3]];
    const values = chars.map((character) => character === "=" ? 0 : ALPHABET.indexOf(character));
    if (values.some((item) => item < 0)) throw new WalletAuthError("INVALID_ENCODING", `${label} is invalid`);
    const combined = values[0] << 18 | values[1] << 12 | values[2] << 6 | values[3];
    output.push(combined >>> 16 & 255);
    if (chars[2] !== "=") output.push(combined >>> 8 & 255);
    if (chars[3] !== "=") output.push(combined & 255);
  }
  return Uint8Array.from(output);
}

// packages/wallet-auth/node_modules/@noble/curves/utils.js
var abytes2 = (value, length, title) => abytes(value, length, title);
var anumber2 = anumber;
var bytesToHex2 = bytesToHex;
var concatBytes2 = (...arrays) => concatBytes(...arrays);
var hexToBytes2 = (hex2) => hexToBytes(hex2);
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
  const hex2 = abignumber(num).toString(16);
  return hex2.length & 1 ? "0" + hex2 : hex2;
}
function hexToNumber(hex2) {
  if (typeof hex2 !== "string")
    throw new TypeError("hex string expected, got " + typeof hex2);
  return hex2 === "" ? _0n : BigInt("0x" + hex2);
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
  const hex2 = n.toString(16);
  if (hex2.length > len * 2)
    throw new RangeError("number too large");
  return hexToBytes(hex2.padStart(len * 2, "0"));
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
function validateObject(object3, fields4 = {}, optFields = {}) {
  if (Object.prototype.toString.call(object3) !== "[object Object]")
    throw new TypeError("expected valid options object");
  function checkField(fieldName, expectedType, isOpt) {
    if (!isOpt && expectedType !== "function" && !Object.hasOwn(object3, fieldName))
      throw new TypeError(`param "${fieldName}" is invalid: expected own property`);
    const val = object3[fieldName];
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields4, false);
  iter(optFields, true);
}

// packages/wallet-auth/node_modules/@noble/curves/abstract/modular.js
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

// packages/wallet-auth/node_modules/@noble/curves/abstract/curve.js
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
function calcOffsets(n, window, wOpts) {
  const { windowSize, mask, maxNumber, shiftBy } = wOpts;
  let wbits = Number(n & mask);
  let nextN = n >> shiftBy;
  if (wbits > windowSize) {
    wbits -= maxNumber;
    nextN += _1n3;
  }
  const offsetStart = window * windowSize;
  const offset = offsetStart + Math.abs(wbits) - 1;
  const isZero = wbits === 0;
  const isNeg = wbits < 0;
  const isNegF = window % 2 !== 0;
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
    for (let window = 0; window < windows; window++) {
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
    for (let window = 0; window < wo.windows; window++) {
      const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
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
    for (let window = 0; window < wo.windows; window++) {
      if (n === _0n3)
        break;
      const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
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

// packages/wallet-auth/node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash3, key) {
    ahash(hash3);
    abytes(key, void 0, "key");
    this.iHash = hash3.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash3.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash3.create();
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
  const hmac_ = ((hash3, key, message) => new _HMAC(hash3, key).update(message).digest());
  hmac_.create = (hash3, key) => new _HMAC(hash3, key);
  return hmac_;
})();

// packages/wallet-auth/node_modules/@noble/curves/abstract/weierstrass.js
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
    encode: (tag, data2) => {
      const { Err: E } = DER;
      asafenumber(tag, "tag");
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      if (typeof data2 !== "string")
        throw new TypeError('"data" expected string, got type=' + typeof data2);
      if (data2.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data2.length / 2;
      const len = numberToHexUnpadded(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded(tag);
      return t + lenLen + len + data2;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data2) {
      const { Err: E } = DER;
      data2 = abytes2(data2, void 0, "DER data");
      let pos = 0;
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      if (data2.length < 2 || data2[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data2[pos++];
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
        const lengthBytes = data2.subarray(pos, pos + lenLen);
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
      const v = data2.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data2.subarray(pos + length) };
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
      let hex2 = numberToHexUnpadded(num);
      if (Number.parseInt(hex2[0], 16) & 8)
        hex2 = "00" + hex2;
      if (hex2.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex2;
    },
    decode(data2) {
      const { Err: E } = DER;
      if (data2.length < 1)
        throw new E("invalid signature integer: empty");
      if (data2[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data2.length > 1 && data2[0] === 0 && !(data2[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE(data2);
    }
  },
  toSig(bytes) {
    const { Err: E, _int: int, _tlv: tlv } = DER;
    const data2 = abytes2(bytes, void 0, "signature");
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data2);
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
    static fromHex(hex2) {
      return Point.fromBytes(hexToBytes2(hex2));
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
function ecdsa(Point, hash3, ecdsaOpts = {}) {
  const hash_ = hash3;
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
    static fromHex(hex2, format) {
      return this.fromBytes(hexToBytes2(hex2), format);
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

// packages/wallet-auth/node_modules/@noble/curves/nist.js
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

// packages/wallet-auth/src/protocol.js
var WALLET_AUTH_VERSION = "2";
var YNX_NATIVE_CHAIN_ID = "ynx_6423-1";
var YNX_EVM_CHAIN_ID = 6423;
var PRODUCT_DEVICE_ALGORITHM = "p256-sha256";
var MAX_REQUEST_LIFETIME_MS = 5 * 60 * 1e3;
var REQUEST_FIELDS = [
  "version",
  "nonce",
  "chainId",
  "requestingProduct",
  "productClientId",
  "bundleId",
  "productDeviceAlgorithm",
  "productDeviceKey",
  "origin",
  "callback",
  "scopes",
  "purpose",
  "issuedAt",
  "expiresAt"
];
var RESPONSE_FIELDS = [
  "version",
  "requestDigest",
  "nonce",
  "chainId",
  "requestingProduct",
  "productClientId",
  "bundleId",
  "productDeviceAlgorithm",
  "productDeviceKey",
  "origin",
  "callback",
  "account",
  "accountPublicKey",
  "grantedScopes",
  "purpose",
  "issuedAt",
  "expiresAt",
  "walletSignature"
];
function parseAuthorizationRequest(input, options) {
  const raw = typeof input === "string" ? parseJSON(input) : input;
  exactFields(raw, REQUEST_FIELDS, "Wallet authorization request");
  const request = {
    version: requiredString(raw.version, "version", 4),
    nonce: requiredPattern(raw.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/),
    chainId: requiredString(raw.chainId, "chainId", 32),
    requestingProduct: requiredPattern(raw.requestingProduct, "requestingProduct", /^[a-z][a-z0-9-]{1,31}$/),
    productClientId: requiredPattern(raw.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    bundleId: requiredPattern(raw.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    productDeviceAlgorithm: requiredString(raw.productDeviceAlgorithm, "productDeviceAlgorithm", 32),
    productDeviceKey: strictProductDeviceKey(raw.productDeviceKey),
    origin: strictOrigin(raw.origin),
    callback: strictURL(raw.callback, "callback"),
    scopes: strictScopes(raw.scopes),
    purpose: requiredString(raw.purpose, "purpose", 180),
    issuedAt: strictTime(raw.issuedAt, "issuedAt"),
    expiresAt: strictTime(raw.expiresAt, "expiresAt")
  };
  const now = options?.now instanceof Date ? options.now : /* @__PURE__ */ new Date();
  if (request.version !== WALLET_AUTH_VERSION) throw new WalletAuthError("UNSUPPORTED_VERSION", "Wallet authorization request version is unsupported");
  if (request.chainId !== YNX_NATIVE_CHAIN_ID) throw new WalletAuthError("WRONG_NETWORK", `Wallet authorization requires ${YNX_NATIVE_CHAIN_ID}`);
  if (request.productDeviceAlgorithm !== PRODUCT_DEVICE_ALGORITHM) throw new WalletAuthError("UNSUPPORTED_DEVICE_ALGORITHM", `Product device algorithm must be ${PRODUCT_DEVICE_ALGORITHM}`);
  const issued = Date.parse(request.issuedAt);
  const expires = Date.parse(request.expiresAt);
  if (expires <= issued || expires - issued > MAX_REQUEST_LIFETIME_MS) throw new WalletAuthError("INVALID_EXPIRY", "Wallet authorization expiry must be after issue time and no more than five minutes later");
  if (issued > now.getTime() + 3e4) throw new WalletAuthError("ISSUED_IN_FUTURE", "Wallet authorization request issue time is in the future");
  if (expires <= now.getTime()) throw new WalletAuthError("EXPIRED", "Wallet authorization request has expired");
  const binding2 = options?.registry?.[request.productClientId];
  if (!binding2) throw new WalletAuthError("UNKNOWN_PRODUCT", "Requesting product client is not registered");
  if (binding2.requestingProduct !== request.requestingProduct || binding2.bundleId !== request.bundleId) throw new WalletAuthError("PRODUCT_MISMATCH", "Requesting product identity does not match its registered client");
  if (!binding2.callbacks.includes(request.callback)) throw new WalletAuthError("CALLBACK_MISMATCH", "Callback is not registered for this exact product client");
  if (!Array.isArray(binding2.origins) || !binding2.origins.includes(request.origin)) throw new WalletAuthError("ORIGIN_NOT_ALLOWED", "Origin is not registered for this exact product client");
  const allowed = new Set(binding2.scopes);
  if (request.scopes.some((scope2) => !allowed.has(scope2))) throw new WalletAuthError("SCOPE_NOT_ALLOWED", "Request contains a scope outside the product allowlist");
  if (request.scopes.length > (binding2.maxScopes ?? binding2.scopes.length)) throw new WalletAuthError("SCOPE_TOO_BROAD", "Request contains too many scopes");
  return Object.freeze({ ...request, scopes: Object.freeze([...request.scopes]) });
}
function requestDigest(request) {
  exactFields(request, REQUEST_FIELDS, "Wallet authorization request");
  return digestHex("YNX_WALLET_AUTH_REQUEST_V2", request);
}
function createApprovalPayload(request, approval) {
  const account = requiredPattern(approval.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/);
  const accountPublicKey = requiredPattern(approval.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/);
  const issuedAt = strictTime(approval.issuedAt, "issuedAt");
  const expiry = Math.min(Date.parse(request.expiresAt), Date.parse(issuedAt) + MAX_REQUEST_LIFETIME_MS);
  if (!Number.isFinite(expiry) || expiry <= Date.parse(issuedAt)) throw new WalletAuthError("INVALID_EXPIRY", "Approval cannot outlive the request");
  return Object.freeze({
    version: WALLET_AUTH_VERSION,
    requestDigest: requestDigest(request),
    nonce: request.nonce,
    chainId: request.chainId,
    requestingProduct: request.requestingProduct,
    productClientId: request.productClientId,
    bundleId: request.bundleId,
    productDeviceAlgorithm: request.productDeviceAlgorithm,
    productDeviceKey: request.productDeviceKey,
    origin: request.origin,
    callback: request.callback,
    account,
    accountPublicKey,
    grantedScopes: Object.freeze([...request.scopes]),
    purpose: request.purpose,
    issuedAt,
    expiresAt: new Date(expiry).toISOString()
  });
}
function approvalSignBytes(payload) {
  return `YNX_WALLET_AUTH_APPROVAL_V2
${canonicalJSON(payload)}`;
}
function parseAuthorizationResponse(input) {
  const raw = typeof input === "string" ? parseJSON(input) : input;
  exactFields(raw, RESPONSE_FIELDS, "Wallet authorization response");
  if (raw.version !== WALLET_AUTH_VERSION || raw.chainId !== YNX_NATIVE_CHAIN_ID) throw new WalletAuthError("INVALID_RESPONSE", "Wallet authorization response uses an unsupported protocol or network");
  requiredPattern(raw.requestDigest, "requestDigest", /^[0-9a-f]{64}$/);
  requiredPattern(raw.walletSignature, "walletSignature", /^[0-9a-f]{128}$/);
  requiredPattern(raw.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/);
  requiredPattern(raw.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/);
  if (raw.productDeviceAlgorithm !== PRODUCT_DEVICE_ALGORITHM) throw new WalletAuthError("UNSUPPORTED_DEVICE_ALGORITHM", "Wallet authorization response device algorithm is unsupported");
  strictProductDeviceKey(raw.productDeviceKey);
  strictOrigin(raw.origin);
  strictScopes(raw.grantedScopes);
  strictURL(raw.callback, "callback");
  strictTime(raw.issuedAt, "issuedAt");
  strictTime(raw.expiresAt, "expiresAt");
  return Object.freeze({ ...raw, grantedScopes: Object.freeze([...raw.grantedScopes]) });
}
function unsignedApproval(response4) {
  const { walletSignature: _signature, ...payload } = response4;
  return payload;
}
function parseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new WalletAuthError("INVALID_JSON", "Wallet authorization payload is not valid JSON");
  }
}
function requiredString(value, label, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || value.trim() !== value) throw new WalletAuthError("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function requiredPattern(value, label, pattern13) {
  const normalized = requiredString(value, label, 256);
  if (!pattern13.test(normalized)) throw new WalletAuthError("INVALID_FIELD", `${label} is invalid`);
  return normalized;
}
function strictTime(value, label) {
  const normalized = requiredPattern(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) throw new WalletAuthError("INVALID_TIME", `${label} is invalid`);
  return normalized;
}
function strictURL(value, label) {
  const normalized = requiredString(value, label, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new WalletAuthError("INVALID_CALLBACK", `${label} is invalid`);
  }
  if (!/^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw new WalletAuthError("INVALID_CALLBACK", `${label} is invalid`);
  if (parsed.toString() !== normalized) throw new WalletAuthError("INVALID_CALLBACK", `${label} must be canonical`);
  return normalized;
}
function strictOrigin(value) {
  const normalized = requiredString(value, "origin", 255);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new WalletAuthError("INVALID_ORIGIN", "origin is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.toString() !== `${normalized}/`) {
    throw new WalletAuthError("INVALID_ORIGIN", "origin must be a canonical HTTPS origin");
  }
  return normalized;
}
function strictScopes(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new WalletAuthError("INVALID_SCOPES", "scopes must contain between one and eight entries");
  const scopes3 = value.map((scope2) => requiredPattern(scope2, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (new Set(scopes3).size !== scopes3.length || [...scopes3].sort().join("\n") !== scopes3.join("\n")) throw new WalletAuthError("INVALID_SCOPES", "scopes must be unique and sorted");
  return scopes3;
}
function strictProductDeviceKey(value) {
  const normalized = requiredPattern(value, "productDeviceKey", /^[A-Za-z0-9_-]{44}$/);
  const bytes = decodeBase64url(normalized, "productDeviceKey");
  if (bytes.length !== 33 || encodeBase64url(bytes) !== normalized || bytes[0] !== 2 && bytes[0] !== 3) throw new WalletAuthError("INVALID_DEVICE_KEY", "productDeviceKey must be canonical compressed P-256 SEC1");
  try {
    p256.Point.fromBytes(bytes);
  } catch {
    throw new WalletAuthError("INVALID_DEVICE_KEY", "productDeviceKey is not a valid P-256 point");
  }
  return normalized;
}

// packages/wallet-auth/node_modules/@noble/curves/secp256k1.js
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

// packages/wallet-auth/node_modules/@noble/hashes/sha3.js
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
  update(data2) {
    aexists(this);
    abytes(data2);
    const { blockLen, state: state2 } = this;
    const len = data2.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state2[this.pos++] ^= data2[pos++];
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

// packages/wallet-auth/src/crypto.js
var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function walletIdentity(secretHex) {
  const secret = validSecret(secretHex);
  const publicKey = secp256k1.getPublicKey(secret, true);
  const digest7 = keccak_256(secp256k1.getPublicKey(secret, false).slice(1));
  return Object.freeze({ account: encodeYNX(digest7.slice(-20)), accountPublicKey: bytesToHex(publicKey) });
}
function signAuthorization(request, input) {
  const secret = validSecret(input.accountSecret);
  const identity = walletIdentity(bytesToHex(secret));
  if (input.account && input.account !== identity.account) throw new WalletAuthError("ACCOUNT_MISMATCH", "Selected account does not match the signing key");
  const payload = createApprovalPayload(request, { ...identity, issuedAt: input.issuedAt });
  const signature = secp256k1.sign(sha256(utf8ToBytes(approvalSignBytes(payload))), secret, { prehash: false, format: "compact", lowS: true });
  return Object.freeze({ ...payload, walletSignature: bytesToHex(signature) });
}
function verifyAuthorization(response4, expected) {
  const parsed = parseAuthorizationResponse(response4);
  const exactKeys2 = ["nonce", "chainId", "requestingProduct", "productClientId", "bundleId", "productDeviceAlgorithm", "productDeviceKey", "origin", "callback", "purpose"];
  if (parsed.requestDigest !== expected.requestDigest || exactKeys2.some((key) => parsed[key] !== expected[key]) || parsed.grantedScopes.join("\n") !== expected.scopes.join("\n") || parsed.expiresAt > expected.expiresAt) {
    throw new WalletAuthError("BINDING_MISMATCH", "Wallet approval does not match the exact product request");
  }
  const now = expected.now.getTime();
  const issued = Date.parse(parsed.issuedAt);
  if (issued < Date.parse(expected.issuedAt) || issued > now + 3e4) throw new WalletAuthError("INVALID_APPROVAL_TIME", "Wallet approval issue time is outside the request verification window");
  if (parsed.expiresAt <= expected.now.toISOString()) throw new WalletAuthError("EXPIRED", "Wallet approval has expired");
  const valid = secp256k1.verify(hexToBytes(parsed.walletSignature), sha256(utf8ToBytes(approvalSignBytes(unsignedApproval(parsed)))), hexToBytes(parsed.accountPublicKey), { prehash: false, format: "compact", lowS: true });
  if (!valid || walletIdentityFromPublicKey(parsed.accountPublicKey) !== parsed.account) throw new WalletAuthError("INVALID_SIGNATURE", "Wallet approval signature is invalid");
  return parsed;
}
function walletIdentityFromPublicKey(publicKeyHex) {
  const point = secp256k1.Point.fromBytes(hexToBytes(publicKeyHex));
  const digest7 = keccak_256(point.toBytes(false).slice(1));
  return encodeYNX(digest7.slice(-20));
}
function evmAddressFromYNX(account) {
  if (typeof account !== "string" || account !== account.toLowerCase() || !account.startsWith("ynx1")) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account is invalid");
  const encoded = account.slice(4);
  const values = [...encoded].map((character) => CHARSET.indexOf(character));
  if (values.length !== 38 || values.some((value) => value < 0) || polymod([...hrpExpand("ynx"), ...values]) !== 1) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account checksum is invalid");
  const data2 = values.slice(0, -6);
  const payload = convertBitsStrict(data2, 5, 8);
  if (payload.length !== 20) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account payload is invalid");
  return `0x${bytesToHex(Uint8Array.from(payload))}`;
}
function ynxAddressFromEVM(address4) {
  if (typeof address4 !== "string" || !/^0x[0-9a-f]{40}$/.test(address4)) throw new WalletAuthError("INVALID_ACCOUNT", "EVM compatibility address is invalid");
  return encodeYNX(hexToBytes(address4.slice(2)));
}
function validSecret(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new WalletAuthError("INVALID_SECRET", "Wallet account secret must be 32-byte lowercase hex");
  const bytes = hexToBytes(value);
  if (!secp256k1.utils.isValidSecretKey(bytes)) throw new WalletAuthError("INVALID_SECRET", "Wallet account secret is outside the secp256k1 range");
  return bytes;
}
function encodeYNX(payload) {
  const data2 = convertBits(payload, 8, 5, true);
  const values = [...hrpExpand("ynx"), ...data2, 0, 0, 0, 0, 0, 0];
  const checksum = polymod(values) ^ 1;
  const tail = Array.from({ length: 6 }, (_, index) => checksum >>> 5 * (5 - index) & 31);
  return `ynx1${[...data2, ...tail].map((item) => CHARSET[item]).join("")}`;
}
function convertBits(data2, fromBits, toBits, pad) {
  let accumulator = 0, bits = 0;
  const result = [], maxValue = (1 << toBits) - 1, maxAccumulator = (1 << fromBits + toBits - 1) - 1;
  for (const value of data2) {
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
function convertBitsStrict(data2, fromBits, toBits) {
  let accumulator = 0, bits = 0;
  const result = [], maxValue = (1 << toBits) - 1, maxAccumulator = (1 << fromBits + toBits - 1) - 1;
  for (const value of data2) {
    if (!Number.isInteger(value) || value < 0 || value >= 1 << fromBits) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account data is invalid");
    accumulator = (accumulator << fromBits | value) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push(accumulator >> bits & maxValue);
    }
  }
  if (bits >= fromBits || (accumulator << toBits - bits & maxValue) !== 0) throw new WalletAuthError("INVALID_ACCOUNT", "YNX account padding is invalid");
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

// packages/wallet-auth/src/deep-link.js
function encodeRequestDeepLink(request) {
  const encoded = encodeBase64url(new TextEncoder().encode(canonicalJSON(request)));
  return `ynxwallet://authorize?request=${encoded}`;
}
function parseWalletDeepLink(url2, platform, options) {
  if (platform !== "android" && platform !== "ios") throw new WalletAuthError("INVALID_PLATFORM", "Deep link platform must be android or ios");
  let parsed;
  try {
    parsed = new URL(url2);
  } catch {
    throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link is invalid");
  }
  if (parsed.protocol !== "ynxwallet:" || parsed.hostname !== "authorize" || parsed.pathname !== "" || parsed.hash || [...parsed.searchParams.keys()].join(",") !== "request") {
    throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link route or fields are invalid");
  }
  let requestText;
  try {
    requestText = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(parsed.searchParams.get("request") ?? "", "Wallet deep link request"));
  } catch {
    throw new WalletAuthError("INVALID_DEEP_LINK", "Wallet deep link request encoding is invalid");
  }
  return Object.freeze({ platform, request: parseAuthorizationRequest(requestText, options) });
}
function createCallbackURL(response4) {
  const callback2 = new URL(response4.callback);
  if (callback2.search || callback2.hash) throw new WalletAuthError("INVALID_CALLBACK", "Registered callback must not contain query or fragment state");
  callback2.searchParams.set("response", encodeBase64url(new TextEncoder().encode(canonicalJSON(response4))));
  return callback2.toString();
}
function parseCallbackURL(url2, expectedCallback) {
  let parsed, expected;
  try {
    parsed = new URL(url2);
    expected = new URL(expectedCallback);
  } catch {
    throw new WalletAuthError("INVALID_CALLBACK", "Wallet callback is invalid");
  }
  const keys = [...parsed.searchParams.keys()];
  const response4 = keys.length === 1 && keys[0] === "response" ? parsed.searchParams.get("response") : null;
  if (parsed.hash || parsed.username || parsed.password) throw new WalletAuthError("CALLBACK_MISMATCH", "Callback route was substituted");
  parsed.search = "";
  if (!response4 || parsed.toString() !== expected.toString()) throw new WalletAuthError("CALLBACK_MISMATCH", "Callback route was substituted");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(response4, "Wallet callback response")));
  } catch {
    throw new WalletAuthError("INVALID_CALLBACK", "Callback response encoding is invalid");
  }
}

// packages/wallet-auth/src/replay.js
var OneTimeNonceStore = class {
  constructor(records = []) {
    this.records = new Map(records);
  }
  consume(request, at = /* @__PURE__ */ new Date()) {
    this.prune(at);
    if (this.records.has(request.nonce)) throw new WalletAuthError("REPLAY", "Wallet authorization nonce was already used");
    this.records.set(request.nonce, request.expiresAt);
  }
  prune(at = /* @__PURE__ */ new Date()) {
    for (const [nonce, expiresAt] of this.records) if (expiresAt <= at.toISOString()) this.records.delete(nonce);
  }
  snapshot() {
    return Object.freeze([...this.records.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
};

// packages/wallet-auth/src/session.js
var CHALLENGE_FIELDS = [
  "version",
  "challenge",
  "requestDigest",
  "productClientId",
  "bundleId",
  "productDeviceAlgorithm",
  "productDeviceKey",
  "origin",
  "account",
  "scopes",
  "issuedAt",
  "expiresAt"
];
var COMPLETION_FIELDS = ["challenge", "deviceSignature"];
var SIGNING_DOMAIN = "YNX_PRODUCT_SESSION_CHALLENGE_V2";
function createGatewayChallenge(approval, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, ["challenge", "expiresAt"], "Gateway challenge input");
  const now = validDate(at, "Gateway challenge issue time");
  const issuedAt = now.toISOString();
  const expiresAt = strictTime2(input.expiresAt, "expiresAt");
  const approvalIssuedAt = strictTime2(approval.issuedAt, "approval issuedAt");
  const approvalExpiresAt = strictTime2(approval.expiresAt, "approval expiresAt");
  if (issuedAt < approvalIssuedAt || issuedAt >= approvalExpiresAt) throw new WalletAuthError("INVALID_CHALLENGE_TIME", "Gateway challenge must be issued during the Wallet approval lifetime");
  if (expiresAt <= issuedAt || expiresAt > approvalExpiresAt) throw new WalletAuthError("INVALID_CHALLENGE_EXPIRY", "Gateway challenge expiry must be after issue time and no later than the Wallet approval expiry");
  return parseGatewayChallenge({
    version: "2",
    challenge: requiredPattern2(input.challenge, "challenge", /^[A-Za-z0-9_-]{32,64}$/),
    requestDigest: approval.requestDigest,
    productClientId: approval.productClientId,
    bundleId: approval.bundleId,
    productDeviceAlgorithm: approval.productDeviceAlgorithm,
    productDeviceKey: approval.productDeviceKey,
    origin: approval.origin,
    account: approval.account,
    scopes: approval.grantedScopes,
    issuedAt,
    expiresAt
  });
}
function parseGatewayChallenge(input) {
  exactFields(input, CHALLENGE_FIELDS, "Gateway challenge");
  const challenge = {
    version: requiredPattern2(input.version, "version", /^2$/),
    challenge: requiredPattern2(input.challenge, "challenge", /^[A-Za-z0-9_-]{32,64}$/),
    requestDigest: requiredPattern2(input.requestDigest, "requestDigest", /^[0-9a-f]{64}$/),
    productClientId: requiredPattern2(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    bundleId: requiredPattern2(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    productDeviceAlgorithm: requiredPattern2(input.productDeviceAlgorithm, "productDeviceAlgorithm", /^p256-sha256$/),
    productDeviceKey: strictDeviceKey(input.productDeviceKey),
    origin: strictOrigin2(input.origin),
    account: requiredPattern2(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    scopes: strictScopes2(input.scopes),
    issuedAt: strictTime2(input.issuedAt, "issuedAt"),
    expiresAt: strictTime2(input.expiresAt, "expiresAt")
  };
  if (challenge.expiresAt <= challenge.issuedAt) throw new WalletAuthError("INVALID_CHALLENGE_EXPIRY", "Gateway challenge expiry must be after issue time");
  return Object.freeze({ ...challenge, scopes: Object.freeze([...challenge.scopes]) });
}
function gatewayChallengeSignBytes(challenge) {
  return `${SIGNING_DOMAIN}
${canonicalJSON(parseGatewayChallenge(challenge))}`;
}
function signGatewayChallenge(challenge, productDeviceSecret) {
  const parsed = parseGatewayChallenge(challenge);
  if (parsed.productDeviceAlgorithm !== PRODUCT_DEVICE_ALGORITHM) throw new WalletAuthError("UNSUPPORTED_DEVICE_ALGORITHM", "Gateway challenge product device algorithm is unsupported");
  const secret = decodeKey(productDeviceSecret, 32, "product device secret");
  const publicKey = encodeBase64url(p256.getPublicKey(secret, true));
  if (publicKey !== parsed.productDeviceKey) throw new WalletAuthError("DEVICE_MISMATCH", "Gateway challenge is bound to another product device");
  const signature = p256.sign(utf8ToBytes(gatewayChallengeSignBytes(parsed)), secret, { format: "der" });
  return Object.freeze({ challenge: parsed, deviceSignature: encodeBase64url(signature) });
}
function verifyGatewayCompletion(completion, expected, at = /* @__PURE__ */ new Date()) {
  exactFields(completion, COMPLETION_FIELDS, "Gateway completion");
  const challenge = parseGatewayChallenge(completion.challenge);
  const now = validDate(at, "Gateway verification time").toISOString();
  const expectedIssuedAt = strictTime2(expected.issuedAt, "approval issuedAt");
  const expectedExpiresAt = strictTime2(expected.expiresAt, "approval expiresAt");
  const expectedScopes = strictScopes2(expected.grantedScopes);
  if (challenge.issuedAt > now) throw new WalletAuthError("ISSUED_IN_FUTURE", "Gateway challenge issue time is in the future");
  if (challenge.expiresAt <= now) throw new WalletAuthError("EXPIRED", "Gateway challenge has expired");
  if (challenge.issuedAt < expectedIssuedAt || challenge.expiresAt > expectedExpiresAt) throw new WalletAuthError("SESSION_LIFETIME_MISMATCH", "Gateway challenge exceeds the Wallet approval lifetime");
  for (const key of ["requestDigest", "productClientId", "bundleId", "productDeviceAlgorithm", "productDeviceKey", "origin", "account"]) {
    if (challenge[key] !== expected[key]) throw new WalletAuthError("SESSION_BINDING_MISMATCH", `Gateway challenge ${key} does not match the Wallet approval`);
  }
  if (challenge.scopes.join("\n") !== expectedScopes.join("\n")) throw new WalletAuthError("SESSION_SCOPE_MISMATCH", "Gateway challenge scopes do not exactly match the Wallet approval");
  const publicKey = decodeKey(challenge.productDeviceKey, 33, "product device key");
  const signature = decodeBase64url(completion.deviceSignature, "device signature");
  if (signature.length < 68 || signature.length > 72) throw new WalletAuthError("INVALID_KEY", "device signature has the wrong length");
  let valid = false;
  try {
    valid = p256.verify(signature, utf8ToBytes(gatewayChallengeSignBytes(challenge)), publicKey, { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) throw new WalletAuthError("INVALID_DEVICE_PROOF", "Gateway challenge device signature is invalid");
  return Object.freeze({
    sessionBinding: bytesToHex(sha256(utf8ToBytes(canonicalJSON(challenge)))),
    productClientId: challenge.productClientId,
    bundleId: challenge.bundleId,
    productDeviceAlgorithm: challenge.productDeviceAlgorithm,
    origin: challenge.origin,
    account: challenge.account,
    scopes: Object.freeze([...challenge.scopes]),
    expiresAt: challenge.expiresAt
  });
}
function strictDeviceKey(value) {
  const normalized = requiredPattern2(value, "productDeviceKey", /^[A-Za-z0-9_-]{44}$/);
  const bytes = decodeKey(normalized, 33, "product device key");
  if (encodeBase64url(bytes) !== normalized || bytes[0] !== 2 && bytes[0] !== 3) throw new WalletAuthError("INVALID_DEVICE_KEY", "product device key must be canonical compressed P-256 SEC1");
  try {
    p256.Point.fromBytes(bytes);
  } catch {
    throw new WalletAuthError("INVALID_DEVICE_KEY", "product device key is not a valid P-256 point");
  }
  return normalized;
}
function strictScopes2(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new WalletAuthError("INVALID_SCOPES", "scopes must contain between one and eight entries");
  const scopes3 = value.map((scope2) => requiredPattern2(scope2, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (new Set(scopes3).size !== scopes3.length || [...scopes3].sort().join("\n") !== scopes3.join("\n")) throw new WalletAuthError("INVALID_SCOPES", "scopes must be unique and sorted");
  return scopes3;
}
function strictOrigin2(value) {
  const normalized = requiredPattern2(value, "origin", /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new WalletAuthError("INVALID_ORIGIN", "origin is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.toString() !== `${normalized}/`) {
    throw new WalletAuthError("INVALID_ORIGIN", "origin must be a canonical HTTPS origin");
  }
  return normalized;
}
function strictTime2(value, label) {
  const normalized = requiredPattern2(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) throw new WalletAuthError("INVALID_TIME", `${label} is invalid`);
  return normalized;
}
function requiredPattern2(value, label, pattern13) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || value.trim() !== value || !pattern13.test(value)) throw new WalletAuthError("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function validDate(value, label) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new WalletAuthError("INVALID_TIME", `${label} is invalid`);
  return value;
}
function decodeKey(value, length, label) {
  const bytes = decodeBase64url(value, label);
  if (bytes.length !== length) throw new WalletAuthError("INVALID_KEY", `${label} has the wrong length`);
  return bytes;
}

// packages/wallet-auth/src/integration.js
var REGISTRY_V1_FIELDS = ["schemaVersion", "productClientId", "requestingProduct", "bundleId", "callback", "scopes", "maxScopes"];
var REGISTRY_V2_FIELDS = ["schemaVersion", "productClientId", "requestingProduct", "bundleId", "callbacks", "scopes", "maxScopes", "productDeviceAlgorithms"];
var REGISTRY_V3_FIELDS = [...REGISTRY_V2_FIELDS, "origins"];
var VERIFY_FIELDS = ["registryEntry", "authorizationRequest", "walletApproval", "gatewayCompletion"];
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
var SESSION_FIELDS = [
  "verifierVersion",
  "sessionBinding",
  "chainId",
  "requestingProduct",
  "productClientId",
  "bundleId",
  "origin",
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
var CENTRAL_REGISTRY_SCHEMA_VERSION = 3;
var CENTRAL_VERIFIER_VERSION = "wallet-auth-v2";
function migrateCentralRegistryEntry(input) {
  if (input?.schemaVersion === 3) return parseCentralRegistryEntry(input);
  exactFields(input, REGISTRY_V1_FIELDS, "Wallet product registry v1 entry");
  const migrated = {
    schemaVersion: 3,
    productClientId: input.productClientId,
    requestingProduct: input.requestingProduct,
    bundleId: input.bundleId,
    callbacks: [input.callback],
    scopes: input.scopes,
    maxScopes: input.maxScopes,
    productDeviceAlgorithms: [PRODUCT_DEVICE_ALGORITHM],
    origins: []
  };
  return parseCentralRegistryEntry(migrated);
}
function parseCentralRegistryEntry(input) {
  const version = input?.schemaVersion;
  if (version === 2) exactFields(input, REGISTRY_V2_FIELDS, "Wallet product registry v2 entry");
  else exactFields(input, REGISTRY_V3_FIELDS, "Wallet product registry entry");
  const entry = {
    schemaVersion: requiredInteger(input.schemaVersion, "schemaVersion", 2, 3),
    productClientId: requiredPattern3(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    requestingProduct: requiredPattern3(input.requestingProduct, "requestingProduct", /^[a-z][a-z0-9-]{1,31}$/),
    bundleId: requiredPattern3(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    callbacks: stringList(input.callbacks, "callbacks", 1, 8, (value) => canonicalCallback(value)),
    scopes: stringList(input.scopes, "scopes", 1, 16, (value) => requiredPattern3(value, "scope", /^[a-z][a-z0-9._:-]{1,63}$/)),
    maxScopes: requiredInteger(input.maxScopes, "maxScopes", 1, 8),
    productDeviceAlgorithms: stringList(input.productDeviceAlgorithms, "productDeviceAlgorithms", 1, 4, (value) => requiredPattern3(value, "productDeviceAlgorithm", /^p256-sha256$/)),
    origins: version === 2 ? [] : stringList(input.origins, "origins", 0, 8, strictOrigin3)
  };
  if (entry.maxScopes > entry.scopes.length) throw new WalletAuthError("INVALID_REGISTRY", "maxScopes cannot exceed the registered scope count");
  return freezeEntry({ ...entry, schemaVersion: 3 });
}
function registryParserBinding(input) {
  const entry = parseCentralRegistryEntry(input);
  return Object.freeze({
    [entry.productClientId]: Object.freeze({
      requestingProduct: entry.requestingProduct,
      bundleId: entry.bundleId,
      callbacks: entry.callbacks,
      origins: entry.origins,
      scopes: entry.scopes,
      maxScopes: entry.maxScopes
    })
  });
}
function verifyCentralWalletSession(input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, VERIFY_FIELDS, "Central Wallet verifier input");
  const registryEntry = parseCentralRegistryEntry(input.registryEntry);
  const request = parseAuthorizationRequest(input.authorizationRequest, { now: at, registry: registryParserBinding(registryEntry) });
  if (!registryEntry.productDeviceAlgorithms.includes(request.productDeviceAlgorithm)) throw new WalletAuthError("UNSUPPORTED_DEVICE_ALGORITHM", "Product device algorithm is not registered");
  const approval = verifyAuthorization(input.walletApproval, { ...request, requestDigest: requestDigest(request), now: at });
  const completion = verifyGatewayCompletion(input.gatewayCompletion, approval, at);
  return Object.freeze({
    verifierVersion: CENTRAL_VERIFIER_VERSION,
    sessionBinding: completion.sessionBinding,
    chainId: request.chainId,
    requestingProduct: request.requestingProduct,
    productClientId: completion.productClientId,
    bundleId: completion.bundleId,
    origin: request.origin,
    callback: request.callback,
    productDeviceAlgorithm: completion.productDeviceAlgorithm,
    productDeviceKey: request.productDeviceKey,
    deviceBinding: centralDeviceBinding(request, completion.account),
    requestDigest: approval.requestDigest,
    approvalDigest: centralApprovalDigest(approval),
    account: completion.account,
    scopes: completion.scopes,
    nonce: request.nonce,
    purpose: request.purpose,
    issuedAt: input.gatewayCompletion.challenge.issuedAt,
    expiresAt: completion.expiresAt
  });
}
function assertCentralWalletSessionActive(session, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, ["revokedSessionBindings", "revokedApprovalDigests", "revokedDeviceBindings", "accountLogoutRecords"], "Central Wallet session state");
  const now = validDate2(at).toISOString();
  const parsed = parseCentralWalletSession(session);
  const bindings = stringList(input.revokedSessionBindings, "revokedSessionBindings", 0, 1e3, (value) => requiredPattern3(value, "sessionBinding", /^[0-9a-f]{64}$/));
  const approvals = stringList(input.revokedApprovalDigests, "revokedApprovalDigests", 0, 1e3, (value) => requiredPattern3(value, "approvalDigest", /^[0-9a-f]{64}$/));
  const devices = stringList(input.revokedDeviceBindings, "revokedDeviceBindings", 0, 1e3, (value) => requiredPattern3(value, "deviceBinding", /^[0-9a-f]{64}$/));
  const logoutRecords = parseAccountLogoutRecords(input.accountLogoutRecords);
  if (parsed.issuedAt > now) throw new WalletAuthError("ISSUED_IN_FUTURE", "Wallet product session issue time is in the future");
  if (parsed.expiresAt <= now) throw new WalletAuthError("EXPIRED", "Wallet product session has expired");
  if (bindings.includes(parsed.sessionBinding)) throw new WalletAuthError("REVOKED", "Wallet product session has been revoked");
  if (approvals.includes(parsed.approvalDigest)) throw new WalletAuthError("REVOKED", "Wallet approval and all sessions derived from it have been revoked");
  if (devices.includes(parsed.deviceBinding)) throw new WalletAuthError("REVOKED", "Wallet product device has been revoked");
  if (logoutRecords.some((record2) => record2.account === parsed.account && parsed.issuedAt <= record2.before)) throw new WalletAuthError("REVOKED", "Wallet account was signed out from all devices");
  if (parsed.verifierVersion !== CENTRAL_VERIFIER_VERSION) throw new WalletAuthError("SESSION_RETIRED", "Wallet product session predates origin binding and must reconnect");
  return parsed;
}
function parseCentralWalletSession(input) {
  const legacy = input?.verifierVersion === "wallet-auth-v1";
  const legacyHasAccountPublicKey = legacy && Object.hasOwn(input, "accountPublicKey");
  exactFields(input, legacy ? legacyHasAccountPublicKey ? SESSION_V1_FIELDS : SESSION_V1_BASE_FIELDS : SESSION_FIELDS, "Central Wallet session");
  const session = {
    verifierVersion: requiredPattern3(input.verifierVersion, "verifierVersion", /^wallet-auth-v[12]$/),
    sessionBinding: requiredPattern3(input.sessionBinding, "sessionBinding", /^[0-9a-f]{64}$/),
    chainId: requiredPattern3(input.chainId, "chainId", /^ynx_6423-1$/),
    requestingProduct: requiredPattern3(input.requestingProduct, "requestingProduct", /^[a-z][a-z0-9-]{1,31}$/),
    productClientId: requiredPattern3(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    bundleId: requiredPattern3(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    ...legacy ? {} : { origin: strictOrigin3(input.origin) },
    callback: canonicalCallback(input.callback),
    productDeviceAlgorithm: requiredPattern3(input.productDeviceAlgorithm, "productDeviceAlgorithm", /^p256-sha256$/),
    productDeviceKey: requiredPattern3(input.productDeviceKey, "productDeviceKey", /^[A-Za-z0-9_-]{44}$/),
    deviceBinding: requiredPattern3(input.deviceBinding, "deviceBinding", /^[0-9a-f]{64}$/),
    requestDigest: requiredPattern3(input.requestDigest, "requestDigest", /^[0-9a-f]{64}$/),
    approvalDigest: requiredPattern3(input.approvalDigest, "approvalDigest", /^[0-9a-f]{64}$/),
    account: requiredPattern3(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    ...legacyHasAccountPublicKey ? { accountPublicKey: requiredPattern3(input.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/) } : {},
    scopes: stringList(input.scopes, "scopes", 1, 8, (value) => requiredPattern3(value, "scope", /^[a-z][a-z0-9._:-]{1,63}$/)),
    nonce: requiredPattern3(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/),
    purpose: requiredPattern3(input.purpose, "purpose", /^.{1,180}$/u),
    issuedAt: strictTime3(input.issuedAt, "issuedAt"),
    expiresAt: strictTime3(input.expiresAt, "expiresAt")
  };
  if (session.expiresAt <= session.issuedAt) throw new WalletAuthError("INVALID_SESSION", "Wallet product session lifetime is invalid");
  let legacyAccountMatches = true;
  if (legacyHasAccountPublicKey) {
    try {
      legacyAccountMatches = walletIdentityFromPublicKey(session.accountPublicKey) === session.account;
    } catch {
      legacyAccountMatches = false;
    }
  }
  if (session.chainId !== YNX_NATIVE_CHAIN_ID || session.deviceBinding !== centralDeviceBinding(session, session.account) || !legacyAccountMatches) throw new WalletAuthError("INVALID_SESSION", "Wallet product session security binding is invalid");
  return Object.freeze({ ...session, scopes: Object.freeze([...session.scopes]) });
}
function centralApprovalDigest(approval) {
  return digestHex("YNX_WALLET_AUTH_APPROVAL_DIGEST_V2", parseAuthorizationResponse(approval));
}
function centralDeviceBinding(requestOrSession, account) {
  const legacy = requestOrSession.verifierVersion === "wallet-auth-v1";
  return digestHex(legacy ? "YNX_WALLET_PRODUCT_DEVICE_BINDING_V1" : "YNX_WALLET_PRODUCT_DEVICE_BINDING_V2", {
    chainId: requestOrSession.chainId,
    requestingProduct: requestOrSession.requestingProduct,
    productClientId: requestOrSession.productClientId,
    bundleId: requestOrSession.bundleId,
    ...legacy ? {} : { origin: requestOrSession.origin },
    callback: requestOrSession.callback,
    productDeviceAlgorithm: requestOrSession.productDeviceAlgorithm,
    productDeviceKey: requestOrSession.productDeviceKey,
    account
  });
}
function freezeEntry(entry) {
  return Object.freeze({ ...entry, callbacks: Object.freeze([...entry.callbacks]), origins: Object.freeze([...entry.origins]), scopes: Object.freeze([...entry.scopes]), productDeviceAlgorithms: Object.freeze([...entry.productDeviceAlgorithms]) });
}
function stringList(value, label, minimum, maximum, normalize2) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new WalletAuthError("INVALID_REGISTRY", `${label} has an invalid item count`);
  const result = value.map(normalize2);
  if (new Set(result).size !== result.length || [...result].sort().join("\n") !== result.join("\n")) throw new WalletAuthError("INVALID_REGISTRY", `${label} must be unique and sorted`);
  return result;
}
function canonicalCallback(value) {
  const normalized = requiredPattern3(value, "callback", /^[a-z][a-z0-9+.-]*:\/\/[^\s#]+$/);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new WalletAuthError("INVALID_REGISTRY", "callback is invalid");
  }
  if (parsed.toString() !== normalized || parsed.username || parsed.password || parsed.search || parsed.hash) throw new WalletAuthError("INVALID_REGISTRY", "callback must be canonical and contain no query or fragment state");
  return normalized;
}
function strictOrigin3(value) {
  const normalized = requiredPattern3(value, "origin", /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new WalletAuthError("INVALID_REGISTRY", "origin is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.toString() !== `${normalized}/`) throw new WalletAuthError("INVALID_REGISTRY", "origin must be a canonical HTTPS origin");
  return normalized;
}
function parseAccountLogoutRecords(value) {
  if (!Array.isArray(value) || value.length > 1e3) throw new WalletAuthError("INVALID_REGISTRY", "accountLogoutRecords has an invalid item count");
  const records = value.map((record2) => {
    exactFields(record2, ["account", "before"], "Wallet account logout record");
    return Object.freeze({ account: requiredPattern3(record2.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: strictTime3(record2.before, "before") });
  });
  const keys = records.map((record2) => `${record2.account}:${record2.before}`);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) throw new WalletAuthError("INVALID_REGISTRY", "accountLogoutRecords must be unique and sorted");
  return records;
}
function requiredPattern3(value, label, pattern13) {
  if (typeof value !== "string" || value.trim() !== value || !pattern13.test(value)) throw new WalletAuthError("INVALID_REGISTRY", `${label} is invalid`);
  return value;
}
function requiredInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new WalletAuthError("INVALID_REGISTRY", `${label} is invalid`);
  return value;
}
function validDate2(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new WalletAuthError("INVALID_TIME", "verification time is invalid");
  return value;
}
function strictTime3(value, label) {
  const normalized = requiredPattern3(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) throw new WalletAuthError("INVALID_TIME", `${label} is invalid`);
  return normalized;
}

// packages/wallet-auth/src/client-retirement.js
var ACTIVE_FIELDS = ["status"];
var RETIRED_FIELDS = [
  "status",
  "clientId",
  "replacementURL",
  "minimumClientVersion",
  "lastSupportedVersion",
  "retiredAt",
  "disabledCallbacks",
  "disabledAppLinks"
];
var RECORD_FIELDS = [
  "clientId",
  "productId",
  "requestingProduct",
  "productClientId",
  "bundleId",
  "replacementURL",
  "minimumClientVersion",
  "lastSupportedVersion",
  "retiredAt",
  "disabledCallbacks",
  "disabledAppLinks"
];
var CLIENT_LIFECYCLE_ACTIVE = Object.freeze({ status: "active" });
var ClientRetiredError = class extends WalletAuthError {
  constructor(record2) {
    const retirement = parseClientRetirementRecord(record2);
    super("CLIENT_RETIRED", "This client is retired");
    this.details = Object.freeze({
      clientId: retirement.clientId,
      replacementURL: retirement.replacementURL,
      minimumClientVersion: retirement.minimumClientVersion
    });
  }
};
function parseClientLifecycle(input, identity) {
  if (input?.status === "active") {
    exactFields(input, ACTIVE_FIELDS, "Wallet client lifecycle");
    return CLIENT_LIFECYCLE_ACTIVE;
  }
  exactFields(input, RETIRED_FIELDS, "Retired Wallet client lifecycle");
  if (input.status !== "retired") throw new WalletAuthError("INVALID_REGISTRY", "Wallet client lifecycle status is unsupported");
  const callbacks = canonicalURLs(input.disabledCallbacks, "disabledCallbacks", 1, 8, false);
  if (callbacks.join("\n") !== identity.callbacks.join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", "Retired Wallet client must disable every registered callback");
  }
  return Object.freeze({
    status: "retired",
    clientId: token(input.clientId, "clientId", /^[a-z][a-z0-9-]{2,63}$/),
    replacementURL: canonicalURL(input.replacementURL, "replacementURL", true),
    minimumClientVersion: token(input.minimumClientVersion, "minimumClientVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    lastSupportedVersion: token(input.lastSupportedVersion, "lastSupportedVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    retiredAt: canonicalTime(input.retiredAt),
    disabledCallbacks: callbacks,
    disabledAppLinks: canonicalURLs(input.disabledAppLinks, "disabledAppLinks", 0, 8, false)
  });
}
function clientRetirementRecord(registration) {
  if (registration?.clientLifecycle?.status !== "retired") throw new WalletAuthError("INVALID_REGISTRY", "Wallet product is not retired");
  return parseClientRetirementRecord({
    clientId: registration.clientLifecycle.clientId,
    productId: registration.productId,
    requestingProduct: registration.requestingProduct,
    productClientId: registration.productClientId,
    bundleId: registration.bundleId,
    replacementURL: registration.clientLifecycle.replacementURL,
    minimumClientVersion: registration.clientLifecycle.minimumClientVersion,
    lastSupportedVersion: registration.clientLifecycle.lastSupportedVersion,
    retiredAt: registration.clientLifecycle.retiredAt,
    disabledCallbacks: registration.clientLifecycle.disabledCallbacks,
    disabledAppLinks: registration.clientLifecycle.disabledAppLinks
  });
}
function retirementRecord(input) {
  return input?.clientLifecycle?.status === "retired" ? clientRetirementRecord(input) : parseClientRetirementRecord(input);
}
function parseClientRetirementRecord(input) {
  exactFields(input, RECORD_FIELDS, "Wallet client retirement record");
  return Object.freeze({
    clientId: token(input.clientId, "clientId", /^[a-z][a-z0-9-]{2,63}$/),
    productId: token(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    requestingProduct: token(input.requestingProduct, "requestingProduct", /^[a-z][a-z0-9-]{1,31}$/),
    productClientId: token(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/),
    bundleId: token(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    replacementURL: canonicalURL(input.replacementURL, "replacementURL", true),
    minimumClientVersion: token(input.minimumClientVersion, "minimumClientVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    lastSupportedVersion: token(input.lastSupportedVersion, "lastSupportedVersion", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
    retiredAt: canonicalTime(input.retiredAt),
    disabledCallbacks: canonicalURLs(input.disabledCallbacks, "disabledCallbacks", 1, 8, false),
    disabledAppLinks: canonicalURLs(input.disabledAppLinks, "disabledAppLinks", 0, 8, false)
  });
}
function assertClientLifecycleActive(registration) {
  if (registration?.clientLifecycle?.status === "retired") throw new ClientRetiredError(clientRetirementRecord(registration));
  if (registration?.clientLifecycle?.status !== "active") throw new WalletAuthError("INVALID_REGISTRY", "Wallet client lifecycle is invalid");
  return registration;
}
function assertSessionClientActive(session, retiredClients) {
  const retirement = retiredClients.find((record2) => retirementMatchesSession(record2, session));
  if (retirement) throw new ClientRetiredError(retirement);
  return session;
}
function assertClientReturnTargetActive(target2, retiredClients) {
  const candidate2 = parsedTarget(target2, "return target");
  if (!Array.isArray(retiredClients)) throw new WalletAuthError("INVALID_STORE", "retired client policy is invalid");
  const retirement = retiredClients.map(parseClientRetirementRecord).find((record2) => record2.disabledCallbacks.includes(candidate2.toString()) || record2.disabledAppLinks.some((disabled) => targetWithinDisabledRoute(candidate2, new URL(disabled))));
  if (retirement) throw new ClientRetiredError(retirement);
  return candidate2.toString();
}
function retirementMatchesSession(record2, session) {
  return record2.requestingProduct === session.requestingProduct && record2.productClientId === session.productClientId && record2.bundleId === session.bundleId && record2.disabledCallbacks.includes(session.callback);
}
function retirementMatchesAuthorization(record2, request) {
  return record2.requestingProduct === request?.requestingProduct && record2.productClientId === request?.productClientId && record2.bundleId === request?.bundleId && record2.disabledCallbacks.includes(request?.callback);
}
function parsedTarget(value, label) {
  const normalized = token(value, label, /^.{8,512}$/u);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new WalletAuthError("INVALID_CALLBACK", label + " is invalid");
  }
  if (!safeReturnProtocol(parsed.protocol) || parsed.username || parsed.password || parsed.toString() !== normalized) throw new WalletAuthError("INVALID_CALLBACK", label + " must be a canonical YNX or HTTPS URL");
  return parsed;
}
function targetWithinDisabledRoute(candidate2, disabled) {
  if (candidate2.protocol !== disabled.protocol || candidate2.hostname !== disabled.hostname || candidate2.port !== disabled.port) return false;
  const basePath = disabled.pathname === "" ? "/" : disabled.pathname;
  const candidatePath = candidate2.pathname === "" ? "/" : candidate2.pathname;
  return candidatePath === basePath || candidatePath.startsWith(basePath.endsWith("/") ? basePath : basePath + "/");
}
function safeReturnProtocol(protocol) {
  return protocol === "https:" || /^ynx[a-z0-9+.-]*:$/.test(protocol);
}
function canonicalURLs(value, label, minimum, maximum, httpsOnly) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new WalletAuthError("INVALID_REGISTRY", `${label} has an invalid item count`);
  const values = value.map((item) => canonicalURL(item, label, httpsOnly));
  if (new Set(values).size !== values.length || [...values].sort().join("\n") !== values.join("\n")) throw new WalletAuthError("INVALID_REGISTRY", `${label} must be unique and sorted`);
  return Object.freeze(values);
}
function canonicalURL(value, label, httpsOnly) {
  const normalized = token(value, label, /^.{8,512}$/u);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new WalletAuthError("INVALID_REGISTRY", `${label} is invalid`);
  }
  if (httpsOnly && parsed.protocol !== "https:" || !httpsOnly && !safeReturnProtocol(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.toString() !== normalized) {
    throw new WalletAuthError("INVALID_REGISTRY", `${label} must be a canonical ${httpsOnly ? "HTTPS " : ""}URL`);
  }
  return normalized;
}
function canonicalTime(value) {
  const normalized = token(value, "retiredAt", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) throw new WalletAuthError("INVALID_REGISTRY", "retiredAt is invalid");
  return normalized;
}
function token(value, label, pattern13) {
  if (typeof value !== "string" || value.trim() !== value || !pattern13.test(value)) throw new WalletAuthError("INVALID_REGISTRY", `${label} is invalid`);
  return value;
}

// packages/wallet-auth/src/registry.js
var DOCUMENT_FIELDS_V2 = ["registryVersion", "chainId", "products"];
var DOCUMENT_FIELDS = [...DOCUMENT_FIELDS_V2, "retiredClients"];
var PRODUCT_FIELDS_V3 = [
  "schemaVersion",
  "productId",
  "displayName",
  "reviewState",
  "enabled",
  "productClientId",
  "requestingProduct",
  "bundleId",
  "callbacks",
  "scopes",
  "maxScopes",
  "productDeviceAlgorithms",
  "sessionDurationSeconds",
  "revocationPolicy"
];
var PRODUCT_FIELDS_V4 = [...PRODUCT_FIELDS_V3, "webOrigins"];
var PRODUCT_FIELDS_V5 = [...PRODUCT_FIELDS_V4, "clientLifecycle"];
var REVOCATION_FIELDS = ["session", "approval", "device", "accountAllDevices"];
var REVIEW_STATES = /* @__PURE__ */ new Set(["approved", "pending-review", "disabled", "retired"]);
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
var CENTRAL_REGISTRY_DOCUMENT_VERSION = 3;
var CENTRAL_REGISTRY_PRODUCT_COUNT = 26;
var CENTRAL_PRODUCT_SCHEMA_VERSION = 5;
function parseCentralRegistryDocument(input) {
  const sourceVersion = input?.registryVersion;
  const hasRetiredClients = Object.hasOwn(input ?? {}, "retiredClients");
  exactFields(input, sourceVersion === 2 && !hasRetiredClients ? DOCUMENT_FIELDS_V2 : DOCUMENT_FIELDS, "Central Wallet registry document");
  if (![2, CENTRAL_REGISTRY_DOCUMENT_VERSION].includes(sourceVersion) || input.chainId !== YNX_NATIVE_CHAIN_ID || !Array.isArray(input.products) || input.products.length !== CENTRAL_REGISTRY_PRODUCT_COUNT) {
    throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet registry v2 or v3 must contain exactly 26 products for ynx_6423-1");
  }
  const products = parseRegistryProducts(input.products);
  const retiredClients = parseRegistryRetirements(
    sourceVersion === 2 && !hasRetiredClients ? products.filter((product) => product.clientLifecycle.status === "retired").map(clientRetirementRecord) : input.retiredClients,
    products
  );
  return Object.freeze({
    registryVersion: sourceVersion,
    chainId: YNX_NATIVE_CHAIN_ID,
    products,
    retiredClients
  });
}
function migrateCentralRegistryDocumentV1(input) {
  exactFields(input, DOCUMENT_FIELDS_V2, "Central Wallet registry document v1");
  if (input.registryVersion !== 1 || input.chainId !== YNX_NATIVE_CHAIN_ID || !Array.isArray(input.products) || input.products.length !== REGISTRY_V1_PRODUCT_IDS.length) {
    throw new WalletAuthError("INVALID_REGISTRY", `Central Wallet registry v1 must contain exactly ${REGISTRY_V1_PRODUCT_IDS.length} products for ${YNX_NATIVE_CHAIN_ID}`);
  }
  const products = parseRegistryProducts(input.products);
  const ids = products.map((product) => product.productId);
  if (ids.join("\n") !== REGISTRY_V1_PRODUCT_IDS.join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet registry v1 product set is not the accepted migration source");
  }
  const migratedProducts = [...input.products.map((product) => structuredClone(product)), canonicalQuantRegistration()].sort((left, right) => left.productId.localeCompare(right.productId));
  return parseCentralRegistryDocument({
    registryVersion: CENTRAL_REGISTRY_DOCUMENT_VERSION,
    chainId: YNX_NATIVE_CHAIN_ID,
    products: migratedProducts,
    retiredClients: []
  });
}
function parseCentralProductRegistration(input) {
  const sourceVersion = input?.schemaVersion;
  if (sourceVersion === 3) exactFields(input, PRODUCT_FIELDS_V3, "Central Wallet product registration v3");
  else if (sourceVersion === 4) exactFields(input, PRODUCT_FIELDS_V4, "Central Wallet product registration v4");
  else exactFields(input, PRODUCT_FIELDS_V5, "Central Wallet product registration");
  if (![3, 4, CENTRAL_PRODUCT_SCHEMA_VERSION].includes(sourceVersion)) throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet product schema is unsupported");
  if (typeof input.productId !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(input.productId)) throw new WalletAuthError("INVALID_REGISTRY", "productId is invalid");
  if (typeof input.displayName !== "string" || input.displayName.trim() !== input.displayName || input.displayName.length < 2 || input.displayName.length > 64) throw new WalletAuthError("INVALID_REGISTRY", "displayName is invalid");
  if (!REVIEW_STATES.has(input.reviewState) || typeof input.enabled !== "boolean" || input.enabled !== (input.reviewState === "approved")) throw new WalletAuthError("INVALID_REGISTRY", "Only approved registrations may be enabled");
  if (!Number.isInteger(input.sessionDurationSeconds) || input.sessionDurationSeconds < 60 || input.sessionDurationSeconds > 300) throw new WalletAuthError("INVALID_REGISTRY", "Session duration must be between 60 and 300 seconds");
  exactFields(input.revocationPolicy, REVOCATION_FIELDS, "Central Wallet revocation policy");
  if (REVOCATION_FIELDS.some((field) => input.revocationPolicy[field] !== true)) throw new WalletAuthError("INVALID_REGISTRY", "Every central Wallet revocation control is mandatory");
  const webOrigins = sourceVersion === 3 ? Object.freeze([]) : canonicalWebOrigins(input.webOrigins);
  const protocol = parseCentralRegistryEntry({
    schemaVersion: 3,
    productClientId: input.productClientId,
    requestingProduct: input.requestingProduct,
    bundleId: input.bundleId,
    callbacks: input.callbacks,
    scopes: input.scopes,
    maxScopes: input.maxScopes,
    productDeviceAlgorithms: input.productDeviceAlgorithms,
    origins: webOrigins
  });
  const { origins: _origins, ...protocolFields } = protocol;
  const clientLifecycle = sourceVersion < CENTRAL_PRODUCT_SCHEMA_VERSION ? CLIENT_LIFECYCLE_ACTIVE : parseClientLifecycle(input.clientLifecycle, { callbacks: protocol.callbacks });
  if (clientLifecycle.status === "retired" !== (input.reviewState === "retired")) throw new WalletAuthError("INVALID_REGISTRY", "Retired Wallet lifecycle and review state must agree");
  return Object.freeze({
    productId: input.productId,
    displayName: input.displayName,
    reviewState: input.reviewState,
    enabled: input.enabled,
    ...protocolFields,
    schemaVersion: CENTRAL_PRODUCT_SCHEMA_VERSION,
    webOrigins,
    clientLifecycle,
    sessionDurationSeconds: input.sessionDurationSeconds,
    revocationPolicy: Object.freeze({ session: true, approval: true, device: true, accountAllDevices: true })
  });
}
function centralProtocolEntry(registration, options = {}) {
  const product = parseCentralProductRegistration(registration);
  if (options.allowRetired !== true) assertClientLifecycleActive(product);
  if (options.requireEnabled !== false && !product.enabled) throw new WalletAuthError("REGISTRY_DISABLED", `Central Wallet product ${product.productId} is ${product.reviewState}`);
  return Object.freeze({
    schemaVersion: 3,
    productClientId: product.productClientId,
    requestingProduct: product.requestingProduct,
    bundleId: product.bundleId,
    callbacks: product.callbacks,
    origins: product.webOrigins,
    scopes: product.scopes,
    maxScopes: product.maxScopes,
    productDeviceAlgorithms: product.productDeviceAlgorithms
  });
}
function centralRegistrationByProduct(document, productId, options = {}) {
  const registry = parseCentralRegistryDocument(document);
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) throw new WalletAuthError("UNKNOWN_PRODUCT", "Central Wallet product is not registered");
  if (options.requireEnabled !== false && !product.enabled) throw new WalletAuthError("REGISTRY_DISABLED", `Central Wallet product ${product.productId} is ${product.reviewState}`);
  return product;
}
function centralRegisteredWebOrigins(document) {
  const registry = parseCentralRegistryDocument(document);
  return Object.freeze([...new Set(registry.products.filter((product) => product.enabled || product.clientLifecycle.status === "retired").flatMap((product) => product.webOrigins))].sort());
}
function parseRegistryProducts(input) {
  const products = input.map(parseCentralProductRegistration);
  assertUnique(products, "productId");
  assertUnique(products, "productClientId");
  assertUnique(products, "bundleId");
  const callbacks = products.flatMap((product) => product.callbacks);
  if (new Set(callbacks).size !== callbacks.length) throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet callbacks must be globally unique");
  if ([...products].sort((left, right) => left.productId.localeCompare(right.productId)).map((item) => item.productId).join("\n") !== products.map((item) => item.productId).join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet products must be sorted by productId");
  }
  return Object.freeze(products);
}
function parseRegistryRetirements(input, products) {
  if (!Array.isArray(input) || input.length > 1e3) throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet retiredClients has an invalid item count");
  const retiredClients = input.map(parseClientRetirementRecord);
  assertUnique(retiredClients, "clientId");
  assertUnique(retiredClients, "productClientId");
  if ([...retiredClients].sort((left, right) => left.clientId.localeCompare(right.clientId)).map((item) => item.clientId).join("\n") !== retiredClients.map((item) => item.clientId).join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", "Central Wallet retiredClients must be sorted by clientId");
  }
  const activeProducts = products.filter((product) => product.clientLifecycle.status === "active");
  for (const retired of retiredClients) {
    if (!products.some((product) => product.productId === retired.productId)) throw new WalletAuthError("INVALID_REGISTRY", "Retired Wallet client product is not registered");
    if (activeProducts.some((product) => product.productClientId === retired.productClientId)) throw new WalletAuthError("INVALID_REGISTRY", "Retired and active Wallet clients must not share productClientId");
    if (activeProducts.some((product) => product.callbacks.some((callback2) => retired.disabledCallbacks.includes(callback2)))) throw new WalletAuthError("INVALID_REGISTRY", "Retired callbacks must not remain registered by an active Wallet client");
  }
  return Object.freeze(retiredClients);
}
function canonicalQuantRegistration() {
  return {
    // v1 migration is deliberately staged through the historical v3 shape;
    // parseCentralProductRegistration then upgrades it to v4 with no browser
    // origin inferred from a package or deep-link callback.
    schemaVersion: 3,
    productId: "quant",
    displayName: "YNX Quant",
    reviewState: "pending-review",
    enabled: false,
    productClientId: "ynx-quant-v1",
    requestingProduct: "quant",
    bundleId: "com.ynxweb4.quant",
    callbacks: ["ynxquant://wallet-auth/callback"],
    scopes: ["quant:account", "quant:mandate:create", "quant:mandate:execute", "quant:mandate:revoke"],
    maxScopes: 4,
    productDeviceAlgorithms: ["p256-sha256"],
    sessionDurationSeconds: 180,
    revocationPolicy: { session: true, approval: true, device: true, accountAllDevices: true }
  };
}
function assertUnique(products, field) {
  const values = products.map((product) => product[field]);
  if (new Set(values).size !== values.length) throw new WalletAuthError("INVALID_REGISTRY", `Central Wallet ${field} values must be unique`);
}
function canonicalWebOrigins(value) {
  return Object.freeze(stringList2(value, "webOrigins", 0, 8, (origin2) => {
    if (typeof origin2 !== "string" || origin2.length > 255 || origin2.trim() !== origin2) {
      throw new WalletAuthError("INVALID_REGISTRY", "web origin is invalid");
    }
    let parsed;
    try {
      parsed = new URL(origin2);
    } catch {
      throw new WalletAuthError("INVALID_REGISTRY", "web origin is invalid");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.toString() !== `${origin2}/`) {
      throw new WalletAuthError("INVALID_REGISTRY", "web origin must be a canonical HTTPS origin");
    }
    return origin2;
  }));
}
function stringList2(value, label, minimum, maximum, normalize2) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new WalletAuthError("INVALID_REGISTRY", `${label} has an invalid item count`);
  }
  const values = value.map(normalize2);
  if (new Set(values).size !== values.length || [...values].sort().join("\n") !== values.join("\n")) {
    throw new WalletAuthError("INVALID_REGISTRY", `${label} must be unique and sorted`);
  }
  return values;
}

// packages/wallet-auth/src/lifecycle.js
var SNAPSHOT_V1_FIELDS = [
  "schemaVersion",
  "consumedNonces",
  "consumedRequestDigests",
  "consumedChallenges",
  "sessions",
  "revokedSessionBindings",
  "revokedApprovalDigests",
  "revokedDeviceBindings",
  "accountLogoutRecords",
  "audit"
];
var SNAPSHOT_FIELDS = [...SNAPSHOT_V1_FIELDS, "retiredClients"];
var AUDIT_FIELDS = ["sequence", "type", "subject", "at", "previousHash", "hash"];
var INTROSPECTION_FIELDS = ["productClientId", "bundleId", "origin", "productDeviceKey", "requiredScopes"];
var CENTRAL_WALLET_SESSION_INVENTORY_SCHEMA_VERSION = 1;
var CENTRAL_WALLET_SESSION_STORE_SCHEMA_VERSION = 2;
var CentralWalletSessionStore = class {
  #state;
  constructor(snapshot3 = emptySnapshot()) {
    this.#state = parseSnapshot(snapshot3);
  }
  complete(input, at = /* @__PURE__ */ new Date()) {
    validDate3(at);
    const before = this.snapshot();
    const session = verifyCentralWalletSession(input, at);
    assertSessionClientActive(session, this.#state.retiredClients);
    const challenge = input.gatewayCompletion.challenge.challenge;
    if (this.#state.consumedNonces.includes(session.nonce) || this.#state.consumedRequestDigests.includes(session.requestDigest) || this.#state.consumedChallenges.includes(challenge) || this.#state.sessions.some((item) => item.sessionBinding === session.sessionBinding)) {
      throw new WalletAuthError("REPLAY", "Wallet authorization or Gateway challenge was already consumed");
    }
    try {
      const next = cloneSnapshot(this.#state);
      next.consumedNonces.push(session.nonce);
      next.consumedRequestDigests.push(session.requestDigest);
      next.consumedChallenges.push(challenge);
      next.sessions.push(session);
      sortState(next);
      appendAudit(next, "session-created", session.sessionBinding, at);
      this.#state = parseSnapshot(next);
      return session;
    } catch (error) {
      this.#state = parseSnapshot(before);
      throw error;
    }
  }
  introspect(sessionBinding, context, at = /* @__PURE__ */ new Date()) {
    exactFields(context, INTROSPECTION_FIELDS, "Central Wallet introspection context");
    const session = this.#state.sessions.find((item) => item.sessionBinding === strictDigest(sessionBinding, "sessionBinding"));
    if (!session) throw new WalletAuthError("SESSION_NOT_FOUND", "Wallet product session was not found");
    assertSessionClientActive(session, this.#state.retiredClients);
    const active2 = assertCentralWalletSessionActive(session, this.revocationState(), at);
    if (context.productClientId !== active2.productClientId || context.bundleId !== active2.bundleId || context.origin !== active2.origin || context.productDeviceKey !== active2.productDeviceKey) throw new WalletAuthError("CROSS_APP_REUSE", "Wallet product session cannot be reused by another App, origin, or device");
    const required = sortedStrings(context.requiredScopes, "requiredScopes", 1, 8, /^[a-z][a-z0-9._:-]{1,63}$/);
    if (required.some((scope2) => !active2.scopes.includes(scope2))) throw new WalletAuthError("SCOPE_NOT_ALLOWED", "Wallet product session lacks a required scope");
    return Object.freeze({ active: true, session: active2 });
  }
  inventory(account, at = /* @__PURE__ */ new Date()) {
    const normalized = strictAccount(account);
    const asOf = validDate3(at).toISOString();
    const sessions = this.#state.sessions.filter((session) => session.account === normalized).map((session) => inventorySession(session, this.#state, asOf));
    return Object.freeze({
      schemaVersion: CENTRAL_WALLET_SESSION_INVENTORY_SCHEMA_VERSION,
      account: normalized,
      asOf,
      connectedApps: groupConnectedApps(sessions),
      approvals: groupApprovals(sessions, this.#state.revokedApprovalDigests),
      devices: groupDevices(sessions, this.#state.revokedDeviceBindings),
      sessions: Object.freeze(sessions)
    });
  }
  revokeSession(sessionBinding, at = /* @__PURE__ */ new Date()) {
    return this.#revoke("revokedSessionBindings", strictDigest(sessionBinding, "sessionBinding"), "session-revoked", at);
  }
  revokeApproval(approvalDigest, at = /* @__PURE__ */ new Date()) {
    return this.#revoke("revokedApprovalDigests", strictDigest(approvalDigest, "approvalDigest"), "approval-revoked", at);
  }
  revokeDevice(deviceBinding2, at = /* @__PURE__ */ new Date()) {
    return this.#revoke("revokedDeviceBindings", strictDigest(deviceBinding2, "deviceBinding"), "device-revoked", at);
  }
  retireClient(registration, at = /* @__PURE__ */ new Date()) {
    validDate3(at);
    const retirement = retirementRecord(registration);
    const existing = this.#state.retiredClients.find((record2) => record2.clientId === retirement.clientId);
    if (existing) {
      if (digestHex("YNX_WALLET_CLIENT_RETIREMENT_V1", existing) !== digestHex("YNX_WALLET_CLIENT_RETIREMENT_V1", retirement)) throw new WalletAuthError("INVALID_STORE", "Wallet client retirement record conflicts with persisted state");
      return retirementResult(retirement, [], [], [], false);
    }
    const sessions = this.#state.sessions.filter((session) => retirementMatchesSession(retirement, session));
    const sessionBindings = sessions.map((session) => session.sessionBinding);
    const approvalDigests = sessions.map((session) => session.approvalDigest);
    const deviceBindings = sessions.map((session) => session.deviceBinding);
    const next = cloneSnapshot(this.#state);
    next.retiredClients.push(retirement);
    next.revokedSessionBindings = uniqueSorted([...next.revokedSessionBindings, ...sessionBindings]);
    next.revokedApprovalDigests = uniqueSorted([...next.revokedApprovalDigests, ...approvalDigests]);
    next.revokedDeviceBindings = uniqueSorted([...next.revokedDeviceBindings, ...deviceBindings]);
    sortState(next);
    appendAudit(next, "client-retired", digestHex("YNX_WALLET_CLIENT_RETIREMENT_V1", retirement), at);
    this.#state = parseSnapshot(next);
    return retirementResult(retirement, sessionBindings, approvalDigests, deviceBindings, true);
  }
  logoutAllDevices(account, at = /* @__PURE__ */ new Date()) {
    const before = strictTime4(validDate3(at).toISOString(), "before");
    const normalized = strictAccount(account);
    const next = cloneSnapshot(this.#state);
    next.accountLogoutRecords = next.accountLogoutRecords.filter((record2) => record2.account !== normalized);
    next.accountLogoutRecords.push({ account: normalized, before });
    sortState(next);
    appendAudit(next, "account-all-devices-logout", digestHex("YNX_WALLET_ACCOUNT_LOGOUT_V1", { account: normalized, before }), at);
    this.#state = parseSnapshot(next);
    return Object.freeze({ account: normalized, before });
  }
  revocationState() {
    return Object.freeze({
      revokedSessionBindings: this.#state.revokedSessionBindings,
      revokedApprovalDigests: this.#state.revokedApprovalDigests,
      revokedDeviceBindings: this.#state.revokedDeviceBindings,
      accountLogoutRecords: this.#state.accountLogoutRecords
    });
  }
  snapshot() {
    return freezeSnapshot(cloneSnapshot(this.#state));
  }
  #revoke(field, digest7, type, at) {
    validDate3(at);
    if (this.#state[field].includes(digest7)) throw new WalletAuthError("ALREADY_REVOKED", "Wallet revocation was already recorded");
    const next = cloneSnapshot(this.#state);
    next[field].push(digest7);
    sortState(next);
    appendAudit(next, type, digest7, at);
    this.#state = parseSnapshot(next);
    return digest7;
  }
};
function parseCentralWalletStoreSnapshot(input) {
  return parseSnapshot(input);
}
function emptySnapshot() {
  return { schemaVersion: CENTRAL_WALLET_SESSION_STORE_SCHEMA_VERSION, consumedNonces: [], consumedRequestDigests: [], consumedChallenges: [], sessions: [], revokedSessionBindings: [], revokedApprovalDigests: [], revokedDeviceBindings: [], accountLogoutRecords: [], retiredClients: [], audit: [] };
}
function parseSnapshot(input) {
  const sourceVersion = input?.schemaVersion;
  exactFields(input, sourceVersion === 1 ? SNAPSHOT_V1_FIELDS : SNAPSHOT_FIELDS, "Central Wallet session store snapshot");
  if (sourceVersion !== 1 && sourceVersion !== CENTRAL_WALLET_SESSION_STORE_SCHEMA_VERSION) throw new WalletAuthError("INVALID_STORE", "Central Wallet session store schema is unsupported");
  const snapshot3 = {
    schemaVersion: CENTRAL_WALLET_SESSION_STORE_SCHEMA_VERSION,
    consumedNonces: sortedStrings(input.consumedNonces, "consumedNonces", 0, 1e4, /^[A-Za-z0-9_-]{32,64}$/),
    consumedRequestDigests: sortedStrings(input.consumedRequestDigests, "consumedRequestDigests", 0, 1e4, /^[0-9a-f]{64}$/),
    consumedChallenges: sortedStrings(input.consumedChallenges, "consumedChallenges", 0, 1e4, /^[A-Za-z0-9_-]{16,128}$/),
    sessions: parseSessions(input.sessions),
    revokedSessionBindings: sortedStrings(input.revokedSessionBindings, "revokedSessionBindings", 0, 1e4, /^[0-9a-f]{64}$/),
    revokedApprovalDigests: sortedStrings(input.revokedApprovalDigests, "revokedApprovalDigests", 0, 1e4, /^[0-9a-f]{64}$/),
    revokedDeviceBindings: sortedStrings(input.revokedDeviceBindings, "revokedDeviceBindings", 0, 1e4, /^[0-9a-f]{64}$/),
    accountLogoutRecords: parseLogoutRecords(input.accountLogoutRecords),
    retiredClients: sourceVersion === 1 ? Object.freeze([]) : parseRetiredClients(input.retiredClients),
    audit: parseAudit(input.audit)
  };
  if (snapshot3.sessions.length !== snapshot3.consumedNonces.length || snapshot3.sessions.length !== snapshot3.consumedRequestDigests.length || snapshot3.sessions.length !== snapshot3.consumedChallenges.length || snapshot3.sessions.some((session) => !snapshot3.consumedNonces.includes(session.nonce) || !snapshot3.consumedRequestDigests.includes(session.requestDigest))) {
    throw new WalletAuthError("INVALID_STORE", "Consumed authorization records must exactly cover stored sessions");
  }
  return freezeSnapshot(snapshot3);
}
function parseSessions(value) {
  if (!Array.isArray(value) || value.length > 1e4) throw new WalletAuthError("INVALID_STORE", "sessions has an invalid item count");
  const sessions = value.map(parseCentralWalletSession);
  const keys = sessions.map((session) => session.sessionBinding);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) throw new WalletAuthError("INVALID_STORE", "sessions must be unique and sorted");
  return sessions;
}
function parseLogoutRecords(value) {
  if (!Array.isArray(value) || value.length > 1e4) throw new WalletAuthError("INVALID_STORE", "accountLogoutRecords has an invalid item count");
  const records = value.map((record2) => {
    exactFields(record2, ["account", "before"], "Wallet account logout record");
    return Object.freeze({ account: strictAccount(record2.account), before: strictTime4(record2.before, "before") });
  });
  const keys = records.map((record2) => `${record2.account}:${record2.before}`);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) throw new WalletAuthError("INVALID_STORE", "accountLogoutRecords must be unique and sorted");
  return records;
}
function parseRetiredClients(value) {
  if (!Array.isArray(value) || value.length > 1e3) throw new WalletAuthError("INVALID_STORE", "retiredClients has an invalid item count");
  const records = value.map(parseClientRetirementRecord);
  const keys = records.map((record2) => record2.clientId);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) throw new WalletAuthError("INVALID_STORE", "retiredClients must be unique and sorted");
  return Object.freeze(records);
}
function parseAudit(value) {
  if (!Array.isArray(value) || value.length > 2e4) throw new WalletAuthError("INVALID_STORE", "audit has an invalid item count");
  let previousHash = null;
  return value.map((event, index) => {
    exactFields(event, AUDIT_FIELDS, "Central Wallet audit event");
    const unsigned3 = { sequence: event.sequence, type: event.type, subject: event.subject, at: event.at, previousHash: event.previousHash };
    if (event.sequence !== index + 1 || typeof event.type !== "string" || !/^[a-z][a-z-]{2,63}$/.test(event.type) || typeof event.subject !== "string" || event.subject.length < 1 || event.subject.length > 128 || strictTime4(event.at, "audit at") !== event.at || event.previousHash !== previousHash || event.hash !== digestHex("YNX_WALLET_CENTRAL_AUDIT_V1", unsigned3)) throw new WalletAuthError("INVALID_STORE", "Central Wallet audit hash chain is invalid");
    previousHash = event.hash;
    return Object.freeze(event);
  });
}
function appendAudit(state2, type, subject, at) {
  const unsigned3 = { sequence: state2.audit.length + 1, type, subject, at: validDate3(at).toISOString(), previousHash: state2.audit.at(-1)?.hash ?? null };
  state2.audit.push(Object.freeze({ ...unsigned3, hash: digestHex("YNX_WALLET_CENTRAL_AUDIT_V1", unsigned3) }));
}
function inventorySession(session, state2, asOf) {
  const inactiveReasons = [];
  if (session.verifierVersion !== "wallet-auth-v2") inactiveReasons.push("origin-binding-retired");
  if (session.issuedAt > asOf) inactiveReasons.push("issued-in-future");
  if (session.expiresAt <= asOf) inactiveReasons.push("expired");
  if (state2.revokedSessionBindings.includes(session.sessionBinding)) inactiveReasons.push("session-revoked");
  if (state2.revokedApprovalDigests.includes(session.approvalDigest)) inactiveReasons.push("approval-revoked");
  if (state2.revokedDeviceBindings.includes(session.deviceBinding)) inactiveReasons.push("device-revoked");
  if (state2.accountLogoutRecords.some((record2) => record2.account === session.account && session.issuedAt <= record2.before)) inactiveReasons.push("account-logout");
  if (state2.retiredClients.some((record2) => retirementMatchesSession(record2, session))) inactiveReasons.push("client-retired");
  return Object.freeze({
    sessionBinding: session.sessionBinding,
    requestingProduct: session.requestingProduct,
    productClientId: session.productClientId,
    bundleId: session.bundleId,
    origin: session.origin ?? null,
    callback: session.callback,
    productDeviceAlgorithm: session.productDeviceAlgorithm,
    productDeviceKey: session.productDeviceKey,
    deviceBinding: session.deviceBinding,
    approvalDigest: session.approvalDigest,
    scopes: Object.freeze([...session.scopes]),
    purpose: session.purpose,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    active: inactiveReasons.length === 0,
    inactiveReasons: Object.freeze(inactiveReasons)
  });
}
function groupConnectedApps(sessions) {
  const groups = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const key = `${session.productClientId}
${session.bundleId}`;
    const current = groups.get(key) ?? {
      requestingProduct: session.requestingProduct,
      productClientId: session.productClientId,
      bundleId: session.bundleId,
      sessionBindings: [],
      activeSessionBindings: [],
      approvalDigests: [],
      deviceBindings: []
    };
    current.sessionBindings.push(session.sessionBinding);
    if (session.active) current.activeSessionBindings.push(session.sessionBinding);
    current.approvalDigests.push(session.approvalDigest);
    current.deviceBindings.push(session.deviceBinding);
    groups.set(key, current);
  }
  return freezeGrouped(groups, (group) => ({ ...group, active: group.activeSessionBindings.length > 0 }));
}
function groupApprovals(sessions, revokedApprovalDigests) {
  const groups = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const current = groups.get(session.approvalDigest) ?? {
      approvalDigest: session.approvalDigest,
      requestingProduct: session.requestingProduct,
      productClientId: session.productClientId,
      bundleId: session.bundleId,
      sessionBindings: [],
      activeSessionBindings: []
    };
    current.sessionBindings.push(session.sessionBinding);
    if (session.active) current.activeSessionBindings.push(session.sessionBinding);
    groups.set(session.approvalDigest, current);
  }
  return freezeGrouped(groups, (group) => ({ ...group, revoked: revokedApprovalDigests.includes(group.approvalDigest) }));
}
function groupDevices(sessions, revokedDeviceBindings) {
  const groups = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const current = groups.get(session.deviceBinding) ?? {
      deviceBinding: session.deviceBinding,
      requestingProduct: session.requestingProduct,
      productClientId: session.productClientId,
      bundleId: session.bundleId,
      productDeviceAlgorithm: session.productDeviceAlgorithm,
      productDeviceKey: session.productDeviceKey,
      sessionBindings: [],
      activeSessionBindings: []
    };
    current.sessionBindings.push(session.sessionBinding);
    if (session.active) current.activeSessionBindings.push(session.sessionBinding);
    groups.set(session.deviceBinding, current);
  }
  return freezeGrouped(groups, (group) => ({ ...group, revoked: revokedDeviceBindings.includes(group.deviceBinding) }));
}
function freezeGrouped(groups, finalize) {
  const output = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, group]) => Object.freeze(finalize({
    ...group,
    sessionBindings: Object.freeze(uniqueSorted(group.sessionBindings)),
    activeSessionBindings: Object.freeze(uniqueSorted(group.activeSessionBindings)),
    ...group.approvalDigests ? { approvalDigests: Object.freeze(uniqueSorted(group.approvalDigests)) } : {},
    ...group.deviceBindings ? { deviceBindings: Object.freeze(uniqueSorted(group.deviceBindings)) } : {}
  })));
  return Object.freeze(output);
}
function uniqueSorted(values) {
  return [...new Set(values)].sort();
}
function sortState(state2) {
  for (const field of ["consumedNonces", "consumedRequestDigests", "consumedChallenges", "revokedSessionBindings", "revokedApprovalDigests", "revokedDeviceBindings"]) state2[field].sort();
  state2.sessions.sort((a, b) => a.sessionBinding.localeCompare(b.sessionBinding));
  state2.accountLogoutRecords.sort((a, b) => `${a.account}:${a.before}`.localeCompare(`${b.account}:${b.before}`));
  state2.retiredClients.sort((a, b) => a.clientId.localeCompare(b.clientId));
}
function cloneSnapshot(state2) {
  return JSON.parse(JSON.stringify(state2));
}
function freezeSnapshot(state2) {
  return Object.freeze({ ...state2, consumedNonces: Object.freeze(state2.consumedNonces), consumedRequestDigests: Object.freeze(state2.consumedRequestDigests), consumedChallenges: Object.freeze(state2.consumedChallenges), sessions: Object.freeze(state2.sessions), revokedSessionBindings: Object.freeze(state2.revokedSessionBindings), revokedApprovalDigests: Object.freeze(state2.revokedApprovalDigests), revokedDeviceBindings: Object.freeze(state2.revokedDeviceBindings), accountLogoutRecords: Object.freeze(state2.accountLogoutRecords), retiredClients: Object.freeze(state2.retiredClients), audit: Object.freeze(state2.audit) });
}
function retirementResult(retirement, sessionBindings, approvalDigests, deviceBindings, changed) {
  return Object.freeze({ clientId: retirement.clientId, changed, revokedSessionBindings: Object.freeze(uniqueSorted(sessionBindings)), revokedApprovalDigests: Object.freeze(uniqueSorted(approvalDigests)), revokedDeviceBindings: Object.freeze(uniqueSorted(deviceBindings)) });
}
function sortedStrings(value, label, min, max, pattern13) {
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== "string" || !pattern13.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) throw new WalletAuthError("INVALID_STORE", `${label} must be bounded, unique and sorted`);
  return [...value];
}
function strictDigest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new WalletAuthError("INVALID_STORE", `${label} is invalid`);
  return value;
}
function strictAccount(value) {
  if (typeof value !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value)) throw new WalletAuthError("INVALID_STORE", "account is invalid");
  return value;
}
function strictTime4(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) throw new WalletAuthError("INVALID_STORE", `${label} is invalid`);
  return value;
}
function validDate3(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new WalletAuthError("INVALID_TIME", "Central Wallet time is invalid");
  return value;
}

// packages/wallet-auth/src/native-transfer.js
var TRANSACTION_FIELDS = ["version", "chainId", "type", "from", "to", "amount", "fee", "nonce", "publicKey", "signature"];
var CREATE_FIELDS = ["accountSecret", "to", "amount", "nonce"];
var NATIVE_TRANSACTION_DOMAIN = "YNX_NATIVE_TX_V1";
var NATIVE_TRANSACTION_CHAIN_ID = 6423;
var NATIVE_TRANSACTION_FEE_YNXT = 1;
function createSignedNativeTransfer(input) {
  exactFields(input, CREATE_FIELDS, "Native transfer input");
  const secret = secretBytes(input.accountSecret);
  const identity = walletIdentity(input.accountSecret);
  const unsigned3 = { version: 1, chainId: NATIVE_TRANSACTION_CHAIN_ID, type: "transfer", from: evmAddressFromYNX(identity.account), to: evmAddressFromYNX(input.to), amount: positiveSafeInteger(input.amount, "amount"), fee: NATIVE_TRANSACTION_FEE_YNXT, nonce: positiveSafeInteger(input.nonce, "nonce"), publicKey: identity.accountPublicKey };
  if (unsigned3.from === unsigned3.to) throw new WalletAuthError("INVALID_TRANSFER", "Native transfer sender and recipient must differ");
  const digest7 = sha256(utf8ToBytes(nativeTransferSignJSON(unsigned3)));
  const signature = bytesToHex(secp256k1.sign(digest7, secret, { prehash: false, format: "der", lowS: true }));
  const transaction = parseSignedNativeTransfer({ ...unsigned3, signature });
  const payload = JSON.stringify(transaction);
  return Object.freeze({ transaction, payload, hash: nativeTransferHash(payload) });
}
function parseSignedNativeTransfer(input) {
  let raw = null, value = input;
  if (typeof input === "string") {
    raw = input;
    try {
      value = JSON.parse(input);
    } catch {
      throw new WalletAuthError("INVALID_TRANSFER", "Native transfer JSON is invalid");
    }
  }
  exactFields(value, TRANSACTION_FIELDS, "Signed native transfer");
  const transaction = { version: exactInteger(value.version, "version", 1), chainId: exactInteger(value.chainId, "chainId", NATIVE_TRANSACTION_CHAIN_ID), type: exactString(value.type, "type", /^transfer$/), from: exactString(value.from, "from", /^0x[0-9a-f]{40}$/), to: exactString(value.to, "to", /^0x[0-9a-f]{40}$/), amount: positiveSafeInteger(value.amount, "amount"), fee: exactInteger(value.fee, "fee", NATIVE_TRANSACTION_FEE_YNXT), nonce: positiveSafeInteger(value.nonce, "nonce"), publicKey: exactString(value.publicKey, "publicKey", /^(02|03)[0-9a-f]{64}$/), signature: exactString(value.signature, "signature", /^30[0-9a-f]{134,142}$/) };
  if (transaction.from === transaction.to) throw new WalletAuthError("INVALID_TRANSFER", "Native transfer sender and recipient must differ");
  let valid = false;
  try {
    const derived = evmAddressFromYNX(walletIdentityFromPublicKey(transaction.publicKey));
    valid = derived === transaction.from && secp256k1.verify(hexToBytes(transaction.signature), sha256(utf8ToBytes(nativeTransferSignJSON(transaction))), hexToBytes(transaction.publicKey), { prehash: false, format: "der", lowS: true });
  } catch {
    valid = false;
  }
  if (!valid) throw new WalletAuthError("INVALID_TRANSFER_SIGNATURE", "Native transfer signature is invalid");
  const frozen2 = Object.freeze(transaction);
  if (raw !== null && raw !== JSON.stringify(frozen2)) throw new WalletAuthError("INVALID_TRANSFER", "Native transfer JSON is not canonical");
  return frozen2;
}
function nativeTransferSignJSON(transaction) {
  return JSON.stringify({ domain: NATIVE_TRANSACTION_DOMAIN, version: transaction.version, chainId: transaction.chainId, type: transaction.type, from: transaction.from, to: transaction.to, amount: transaction.amount, fee: transaction.fee, nonce: transaction.nonce, publicKey: transaction.publicKey });
}
function nativeTransferHash(payload) {
  const parsed = parseSignedNativeTransfer(payload);
  const canonical = JSON.stringify(parsed);
  return `0x${bytesToHex(sha256(utf8ToBytes(canonical)))}`;
}
function secretBytes(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new WalletAuthError("INVALID_SECRET", "Wallet account secret must be 32-byte lowercase hex");
  }
  const secret = hexToBytes(value);
  if (!secp256k1.utils.isValidSecretKey(secret)) throw new WalletAuthError("INVALID_SECRET", "Wallet account secret is outside the secp256k1 range");
  return secret;
}
function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new WalletAuthError("INVALID_TRANSFER", `${label} must be a positive safe integer`);
  return value;
}
function exactInteger(value, label, expected) {
  if (value !== expected) throw new WalletAuthError("INVALID_TRANSFER", `${label} must equal ${expected}`);
  return value;
}
function exactString(value, label, pattern13) {
  if (typeof value !== "string" || value.trim() !== value || !pattern13.test(value)) throw new WalletAuthError("INVALID_TRANSFER", `${label} is invalid`);
  return value;
}

// packages/wallet-auth/src/application-action.js
var APPLICATION_ACTION_DOMAIN = "YNX_APPLICATION_ACTION_V1";
var APPLICATION_ACTION_CHAIN_ID = 6423;
var APPLICATION_ACTION_FEE_YNXT = 1;
var MAX_ENVELOPE_BYTES = 16 * 1024;
var MAX_PAYLOAD_BYTES = 8 * 1024;
var UNSIGNED_FIELDS = ["version", "chainId", "type", "signer", "nonce", "action", "payload", "payloadHash", "fee", "aiUnits", "payUnits", "publicKey"];
var SIGNED_FIELDS = [...UNSIGNED_FIELDS, "signature"];
var PAYLOAD_FIELDS = Object.freeze({
  dex_swap_exact_input: ["poolId", "assetIn", "amountIn", "minAmountOut", "deadlineUnix"],
  dex_swap_exact_output: ["poolId", "assetOut", "amountOut", "maxAmountIn", "deadlineUnix"],
  dex_liquidity_add: ["poolId", "amount0", "amount1", "minShares", "deadlineUnix"],
  dex_liquidity_remove: ["poolId", "shares", "minAmount0", "minAmount1", "deadlineUnix"]
});
function createSignedApplicationAction(input) {
  const fields4 = dataFields(input, ["accountSecret", "action", "payload", "nonce"], "Application action input");
  const action2 = actionName(fields4.action);
  const payload = businessPayload(action2, fields4.payload);
  const nonce = safeInteger(fields4.nonce, "nonce", 1);
  const secret = secretBytes2(fields4.accountSecret);
  try {
    const publicKey = bytesToHex(secp256k1.getPublicKey(secret, true));
    const unsigned3 = unsignedAction({
      version: 1,
      chainId: APPLICATION_ACTION_CHAIN_ID,
      type: "application_action",
      signer: evmAddressFromYNX(walletIdentityFromPublicKey(publicKey)),
      nonce,
      action: action2,
      payload,
      payloadHash: hashHex(JSON.stringify(payload)),
      fee: APPLICATION_ACTION_FEE_YNXT,
      aiUnits: 0,
      payUnits: 0,
      publicKey
    });
    const digest7 = sha256(utf8ToBytes(signJSON(unsigned3)));
    const signature = bytesToHex(secp256k1.sign(digest7, secret, { prehash: false, format: "der", lowS: true }));
    const transaction = parseSignedApplicationAction({ ...unsigned3, signature });
    const encoded = JSON.stringify(transaction);
    return Object.freeze({ transaction, payload: encoded, hash: `0x${hashHex(encoded)}` });
  } finally {
    secret.fill(0);
  }
}
function parseSignedApplicationAction(input) {
  let value = input;
  const raw = typeof input === "string" ? input : null;
  if (raw !== null) {
    boundedJSON(raw, MAX_ENVELOPE_BYTES, "Application action envelope");
    try {
      value = JSON.parse(raw);
    } catch {
      throw invalid("Application action JSON is invalid");
    }
  }
  const fields4 = dataFields(value, SIGNED_FIELDS, "Signed application action");
  const unsigned3 = unsignedAction(fields4);
  const signature = exactString2(fields4.signature, "signature", /^30(?:[0-9a-f]{2}){7,71}$/);
  const transaction = Object.freeze({ ...unsigned3, signature });
  const canonical = JSON.stringify(transaction);
  boundedJSON(canonical, MAX_ENVELOPE_BYTES, "Application action envelope");
  if (raw !== null && raw !== canonical) throw invalid("Application action JSON is not canonical");
  let valid = false;
  try {
    valid = evmAddressFromYNX(walletIdentityFromPublicKey(unsigned3.publicKey)) === unsigned3.signer && secp256k1.verify(hexToBytes(signature), sha256(utf8ToBytes(signJSON(unsigned3))), hexToBytes(unsigned3.publicKey), { prehash: false, format: "der", lowS: true });
  } catch {
    valid = false;
  }
  if (!valid) throw new WalletAuthError("INVALID_APPLICATION_ACTION_SIGNATURE", "Application action signature or signer is invalid");
  return transaction;
}
function verifySignedApplicationAction(input, expected) {
  const context = dataFields(expected, ["account", "action", "payload", "nonce"], "Application action binding");
  const account = evmAddressFromYNX(context.account);
  const action2 = actionName(context.action);
  const payload = businessPayload(action2, context.payload);
  const nonce = safeInteger(context.nonce, "nonce", 1);
  const transaction = parseSignedApplicationAction(input);
  if (transaction.signer !== account || transaction.action !== action2 || transaction.nonce !== nonce || JSON.stringify(transaction.payload) !== JSON.stringify(payload)) {
    throw new WalletAuthError("BINDING_MISMATCH", "Application action does not match the exact reviewed account, action, payload and nonce");
  }
  return transaction;
}
function applicationActionSignJSON(transaction) {
  const signed = transaction !== null && typeof transaction === "object" && Object.hasOwn(transaction, "signature");
  return signJSON(unsignedAction(dataFields(transaction, signed ? SIGNED_FIELDS : UNSIGNED_FIELDS, "Application action sign document")));
}
function applicationActionPayloadHash(action2, payload) {
  return hashHex(JSON.stringify(businessPayload(actionName(action2), payload)));
}
function applicationActionHash(input) {
  return `0x${hashHex(JSON.stringify(parseSignedApplicationAction(input)))}`;
}
function unsignedAction(value) {
  const action2 = actionName(value.action);
  const payload = businessPayload(action2, value.payload);
  const payloadHash = exactString2(value.payloadHash, "payloadHash", /^[0-9a-f]{64}$/);
  if (payloadHash !== hashHex(JSON.stringify(payload))) throw invalid("Application action payload hash mismatch");
  return {
    version: exactNumber(value.version, "version", 1),
    chainId: exactNumber(value.chainId, "chainId", APPLICATION_ACTION_CHAIN_ID),
    type: exactString2(value.type, "type", /^application_action$/),
    signer: exactString2(value.signer, "signer", /^0x[0-9a-f]{40}$/),
    nonce: safeInteger(value.nonce, "nonce", 1),
    action: action2,
    payload,
    payloadHash,
    fee: exactNumber(value.fee, "fee", APPLICATION_ACTION_FEE_YNXT),
    aiUnits: exactNumber(value.aiUnits, "aiUnits", 0),
    payUnits: exactNumber(value.payUnits, "payUnits", 0),
    publicKey: exactString2(value.publicKey, "publicKey", /^(02|03)[0-9a-f]{64}$/)
  };
}
function signJSON(unsigned3) {
  return JSON.stringify({ domain: APPLICATION_ACTION_DOMAIN, ...unsigned3 });
}
function businessPayload(action2, input) {
  const fields4 = dataFields(input, PAYLOAD_FIELDS[action2], "DEX business payload");
  const result = {};
  for (const key of PAYLOAD_FIELDS[action2]) {
    const value = fields4[key];
    if (key === "poolId") result[key] = exactString2(value, key, /^dex_[a-z0-9][a-z0-9_-]{2,59}$/);
    else if (key === "assetIn" || key === "assetOut") {
      result[key] = exactString2(value, key, /^(?:YNXT|[a-z][a-z0-9-]{2,31})$/);
      if (value === "ynxt") throw invalid(`${key} must use the canonical native asset ID YNXT`);
    } else result[key] = safeInteger(value, key, key === "minAmount0" || key === "minAmount1" ? 0 : 1);
  }
  boundedJSON(JSON.stringify(result), MAX_PAYLOAD_BYTES, "DEX business payload");
  return Object.freeze(result);
}
function actionName(value) {
  if (typeof value !== "string" || !Object.hasOwn(PAYLOAD_FIELDS, value)) throw invalid("Unsupported application action; only DEX swap and liquidity actions are enabled");
  return value;
}
function dataFields(value, expected, label) {
  exactFields(value, expected, label);
  if (Reflect.ownKeys(value).length !== expected.length) throw invalid(`${label} must contain only protocol data fields`);
  const snapshot3 = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw invalid(`${label} must contain data properties`);
    snapshot3[key] = descriptor.value;
  }
  return snapshot3;
}
function secretBytes2(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new WalletAuthError("INVALID_SECRET", "Wallet account secret must be 32-byte lowercase hex");
  const secret = hexToBytes(value);
  if (!secp256k1.utils.isValidSecretKey(secret)) {
    secret.fill(0);
    throw new WalletAuthError("INVALID_SECRET", "Wallet account secret is outside the secp256k1 range");
  }
  return secret;
}
function safeInteger(value, label, minimum) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum) throw invalid(`${label} must be a safe integer greater than or equal to ${minimum}`);
  return value;
}
function exactNumber(value, label, expected) {
  if (!Object.is(value, expected)) throw invalid(`${label} must equal ${expected}`);
  return value;
}
function exactString2(value, label, pattern13) {
  if (typeof value !== "string" || value.trim() !== value || !pattern13.test(value)) throw invalid(`${label} is invalid`);
  return value;
}
function boundedJSON(value, max, label) {
  if (!value.length || value.length > max || utf8ToBytes(value).length > max) throw invalid(`${label} must be between 1 and ${max} bytes`);
}
function hashHex(value) {
  return bytesToHex(sha256(utf8ToBytes(value)));
}
function invalid(message) {
  return new WalletAuthError("INVALID_APPLICATION_ACTION", message);
}

// packages/wallet-auth/src/product-session-registry.js
var PRODUCT_SESSION_REGISTRY_VERSION = 2;
var PRODUCT_SESSION_PLATFORMS = Object.freeze(["android", "ios", "linux", "macos", "web", "windows"]);
var DOCUMENT_FIELDS2 = ["schemaVersion", "chainId", "wallet", "products"];
var WALLET_FIELDS = ["authorizeCallback", "downloadUrl", "metaMaskDownloadUrl"];
var WALLET_V1_FIELDS = ["authorizeCallback", "downloadUrl"];
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
var FORBIDDEN_CALLBACK_SCHEMES = /* @__PURE__ */ new Set(["data:", "file:", "http:", "javascript:"]);
function parseProductSessionRegistry(input) {
  exactFields(input, DOCUMENT_FIELDS2, "Product Session router registry");
  if (input.schemaVersion !== PRODUCT_SESSION_REGISTRY_VERSION || input.chainId !== "ynx_6423-1") {
    fail("INVALID_ROUTER_REGISTRY", "Product Session router registry version or chain is unsupported");
  }
  exactFields(input.wallet, WALLET_FIELDS, "Product Session Wallet registration");
  const authorizeCallback = callback(input.wallet.authorizeCallback, "wallet authorize callback", { allowHttps: false });
  const authorize = new URL(authorizeCallback);
  if (authorize.protocol !== "ynxwallet:" || authorize.hostname !== "authorize" || authorize.pathname !== "") {
    fail("INVALID_ROUTER_REGISTRY", "Wallet authorize callback must be ynxwallet://authorize");
  }
  const downloadUrl = httpsURL(input.wallet.downloadUrl, "Wallet download URL", false);
  const metaMaskDownloadUrl = httpsURL(input.wallet.metaMaskDownloadUrl, "MetaMask download URL", false);
  if (downloadUrl !== "https://www.ynxweb4.com/dapp/download" || metaMaskDownloadUrl !== "https://metamask.io/download") {
    fail("INVALID_ROUTER_REGISTRY", "Wallet download routes must match the approved official allowlist");
  }
  if (!Array.isArray(input.products) || input.products.length < 1 || input.products.length > 64) {
    fail("INVALID_ROUTER_REGISTRY", "Product Session registry product count is invalid");
  }
  const products = input.products.map(parseProduct);
  uniqueSorted2(products.map((item) => item.productId), "productId");
  unique(products.map((item) => item.clientId), "clientId");
  unique(products.map((item) => item.applicationId), "applicationId");
  unique(products.map((item) => item.webOrigin), "webOrigin");
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
function migrateProductSessionRegistryV1(input) {
  exactFields(input, DOCUMENT_FIELDS2, "Product Session router registry v1");
  if (input.schemaVersion !== 1 || input.chainId !== "ynx_6423-1") fail("INVALID_ROUTER_REGISTRY", "Product Session router registry v1 is unsupported");
  exactFields(input.wallet, WALLET_V1_FIELDS, "Product Session Wallet registration v1");
  return parseProductSessionRegistry({
    ...input,
    schemaVersion: PRODUCT_SESSION_REGISTRY_VERSION,
    wallet: { ...input.wallet, metaMaskDownloadUrl: "https://metamask.io/download" }
  });
}
function productPlatformBinding(registryInput, productId, platform) {
  const registry = parseProductSessionRegistry(registryInput);
  if (!PRODUCT_SESSION_PLATFORMS.includes(platform)) fail("INVALID_PLATFORM", "Product Session platform is unsupported");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail("UNKNOWN_PRODUCT", "Product is not registered for Product Sessions");
  if (product.platforms && !product.platforms.includes(platform)) fail("INVALID_PLATFORM", "Product Session platform is not registered for this product");
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
    callback: web ? `${product.webOrigin}/wallet-auth/callback` : product.nativeCallback,
    scopes: product.scopes,
    evmCompatible: product.evmCompatible,
    sessionDurationSeconds: product.sessionDurationSeconds,
    walletAuthorizeCallback: registry.wallet.authorizeCallback,
    walletDownloadUrl: registry.wallet.downloadUrl,
    metaMaskDownloadUrl: registry.wallet.metaMaskDownloadUrl
  });
}
function migrateLegacyCallback(registryInput, legacyValue, context) {
  const registry = parseProductSessionRegistry(registryInput);
  exactFields(context, ["productId", "platform"], "Legacy callback migration context");
  if (typeof legacyValue !== "string" || legacyValue.length < 3 || legacyValue.length > 512 || legacyValue.trim() !== legacyValue) {
    fail("UNKNOWN_LEGACY_SCHEME", "Legacy callback is not registered");
  }
  const product = registry.products.find((item) => item.productId === context.productId);
  if (!product || !product.legacyCallbacks.includes(legacyValue)) {
    fail("UNKNOWN_LEGACY_SCHEME", "Legacy callback is not registered for this product");
  }
  const target2 = productPlatformBinding(registry, context.productId, context.platform);
  if (context.platform === "web" && legacyValue !== target2.callback) {
    fail("CALLBACK_MISMATCH", "A native legacy callback cannot be migrated into a Web origin");
  }
  return Object.freeze({
    migrated: legacyValue !== target2.callback,
    legacyValue,
    callback: target2.callback,
    productId: target2.productId,
    clientId: target2.clientId,
    platform: target2.platform
  });
}
function parseProduct(input) {
  const hasPlatforms = input !== null && typeof input === "object" && Object.hasOwn(input, "platforms");
  exactFields(input, hasPlatforms ? [...PRODUCT_FIELDS, "platforms"] : PRODUCT_FIELDS, "Product Session product registration");
  if (hasPlatforms && (!Array.isArray(input.platforms) || input.platforms.length !== 1 || input.platforms[0] !== "web")) {
    fail("INVALID_ROUTER_REGISTRY", "Explicit Product Session platforms must be exactly [web]");
  }
  const productId = pattern(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/);
  const clientId = pattern(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/);
  const displayName = text(input.displayName, "displayName", 2, 64);
  const applicationId = pattern(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/);
  const webOrigin = httpsURL(input.webOrigin, "webOrigin", true);
  let nativeCallback, legacyCallbacks;
  if (hasPlatforms) {
    if (input.nativeCallback !== null || !Array.isArray(input.legacyCallbacks) || input.legacyCallbacks.length !== 0) {
      fail("INVALID_ROUTER_REGISTRY", "Web-only products cannot register native or legacy callbacks");
    }
    nativeCallback = null;
    legacyCallbacks = [];
  } else {
    nativeCallback = callback(input.nativeCallback, "nativeCallback", { allowHttps: false });
    const native = new URL(nativeCallback);
    if (native.search || native.hash || native.username || native.password || !native.hostname) {
      fail("INVALID_ROUTER_REGISTRY", "Native callback must contain an exact host/path without query or fragment");
    }
    legacyCallbacks = stringList3(input.legacyCallbacks, "legacyCallbacks", 1, 8, (value) => text(value, "legacy callback", 3, 512));
    if (!legacyCallbacks.includes(nativeCallback)) fail("INVALID_ROUTER_REGISTRY", "Legacy callback list must include the canonical native callback");
  }
  const scopes3 = stringList3(input.scopes, "scopes", 1, 8, (value) => pattern(value, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (scopes3.some((scope2) => scope2.includes("*"))) fail("INVALID_ROUTER_REGISTRY", "Wildcard Product Session scope is forbidden");
  if (typeof input.evmCompatible !== "boolean") fail("INVALID_ROUTER_REGISTRY", "evmCompatible must be boolean");
  if (!Number.isInteger(input.sessionDurationSeconds) || input.sessionDurationSeconds < 60 || input.sessionDurationSeconds > 300) {
    fail("INVALID_ROUTER_REGISTRY", "Product Session duration must be between 60 and 300 seconds");
  }
  return Object.freeze({
    productId,
    clientId,
    displayName,
    applicationId,
    webOrigin,
    nativeCallback,
    ...hasPlatforms ? { platforms: Object.freeze(["web"]) } : {},
    legacyCallbacks: Object.freeze(legacyCallbacks),
    scopes: Object.freeze(scopes3),
    evmCompatible: input.evmCompatible,
    sessionDurationSeconds: input.sessionDurationSeconds
  });
}
function callback(value, label, options) {
  const normalized = text(value, label, 3, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail("INVALID_ROUTER_REGISTRY", `${label} is not a URL with ://`);
  }
  if (parsed.toString() !== normalized || parsed.username || parsed.password || parsed.hash || FORBIDDEN_CALLBACK_SCHEMES.has(parsed.protocol)) {
    fail("INVALID_ROUTER_REGISTRY", `${label} is not canonical or uses a forbidden scheme`);
  }
  if (parsed.protocol === "https:" && !options.allowHttps) fail("INVALID_ROUTER_REGISTRY", `${label} must use its registered application scheme`);
  if (parsed.protocol !== "https:" && !/^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol)) fail("INVALID_ROUTER_REGISTRY", `${label} scheme is invalid`);
  return normalized;
}
function httpsURL(value, label, originOnly) {
  const normalized = text(value, label, 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.port || !parsed.hostname || originOnly && (parsed.pathname !== "/" || parsed.search)) {
    fail("INVALID_ROUTER_REGISTRY", `${label} must be a canonical HTTPS ${originOnly ? "origin" : "URL"}`);
  }
  return originOnly ? parsed.origin : parsed.toString().replace(/\/$/, "");
}
function stringList3(value, label, minimum, maximum, normalize2) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail("INVALID_ROUTER_REGISTRY", `${label} item count is invalid`);
  const result = value.map(normalize2);
  uniqueSorted2(result, label);
  return result;
}
function uniqueSorted2(values, label) {
  unique(values, label);
  if ([...values].sort().join("\n") !== values.join("\n")) fail("INVALID_ROUTER_REGISTRY", `${label} must be sorted`);
}
function unique(values, label) {
  if (new Set(values).size !== values.length) fail("INVALID_ROUTER_REGISTRY", `${label} must be globally unique`);
}
function pattern(value, label, regex) {
  const result = text(value, label, 1, 512);
  if (!regex.test(result)) fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  return result;
}
function text(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.trim() !== value) fail("INVALID_ROUTER_REGISTRY", `${label} is invalid`);
  return value;
}
function fail(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/application-action-request.js
var REQUEST_FIELDS2 = ["version", "chainId", "productId", "platform", "applicationId", "origin", "callback", "account", "action", "payload", "nonce", "requestId", "state", "issuedAt", "expiresAt"];
var INPUT_FIELDS = ["productId", "platform", "account", "action", "payload", "nonce", "requestId", "state"];
var REQUEST_LIMIT = 16 * 1024;
var RESULT_LIMIT = 24 * 1024;
var MAX_LIFETIME = 3e5;
var ROUTE = "ynxwallet://application-action";
function createApplicationActionRequest(registry, input, at = /* @__PURE__ */ new Date()) {
  const data2 = fields(input, INPUT_FIELDS, "Application action request input");
  const binding2 = productPlatformBinding(registry, data2.productId, data2.platform);
  const time9 = instant(at);
  return parseApplicationActionRequest(registry, {
    version: "1",
    chainId: "ynx_6423-1",
    ...data2,
    applicationId: binding2.applicationId,
    origin: binding2.origin,
    callback: binding2.callback,
    issuedAt: time9.toISOString(),
    expiresAt: new Date(time9.getTime() + MAX_LIFETIME).toISOString()
  }, time9);
}
function parseApplicationActionRequest(registry, input, at = /* @__PURE__ */ new Date()) {
  const request = snapshot(input);
  const binding2 = productPlatformBinding(registry, request.productId, request.platform);
  if (request.productId !== "dex" || request.version !== "1" || request.chainId !== "ynx_6423-1" || !binding2.callback || ["applicationId", "origin", "callback"].some((key) => request[key] !== binding2[key])) {
    fail2("BINDING_MISMATCH", "Application action must match the exact registered DEX platform, origin and callback");
  }
  const now = instant(at).getTime();
  const issued = timestamp(request.issuedAt), expires = timestamp(request.expiresAt);
  if (issued > now || expires <= now || expires <= issued || expires - issued > MAX_LIFETIME) {
    fail2("EXPIRED_APPLICATION_ACTION", "Application action request is outside its maximum 300 second lifetime");
  }
  if (request.payload.deadlineUnix <= Math.floor(now / 1e3)) fail2("EXPIRED_APPLICATION_ACTION", "DEX action deadline has expired");
  return Object.freeze(request);
}
function applicationActionRequestDigest(request) {
  return digestHex("YNX_APPLICATION_ACTION_REQUEST_V1", snapshot(request));
}
function encodeApplicationActionWalletURL(registry, input, at = /* @__PURE__ */ new Date()) {
  const request = parseApplicationActionRequest(registry, input, at);
  return `${ROUTE}?request=${encode(request, REQUEST_LIMIT)}`;
}
function parseApplicationActionWalletURL(registry, url2, at = /* @__PURE__ */ new Date()) {
  return parseApplicationActionRequest(registry, decodeRoute(url2, ROUTE, "request", REQUEST_LIMIT), at);
}
function createApplicationActionReturnURL(registry, input, result, at = /* @__PURE__ */ new Date()) {
  const request = parseApplicationActionRequest(registry, input, at);
  const approved = dataStatus(result) === "approved";
  const data2 = fields(result, approved ? ["status", "signed"] : ["status", "reason"], "Application action decision");
  const parsed = resultFor(request, {
    kind: "application-action",
    version: "1",
    requestDigest: applicationActionRequestDigest(request),
    state: request.state,
    ...data2
  });
  return `${request.callback}?applicationActionResult=${encode(parsed, RESULT_LIMIT)}`;
}
function parseApplicationActionReturnURL(registry, url2, input, at = /* @__PURE__ */ new Date()) {
  const request = parseApplicationActionRequest(registry, input, at);
  return resultFor(request, decodeRoute(url2, request.callback, "applicationActionResult", RESULT_LIMIT));
}
function resultFor(request, input) {
  const approved = dataStatus(input) === "approved";
  const result = fields(input, ["kind", "version", "requestDigest", "state", "status", approved ? "signed" : "reason"], "Application action result");
  if (result.kind !== "application-action" || result.version !== "1" || result.requestDigest !== applicationActionRequestDigest(request) || result.state !== request.state) {
    fail2("BINDING_MISMATCH", "Application action result does not match the pending request");
  }
  if (approved) {
    if (typeof result.signed !== "string" || result.signed.length > REQUEST_LIMIT) fail2("INVALID_APPLICATION_ACTION_RESULT", "Signed application action must be bounded canonical Core JSON");
    verifySignedApplicationAction(result.signed, { account: request.account, action: request.action, payload: request.payload, nonce: request.nonce });
  } else if (result.status !== "rejected" || result.reason !== "USER_REJECTED") {
    fail2("INVALID_APPLICATION_ACTION_RESULT", "Application action decision is unsupported");
  }
  return Object.freeze(result);
}
function snapshot(input) {
  const request = fields(input, REQUEST_FIELDS2, "Application action request");
  if (!request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) fail2("INVALID_SHAPE", "DEX payload must be a data object");
  request.payload = Object.freeze(fields(request.payload, Object.keys(request.payload), "DEX payload"));
  applicationActionPayloadHash(request.action, request.payload);
  evmAddressFromYNX(request.account);
  if (!Number.isSafeInteger(request.nonce) || request.nonce <= 0) fail2("INVALID_APPLICATION_ACTION", "Application action nonce must be a positive safe integer");
  if (typeof request.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.requestId)) fail2("INVALID_APPLICATION_ACTION", "requestId must be a canonical UUID v4");
  if (typeof request.state !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(request.state)) fail2("INVALID_APPLICATION_ACTION", "state must be 32 to 128 base64url characters");
  timestamp(request.issuedAt);
  timestamp(request.expiresAt);
  for (const key of ["version", "chainId", "productId", "platform", "applicationId", "origin", "callback"]) {
    if (typeof request[key] !== "string" || !request[key].length || request[key].length > 512) fail2("INVALID_APPLICATION_ACTION", `${key} is invalid`);
  }
  bounded(canonicalJSON(request), REQUEST_LIMIT);
  return request;
}
function dataStatus(value) {
  return value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status")?.value : void 0;
}
function fields(value, names, label) {
  exactFields(value, names, label);
  if (Reflect.ownKeys(value).length !== names.length) fail2("INVALID_SHAPE", `${label} must contain only data fields`);
  const copy = {};
  for (const key of names) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) fail2("INVALID_SHAPE", `${label} cannot contain accessors`);
    Object.defineProperty(copy, key, { value: field.value, enumerable: true, writable: true, configurable: true });
  }
  return copy;
}
function instant(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail2("INVALID_TIME", "A valid current time is required");
  return new Date(value.getTime());
}
function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail2("INVALID_TIME", "Application action time must be canonical ISO UTC");
  return Date.parse(value);
}
function bounded(raw, limit) {
  if (!raw.length || raw.length > limit || new TextEncoder().encode(raw).length > limit) fail2("INVALID_ENCODING", "Application action data exceeds its byte limit");
}
function encode(value, limit) {
  const raw = canonicalJSON(value);
  bounded(raw, limit);
  return encodeBase64url(new TextEncoder().encode(raw));
}
function decodeRoute(value, target2, key, limit) {
  if (typeof value !== "string" || value.length > limit * 2 || !value.startsWith(`${target2}?${key}=`)) fail2("INVALID_APPLICATION_ACTION_ROUTE", "Application action route is not registered");
  const encoded = value.slice(target2.length + key.length + 2);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) fail2("INVALID_ENCODING", "Application action URL must contain a single canonical base64url field");
  const bytes = decodeBase64url(encoded);
  if (bytes.length > limit || encodeBase64url(bytes) !== encoded) fail2("INVALID_ENCODING", "Application action base64url is not canonical or exceeds its byte limit");
  let raw, result;
  try {
    raw = decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""));
    result = JSON.parse(raw);
  } catch {
    fail2("INVALID_ENCODING", "Application action JSON or UTF-8 is invalid");
  }
  if (canonicalJSON(result) !== raw) fail2("INVALID_ENCODING", "Application action JSON must be canonical with no duplicate fields");
  return result;
}
function fail2(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/card-application-approval.js
var CARD_APPLICATION_APPROVAL_DOMAIN = "YNX_CARD_APPLICATION_APPROVAL_V1";
var CHALLENGE_FIELDS2 = ["id", "applicationId", "owner", "chainId", "purpose", "payloadHash", "nonce", "issuedAt", "expiresAt"];
var DETAILS_FIELDS = ["nickname", "useCase", "limitWei", "riskAccepted", "termsVersion"];
var PROOF_FIELDS = ["version", "productId", "challenge", "details", "account", "accountPublicKey", "issuedAt", "expiresAt", "signature"];
var UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
var MAX_BYTES = 16 * 1024;
function createSignedCardApplicationApproval(input, at = /* @__PURE__ */ new Date()) {
  const fields4 = record(input, ["accountSecret", "challenge", "details"], "Card approval input");
  const challenge = parseChallenge(fields4.challenge);
  const details = parseDetails(fields4.details);
  assertDetailsHash(challenge, details);
  const now = instant2(at);
  assertActive(challenge.issuedAt, challenge.expiresAt, now);
  const secret = secretBytes3(fields4.accountSecret);
  try {
    const accountPublicKey = bytesToHex(secp256k1.getPublicKey(secret, true));
    const account = walletIdentityFromPublicKey(accountPublicKey);
    if (ownerAddress(challenge.owner) !== evmAddressFromYNX(account)) fail3("ACCOUNT_MISMATCH", "Card challenge owner does not match the signing account");
    const unsigned3 = { version: "1", productId: "card", challenge, details, account, accountPublicKey, issuedAt: now.toISOString(), expiresAt: challenge.expiresAt };
    const signature = bytesToHex(secp256k1.sign(signDigest(unsigned3), secret, { prehash: false, format: "compact", lowS: true }));
    return parseSignedCardApplicationApproval({ ...unsigned3, signature });
  } finally {
    secret.fill(0);
  }
}
function parseSignedCardApplicationApproval(input) {
  let value = input;
  const raw = typeof input === "string" ? input : null;
  if (raw !== null) {
    boundedBytes(raw);
    try {
      value = JSON.parse(raw);
    } catch {
      fail3("INVALID_CARD_APPROVAL", "Card approval JSON is invalid");
    }
  }
  const fields4 = record(value, PROOF_FIELDS, "Signed Card approval");
  if (fields4.version !== "1" || fields4.productId !== "card") fail3("INVALID_CARD_APPROVAL", "Unsupported Card approval version or product");
  const challenge = parseChallenge(fields4.challenge), details = parseDetails(fields4.details);
  assertDetailsHash(challenge, details);
  const account = text2(fields4.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/);
  evmAddressFromYNX(account);
  const accountPublicKey = text2(fields4.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/);
  const issuedAt = timestamp2(fields4.issuedAt), expiresAt = timestamp2(fields4.expiresAt);
  if (issuedAt < challenge.issuedAt || expiresAt > challenge.expiresAt || expiresAt <= issuedAt || Date.parse(expiresAt) - Date.parse(issuedAt) > 3e5) fail3("INVALID_CARD_APPROVAL_TIME", "Card approval must fit inside its challenge lifetime");
  const unsigned3 = { version: "1", productId: "card", challenge, details, account, accountPublicKey, issuedAt, expiresAt };
  const signature = text2(fields4.signature, "signature", /^[0-9a-f]{128}$/);
  const proof = Object.freeze({ ...unsigned3, signature });
  const encoded = canonicalJSON(proof);
  boundedBytes(encoded);
  if (raw !== null && raw !== encoded) fail3("INVALID_CARD_APPROVAL", "Card approval JSON must be canonical");
  let valid = false;
  try {
    valid = secp256k1.verify(hexToBytes(signature), signDigest(unsigned3), hexToBytes(accountPublicKey), { prehash: false, format: "compact", lowS: true });
    if (valid) {
      const derived = walletIdentityFromPublicKey(accountPublicKey);
      valid = derived === account && evmAddressFromYNX(derived) === ownerAddress(challenge.owner);
    }
  } catch {
    valid = false;
  }
  if (!valid) fail3("INVALID_CARD_APPROVAL_SIGNATURE", "Card approval signature, account or owner is invalid");
  return proof;
}
function verifySignedCardApplicationApproval(input, expected, at = /* @__PURE__ */ new Date()) {
  const context = record(expected, ["challenge", "details", "account"], "Card approval server context");
  const challenge = parseChallenge(context.challenge), details = parseDetails(context.details);
  assertDetailsHash(challenge, details);
  const accountAddress = ownerAddress(context.account);
  const proof = parseSignedCardApplicationApproval(input);
  if (canonicalJSON(proof.challenge) !== canonicalJSON(challenge) || canonicalJSON(proof.details) !== canonicalJSON(details) || evmAddressFromYNX(proof.account) !== accountAddress || ownerAddress(challenge.owner) !== accountAddress) {
    fail3("BINDING_MISMATCH", "Card approval does not match the current challenge, full details and authenticated account");
  }
  const now = instant2(at);
  assertActive(challenge.issuedAt, challenge.expiresAt, now);
  assertActive(proof.issuedAt, proof.expiresAt, now);
  return proof;
}
function cardApplicationDetailsHash(details) {
  return hash(canonicalJSON(parseDetails(details)));
}
function cardApplicationApprovalId(input) {
  return `card_approval_${hash(canonicalJSON(parseSignedCardApplicationApproval(input)))}`;
}
function parseChallenge(input) {
  const fields4 = record(input, CHALLENGE_FIELDS2, "Card business challenge");
  const owner = fields4.owner;
  ownerAddress(owner);
  if (fields4.chainId !== "0x1917" || fields4.purpose !== "create-testnet-card") fail3("INVALID_CARD_CHALLENGE", "Card challenge chain or purpose is invalid");
  const issuedAt = timestamp2(fields4.issuedAt), expiresAt = timestamp2(fields4.expiresAt);
  if (expiresAt <= issuedAt || Date.parse(expiresAt) - Date.parse(issuedAt) > 3e5) fail3("INVALID_CARD_APPROVAL_TIME", "Card challenge lifetime must be positive and at most 300 seconds");
  return Object.freeze({
    id: text2(fields4.id, "challenge id", new RegExp(`^challenge_${UUID}$`)),
    applicationId: text2(fields4.applicationId, "application id", new RegExp(`^application_${UUID}$`)),
    owner,
    chainId: "0x1917",
    purpose: "create-testnet-card",
    payloadHash: text2(fields4.payloadHash, "payloadHash", /^[0-9a-f]{64}$/),
    nonce: text2(fields4.nonce, "nonce", new RegExp(`^${UUID}$`)),
    issuedAt,
    expiresAt
  });
}
function parseDetails(input) {
  const fields4 = record(input, DETAILS_FIELDS, "Card application details");
  const nickname = boundedText(fields4.nickname, "nickname", 2, 48), useCase = boundedText(fields4.useCase, "useCase", 4, 160);
  const limitWei = text2(fields4.limitWei, "limitWei", /^[1-9][0-9]{0,77}$/);
  if (BigInt(limitWei) > 2n ** 256n - 1n) fail3("INVALID_CARD_DETAILS", "Card YNXT limit exceeds uint256");
  if (fields4.riskAccepted !== true || fields4.termsVersion !== "card-testnet-v1") fail3("INVALID_CARD_DETAILS", "Explicit Testnet risk acceptance and current terms are required");
  return Object.freeze({ nickname, useCase, limitWei, riskAccepted: true, termsVersion: "card-testnet-v1" });
}
function record(value, fields4, label) {
  exactFields(value, fields4, label);
  if (Reflect.ownKeys(value).length !== fields4.length) fail3("INVALID_CARD_APPROVAL", `${label} contains hidden fields`);
  const out = {};
  for (const key of fields4) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, "value")) fail3("INVALID_CARD_APPROVAL", `${label} must contain plain data fields`);
    out[key] = property.value;
  }
  return out;
}
function ownerAddress(value) {
  if (typeof value === "string" && value.startsWith("ynx1")) return evmAddressFromYNX(value);
  return text2(value, "owner", /^0x[0-9a-f]{40}$/);
}
function timestamp2(value) {
  text2(value, "timestamp", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail3("INVALID_CARD_APPROVAL_TIME", "Card approval timestamp is invalid");
  return value;
}
function instant2(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail3("INVALID_CARD_APPROVAL_TIME", "Card approval requires valid authority time");
  return value;
}
function assertActive(issuedAt, expiresAt, at) {
  if (Date.parse(issuedAt) > at.getTime() || Date.parse(expiresAt) <= at.getTime()) fail3("CARD_APPROVAL_EXPIRED", "Card approval is not currently valid");
}
function assertDetailsHash(challenge, details) {
  if (hash(canonicalJSON(details)) !== challenge.payloadHash) fail3("BINDING_MISMATCH", "Card challenge hash does not match the exact business details");
}
function boundedText(value, label, min, max) {
  if (typeof value !== "string" || value.trim() !== value || value.length < min || value.length > max) fail3("INVALID_CARD_DETAILS", `Card ${label} is invalid`);
  return value;
}
function text2(value, label, pattern13) {
  if (typeof value !== "string" || value.trim() !== value || !pattern13.test(value)) fail3("INVALID_CARD_APPROVAL", `Card ${label} is invalid`);
  return value;
}
function boundedBytes(raw) {
  if (!raw.length || raw.length > MAX_BYTES || utf8ToBytes(raw).length > MAX_BYTES) fail3("INVALID_CARD_APPROVAL", "Card approval exceeds its byte limit");
}
function hash(value) {
  return bytesToHex(sha256(utf8ToBytes(value)));
}
function signDigest(unsigned3) {
  return sha256(utf8ToBytes(`${CARD_APPLICATION_APPROVAL_DOMAIN}
${canonicalJSON(unsigned3)}`));
}
function secretBytes3(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail3("INVALID_SECRET", "Wallet account secret must be 32-byte lowercase hex");
  const bytes = hexToBytes(value);
  if (!secp256k1.utils.isValidSecretKey(bytes)) {
    bytes.fill(0);
    fail3("INVALID_SECRET", "Wallet account secret is outside the secp256k1 range");
  }
  return bytes;
}
function fail3(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/card-application-approval-request.js
var INPUT_FIELDS2 = ["productId", "platform", "account", "challenge", "details", "requestId", "state"];
var REQUEST_FIELDS3 = ["version", "chainId", "productId", "platform", "applicationId", "origin", "callback", "account", "challenge", "details", "requestId", "state", "issuedAt", "expiresAt"];
var CHALLENGE_FIELDS3 = ["id", "applicationId", "owner", "chainId", "purpose", "payloadHash", "nonce", "issuedAt", "expiresAt"];
var DETAILS_FIELDS2 = ["nickname", "useCase", "limitWei", "riskAccepted", "termsVersion"];
var UUID2 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
var REQUEST_LIMIT2 = 16 * 1024;
var RESULT_LIMIT2 = 24 * 1024;
var MAX_LIFETIME2 = 3e5;
var ROUTE2 = "ynxwallet://card-application-approval";
function createCardApplicationApprovalRequest(registry, input, at = /* @__PURE__ */ new Date()) {
  const data2 = fields2(input, INPUT_FIELDS2, "Card approval request input");
  const challenge = challengeSnapshot(data2.challenge);
  const binding2 = productPlatformBinding(registry, data2.productId, data2.platform);
  const now = instant3(at);
  return parseCardApplicationApprovalRequest(registry, {
    version: "1",
    chainId: "ynx_6423-1",
    ...data2,
    challenge,
    applicationId: binding2.applicationId,
    origin: binding2.origin,
    callback: binding2.callback,
    issuedAt: now.toISOString(),
    expiresAt: new Date(Math.min(now.getTime() + MAX_LIFETIME2, timestamp3(challenge.expiresAt))).toISOString()
  }, now);
}
function parseCardApplicationApprovalRequest(registry, input, at = /* @__PURE__ */ new Date()) {
  const request = snapshot2(input);
  const binding2 = productPlatformBinding(registry, request.productId, request.platform);
  if (request.version !== "1" || request.chainId !== "ynx_6423-1" || request.productId !== "card" || !binding2.callback || ["applicationId", "origin", "callback"].some((key) => request[key] !== binding2[key])) {
    fail4("BINDING_MISMATCH", "Card approval must match the exact registered Card platform, origin and callback");
  }
  const now = instant3(at).getTime(), issued = timestamp3(request.issuedAt), expires = timestamp3(request.expiresAt);
  if (issued > now || expires <= now || expires <= issued || expires - issued > MAX_LIFETIME2 || issued < timestamp3(request.challenge.issuedAt) || expires > timestamp3(request.challenge.expiresAt)) {
    fail4("EXPIRED_CARD_APPROVAL_REQUEST", "Card review must be current and fit inside its challenge and 300 second lifetime");
  }
  return Object.freeze(request);
}
function cardApplicationApprovalRequestDigest(request) {
  return digestHex("YNX_CARD_APPLICATION_APPROVAL_REQUEST_V1", snapshot2(request));
}
function encodeCardApplicationApprovalWalletURL(registry, input, at = /* @__PURE__ */ new Date()) {
  return `${ROUTE2}?request=${encode2(parseCardApplicationApprovalRequest(registry, input, at), REQUEST_LIMIT2)}`;
}
function parseCardApplicationApprovalWalletURL(registry, url2, at = /* @__PURE__ */ new Date()) {
  return parseCardApplicationApprovalRequest(registry, decodeRoute2(url2, ROUTE2, "request", REQUEST_LIMIT2), at);
}
function createCardApplicationApprovalReturnURL(registry, input, decision, at = /* @__PURE__ */ new Date()) {
  const request = parseCardApplicationApprovalRequest(registry, input, at);
  const approved = dataStatus2(decision) === "approved";
  const data2 = fields2(decision, approved ? ["status", "approval"] : ["status", "reason"], "Card approval decision");
  const result = resultFor2(request, {
    kind: "card-application-approval",
    version: "1",
    requestDigest: cardApplicationApprovalRequestDigest(request),
    state: request.state,
    ...data2
  }, at);
  return `${request.callback}?cardApplicationApprovalResult=${encode2(result, RESULT_LIMIT2)}`;
}
function parseCardApplicationApprovalReturnURL(registry, url2, input, at = /* @__PURE__ */ new Date()) {
  const request = parseCardApplicationApprovalRequest(registry, input, at);
  return resultFor2(request, decodeRoute2(url2, request.callback, "cardApplicationApprovalResult", RESULT_LIMIT2), at);
}
function resultFor2(request, input, at) {
  const approved = dataStatus2(input) === "approved";
  const result = fields2(input, ["kind", "version", "requestDigest", "state", "status", approved ? "approval" : "reason"], "Card approval result");
  if (result.kind !== "card-application-approval" || result.version !== "1" || result.requestDigest !== cardApplicationApprovalRequestDigest(request) || result.state !== request.state) {
    fail4("BINDING_MISMATCH", "Card approval result does not match the exact pending request");
  }
  if (approved) {
    if (result.approval === null || typeof result.approval !== "object" || Array.isArray(result.approval)) fail4("INVALID_CARD_APPROVAL_RESULT", "Card approval must be a signed proof object");
    result.approval = verifySignedCardApplicationApproval(result.approval, { challenge: request.challenge, details: request.details, account: request.account }, at);
    if (timestamp3(result.approval.issuedAt) < timestamp3(request.issuedAt)) fail4("BINDING_MISMATCH", "Card approval predates this review request");
  } else if (result.status !== "rejected" || result.reason !== "USER_REJECTED") {
    fail4("INVALID_CARD_APPROVAL_RESULT", "Card approval decision is unsupported");
  }
  bounded2(canonicalJSON(result), RESULT_LIMIT2);
  return Object.freeze(result);
}
function snapshot2(input) {
  const request = fields2(input, REQUEST_FIELDS3, "Card approval request");
  request.challenge = challengeSnapshot(request.challenge);
  request.details = Object.freeze(fields2(request.details, DETAILS_FIELDS2, "Card application details"));
  const payloadHash = cardApplicationDetailsHash(request.details);
  const accountAddress = evmAddressFromYNX(request.account);
  if (request.challenge.payloadHash !== payloadHash || ownerAddress2(request.challenge.owner) !== accountAddress) fail4("BINDING_MISMATCH", "Card challenge must match the full application details and selected account");
  text3(request.requestId, "requestId", new RegExp(`^${UUID2}$`));
  text3(request.state, "state", /^[A-Za-z0-9_-]{32,128}$/);
  timestamp3(request.issuedAt);
  timestamp3(request.expiresAt);
  for (const key of ["version", "chainId", "productId", "platform", "applicationId", "origin", "callback"]) {
    if (typeof request[key] !== "string" || !request[key].length || request[key].length > 512) fail4("INVALID_CARD_APPROVAL_REQUEST", `${key} is invalid`);
  }
  bounded2(canonicalJSON(request), REQUEST_LIMIT2);
  return request;
}
function challengeSnapshot(input) {
  const challenge = fields2(input, CHALLENGE_FIELDS3, "Card business challenge");
  text3(challenge.id, "challenge id", new RegExp(`^challenge_${UUID2}$`));
  text3(challenge.applicationId, "Card application id", new RegExp(`^application_${UUID2}$`));
  text3(challenge.nonce, "challenge nonce", new RegExp(`^${UUID2}$`));
  text3(challenge.payloadHash, "payloadHash", /^[0-9a-f]{64}$/);
  ownerAddress2(challenge.owner);
  if (challenge.chainId !== "0x1917" || challenge.purpose !== "create-testnet-card") fail4("INVALID_CARD_APPROVAL_REQUEST", "Card challenge chain or purpose is invalid");
  const issued = timestamp3(challenge.issuedAt), expires = timestamp3(challenge.expiresAt);
  if (expires <= issued || expires - issued > MAX_LIFETIME2) fail4("EXPIRED_CARD_APPROVAL_REQUEST", "Card challenge lifetime must be positive and at most 300 seconds");
  return Object.freeze(challenge);
}
function ownerAddress2(value) {
  return typeof value === "string" && value.startsWith("ynx1") ? evmAddressFromYNX(value) : text3(value, "owner", /^0x[0-9a-f]{40}$/);
}
function dataStatus2(value) {
  return value !== null && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, "status")?.value : void 0;
}
function fields2(value, names, label) {
  exactFields(value, names, label);
  if (Reflect.ownKeys(value).length !== names.length) fail4("INVALID_SHAPE", `${label} must contain only data fields`);
  const copy = {};
  for (const key of names) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, "value")) fail4("INVALID_SHAPE", `${label} cannot contain accessors`);
    copy[key] = property.value;
  }
  return copy;
}
function text3(value, label, pattern13) {
  if (typeof value !== "string" || value.trim() !== value || !pattern13.test(value)) fail4("INVALID_CARD_APPROVAL_REQUEST", `${label} is invalid`);
  return value;
}
function instant3(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail4("INVALID_TIME", "A valid current authority time is required");
  return new Date(value.getTime());
}
function timestamp3(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail4("INVALID_TIME", "Card review timestamps must be canonical ISO UTC");
  return Date.parse(value);
}
function bounded2(raw, limit) {
  if (!raw.length || raw.length > limit || new TextEncoder().encode(raw).length > limit) fail4("INVALID_ENCODING", "Card approval data exceeds its byte limit");
}
function encode2(value, limit) {
  const raw = canonicalJSON(value);
  bounded2(raw, limit);
  return encodeBase64url(new TextEncoder().encode(raw));
}
function decodeRoute2(value, target2, key, limit) {
  if (typeof value !== "string" || value.length > limit * 2 || !value.startsWith(`${target2}?${key}=`)) fail4("INVALID_CARD_APPROVAL_ROUTE", "Card approval route is not registered");
  const encoded = value.slice(target2.length + key.length + 2);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) fail4("INVALID_ENCODING", "Card URL requires a single canonical base64url field");
  const bytes = decodeBase64url(encoded);
  if (bytes.length > limit || encodeBase64url(bytes) !== encoded) fail4("INVALID_ENCODING", "Card base64url is noncanonical or too large");
  let raw, result;
  try {
    raw = decodeURIComponent(Array.from(bytes, (byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""));
    result = JSON.parse(raw);
  } catch {
    fail4("INVALID_ENCODING", "Card approval JSON or UTF-8 is invalid");
  }
  if (canonicalJSON(result) !== raw) fail4("INVALID_ENCODING", "Card approval JSON must be canonical without duplicate fields");
  return result;
}
function fail4(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/smart-account.js
var OPERATION_FIELDS = [
  "schemaVersion",
  "chainId",
  "entryPoint",
  "sender",
  "nonceKey",
  "nonceSequence",
  "calls",
  "callGasLimit",
  "verificationGasLimit",
  "preVerificationGas",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "validAfter",
  "validUntil"
];
var CALL_FIELDS = ["target", "selector", "value", "dataDigest"];
var REQUEST_FIELDS4 = [
  "schemaVersion",
  "policyId",
  "sponsorType",
  "productClientId",
  "sessionBinding",
  "account",
  "userOperationDigest",
  "antiSybilBinding",
  "requestedCost",
  "subjectDailyUsed",
  "sponsorDailyUsed",
  "firstAction",
  "source",
  "asOf",
  "version"
];
var POLICY_FIELDS = [
  "schemaVersion",
  "policyId",
  "enabled",
  "sponsorType",
  "productClientId",
  "paymaster",
  "entryPoint",
  "allowedTargets",
  "allowedSelectors",
  "maxCalls",
  "maxCostPerOperation",
  "maxCostPerSubjectDay",
  "maxCostPerSponsorDay",
  "requiresFirstAction",
  "validAfter",
  "validUntil",
  "provider",
  "fees",
  "risk",
  "revocation",
  "source",
  "asOf",
  "version"
];
var SMART_ACCOUNT_SCHEMA_VERSION = 1;
var SMART_ACCOUNT_CHAIN_ID = 6423;
function parseUserOperationEnvelope(input) {
  exactFields(input, OPERATION_FIELDS, "Smart Account UserOperation envelope");
  const operation = {
    schemaVersion: exactInteger2(input.schemaVersion, "schemaVersion", SMART_ACCOUNT_SCHEMA_VERSION),
    chainId: exactInteger2(input.chainId, "chainId", SMART_ACCOUNT_CHAIN_ID),
    entryPoint: address(input.entryPoint, "entryPoint"),
    sender: address(input.sender, "sender"),
    nonceKey: hex(input.nonceKey, "nonceKey", 48),
    nonceSequence: nonnegative(input.nonceSequence, "nonceSequence"),
    calls: calls(input.calls),
    callGasLimit: positive(input.callGasLimit, "callGasLimit"),
    verificationGasLimit: positive(input.verificationGasLimit, "verificationGasLimit"),
    preVerificationGas: positive(input.preVerificationGas, "preVerificationGas"),
    maxFeePerGas: positive(input.maxFeePerGas, "maxFeePerGas"),
    maxPriorityFeePerGas: positive(input.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
    validAfter: timestamp4(input.validAfter, "validAfter"),
    validUntil: timestamp4(input.validUntil, "validUntil")
  };
  if (operation.entryPoint === operation.sender) fail5("INVALID_USER_OPERATION", "EntryPoint and sender must differ");
  if (operation.maxPriorityFeePerGas > operation.maxFeePerGas) fail5("INVALID_USER_OPERATION", "Priority fee cannot exceed maximum fee");
  if (operation.validUntil <= operation.validAfter) fail5("INVALID_USER_OPERATION", "UserOperation validity window is empty");
  return freeze(operation, ["calls"]);
}
function userOperationDigest(input) {
  return digestHex("YNX_SMART_ACCOUNT_USER_OPERATION_V1", parseUserOperationEnvelope(input));
}
function parseSponsorshipPolicy(input) {
  exactFields(input, POLICY_FIELDS, "Smart Account sponsorship policy");
  const policy = {
    schemaVersion: exactInteger2(input.schemaVersion, "schemaVersion", 1),
    policyId: identifier(input.policyId, "policyId"),
    enabled: boolean(input.enabled, "enabled"),
    sponsorType: enumeration(input.sponsorType, "sponsorType", ["first-action", "product", "merchant", "developer-testnet"]),
    productClientId: identifier(input.productClientId, "productClientId"),
    paymaster: address(input.paymaster, "paymaster"),
    entryPoint: address(input.entryPoint, "entryPoint"),
    allowedTargets: uniqueSorted3(input.allowedTargets, "allowedTargets", 1, 32, (value) => address(value, "allowed target")),
    allowedSelectors: uniqueSorted3(input.allowedSelectors, "allowedSelectors", 1, 64, (value) => hex(value, "allowed selector", 8)),
    maxCalls: boundedInteger(input.maxCalls, "maxCalls", 1, 16),
    maxCostPerOperation: positive(input.maxCostPerOperation, "maxCostPerOperation"),
    maxCostPerSubjectDay: positive(input.maxCostPerSubjectDay, "maxCostPerSubjectDay"),
    maxCostPerSponsorDay: positive(input.maxCostPerSponsorDay, "maxCostPerSponsorDay"),
    requiresFirstAction: boolean(input.requiresFirstAction, "requiresFirstAction"),
    validAfter: timestamp4(input.validAfter, "validAfter"),
    validUntil: timestamp4(input.validUntil, "validUntil"),
    provider: boundedText2(input.provider, "provider", 1, 128),
    fees: boundedText2(input.fees, "fees", 1, 280),
    risk: boundedText2(input.risk, "risk", 1, 500),
    revocation: httpsURL2(input.revocation, "revocation"),
    source: httpsURL2(input.source, "source"),
    asOf: timestamp4(input.asOf, "asOf"),
    version: boundedText2(input.version, "version", 1, 64)
  };
  if (policy.validUntil <= policy.validAfter) fail5("INVALID_SPONSOR_POLICY", "Sponsorship policy validity window is empty");
  if (policy.maxCostPerOperation > policy.maxCostPerSubjectDay || policy.maxCostPerSubjectDay > policy.maxCostPerSponsorDay) fail5("INVALID_SPONSOR_POLICY", "Sponsorship budgets must be monotonically bounded");
  if (policy.sponsorType === "first-action" !== policy.requiresFirstAction) fail5("INVALID_SPONSOR_POLICY", "First-action policy must require an unused subject");
  return freeze(policy, ["allowedTargets", "allowedSelectors"]);
}
function parseSponsorshipRequest(input) {
  exactFields(input, REQUEST_FIELDS4, "Smart Account sponsorship request");
  return Object.freeze({
    schemaVersion: exactInteger2(input.schemaVersion, "schemaVersion", 1),
    policyId: identifier(input.policyId, "policyId"),
    sponsorType: enumeration(input.sponsorType, "sponsorType", ["first-action", "product", "merchant", "developer-testnet"]),
    productClientId: identifier(input.productClientId, "productClientId"),
    sessionBinding: hex(input.sessionBinding, "sessionBinding", 64),
    account: ynxAccount(input.account),
    userOperationDigest: hex(input.userOperationDigest, "userOperationDigest", 64),
    antiSybilBinding: hex(input.antiSybilBinding, "antiSybilBinding", 64),
    requestedCost: positive(input.requestedCost, "requestedCost"),
    subjectDailyUsed: nonnegative(input.subjectDailyUsed, "subjectDailyUsed"),
    sponsorDailyUsed: nonnegative(input.sponsorDailyUsed, "sponsorDailyUsed"),
    firstAction: boolean(input.firstAction, "firstAction"),
    source: httpsURL2(input.source, "source"),
    asOf: timestamp4(input.asOf, "asOf"),
    version: boundedText2(input.version, "version", 1, 64)
  });
}
function evaluateSponsorship(operationInput, requestInput, policyInput, at = /* @__PURE__ */ new Date()) {
  const operation = parseUserOperationEnvelope(operationInput);
  const request = parseSponsorshipRequest(requestInput);
  const policy = parseSponsorshipPolicy(policyInput);
  const now = validDate4(at).toISOString();
  const reasons = [];
  if (!policy.enabled) reasons.push("policy-disabled");
  if (request.policyId !== policy.policyId || request.sponsorType !== policy.sponsorType || request.productClientId !== policy.productClientId) reasons.push("policy-binding-mismatch");
  if (request.userOperationDigest !== userOperationDigest(operation)) reasons.push("operation-digest-mismatch");
  if (operation.entryPoint !== policy.entryPoint) reasons.push("entry-point-mismatch");
  if (operation.calls.length > policy.maxCalls) reasons.push("call-count-exceeded");
  if (operation.calls.some((call) => !policy.allowedTargets.includes(call.target))) reasons.push("target-not-allowed");
  if (operation.calls.some((call) => !policy.allowedSelectors.includes(call.selector))) reasons.push("selector-not-allowed");
  if (request.requestedCost > policy.maxCostPerOperation) reasons.push("operation-budget-exceeded");
  if (request.subjectDailyUsed + request.requestedCost > policy.maxCostPerSubjectDay) reasons.push("subject-daily-budget-exceeded");
  if (request.sponsorDailyUsed + request.requestedCost > policy.maxCostPerSponsorDay) reasons.push("sponsor-daily-budget-exceeded");
  if (policy.requiresFirstAction && !request.firstAction) reasons.push("first-action-already-used");
  if (now < policy.validAfter || now >= policy.validUntil || now < operation.validAfter || now >= operation.validUntil) reasons.push("outside-validity-window");
  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze(reasons),
    policyId: policy.policyId,
    userOperationDigest: request.userOperationDigest,
    paymaster: policy.paymaster,
    approvedCost: reasons.length === 0 ? request.requestedCost : 0,
    remainingSubjectBudget: Math.max(0, policy.maxCostPerSubjectDay - request.subjectDailyUsed - (reasons.length === 0 ? request.requestedCost : 0)),
    remainingSponsorBudget: Math.max(0, policy.maxCostPerSponsorDay - request.sponsorDailyUsed - (reasons.length === 0 ? request.requestedCost : 0))
  });
}
function calls(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) fail5("INVALID_USER_OPERATION", "calls must contain between one and sixteen entries");
  return Object.freeze(value.map((item) => {
    exactFields(item, CALL_FIELDS, "Smart Account call");
    return Object.freeze({ target: address(item.target, "target"), selector: hex(item.selector, "selector", 8), value: nonnegative(item.value, "value"), dataDigest: hex(item.dataDigest, "dataDigest", 64) });
  }));
}
function freeze(value, arrays) {
  const copy = { ...value };
  for (const key of arrays) copy[key] = Object.freeze([...copy[key]]);
  return Object.freeze(copy);
}
function uniqueSorted3(value, label, min, max, parser) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail5("INVALID_FIELD", `${label} has an invalid item count`);
  const parsed = value.map(parser);
  if (new Set(parsed).size !== parsed.length || [...parsed].sort().join("\n") !== parsed.join("\n")) fail5("INVALID_FIELD", `${label} must be unique and sorted`);
  return Object.freeze(parsed);
}
function address(value, label) {
  return pattern2(value, label, /^0x[0-9a-f]{40}$/);
}
function ynxAccount(value) {
  return pattern2(value, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/);
}
function identifier(value, label) {
  return pattern2(value, label, /^[a-z][a-z0-9._-]{2,63}$/);
}
function hex(value, label, digits) {
  return pattern2(value, label, new RegExp(`^(?:0x)?[0-9a-f]{${digits}}$`));
}
function pattern2(value, label, regex) {
  const text8 = boundedText2(value, label, 1, 512);
  if (!regex.test(text8)) fail5("INVALID_FIELD", `${label} is invalid`);
  return text8;
}
function boundedText2(value, label, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value) fail5("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function timestamp4(value, label) {
  const text8 = pattern2(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(text8)) || new Date(text8).toISOString() !== text8) fail5("INVALID_TIME", `${label} is invalid`);
  return text8;
}
function httpsURL2(value, label) {
  const text8 = boundedText2(value, label, 1, 512);
  let parsed;
  try {
    parsed = new URL(text8);
  } catch {
    fail5("INVALID_URL", `${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.toString() !== text8) fail5("INVALID_URL", `${label} must be a canonical HTTPS URL`);
  return text8;
}
function positive(value, label) {
  return boundedInteger(value, label, 1, Number.MAX_SAFE_INTEGER);
}
function nonnegative(value, label) {
  return boundedInteger(value, label, 0, Number.MAX_SAFE_INTEGER);
}
function boundedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail5("INVALID_NUMBER", `${label} is outside its allowed range`);
  return value;
}
function exactInteger2(value, label, expected) {
  return boundedInteger(value, label, expected, expected);
}
function boolean(value, label) {
  if (typeof value !== "boolean") fail5("INVALID_FIELD", `${label} must be boolean`);
  return value;
}
function enumeration(value, label, choices) {
  if (!choices.includes(value)) fail5("INVALID_FIELD", `${label} is unsupported`);
  return value;
}
function validDate4(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail5("INVALID_TIME", "Evaluation time is invalid");
  return value;
}
function fail5(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/mandate.js
var STRATEGY_MANDATE_SCHEMA_VERSION = 2;
var STRATEGY_ACTION_SCHEMA_VERSION = 1;
var MANDATE_FIELDS = [
  "schemaVersion",
  "mandateId",
  "account",
  "productClientId",
  "sessionBinding",
  "strategyName",
  "strategyHash",
  "strategyVersion",
  "engineCommit",
  "engineRelease",
  "executionKind",
  "executionAccount",
  "nonceDomain",
  "allowedVenues",
  "allowedAssets",
  "allowedMarkets",
  "allowedMethods",
  "allowedContracts",
  "allowedTargets",
  "maxCapital",
  "maxPosition",
  "maxLeverageBps",
  "maxOrder",
  "maxSlippageBps",
  "maxGas",
  "maxFrequencyPerHour",
  "dailyLossLimit",
  "drawdownLimit",
  "noWithdraw",
  "ownerChangeAllowed",
  "arbitraryTransferAllowed",
  "unlimitedApprovalAllowed",
  "computeDataFee",
  "subscriptionFee",
  "managementFeeBps",
  "performanceFeeBps",
  "highWaterMark",
  "lossCarryForward",
  "killSwitch",
  "revoke",
  "emergencyExit",
  "userRiskAccepted",
  "testnetNoValue",
  "issuedAt",
  "expiresAt",
  "source",
  "asOf",
  "version"
];
var TARGET_FIELDS = ["address", "role", "methods"];
var ACTION_FIELDS = [
  "schemaVersion",
  "mandateId",
  "mandateDigest",
  "account",
  "productClientId",
  "sessionBinding",
  "nonceDomain",
  "nonce",
  "venue",
  "asset",
  "market",
  "target",
  "method",
  "capital",
  "position",
  "leverageBps",
  "order",
  "slippageBps",
  "gas",
  "executionsInCurrentHour",
  "dailyLoss",
  "drawdown",
  "at"
];
var CAPITAL_FIELDS = [
  "schemaVersion",
  "productType",
  "name",
  "provider",
  "contract",
  "governance",
  "yieldSource",
  "historicalYieldRange",
  "nonGuarantee",
  "fees",
  "lock",
  "cooldown",
  "slashing",
  "drawdown",
  "withdrawalDelay",
  "reserveRatio",
  "immediateExit",
  "revoke",
  "risk",
  "source",
  "asOf",
  "version"
];
var DANGEROUS_METHODS = /* @__PURE__ */ new Set([
  "0x095ea7b3",
  // approve(address,uint256)
  "0x23b872dd",
  // transferFrom(address,address,uint256)
  "0x3659cfe6",
  // upgradeTo(address)
  "0x715018a6",
  // renounceOwnership()
  "0x8f283970",
  // changeAdmin(address)
  "0xa22cb465",
  // setApprovalForAll(address,bool)
  "0xa9059cbb",
  // transfer(address,uint256)
  "0xf2fde38b"
  // transferOwnership(address)
]);
function parseStrategyMandate(input) {
  exactFields(input, MANDATE_FIELDS, "Wallet strategy mandate");
  const mandate = {
    schemaVersion: exact(input.schemaVersion, "schemaVersion", STRATEGY_MANDATE_SCHEMA_VERSION),
    mandateId: id(input.mandateId, "mandateId"),
    account: pattern3(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    productClientId: id(input.productClientId, "productClientId"),
    sessionBinding: digest(input.sessionBinding, "sessionBinding"),
    strategyName: text4(input.strategyName, "strategyName", 1, 100),
    strategyHash: digest(input.strategyHash, "strategyHash"),
    strategyVersion: text4(input.strategyVersion, "strategyVersion", 1, 64),
    engineCommit: pattern3(input.engineCommit, "engineCommit", /^[0-9a-f]{40}$/),
    engineRelease: text4(input.engineRelease, "engineRelease", 1, 100),
    executionKind: enumeration2(input.executionKind, "executionKind", ["exchange-subaccount", "dex-strategy-vault"]),
    executionAccount: text4(input.executionAccount, "executionAccount", 3, 128),
    nonceDomain: pattern3(input.nonceDomain, "nonceDomain", /^[a-z0-9][a-z0-9:._-]{15,255}$/),
    allowedVenues: list(input.allowedVenues, "allowedVenues", 1, 16, (value) => id(value, "venue")),
    allowedAssets: list(input.allowedAssets, "allowedAssets", 1, 32, (value) => pattern3(value, "asset", /^[A-Z][A-Z0-9.-]{1,15}$/)),
    allowedMarkets: list(input.allowedMarkets, "allowedMarkets", 1, 64, (value) => pattern3(value, "market", /^[A-Z0-9._:/-]{3,63}$/)),
    allowedMethods: list(input.allowedMethods, "allowedMethods", 1, 32, (value) => selector(value, "method")),
    allowedContracts: list(input.allowedContracts, "allowedContracts", 0, 32, (value) => address2(value, "contract")),
    allowedTargets: targetList(input.allowedTargets),
    maxCapital: positive2(input.maxCapital, "maxCapital"),
    maxPosition: positive2(input.maxPosition, "maxPosition"),
    maxLeverageBps: bounded3(input.maxLeverageBps, "maxLeverageBps", 1e4, 1e5),
    maxOrder: positive2(input.maxOrder, "maxOrder"),
    maxSlippageBps: bounded3(input.maxSlippageBps, "maxSlippageBps", 0, 5e3),
    maxGas: positive2(input.maxGas, "maxGas"),
    maxFrequencyPerHour: bounded3(input.maxFrequencyPerHour, "maxFrequencyPerHour", 1, 3600),
    dailyLossLimit: positive2(input.dailyLossLimit, "dailyLossLimit"),
    drawdownLimit: positive2(input.drawdownLimit, "drawdownLimit"),
    noWithdraw: bool(input.noWithdraw, "noWithdraw"),
    ownerChangeAllowed: bool(input.ownerChangeAllowed, "ownerChangeAllowed"),
    arbitraryTransferAllowed: bool(input.arbitraryTransferAllowed, "arbitraryTransferAllowed"),
    unlimitedApprovalAllowed: bool(input.unlimitedApprovalAllowed, "unlimitedApprovalAllowed"),
    computeDataFee: nonnegative2(input.computeDataFee, "computeDataFee"),
    subscriptionFee: nonnegative2(input.subscriptionFee, "subscriptionFee"),
    managementFeeBps: bounded3(input.managementFeeBps, "managementFeeBps", 0, 1e3),
    performanceFeeBps: bounded3(input.performanceFeeBps, "performanceFeeBps", 0, 3e3),
    highWaterMark: bool(input.highWaterMark, "highWaterMark"),
    lossCarryForward: bool(input.lossCarryForward, "lossCarryForward"),
    killSwitch: https(input.killSwitch, "killSwitch"),
    revoke: https(input.revoke, "revoke"),
    emergencyExit: https(input.emergencyExit, "emergencyExit"),
    userRiskAccepted: bool(input.userRiskAccepted, "userRiskAccepted"),
    testnetNoValue: bool(input.testnetNoValue, "testnetNoValue"),
    issuedAt: time(input.issuedAt, "issuedAt"),
    expiresAt: time(input.expiresAt, "expiresAt"),
    source: https(input.source, "source"),
    asOf: time(input.asOf, "asOf"),
    version: text4(input.version, "version", 1, 64)
  };
  const expectedNonceDomain = `ynx:strategy:${mandate.account}:${mandate.productClientId}:${mandate.mandateId}`;
  if (mandate.nonceDomain !== expectedNonceDomain) fail6("NONCE_DOMAIN_MISMATCH", "Mandate nonce domain must bind account, product and mandate");
  if (!mandate.noWithdraw || mandate.ownerChangeAllowed || mandate.arbitraryTransferAllowed || mandate.unlimitedApprovalAllowed) {
    fail6("UNSAFE_MANDATE", "Mandate must prohibit withdrawals, owner changes, arbitrary transfers and unlimited approvals");
  }
  if (!mandate.userRiskAccepted || !mandate.testnetNoValue) fail6("UNACCEPTED_RISK", "Mandate requires explicit loss and Testnet-no-value acknowledgement");
  if (mandate.maxOrder > mandate.maxPosition || mandate.maxPosition > mandate.maxCapital || mandate.dailyLossLimit > mandate.maxCapital || mandate.drawdownLimit > mandate.maxCapital) {
    fail6("INVALID_LIMITS", "Mandate financial limits are inconsistent");
  }
  if (mandate.performanceFeeBps > 0 && (!mandate.highWaterMark || !mandate.lossCarryForward)) fail6("INVALID_FEES", "Performance fees require high-water mark and loss carry-forward");
  if (mandate.expiresAt <= mandate.issuedAt) fail6("INVALID_EXPIRY", "Mandate expiry must follow issuance");
  if (mandate.asOf > mandate.issuedAt) fail6("INVALID_TIME", "Mandate source timestamp cannot follow issuance");
  if (mandate.allowedMethods.some((method3) => DANGEROUS_METHODS.has(method3))) fail6("PROHIBITED_METHOD", "Mandate cannot directly authorize transfer, approval, ownership or upgrade methods");
  validateExecutionBoundary(mandate);
  return freeze2(mandate, ["allowedVenues", "allowedAssets", "allowedMarkets", "allowedMethods", "allowedContracts", "allowedTargets"]);
}
function strategyMandateDigest(input) {
  return digestHex("YNX_WALLET_STRATEGY_MANDATE_V2", parseStrategyMandate(input));
}
function parseStrategyAction(input) {
  exactFields(input, ACTION_FIELDS, "Wallet strategy action");
  return Object.freeze({
    schemaVersion: exact(input.schemaVersion, "schemaVersion", STRATEGY_ACTION_SCHEMA_VERSION),
    mandateId: id(input.mandateId, "mandateId"),
    mandateDigest: digest(input.mandateDigest, "mandateDigest"),
    account: pattern3(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    productClientId: id(input.productClientId, "productClientId"),
    sessionBinding: digest(input.sessionBinding, "sessionBinding"),
    nonceDomain: pattern3(input.nonceDomain, "nonceDomain", /^[a-z0-9][a-z0-9:._-]{15,255}$/),
    nonce: pattern3(input.nonce, "nonce", /^[A-Za-z0-9_-]{16,128}$/),
    venue: id(input.venue, "venue"),
    asset: pattern3(input.asset, "asset", /^[A-Z][A-Z0-9.-]{1,15}$/),
    market: pattern3(input.market, "market", /^[A-Z0-9._:/-]{3,63}$/),
    target: text4(input.target, "target", 3, 128),
    method: selector(input.method, "method"),
    capital: nonnegative2(input.capital, "capital"),
    position: nonnegative2(input.position, "position"),
    leverageBps: bounded3(input.leverageBps, "leverageBps", 0, 1e5),
    order: positive2(input.order, "order"),
    slippageBps: bounded3(input.slippageBps, "slippageBps", 0, 5e3),
    gas: nonnegative2(input.gas, "gas"),
    executionsInCurrentHour: bounded3(input.executionsInCurrentHour, "executionsInCurrentHour", 0, 3600),
    dailyLoss: nonnegative2(input.dailyLoss, "dailyLoss"),
    drawdown: nonnegative2(input.drawdown, "drawdown"),
    at: time(input.at, "at")
  });
}
function authorizeStrategyAction(mandateInput, actionInput, at = /* @__PURE__ */ new Date()) {
  validDate5(at);
  const mandate = parseStrategyMandate(mandateInput);
  const action2 = parseStrategyAction(actionInput);
  const actionTime = new Date(action2.at);
  if (actionTime.getTime() > at.getTime() + 3e4) fail6("FUTURE_ACTION", "Strategy action timestamp is too far in the future");
  if (at.getTime() - actionTime.getTime() > 3e5) fail6("STALE_ACTION", "Strategy action timestamp is stale");
  if (action2.at < mandate.issuedAt || action2.at >= mandate.expiresAt) fail6("INACTIVE_MANDATE", "Strategy mandate is not active for this action");
  for (const field of ["mandateId", "account", "productClientId", "sessionBinding", "nonceDomain"]) {
    if (action2[field] !== mandate[field]) fail6("MANDATE_BINDING_MISMATCH", `Strategy action ${field} does not match the mandate`);
  }
  if (action2.mandateDigest !== strategyMandateDigest(mandate)) fail6("MANDATE_DIGEST_MISMATCH", "Strategy action references a different mandate digest");
  if (!mandate.allowedVenues.includes(action2.venue) || !mandate.allowedAssets.includes(action2.asset) || !mandate.allowedMarkets.includes(action2.market) || !mandate.allowedMethods.includes(action2.method)) {
    fail6("SCOPE_EXPANSION", "Strategy action expands the approved venue, asset, market or method scope");
  }
  if (DANGEROUS_METHODS.has(action2.method)) fail6("PROHIBITED_METHOD", "Strategy action cannot transfer, approve, change ownership or upgrade authority");
  if (action2.capital > mandate.maxCapital || action2.position > mandate.maxPosition || action2.leverageBps > mandate.maxLeverageBps || action2.order > mandate.maxOrder || action2.slippageBps > mandate.maxSlippageBps || action2.gas > mandate.maxGas || action2.executionsInCurrentHour >= mandate.maxFrequencyPerHour || action2.dailyLoss > mandate.dailyLossLimit || action2.drawdown > mandate.drawdownLimit) {
    fail6("LIMIT_EXCEEDED", "Strategy action exceeds an approved mandate limit");
  }
  if (mandate.executionKind === "exchange-subaccount") {
    if (action2.target !== mandate.executionAccount) fail6("WRONG_EXECUTION_ACCOUNT", "Exchange action must use the approved subaccount");
  } else {
    const normalizedTarget = address2(action2.target, "target");
    const target2 = mandate.allowedTargets.find((item) => item.address === normalizedTarget);
    if (!target2 || !target2.methods.includes(action2.method)) fail6("WRONG_DEX_TARGET", "DEX action target or method is outside the approved Vault/Pool/Router boundary");
  }
  return Object.freeze({
    authorized: true,
    mandateId: mandate.mandateId,
    mandateDigest: action2.mandateDigest,
    actionDigest: digestHex("YNX_WALLET_STRATEGY_ACTION_V1", action2),
    nonceDomain: mandate.nonceDomain,
    nonce: action2.nonce,
    at: action2.at
  });
}
function parseCapitalProductReview(input) {
  exactFields(input, CAPITAL_FIELDS, "Wallet capital product review");
  const review = {
    schemaVersion: exact(input.schemaVersion, "schemaVersion", 1),
    productType: enumeration2(input.productType, "productType", ["native-staking", "liquid-staking-candidate", "withdrawal-queue", "safety-module", "service-security-pool", "dex-lp", "vault", "trading-subaccount", "api-wallet", "portfolio-margin", "stablecoin", "bridge-route", "cross-chain-route", "solver-auction", "protocol-owned-liquidity", "treasury-multisig"]),
    name: text4(input.name, "name", 1, 120),
    provider: text4(input.provider, "provider", 1, 120),
    contract: address2(input.contract, "contract"),
    governance: https(input.governance, "governance"),
    yieldSource: text4(input.yieldSource, "yieldSource", 1, 500),
    historicalYieldRange: text4(input.historicalYieldRange, "historicalYieldRange", 1, 200),
    nonGuarantee: bool(input.nonGuarantee, "nonGuarantee"),
    fees: text4(input.fees, "fees", 1, 300),
    lock: text4(input.lock, "lock", 1, 200),
    cooldown: text4(input.cooldown, "cooldown", 1, 200),
    slashing: text4(input.slashing, "slashing", 1, 300),
    drawdown: text4(input.drawdown, "drawdown", 1, 300),
    withdrawalDelay: text4(input.withdrawalDelay, "withdrawalDelay", 1, 200),
    reserveRatio: text4(input.reserveRatio, "reserveRatio", 1, 200),
    immediateExit: https(input.immediateExit, "immediateExit"),
    revoke: https(input.revoke, "revoke"),
    risk: text4(input.risk, "risk", 1, 600),
    source: https(input.source, "source"),
    asOf: time(input.asOf, "asOf"),
    version: text4(input.version, "version", 1, 64)
  };
  if (!review.nonGuarantee) fail6("MISLEADING_CAPITAL_REVIEW", "Capital review must explicitly state that yield, price and peg are not guaranteed");
  return Object.freeze(review);
}
function validateExecutionBoundary(mandate) {
  const targetAddresses = mandate.allowedTargets.map((item) => item.address);
  const targetMethods = [...new Set(mandate.allowedTargets.flatMap((item) => item.methods))].sort();
  if (mandate.executionKind === "exchange-subaccount") {
    if (!/^subaccount:[a-zA-Z0-9._-]{3,96}$/.test(mandate.executionAccount)) fail6("INVALID_EXECUTION_BOUNDARY", "Exchange executionAccount must be an explicit subaccount identifier");
    if (mandate.allowedContracts.length !== 0 || mandate.allowedTargets.length !== 0) fail6("INVALID_EXECUTION_BOUNDARY", "Exchange subaccounts cannot carry DEX contract permissions");
    return;
  }
  const vault = address2(mandate.executionAccount, "executionAccount");
  if (mandate.allowedTargets.length === 0 || !mandate.allowedTargets.some((item) => item.address === vault && item.role === "vault")) fail6("INVALID_EXECUTION_BOUNDARY", "DEX mandates require the execution vault as an exact vault target");
  if (targetAddresses.join("\n") !== mandate.allowedContracts.join("\n")) fail6("INVALID_EXECUTION_BOUNDARY", "DEX allowedContracts must exactly equal the typed target addresses");
  if (targetMethods.join("\n") !== mandate.allowedMethods.join("\n")) fail6("INVALID_EXECUTION_BOUNDARY", "DEX allowedMethods must exactly equal the typed target methods");
}
function targetList(value) {
  if (!Array.isArray(value) || value.length > 32) fail6("INVALID_FIELD", "allowedTargets has an invalid item count");
  const parsed = value.map((item, index) => {
    exactFields(item, TARGET_FIELDS, `Wallet strategy target ${index}`);
    return Object.freeze({
      address: address2(item.address, `allowedTargets[${index}].address`),
      role: enumeration2(item.role, `allowedTargets[${index}].role`, ["vault", "pool", "router"]),
      methods: list(item.methods, `allowedTargets[${index}].methods`, 1, 16, (method3) => selector(method3, "method"))
    });
  });
  const keys = parsed.map((item) => `${item.address}:${item.role}`);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) fail6("INVALID_FIELD", "allowedTargets must be unique and sorted by address and role");
  return Object.freeze(parsed);
}
function freeze2(value, arrays) {
  const copy = { ...value };
  for (const key of arrays) copy[key] = Object.freeze([...copy[key]]);
  return Object.freeze(copy);
}
function list(value, label, min, max, parser) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail6("INVALID_FIELD", `${label} has an invalid item count`);
  const parsed = value.map(parser);
  if (new Set(parsed).size !== parsed.length || [...parsed].sort().join("\n") !== parsed.join("\n")) fail6("INVALID_FIELD", `${label} must be unique and sorted`);
  return Object.freeze(parsed);
}
function id(value, label) {
  return pattern3(value, label, /^[a-z][a-z0-9._-]{2,63}$/);
}
function digest(value, label) {
  return pattern3(value, label, /^[0-9a-f]{64}$/);
}
function selector(value, label) {
  return pattern3(value, label, /^0x[0-9a-f]{8}$/);
}
function address2(value, label) {
  return pattern3(value, label, /^0x[0-9a-f]{40}$/);
}
function pattern3(value, label, regex) {
  const result = text4(value, label, 1, 512);
  if (!regex.test(result)) fail6("INVALID_FIELD", `${label} is invalid`);
  return result;
}
function text4(value, label, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value) fail6("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time(value, label) {
  const result = pattern3(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) fail6("INVALID_TIME", `${label} is invalid`);
  return result;
}
function https(value, label) {
  const result = text4(value, label, 1, 512);
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    fail6("INVALID_URL", `${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.toString() !== result) fail6("INVALID_URL", `${label} must be a canonical HTTPS URL`);
  return result;
}
function bounded3(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail6("INVALID_NUMBER", `${label} is outside its allowed range`);
  return value;
}
function exact(value, label, expected) {
  return bounded3(value, label, expected, expected);
}
function positive2(value, label) {
  return bounded3(value, label, 1, Number.MAX_SAFE_INTEGER);
}
function nonnegative2(value, label) {
  return bounded3(value, label, 0, Number.MAX_SAFE_INTEGER);
}
function bool(value, label) {
  if (typeof value !== "boolean") fail6("INVALID_FIELD", `${label} must be boolean`);
  return value;
}
function enumeration2(value, label, values) {
  if (!values.includes(value)) fail6("INVALID_FIELD", `${label} is unsupported`);
  return value;
}
function validDate5(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail6("INVALID_TIME", "Strategy evaluation time is invalid");
  return value;
}
function fail6(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/mandate-lifecycle.js
var STRATEGY_MANDATE_STORE_SCHEMA_VERSION = 1;
var SNAPSHOT_FIELDS2 = [
  "schemaVersion",
  "mandates",
  "revokedMandateDigests",
  "killedMandateDigests",
  "emergencyExits",
  "consumedActionNonces",
  "consumedActionDigests",
  "audit"
];
var EXIT_FIELDS = ["mandateDigest", "at", "reason"];
var AUDIT_FIELDS2 = ["sequence", "type", "subject", "at", "previousHash", "hash"];
var StrategyMandateStore = class {
  #state;
  constructor(snapshot3 = emptySnapshot2()) {
    this.#state = parseStrategyMandateStoreSnapshot(snapshot3);
  }
  activate(mandateInput, at = /* @__PURE__ */ new Date()) {
    const now = validDate6(at);
    const mandate = parseStrategyMandate(mandateInput);
    const digest7 = strategyMandateDigest(mandate);
    const nowText = now.toISOString();
    if (nowText < mandate.issuedAt || nowText >= mandate.expiresAt) {
      fail7("INACTIVE_MANDATE", "Strategy mandate is not active at activation time");
    }
    if (this.#state.mandates.some((item) => item.mandateId === mandate.mandateId || strategyMandateDigest(item) === digest7)) {
      fail7("MANDATE_EXISTS", "Strategy mandate is already active in this store");
    }
    const next = clone(this.#state);
    next.mandates.push(mandate);
    sortState2(next);
    appendAudit2(next, "mandate-activated", digest7, now);
    this.#state = parseStrategyMandateStoreSnapshot(next);
    return mandate;
  }
  authorize(mandateId, actionInput, at = /* @__PURE__ */ new Date()) {
    const now = validDate6(at);
    const mandate = this.#mandate(mandateId);
    const mandateDigest = strategyMandateDigest(mandate);
    const nowText = now.toISOString();
    if (nowText >= mandate.expiresAt) fail7("INACTIVE_MANDATE", "Strategy mandate has expired");
    if (this.#state.revokedMandateDigests.includes(mandateDigest)) fail7("MANDATE_REVOKED", "Strategy mandate was revoked");
    if (this.#state.emergencyExits.some((exit) => exit.mandateDigest === mandateDigest)) fail7("MANDATE_EXITED", "Strategy mandate completed an emergency exit");
    if (this.#state.killedMandateDigests.includes(mandateDigest)) fail7("MANDATE_KILLED", "Strategy mandate kill switch is active");
    const authorized = authorizeStrategyAction(mandate, actionInput, now);
    const nonceKey = strategyActionNonceKey(authorized.nonceDomain, authorized.nonce);
    if (this.#state.consumedActionNonces.includes(nonceKey) || this.#state.consumedActionDigests.includes(authorized.actionDigest)) {
      fail7("REPLAY", "Strategy action nonce or digest was already consumed");
    }
    if (this.#state.consumedActionNonces.length >= 1e5) fail7("CAPACITY", "Strategy action replay store reached its bound");
    const next = clone(this.#state);
    next.consumedActionNonces.push(nonceKey);
    next.consumedActionDigests.push(authorized.actionDigest);
    sortState2(next);
    appendAudit2(next, "strategy-action-authorized", authorized.actionDigest, now);
    this.#state = parseStrategyMandateStoreSnapshot(next);
    return authorized;
  }
  revoke(mandateId, at = /* @__PURE__ */ new Date()) {
    return this.#terminal(mandateId, "revokedMandateDigests", "mandate-revoked", at, false);
  }
  kill(mandateId, at = /* @__PURE__ */ new Date()) {
    return this.#terminal(mandateId, "killedMandateDigests", "mandate-killed", at, false);
  }
  emergencyExit(mandateId, reason, at = /* @__PURE__ */ new Date()) {
    const now = validDate6(at);
    const mandate = this.#mandate(mandateId);
    const mandateDigest = strategyMandateDigest(mandate);
    if (this.#state.revokedMandateDigests.includes(mandateDigest)) fail7("MANDATE_REVOKED", "Revoked mandate cannot start an emergency exit");
    if (this.#state.emergencyExits.some((exit) => exit.mandateDigest === mandateDigest)) fail7("ALREADY_EXITED", "Strategy mandate already completed an emergency exit");
    const next = clone(this.#state);
    next.emergencyExits.push({ mandateDigest, at: now.toISOString(), reason: boundedReason(reason) });
    sortState2(next);
    appendAudit2(next, "mandate-emergency-exit", mandateDigest, now);
    this.#state = parseStrategyMandateStoreSnapshot(next);
    return Object.freeze(next.emergencyExits.find((exit) => exit.mandateDigest === mandateDigest));
  }
  inventory(account, at = /* @__PURE__ */ new Date()) {
    const now = validDate6(at).toISOString();
    const normalizedAccount = strictAccount2(account);
    return Object.freeze(this.#state.mandates.filter((mandate) => mandate.account === normalizedAccount).map((mandate) => {
      const mandateDigest = strategyMandateDigest(mandate);
      let status = "active";
      if (this.#state.emergencyExits.some((exit) => exit.mandateDigest === mandateDigest)) status = "emergency-exit";
      else if (this.#state.revokedMandateDigests.includes(mandateDigest)) status = "revoked";
      else if (this.#state.killedMandateDigests.includes(mandateDigest)) status = "killed";
      else if (now >= mandate.expiresAt) status = "expired";
      return Object.freeze({ mandate, mandateDigest, status });
    }));
  }
  snapshot() {
    return freezeSnapshot2(clone(this.#state));
  }
  #mandate(mandateId) {
    const normalized = strictId(mandateId, "mandateId");
    const mandate = this.#state.mandates.find((item) => item.mandateId === normalized);
    if (!mandate) fail7("MANDATE_NOT_FOUND", "Strategy mandate was not found");
    return mandate;
  }
  #terminal(mandateId, field, type, at, allowKilled) {
    const now = validDate6(at);
    const mandate = this.#mandate(mandateId);
    const mandateDigest = strategyMandateDigest(mandate);
    if (this.#state.revokedMandateDigests.includes(mandateDigest)) fail7("MANDATE_REVOKED", "Strategy mandate was already revoked");
    if (!allowKilled && this.#state.killedMandateDigests.includes(mandateDigest)) fail7("MANDATE_KILLED", "Strategy mandate kill switch is already active");
    if (this.#state.emergencyExits.some((exit) => exit.mandateDigest === mandateDigest)) fail7("MANDATE_EXITED", "Strategy mandate already completed an emergency exit");
    const next = clone(this.#state);
    next[field].push(mandateDigest);
    sortState2(next);
    appendAudit2(next, type, mandateDigest, now);
    this.#state = parseStrategyMandateStoreSnapshot(next);
    return mandateDigest;
  }
};
function strategyActionNonceKey(nonceDomain, nonce) {
  return digestHex("YNX_WALLET_STRATEGY_ACTION_NONCE_V1", {
    nonceDomain: strictNonceDomain(nonceDomain),
    nonce: strictNonce(nonce)
  });
}
function parseStrategyMandateStoreSnapshot(input) {
  exactFields(input, SNAPSHOT_FIELDS2, "Strategy mandate store snapshot");
  if (input.schemaVersion !== STRATEGY_MANDATE_STORE_SCHEMA_VERSION) fail7("INVALID_STORE", "Strategy mandate store schema is unsupported");
  const mandates = parseMandates(input.mandates);
  const mandateDigests = mandates.map(strategyMandateDigest);
  const revokedMandateDigests = sortedDigests(input.revokedMandateDigests, "revokedMandateDigests", mandateDigests);
  const killedMandateDigests = sortedDigests(input.killedMandateDigests, "killedMandateDigests", mandateDigests);
  const emergencyExits = parseEmergencyExits(input.emergencyExits, mandateDigests);
  if (revokedMandateDigests.some((digest7) => killedMandateDigests.includes(digest7) || emergencyExits.some((exit) => exit.mandateDigest === digest7))) {
    fail7("INVALID_STORE", "A revoked mandate cannot also be killed or emergency-exited");
  }
  const consumedActionNonces = sortedDigests(input.consumedActionNonces, "consumedActionNonces");
  const consumedActionDigests = sortedDigests(input.consumedActionDigests, "consumedActionDigests");
  if (consumedActionNonces.length !== consumedActionDigests.length) fail7("INVALID_STORE", "Consumed strategy action nonce and digest counts must match");
  const audit = parseAudit2(input.audit);
  return freezeSnapshot2({
    schemaVersion: STRATEGY_MANDATE_STORE_SCHEMA_VERSION,
    mandates,
    revokedMandateDigests,
    killedMandateDigests,
    emergencyExits,
    consumedActionNonces,
    consumedActionDigests,
    audit
  });
}
function emptySnapshot2() {
  return {
    schemaVersion: STRATEGY_MANDATE_STORE_SCHEMA_VERSION,
    mandates: [],
    revokedMandateDigests: [],
    killedMandateDigests: [],
    emergencyExits: [],
    consumedActionNonces: [],
    consumedActionDigests: [],
    audit: []
  };
}
function parseMandates(value) {
  if (!Array.isArray(value) || value.length > 1e4) fail7("INVALID_STORE", "mandates has an invalid item count");
  const mandates = value.map(parseStrategyMandate);
  const ids = mandates.map((mandate) => mandate.mandateId);
  const digests = mandates.map(strategyMandateDigest);
  if (new Set(ids).size !== ids.length || new Set(digests).size !== digests.length || [...ids].sort().join("\n") !== ids.join("\n")) {
    fail7("INVALID_STORE", "mandates must be unique and sorted by mandateId");
  }
  return Object.freeze(mandates);
}
function sortedDigests(value, label, allowed) {
  if (!Array.isArray(value) || value.length > 1e5 || value.some((item) => typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) {
    fail7("INVALID_STORE", `${label} must be bounded, unique and sorted`);
  }
  if (allowed && value.some((item) => !allowed.includes(item))) fail7("INVALID_STORE", `${label} references an unknown mandate`);
  return Object.freeze([...value]);
}
function parseEmergencyExits(value, mandateDigests) {
  if (!Array.isArray(value) || value.length > 1e4) fail7("INVALID_STORE", "emergencyExits has an invalid item count");
  const exits = value.map((exit, index) => {
    exactFields(exit, EXIT_FIELDS, `Strategy emergency exit ${index}`);
    const parsed = Object.freeze({
      mandateDigest: strictDigest2(exit.mandateDigest, "mandateDigest"),
      at: strictTime5(exit.at, "emergency exit at"),
      reason: boundedReason(exit.reason)
    });
    if (!mandateDigests.includes(parsed.mandateDigest)) fail7("INVALID_STORE", "Emergency exit references an unknown mandate");
    return parsed;
  });
  const keys = exits.map((exit) => exit.mandateDigest);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) fail7("INVALID_STORE", "emergencyExits must be unique and sorted");
  return Object.freeze(exits);
}
function parseAudit2(value) {
  if (!Array.isArray(value) || value.length > 2e5) fail7("INVALID_STORE", "audit has an invalid item count");
  let previousHash = null;
  return Object.freeze(value.map((event, index) => {
    exactFields(event, AUDIT_FIELDS2, "Strategy mandate audit event");
    const unsigned3 = {
      sequence: event.sequence,
      type: event.type,
      subject: event.subject,
      at: event.at,
      previousHash: event.previousHash
    };
    if (event.sequence !== index + 1 || typeof event.type !== "string" || !/^[a-z][a-z-]{2,63}$/.test(event.type) || typeof event.subject !== "string" || !/^[0-9a-f]{64}$/.test(event.subject) || strictTime5(event.at, "audit at") !== event.at || event.previousHash !== previousHash || event.hash !== digestHex("YNX_WALLET_STRATEGY_AUDIT_V1", unsigned3)) {
      fail7("INVALID_STORE", "Strategy mandate audit hash chain is invalid");
    }
    previousHash = event.hash;
    return Object.freeze({ ...event });
  }));
}
function appendAudit2(state2, type, subject, at) {
  const unsigned3 = {
    sequence: state2.audit.length + 1,
    type,
    subject,
    at: validDate6(at).toISOString(),
    previousHash: state2.audit.at(-1)?.hash ?? null
  };
  state2.audit.push({ ...unsigned3, hash: digestHex("YNX_WALLET_STRATEGY_AUDIT_V1", unsigned3) });
}
function sortState2(state2) {
  state2.mandates.sort((left, right) => left.mandateId.localeCompare(right.mandateId));
  for (const field of ["revokedMandateDigests", "killedMandateDigests", "consumedActionNonces", "consumedActionDigests"]) state2[field].sort();
  state2.emergencyExits.sort((left, right) => left.mandateDigest.localeCompare(right.mandateDigest));
}
function freezeSnapshot2(state2) {
  return Object.freeze({
    ...state2,
    mandates: Object.freeze(state2.mandates.map((mandate) => parseStrategyMandate(mandate))),
    revokedMandateDigests: Object.freeze([...state2.revokedMandateDigests]),
    killedMandateDigests: Object.freeze([...state2.killedMandateDigests]),
    emergencyExits: Object.freeze(state2.emergencyExits.map((exit) => Object.freeze({ ...exit }))),
    consumedActionNonces: Object.freeze([...state2.consumedActionNonces]),
    consumedActionDigests: Object.freeze([...state2.consumedActionDigests]),
    audit: Object.freeze(state2.audit.map((event) => Object.freeze({ ...event })))
  });
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function strictId(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._-]{2,63}$/.test(value)) fail7("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function strictDigest2(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail7("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function strictAccount2(value) {
  if (typeof value !== "string" || !/^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value)) fail7("INVALID_FIELD", "account is invalid");
  return value;
}
function strictNonceDomain(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9:._-]{15,255}$/.test(value)) fail7("INVALID_FIELD", "nonceDomain is invalid");
  return value;
}
function strictNonce(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail7("INVALID_FIELD", "nonce is invalid");
  return value;
}
function strictTime5(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) fail7("INVALID_TIME", `${label} is invalid`);
  return value;
}
function boundedReason(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > 300) fail7("INVALID_FIELD", "emergency exit reason is invalid");
  return value;
}
function validDate6(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail7("INVALID_TIME", "Strategy mandate store time is invalid");
  return value;
}
function fail7(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/credential.js
var FIELDS = ["schemaVersion", "credentialId", "type", "issuer", "subjectBinding", "claim", "issuedAt", "expiresAt", "status", "proofDigest", "auditId", "source", "asOf", "version"];
var CLAIM_FIELDS = ["kind", "value"];
var STATUS_FIELDS = ["type", "url", "index"];
var ALLOWED = Object.freeze({
  "age-eligibility": ["eligible", "not-eligible"],
  "region-eligibility": ["eligible", "not-eligible"],
  merchant: ["verified", "not-verified"],
  institution: ["verified", "not-verified"],
  "kyc-completed-reference": ["completed", "not-completed"],
  "professional-classification-reference": ["accredited", "professional", "not-classified"]
});
function parseCredentialCandidate(input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, FIELDS, "Selective disclosure credential candidate");
  exactFields(input.claim, CLAIM_FIELDS, "Credential claim");
  exactFields(input.status, STATUS_FIELDS, "Credential status");
  const type = enumeration3(input.type, "type", Object.keys(ALLOWED));
  const credential = {
    schemaVersion: exact2(input.schemaVersion, "schemaVersion", 1),
    credentialId: uri(input.credentialId, "credentialId"),
    type,
    issuer: https2(input.issuer, "issuer"),
    subjectBinding: digest2(input.subjectBinding, "subjectBinding"),
    claim: Object.freeze({ kind: type, value: enumeration3(input.claim.value, "claim value", ALLOWED[type]) }),
    issuedAt: time2(input.issuedAt, "issuedAt"),
    expiresAt: time2(input.expiresAt, "expiresAt"),
    status: Object.freeze({ type: enumeration3(input.status.type, "status type", ["BitstringStatusListEntry"]), url: https2(input.status.url, "status URL"), index: bounded4(input.status.index, "status index", 0, 131071) }),
    proofDigest: digest2(input.proofDigest, "proofDigest"),
    auditId: digest2(input.auditId, "auditId"),
    source: https2(input.source, "source"),
    asOf: time2(input.asOf, "asOf"),
    version: text5(input.version, "version", 1, 64)
  };
  if (credential.claim.kind !== credential.type) fail8("CLAIM_MISMATCH", "Credential claim does not match its declared type");
  if (credential.expiresAt <= credential.issuedAt) fail8("INVALID_EXPIRY", "Credential expiry must follow issuance");
  const now = validDate7(at).toISOString();
  if (now < credential.issuedAt || now >= credential.expiresAt) fail8("INACTIVE_CREDENTIAL", "Credential is not active at verification time");
  return Object.freeze(credential);
}
function credentialCandidateDigest(input, at = /* @__PURE__ */ new Date()) {
  return digestHex("YNX_SELECTIVE_DISCLOSURE_CREDENTIAL_V1", parseCredentialCandidate(input, at));
}
function uri(value, label) {
  const result = text5(value, label, 1, 512);
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    fail8("INVALID_URL", `${label} is invalid`);
  }
  if (!parsed.protocol || parsed.username || parsed.password || parsed.hash || parsed.toString() !== result) fail8("INVALID_URL", `${label} must be canonical`);
  return result;
}
function https2(value, label) {
  const result = uri(value, label);
  if (!result.startsWith("https://")) fail8("INVALID_URL", `${label} must use HTTPS`);
  return result;
}
function digest2(value, label) {
  return pattern4(value, label, /^[0-9a-f]{64}$/);
}
function pattern4(value, label, regex) {
  const result = text5(value, label, 1, 512);
  if (!regex.test(result)) fail8("INVALID_FIELD", `${label} is invalid`);
  return result;
}
function text5(value, label, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value) fail8("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time2(value, label) {
  const result = pattern4(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) fail8("INVALID_TIME", `${label} is invalid`);
  return result;
}
function bounded4(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail8("INVALID_NUMBER", `${label} is outside its allowed range`);
  return value;
}
function exact2(value, label, expected) {
  return bounded4(value, label, expected, expected);
}
function enumeration3(value, label, values) {
  if (!values.includes(value)) fail8("INVALID_FIELD", `${label} is unsupported`);
  return value;
}
function validDate7(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail8("INVALID_TIME", "Credential verification time is invalid");
  return value;
}
function fail8(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/intent.js
var INTENT_FIELDS = ["schemaVersion", "intentId", "sessionBinding", "productClientId", "bundleId", "account", "action", "parametersDigest", "evidence", "trust", "approval", "ai", "nonce", "issuedAt", "expiresAt", "accountPublicKey", "signature"];
var CREATE_FIELDS2 = ["accountSecret", "schemaVersion", "intentId", "sessionBinding", "productClientId", "bundleId", "account", "action", "parametersDigest", "evidence", "trust", "approval", "ai", "nonce", "issuedAt", "expiresAt"];
var EVIDENCE_FIELDS = ["sourceClass", "source", "asOf", "version", "status", "digest", "confidenceBps", "coverage"];
var TRUST_FIELDS = ["issuer", "policy", "decision", "reasons"];
var APPROVAL_FIELDS = ["actor", "mode", "reviewedDigest"];
var AI_FIELDS = ["used", "role", "provider", "model", "outputDigest"];
var CONTEXT_FIELDS = ["sessionBinding", "productClientId", "bundleId", "account", "action", "parametersDigest", "revokedIntentDigests"];
function createSignedIntent(input) {
  exactFields(input, CREATE_FIELDS2, "Signed Intent creation input");
  const identity = walletIdentity(input.accountSecret);
  if (identity.account !== input.account) fail9("ACCOUNT_MISMATCH", "Signed Intent account does not match the signing key");
  const { accountSecret: accountSecret2, ...payload } = input;
  const unsigned3 = parseUnsigned({ ...payload, accountPublicKey: identity.accountPublicKey });
  const signature = bytesToHex(secp256k1.sign(sha256(utf8ToBytes(intentSignBytes(unsigned3))), hexToBytes(accountSecret2), { prehash: false, format: "compact", lowS: true }));
  return parseSignedIntent({ ...unsigned3, signature });
}
function parseSignedIntent(input) {
  exactFields(input, INTENT_FIELDS, "Signed Intent");
  const { signature, ...candidate2 } = input;
  const intent = { ...parseUnsigned(candidate2), signature: pattern5(signature, "signature", /^[0-9a-f]{128}$/) };
  let verified = false;
  try {
    verified = walletIdentityFromPublicKey(intent.accountPublicKey) === intent.account && secp256k1.verify(hexToBytes(intent.signature), sha256(utf8ToBytes(intentSignBytes(unsignedIntent(intent)))), hexToBytes(intent.accountPublicKey), { prehash: false, format: "compact", lowS: true });
  } catch {
    verified = false;
  }
  if (!verified) fail9("INVALID_INTENT_SIGNATURE", "Signed Intent signature is invalid");
  return deepFreeze(intent);
}
function signedIntentDigest(input) {
  return digestHex("YNX_SIGNED_INTENT_RECEIPT_V1", parseSignedIntent(input));
}
function exportSignedIntent(input) {
  return canonicalJSON(parseSignedIntent(input));
}
function assertSignedIntentActive(input, context, at = /* @__PURE__ */ new Date()) {
  exactFields(context, CONTEXT_FIELDS, "Signed Intent execution context");
  const intent = parseSignedIntent(input);
  const expected = {
    sessionBinding: digest3(context.sessionBinding, "sessionBinding"),
    productClientId: id2(context.productClientId, "productClientId"),
    bundleId: pattern5(context.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    account: pattern5(context.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    action: action(context.action),
    parametersDigest: digest3(context.parametersDigest, "parametersDigest")
  };
  for (const key of Object.keys(expected)) if (intent[key] !== expected[key]) fail9("INTENT_BINDING_MISMATCH", `Signed Intent ${key} does not match execution context`);
  const revoked = list2(context.revokedIntentDigests, "revokedIntentDigests", 0, 1e4, (value) => digest3(value, "revoked intent digest"));
  if (revoked.includes(signedIntentDigest(intent))) fail9("REVOKED", "Signed Intent was revoked");
  const now = validDate8(at).toISOString();
  if (now < intent.issuedAt || now >= intent.expiresAt) fail9("EXPIRED", "Signed Intent is not active");
  return intent;
}
function parseUnsigned(input) {
  exactFields(input, INTENT_FIELDS.filter((key) => key !== "signature"), "Unsigned Signed Intent");
  const evidence2 = parseEvidence(input.evidence), trust = parseTrust(input.trust), approval = parseApproval(input.approval), ai = parseAI(input.ai);
  const intent = {
    schemaVersion: exact3(input.schemaVersion, "schemaVersion", 1),
    intentId: id2(input.intentId, "intentId"),
    sessionBinding: digest3(input.sessionBinding, "sessionBinding"),
    productClientId: id2(input.productClientId, "productClientId"),
    bundleId: pattern5(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/),
    account: pattern5(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    action: action(input.action),
    parametersDigest: digest3(input.parametersDigest, "parametersDigest"),
    evidence: evidence2,
    trust,
    approval,
    ai,
    nonce: pattern5(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/),
    issuedAt: time3(input.issuedAt, "issuedAt"),
    expiresAt: time3(input.expiresAt, "expiresAt"),
    accountPublicKey: pattern5(input.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/)
  };
  if (intent.expiresAt <= intent.issuedAt || Date.parse(intent.expiresAt) - Date.parse(intent.issuedAt) > 3e5) fail9("INVALID_EXPIRY", "Signed Intent lifetime must be positive and at most five minutes");
  if (approval.reviewedDigest !== intent.parametersDigest) fail9("REVIEW_MISMATCH", "Human approval must cover the exact parameter digest");
  return deepFreeze(intent);
}
function parseEvidence(input) {
  exactFields(input, EVIDENCE_FIELDS, "Signed Intent evidence");
  return Object.freeze({ sourceClass: enumeration4(input.sourceClass, "sourceClass", ["ynx-authoritative", "third-party", "estimate", "ai-inference", "cache", "user-input"]), source: https3(input.source, "evidence source"), asOf: time3(input.asOf, "evidence asOf"), version: text6(input.version, "evidence version", 1, 64), status: enumeration4(input.status, "evidence status", ["available", "unavailable", "stale", "failed"]), digest: digest3(input.digest, "evidence digest"), confidenceBps: bounded5(input.confidenceBps, "confidenceBps", 0, 1e4), coverage: text6(input.coverage, "coverage", 1, 200) });
}
function parseTrust(input) {
  exactFields(input, TRUST_FIELDS, "Signed Intent trust decision");
  return Object.freeze({ issuer: https3(input.issuer, "trust issuer"), policy: https3(input.policy, "trust policy"), decision: enumeration4(input.decision, "trust decision", ["allow", "deny", "review"]), reasons: list2(input.reasons, "trust reasons", 1, 16, (value) => text6(value, "trust reason", 1, 160)) });
}
function parseApproval(input) {
  exactFields(input, APPROVAL_FIELDS, "Signed Intent approval");
  return Object.freeze({ actor: enumeration4(input.actor, "approval actor", ["human"]), mode: enumeration4(input.mode, "approval mode", ["biometric", "external-signer"]), reviewedDigest: digest3(input.reviewedDigest, "reviewedDigest") });
}
function parseAI(input) {
  exactFields(input, AI_FIELDS, "Signed Intent AI boundary");
  const used = bool2(input.used, "AI used"), role = enumeration4(input.role, "AI role", ["none", "explain-only"]);
  if (used !== (role === "explain-only")) fail9("AI_BOUNDARY", "AI use must be explain-only");
  const provider = nullableText(input.provider, "AI provider"), model = nullableText(input.model, "AI model"), outputDigest = input.outputDigest === null ? null : digest3(input.outputDigest, "AI output digest");
  if (used && (!provider || !model || !outputDigest)) fail9("AI_BOUNDARY", "AI explanation requires provider, model and output digest");
  if (!used && (provider || model || outputDigest)) fail9("AI_BOUNDARY", "Unused AI cannot carry provider output");
  return Object.freeze({ used, role, provider, model, outputDigest });
}
function unsignedIntent(intent) {
  const { signature: _signature, ...unsigned3 } = intent;
  return unsigned3;
}
function intentSignBytes(unsigned3) {
  return `YNX_SIGNED_INTENT_V1
${canonicalJSON(unsigned3)}`;
}
function deepFreeze(value) {
  return Object.freeze({ ...value, evidence: Object.freeze(value.evidence), trust: Object.freeze({ ...value.trust, reasons: Object.freeze([...value.trust.reasons]) }), approval: Object.freeze(value.approval), ai: Object.freeze(value.ai) });
}
function action(value) {
  return enumeration4(value, "action", ["user-operation", "native-transfer", "strategy-mandate", "capital-enter", "capital-exit", "credential-present", "revoke"]);
}
function list2(value, label, min, max, parser) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail9("INVALID_FIELD", `${label} has an invalid item count`);
  const parsed = value.map(parser);
  if (new Set(parsed).size !== parsed.length || [...parsed].sort().join("\n") !== parsed.join("\n")) fail9("INVALID_FIELD", `${label} must be unique and sorted`);
  return Object.freeze(parsed);
}
function id2(value, label) {
  return pattern5(value, label, /^[a-z][a-z0-9._-]{2,63}$/);
}
function digest3(value, label) {
  return pattern5(value, label, /^[0-9a-f]{64}$/);
}
function pattern5(value, label, regex) {
  const result = text6(value, label, 1, 512);
  if (!regex.test(result)) fail9("INVALID_FIELD", `${label} is invalid`);
  return result;
}
function text6(value, label, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value) fail9("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function nullableText(value, label) {
  if (value === null) return null;
  return text6(value, label, 1, 128);
}
function time3(value, label) {
  const result = pattern5(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) fail9("INVALID_TIME", `${label} is invalid`);
  return result;
}
function https3(value, label) {
  const result = text6(value, label, 1, 512);
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    fail9("INVALID_URL", `${label} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.toString() !== result) fail9("INVALID_URL", `${label} must be a canonical HTTPS URL`);
  return result;
}
function bounded5(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail9("INVALID_NUMBER", `${label} is outside its allowed range`);
  return value;
}
function exact3(value, label, expected) {
  return bounded5(value, label, expected, expected);
}
function bool2(value, label) {
  if (typeof value !== "boolean") fail9("INVALID_FIELD", `${label} must be boolean`);
  return value;
}
function enumeration4(value, label, values) {
  if (!values.includes(value)) fail9("INVALID_FIELD", `${label} is unsupported`);
  return value;
}
function validDate8(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail9("INVALID_TIME", "Signed Intent verification time is invalid");
  return value;
}
function fail9(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/session-proof.js
var FIELDS2 = ["version", "sessionBinding", "productClientId", "bundleId", "productDeviceKey", "origin", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt", "signature"];
var CREATE_FIELDS3 = ["method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];
var EXPECTED_FIELDS = ["method", "path", "bodyDigest", "origin"];
var DOMAIN = "YNX_PRODUCT_SESSION_HTTP_PROOF_V2";
function createProductSessionProof(sessionInput, input, productDeviceSecret) {
  const session = parseCentralWalletSession(sessionInput);
  exactFields(input, CREATE_FIELDS3, "Product Session proof input");
  if (session.verifierVersion !== "wallet-auth-v2") fail10("SESSION_RETIRED", "Product Session predates origin binding and must reconnect");
  const secret = decodeBase64url(productDeviceSecret, "product device secret");
  if (secret.length !== 32 || encodeBase64url(p256.getPublicKey(secret, true)) !== session.productDeviceKey) fail10("DEVICE_MISMATCH", "Product Session proof key does not match the session device");
  const unsigned3 = parseUnsigned2({ version: "2", sessionBinding: session.sessionBinding, productClientId: session.productClientId, bundleId: session.bundleId, productDeviceKey: session.productDeviceKey, origin: session.origin, method: input.method, path: input.path, bodyDigest: input.bodyDigest, nonce: input.nonce, issuedAt: input.issuedAt, expiresAt: input.expiresAt });
  const signature = encodeBase64url(p256.sign(utf8ToBytes(productSessionProofSignBytes(unsigned3)), secret, { format: "der" }));
  return parseProductSessionProof({ ...unsigned3, signature });
}
function parseProductSessionProof(input) {
  exactFields(input, FIELDS2, "Product Session HTTP proof");
  const { signature, ...unsigned3 } = input;
  const proof = { ...parseUnsigned2(unsigned3), signature: base64Signature(signature) };
  return Object.freeze(proof);
}
function productSessionProofSignBytes(input) {
  return `${DOMAIN}
${canonicalJSON(parseUnsigned2(input))}`;
}
function productSessionProofDigest(input) {
  return digestHex("YNX_PRODUCT_SESSION_HTTP_PROOF_DIGEST_V1", parseProductSessionProof(input));
}
function httpBodyDigest(body) {
  if (typeof body !== "string" && !(body instanceof Uint8Array)) fail10("INVALID_BODY", "HTTP proof body must be a string or bytes");
  return bytesToHex(sha256(typeof body === "string" ? utf8ToBytes(body) : body));
}
function verifyProductSessionProof(proofInput, sessionInput, expectedInput, at = /* @__PURE__ */ new Date()) {
  const proof = parseProductSessionProof(proofInput), session = parseCentralWalletSession(sessionInput);
  exactFields(expectedInput, EXPECTED_FIELDS, "Product Session HTTP context");
  const expected = { method: method(expectedInput.method), path: path(expectedInput.path), bodyDigest: digest4(expectedInput.bodyDigest, "bodyDigest"), origin: origin(expectedInput.origin) };
  for (const key of ["sessionBinding", "productClientId", "bundleId", "productDeviceKey", "origin"]) if (proof[key] !== session[key]) fail10("SESSION_BINDING_MISMATCH", `Product Session proof ${key} does not match the session`);
  for (const key of Object.keys(expected)) if (proof[key] !== expected[key]) fail10("HTTP_BINDING_MISMATCH", `Product Session proof ${key} does not match the HTTP request`);
  const now = validDate9(at).toISOString();
  if (proof.issuedAt < session.issuedAt) fail10("INVALID_TIME", "Product Session proof predates its session");
  if (proof.issuedAt > now) fail10("ISSUED_IN_FUTURE", "Product Session proof issue time is in the future");
  if (proof.expiresAt <= now || proof.expiresAt > session.expiresAt) fail10("EXPIRED", "Product Session proof is expired or exceeds its session");
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url(proof.signature, "proof signature"), utf8ToBytes(productSessionProofSignBytes(unsigned(proof))), decodeBase64url(proof.productDeviceKey, "product device key"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail10("INVALID_DEVICE_PROOF", "Product Session HTTP proof signature is invalid");
  return proof;
}
function parseUnsigned2(input) {
  exactFields(input, FIELDS2.filter((key) => key !== "signature"), "Unsigned Product Session HTTP proof");
  const value = { version: pattern6(input.version, "version", /^2$/), sessionBinding: digest4(input.sessionBinding, "sessionBinding"), productClientId: pattern6(input.productClientId, "productClientId", /^[a-z][a-z0-9._-]{2,63}$/), bundleId: pattern6(input.bundleId, "bundleId", /^[A-Za-z][A-Za-z0-9.-]{2,127}$/), productDeviceKey: deviceKey(input.productDeviceKey), origin: origin(input.origin), method: method(input.method), path: path(input.path), bodyDigest: digest4(input.bodyDigest, "bodyDigest"), nonce: pattern6(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/), issuedAt: time4(input.issuedAt, "issuedAt"), expiresAt: time4(input.expiresAt, "expiresAt") };
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 6e4) fail10("INVALID_EXPIRY", "Product Session proof lifetime must be positive and at most sixty seconds");
  return Object.freeze(value);
}
function unsigned(value) {
  const { signature: _signature, ...result } = value;
  return result;
}
function deviceKey(value) {
  const normalized = pattern6(value, "productDeviceKey", /^[A-Za-z0-9_-]{44}$/);
  const bytes = decodeBase64url(normalized, "product device key");
  if (bytes.length !== 33 || encodeBase64url(bytes) !== normalized) fail10("INVALID_DEVICE_KEY", "Product device key is invalid");
  try {
    p256.Point.fromBytes(bytes);
  } catch {
    fail10("INVALID_DEVICE_KEY", "Product device key is not a P-256 point");
  }
  return normalized;
}
function base64Signature(value) {
  const normalized = pattern6(value, "signature", /^[A-Za-z0-9_-]{90,96}$/);
  const bytes = decodeBase64url(normalized, "signature");
  if (bytes.length < 68 || bytes.length > 72 || encodeBase64url(bytes) !== normalized) fail10("INVALID_DEVICE_PROOF", "Product Session proof signature is invalid");
  return normalized;
}
function method(value) {
  return pattern6(value, "method", /^(DELETE|GET|PATCH|POST|PUT)$/);
}
function path(value) {
  const result = pattern6(value, "path", /^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/);
  if (result.includes("//") || result.endsWith("/") || result.includes("?") || result.includes("#")) fail10("INVALID_PATH", "Product Session proof path must be canonical without query, fragment or percent encoding");
  return result;
}
function origin(value) {
  const result = pattern6(value, "origin", /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/);
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    fail10("INVALID_ORIGIN", "Product Session proof origin is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.toString() !== `${result}/`) fail10("INVALID_ORIGIN", "Product Session proof origin must be canonical HTTPS");
  return result;
}
function digest4(value, label) {
  return pattern6(value, label, /^[0-9a-f]{64}$/);
}
function pattern6(value, label, regex) {
  if (typeof value !== "string" || value.trim() !== value || !regex.test(value)) fail10("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time4(value, label) {
  const result = pattern6(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) fail10("INVALID_TIME", `${label} is invalid`);
  return result;
}
function validDate9(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail10("INVALID_TIME", "Product Session proof verification time is invalid");
  return value;
}
function fail10(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/gateway-adapter.js
var CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION = 2;
var SNAPSHOT_V1_FIELDS2 = ["schemaVersion", "registryVersion", "sessionStore", "consumedProductProofs"];
var SNAPSHOT_FIELDS3 = [...SNAPSHOT_V1_FIELDS2, "mandateStore"];
var COMPLETE_FIELDS = ["authorizationRequest", "walletApproval", "gatewayCompletion"];
var AUTH_FIELDS = ["proof", "requiredScopes"];
var PROOF_FIELDS2 = ["proof"];
var MANDATE_ACTIVATE_FIELDS = ["proof", "mandate"];
var MANDATE_ACTION_FIELDS = ["proof", "mandateId", "action"];
var MANDATE_TERMINAL_FIELDS = ["proof", "mandateId"];
var MANDATE_EXIT_FIELDS = ["proof", "mandateId", "reason"];
var REQUEST_FIELDS5 = ["method", "path", "bodyDigest", "origin"];
var CanonicalWalletGatewayAdapter = class {
  #registry;
  #store;
  #proofs;
  #mandates;
  constructor(registryInput, snapshot3) {
    this.#registry = parseCentralRegistryDocument(registryInput);
    const parsed = snapshot3 === void 0 ? emptySnapshot3(this.#registry.registryVersion) : parseGatewayAdapterSnapshot(snapshot3, this.#registry.registryVersion);
    this.#store = new CentralWalletSessionStore(parsed.sessionStore);
    this.#proofs = [...parsed.consumedProductProofs];
    this.#mandates = new StrategyMandateStore(parsed.mandateStore);
  }
  complete(input, at = /* @__PURE__ */ new Date()) {
    exactFields(input, COMPLETE_FIELDS, "Canonical Gateway completion input");
    const client = input.authorizationRequest?.productClientId;
    if (typeof client !== "string") fail11("UNKNOWN_PRODUCT", "Canonical Gateway request has no product client");
    const retirement = this.#registry.retiredClients.find((record2) => retirementMatchesAuthorization(record2, input.authorizationRequest));
    if (retirement) throw new ClientRetiredError(retirement);
    const registration = this.#registry.products.find((product) => product.productClientId === client);
    if (!registration) fail11("UNKNOWN_PRODUCT", "Canonical Gateway product client is not registered");
    const registryEntry = centralProtocolEntry(registration);
    return this.#store.complete({ registryEntry, ...input }, at);
  }
  introspect(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, AUTH_FIELDS, "Canonical Gateway introspection input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), input.requiredScopes, at);
    this.#consume(authenticated.proof);
    return authenticated.result;
  }
  revokeSession(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, PROOF_FIELDS2, "Canonical Gateway session revoke input");
    const authenticated = this.#authenticateRevocationProof(input.proof, parseRequest(request), at);
    const revoked = this.#store.revokeSession(authenticated.session.sessionBinding, at);
    this.#consume(authenticated.proof);
    return revoked;
  }
  revokeApproval(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, PROOF_FIELDS2, "Canonical Gateway approval revoke input");
    const authenticated = this.#authenticateRevocationProof(input.proof, parseRequest(request), at);
    const revoked = this.#store.revokeApproval(authenticated.session.approvalDigest, at);
    this.#consume(authenticated.proof);
    return revoked;
  }
  revokeDevice(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, PROOF_FIELDS2, "Canonical Gateway device revoke input");
    const authenticated = this.#authenticateRevocationProof(input.proof, parseRequest(request), at);
    const revoked = this.#store.revokeDevice(authenticated.session.deviceBinding, at);
    this.#consume(authenticated.proof);
    return revoked;
  }
  sessionInventory(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, PROOF_FIELDS2, "Canonical Gateway session inventory input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["wallet:sessions"], at);
    this.#assertWalletControlSession(authenticated.session, "Session inventory");
    const inventory = this.#store.inventory(authenticated.session.account, at);
    this.#consume(authenticated.proof);
    return inventory;
  }
  logoutAllDevices(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, PROOF_FIELDS2, "Canonical Gateway all-device logout input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["wallet:sessions"], at);
    this.#assertWalletControlSession(authenticated.session, "All-device logout");
    const logout = this.#store.logoutAllDevices(authenticated.session.account, at);
    this.#consume(authenticated.proof);
    return logout;
  }
  activateMandate(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, MANDATE_ACTIVATE_FIELDS, "Canonical Gateway mandate activation input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:mandate:create"], at);
    const mandate = parseStrategyMandate(input.mandate);
    assertSessionSubject(mandate, authenticated.session);
    const activated = this.#mandates.activate(mandate, at);
    this.#consume(authenticated.proof);
    return activated;
  }
  authorizeMandateAction(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, MANDATE_ACTION_FIELDS, "Canonical Gateway mandate action input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:mandate:execute"], at);
    const action2 = parseStrategyAction(input.action);
    if (action2.mandateId !== input.mandateId) fail11("MANDATE_BINDING_MISMATCH", "Strategy action mandateId does not match the requested mandate");
    assertSessionSubject(action2, authenticated.session);
    const authorized = this.#mandates.authorize(input.mandateId, action2, at);
    this.#consume(authenticated.proof);
    return authorized;
  }
  mandateInventory(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, PROOF_FIELDS2, "Canonical Gateway mandate inventory input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:account"], at);
    const inventory = Object.freeze(this.#mandates.inventory(authenticated.session.account, at).filter((item) => item.mandate.productClientId === authenticated.session.productClientId));
    this.#consume(authenticated.proof);
    return inventory;
  }
  revokeMandate(input, request, at = /* @__PURE__ */ new Date()) {
    return this.#terminateMandate(input, request, at, "revoke");
  }
  killMandate(input, request, at = /* @__PURE__ */ new Date()) {
    return this.#terminateMandate(input, request, at, "kill");
  }
  emergencyExitMandate(input, request, at = /* @__PURE__ */ new Date()) {
    exactFields(input, MANDATE_EXIT_FIELDS, "Canonical Gateway mandate emergency exit input");
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:mandate:revoke"], at);
    this.#assertMandateOwner(input.mandateId, authenticated.session, at);
    const exited = this.#mandates.emergencyExit(input.mandateId, input.reason, at);
    this.#consume(authenticated.proof);
    return exited;
  }
  snapshot() {
    return Object.freeze({
      schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
      registryVersion: this.#registry.registryVersion,
      sessionStore: this.#store.snapshot(),
      consumedProductProofs: Object.freeze([...this.#proofs]),
      mandateStore: this.#mandates.snapshot()
    });
  }
  #terminateMandate(input, request, at, action2) {
    exactFields(input, MANDATE_TERMINAL_FIELDS, `Canonical Gateway mandate ${action2} input`);
    const authenticated = this.#authenticateProof(input.proof, parseRequest(request), ["quant:mandate:revoke"], at);
    this.#assertMandateOwner(input.mandateId, authenticated.session, at);
    const terminated = action2 === "revoke" ? this.#mandates.revoke(input.mandateId, at) : this.#mandates.kill(input.mandateId, at);
    this.#consume(authenticated.proof);
    return terminated;
  }
  #assertMandateOwner(mandateId, session, at) {
    const item = this.#mandates.inventory(session.account, at).find((entry) => entry.mandate.mandateId === mandateId);
    if (!item || item.mandate.productClientId !== session.productClientId || item.mandate.sessionBinding !== session.sessionBinding) {
      fail11("MANDATE_BINDING_MISMATCH", "Strategy mandate is not owned by this Product Session");
    }
    return item;
  }
  #assertWalletControlSession(session, operation) {
    if (session.productClientId !== "ynx-wallet-v1" || session.bundleId !== "com.ynxweb4.wallet") {
      fail11("WALLET_CONTROL_REQUIRED", `${operation} requires the canonical Wallet Product Session`);
    }
  }
  #authenticateRevocationProof(proofInput, request, at) {
    const session = this.#sessionForProof(proofInput);
    const proof = verifyProductSessionProof(proofInput, session, request, at);
    this.#assertUnused(proof);
    return Object.freeze({ proof, session });
  }
  #authenticateProof(proofInput, request, requiredScopes2, at) {
    const session = this.#sessionForProof(proofInput);
    const proof = verifyProductSessionProof(proofInput, session, request, at);
    this.#assertUnused(proof);
    const result = this.#store.introspect(proof.sessionBinding, {
      productClientId: proof.productClientId,
      bundleId: proof.bundleId,
      productDeviceKey: proof.productDeviceKey,
      origin: proof.origin,
      requiredScopes: requiredScopes2
    }, at);
    return Object.freeze({ proof, session: result.session, result });
  }
  #sessionForProof(proofInput) {
    const session = this.#store.snapshot().sessions.find((item) => item.sessionBinding === proofInput?.sessionBinding);
    if (!session) fail11("SESSION_NOT_FOUND", "Canonical Gateway Product Session was not found");
    assertSessionClientActive(session, this.#registry.retiredClients);
    const registration = this.#registry.products.find((product) => product.productClientId === session.productClientId && product.bundleId === session.bundleId && product.callbacks.includes(session.callback));
    if (!registration) fail11("UNKNOWN_PRODUCT", "Canonical Gateway Product Session registration was not found");
    assertClientLifecycleActive(registration);
    return session;
  }
  #assertUnused(proof) {
    if (this.#proofs.includes(productSessionProofDigest(proof))) fail11("REPLAY", "Product Session HTTP proof was already consumed");
    if (this.#proofs.length >= 2e4) fail11("CAPACITY", "Product Session proof replay store reached its bound");
  }
  #consume(proof) {
    this.#proofs.push(productSessionProofDigest(proof));
    this.#proofs.sort();
  }
};
function applyClientRetirementToGatewaySnapshot(registryInput, snapshot3, productId, clientId, at = /* @__PURE__ */ new Date()) {
  const registry = parseCentralRegistryDocument(registryInput);
  const candidates = registry.retiredClients.filter((record2) => record2.productId === productId && (clientId === void 0 || record2.clientId === clientId));
  if (candidates.length !== 1) fail11(candidates.length === 0 ? "UNKNOWN_PRODUCT" : "INVALID_REGISTRY", "Canonical Gateway retirement client is not uniquely registered");
  const retirement = candidates[0];
  const parsed = snapshot3 === void 0 ? emptySnapshot3(registry.registryVersion) : parseGatewayAdapterSnapshotForRetirement(snapshot3, registry.registryVersion);
  const store = new CentralWalletSessionStore(parsed.sessionStore);
  const result = store.retireClient(retirement, at);
  return Object.freeze({
    result,
    snapshot: Object.freeze({
      schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
      registryVersion: parsed.registryVersion,
      sessionStore: store.snapshot(),
      consumedProductProofs: parsed.consumedProductProofs,
      mandateStore: parsed.mandateStore
    })
  });
}
function parseGatewayAdapterSnapshotForRetirement(snapshot3, registryVersion) {
  if (snapshot3?.registryVersion === registryVersion) return parseGatewayAdapterSnapshot(snapshot3, registryVersion);
  if (registryVersion === 3 && snapshot3?.registryVersion === 2) {
    const parsed = parseGatewayAdapterSnapshot(snapshot3, 2);
    return Object.freeze({ ...parsed, registryVersion: 3 });
  }
  fail11("INVALID_STORE", "Canonical Gateway snapshot registry version cannot be migrated for client retirement");
}
function parseGatewayAdapterSnapshot(input, registryVersion) {
  const version = input?.schemaVersion;
  if (version === 1) {
    exactFields(input, SNAPSHOT_V1_FIELDS2, "Canonical Gateway adapter snapshot v1");
    const common = parseCommonSnapshot(input, registryVersion);
    return Object.freeze({
      schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
      ...common,
      mandateStore: new StrategyMandateStore().snapshot()
    });
  }
  exactFields(input, SNAPSHOT_FIELDS3, "Canonical Gateway adapter snapshot");
  if (version !== CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION) fail11("INVALID_STORE", "Canonical Gateway adapter snapshot schema is incompatible");
  return Object.freeze({
    schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
    ...parseCommonSnapshot(input, registryVersion),
    mandateStore: parseStrategyMandateStoreSnapshot(input.mandateStore)
  });
}
function parseCommonSnapshot(input, registryVersion) {
  const acceptedRegistryMigration = input.registryVersion === 1 && registryVersion === 2;
  if (input.registryVersion !== registryVersion && !acceptedRegistryMigration) fail11("INVALID_STORE", "Canonical Gateway adapter registry version is incompatible");
  return {
    registryVersion,
    sessionStore: parseCentralWalletStoreSnapshot(input.sessionStore),
    consumedProductProofs: parseProofDigests(input.consumedProductProofs)
  };
}
function parseProofDigests(value) {
  if (!Array.isArray(value) || value.length > 2e4 || value.some((item) => typeof item !== "string" || !/^[0-9a-f]{64}$/.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) {
    fail11("INVALID_STORE", "Consumed Product Session proofs must be bounded, unique and sorted");
  }
  return Object.freeze([...value]);
}
function emptySnapshot3(registryVersion) {
  return {
    schemaVersion: CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
    registryVersion,
    sessionStore: {
      schemaVersion: 1,
      consumedNonces: [],
      consumedRequestDigests: [],
      consumedChallenges: [],
      sessions: [],
      revokedSessionBindings: [],
      revokedApprovalDigests: [],
      revokedDeviceBindings: [],
      accountLogoutRecords: [],
      audit: []
    },
    consumedProductProofs: [],
    mandateStore: new StrategyMandateStore().snapshot()
  };
}
function assertSessionSubject(subject, session) {
  if (subject.account !== session.account || subject.productClientId !== session.productClientId || subject.sessionBinding !== session.sessionBinding) {
    fail11("MANDATE_BINDING_MISMATCH", "Strategy subject does not match the authenticated Product Session");
  }
}
function parseRequest(input) {
  exactFields(input, REQUEST_FIELDS5, "Canonical Gateway HTTP request context");
  return Object.freeze({ method: input.method, path: input.path, bodyDigest: input.bodyDigest, origin: input.origin });
}
function fail11(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/gateway-http.js
var CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION = 1;
var CANONICAL_GATEWAY_HTTP_MAX_BODY_BYTES = 1048576;
var REQUEST_FIELDS6 = ["method", "path", "contentType", "body", "proof", "origin"];
var RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8"
});
var ROUTES = Object.freeze({
  "/v1/wallet/sessions/complete": "complete",
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
var CanonicalWalletGatewayHttpKernel = class {
  #registry;
  #adapter;
  constructor(registry, snapshot3) {
    this.#registry = parseCentralRegistryDocument(registry);
    this.#adapter = new CanonicalWalletGatewayAdapter(this.#registry, snapshot3);
  }
  dispatch(input, at = /* @__PURE__ */ new Date()) {
    const before = this.#adapter.snapshot();
    try {
      const request = parseRequest2(input);
      const now = validDate10(at);
      const payload = parseCanonicalBody(request.body);
      const operation = ROUTES[request.path];
      if (!operation) fail12("ROUTE_NOT_FOUND", "Canonical Wallet Gateway route was not found");
      const context = Object.freeze({ method: request.method, path: request.path, bodyDigest: httpBodyDigest(request.body), origin: request.origin });
      const result = operation === "complete" ? complete(this.#adapter, request.proof, payload, now, request.origin) : this.#adapter[operation](authenticatedInput(operation, request.proof, payload), context, now);
      const snapshot3 = this.#adapter.snapshot();
      const stateDigest = gatewayStateDigest(snapshot3);
      return response(200, true, { ok: true, result, schemaVersion: CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION, stateDigest });
    } catch (caught) {
      this.#adapter = new CanonicalWalletGatewayAdapter(this.#registry, before);
      const error = publicError(caught);
      const stateDigest = gatewayStateDigest(this.#adapter.snapshot());
      return response(error.status, false, {
        error: { code: error.code, message: error.message, ...error.details ?? {} },
        ok: false,
        schemaVersion: CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION,
        stateDigest
      });
    }
  }
  snapshot() {
    return this.#adapter.snapshot();
  }
};
function gatewayStateDigest(snapshot3) {
  return digestHex("YNX_CANONICAL_GATEWAY_HTTP_STATE_V1", snapshot3);
}
function parseRequest2(input) {
  exactFields(input, REQUEST_FIELDS6, "Canonical Gateway HTTP input");
  if (input.method !== "POST") fail12("METHOD_NOT_ALLOWED", "Canonical Wallet Gateway accepts POST only");
  if (input.contentType !== "application/json") fail12("UNSUPPORTED_MEDIA_TYPE", "Canonical Wallet Gateway requires application/json");
  if (typeof input.path !== "string" || !/^\/[A-Za-z0-9/_-]{1,255}$/.test(input.path) || input.path.includes("//") || input.path.endsWith("/")) {
    fail12("INVALID_PATH", "Canonical Wallet Gateway path is invalid");
  }
  if (typeof input.body !== "string") fail12("INVALID_BODY", "Canonical Wallet Gateway body must be UTF-8 JSON text");
  const bytes = new TextEncoder().encode(input.body).length;
  if (bytes < 2 || bytes > CANONICAL_GATEWAY_HTTP_MAX_BODY_BYTES) fail12("INVALID_BODY", "Canonical Wallet Gateway body size is outside policy");
  if (input.proof !== null && (typeof input.proof !== "object" || input.proof === null || Array.isArray(input.proof))) fail12("INVALID_PROOF_HEADER", "Product Session proof header must be a JSON object or null");
  return Object.freeze({ method: input.method, path: input.path, contentType: input.contentType, body: input.body, proof: input.proof, origin: strictOrigin4(input.origin) });
}
function strictOrigin4(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 255 || value.trim() !== value) fail12("INVALID_ORIGIN", "Canonical Wallet Gateway origin is invalid");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail12("INVALID_ORIGIN", "Canonical Wallet Gateway origin is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.toString() !== `${value}/`) fail12("INVALID_ORIGIN", "Canonical Wallet Gateway origin is invalid");
  return value;
}
function complete(adapter, proof, payload, at, origin2) {
  if (proof !== null) fail12("UNEXPECTED_PROOF_HEADER", "Session completion must not include a Product Session proof header");
  if (payload?.authorizationRequest?.origin !== origin2) fail12("ORIGIN_MISMATCH", "Session completion origin must exactly match its signed authorization request");
  return adapter.complete(payload, at);
}
function authenticatedInput(operation, proof, payload) {
  if (proof === null) fail12("PROOF_REQUIRED", "Product Session proof header is required");
  const fields4 = operationFields(operation);
  exactFields(payload, fields4, `Canonical Gateway ${operation} body`);
  return Object.freeze({ proof, ...payload });
}
function operationFields(operation) {
  if (operation === "introspect") return ["requiredScopes"];
  if (["sessionInventory", "revokeSession", "revokeApproval", "revokeDevice", "logoutAllDevices", "mandateInventory"].includes(operation)) return [];
  if (operation === "activateMandate") return ["mandate"];
  if (operation === "authorizeMandateAction") return ["mandateId", "action"];
  if (operation === "revokeMandate" || operation === "killMandate") return ["mandateId"];
  if (operation === "emergencyExitMandate") return ["mandateId", "reason"];
  fail12("ROUTE_NOT_FOUND", "Canonical Wallet Gateway operation is not registered");
}
function parseCanonicalBody(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    fail12("INVALID_JSON", "Canonical Wallet Gateway body is not valid JSON");
  }
  let normalized;
  try {
    normalized = canonicalJSON(value);
  } catch (caught) {
    if (caught instanceof WalletAuthError) throw caught;
    fail12("INVALID_JSON", "Canonical Wallet Gateway body is not canonical JSON");
  }
  if (normalized !== body) fail12("NON_CANONICAL_JSON", "Canonical Wallet Gateway body must use canonical JSON without duplicate keys or alternate encodings");
  return value;
}
function response(status, mutated, payload) {
  const body = canonicalJSON(payload);
  return Object.freeze({ status, headers: RESPONSE_HEADERS, body, mutated });
}
function publicError(caught) {
  if (!(caught instanceof WalletAuthError)) return Object.freeze({ status: 500, code: "INTERNAL", message: "Canonical Wallet Gateway failed closed" });
  const status = errorStatus(caught.code);
  const details = caught.code === "CLIENT_RETIRED" ? retiredErrorDetails(caught.details) : null;
  return Object.freeze({ status, code: caught.code, message: boundedMessage(caught.message), details });
}
function errorStatus(code) {
  if (code === "ROUTE_NOT_FOUND" || code === "SESSION_NOT_FOUND" || code === "MANDATE_NOT_FOUND") return 404;
  if (code === "METHOD_NOT_ALLOWED") return 405;
  if (code === "CLIENT_RETIRED") return 410;
  if (code === "UNSUPPORTED_MEDIA_TYPE") return 415;
  if (["REPLAY", "ALREADY_REVOKED", "MANDATE_EXISTS", "MANDATE_TERMINAL", "MANDATE_REVOKED", "MANDATE_KILLED", "MANDATE_EXPIRED"].includes(code)) return 409;
  if (code === "CAPACITY") return 503;
  if (["UNKNOWN_PRODUCT", "REGISTRY_DISABLED", "DEVICE_MISMATCH", "INVALID_DEVICE_PROOF", "SESSION_BINDING_MISMATCH", "HTTP_BINDING_MISMATCH", "ORIGIN_MISMATCH", "SCOPE_NOT_GRANTED", "SCOPE_NOT_ALLOWED", "REVOKED", "EXPIRED", "WALLET_CONTROL_REQUIRED", "MANDATE_BINDING_MISMATCH", "MANDATE_POLICY_VIOLATION", "LIMIT_EXCEEDED"].includes(code)) return 403;
  return 400;
}
function retiredErrorDetails(value) {
  exactFields(value, ["clientId", "replacementURL", "minimumClientVersion"], "Retired Wallet client error details");
  return Object.freeze({ clientId: value.clientId, replacementURL: value.replacementURL, minimumClientVersion: value.minimumClientVersion });
}
function boundedMessage(value) {
  if (typeof value !== "string" || value.length < 1) return "Canonical Wallet Gateway rejected the request";
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}
function validDate10(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail12("INVALID_TIME", "Canonical Wallet Gateway time is invalid");
  return value;
}
function fail12(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/bundler.js
var USER_OPERATION_FIELDS = ["sender", "nonce", "initCode", "callData", "accountGasLimits", "preVerificationGas", "gasFees", "paymasterAndData", "signature"];
var ESTIMATE_FIELDS_REQUIRED = ["preVerificationGas", "verificationGasLimit", "callGasLimit"];
var ESTIMATE_FIELDS_OPTIONAL = ["paymasterVerificationGasLimit", "paymasterPostOpGasLimit"];
var RECEIPT_REQUIRED = ["userOpHash", "entryPoint", "sender", "nonce", "actualGasCost", "actualGasUsed", "success", "logs", "receipt"];
var RECEIPT_OPTIONAL = ["paymaster", "reason"];
var METHODS = /* @__PURE__ */ new Set(["eth_chainId", "eth_supportedEntryPoints", "eth_estimateUserOperationGas", "eth_sendUserOperation", "eth_getUserOperationByHash", "eth_getUserOperationReceipt"]);
var ERC_7769_VERSION = "ERC-7769";
var YNX_TESTNET_CHAIN_QUANTITY = "0x1917";
function parsePackedUserOperation(input) {
  exactFields(input, USER_OPERATION_FIELDS, "PackedUserOperation");
  return Object.freeze({ sender: address3(input.sender, "sender"), nonce: quantity(input.nonce, "nonce"), initCode: data(input.initCode, "initCode", 65536), callData: data(input.callData, "callData", 131072), accountGasLimits: dataBytes(input.accountGasLimits, "accountGasLimits", 32), preVerificationGas: quantity(input.preVerificationGas, "preVerificationGas"), gasFees: dataBytes(input.gasFees, "gasFees", 32), paymasterAndData: data(input.paymasterAndData, "paymasterAndData", 65536), signature: nonemptyData(input.signature, "signature", 16384) });
}
var ERC7769BundlerClient = class {
  #endpoint;
  #entryPoint;
  #timeoutMs;
  #maxRequests;
  #requestTimes = [];
  #id = 0;
  #headers;
  constructor({ endpoint: endpoint2, entryPoint, timeoutMs = 1e4, maxRequestsPerSecond = 10, authentication } = {}) {
    this.#endpoint = endpointURL(endpoint2);
    this.#entryPoint = address3(entryPoint, "entryPoint");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 12e4) fail13("INVALID_CONFIG", "Bundler timeout must be between 250 and 120000 ms");
    if (!Number.isSafeInteger(maxRequestsPerSecond) || maxRequestsPerSecond < 1 || maxRequestsPerSecond > 100) fail13("INVALID_CONFIG", "Bundler local rate limit must be between 1 and 100 requests/second");
    this.#timeoutMs = timeoutMs;
    this.#maxRequests = maxRequestsPerSecond;
    this.#headers = { "content-type": "application/json", "accept": "application/json" };
    if (authentication !== void 0) {
      exactFields(authentication, ["header", "value"], "Bundler authentication");
      if (!["authorization", "x-api-key"].includes(authentication.header) || typeof authentication.value !== "string" || authentication.value.length < 1 || authentication.value.length > 4096 || authentication.value.trim() !== authentication.value) fail13("INVALID_CONFIG", "Bundler authentication is invalid");
      this.#headers[authentication.header] = authentication.value;
    }
  }
  async health() {
    const [chainId, entryPoints] = await Promise.all([this.#request("eth_chainId", []), this.#request("eth_supportedEntryPoints", [])]);
    if (chainId !== YNX_TESTNET_CHAIN_QUANTITY) fail13("WRONG_NETWORK", "Bundler is not connected to YNX Testnet chainId 6423");
    const parsed = entryPointList(entryPoints);
    if (!parsed.includes(this.#entryPoint)) fail13("ENTRY_POINT_UNSUPPORTED", "Bundler does not support the configured EntryPoint");
    return evidence({ chainId, entryPoints: parsed }, this.#endpoint);
  }
  async estimateUserOperationGas(operation) {
    const value = await this.#request("eth_estimateUserOperationGas", [parsePackedUserOperation(operation), this.#entryPoint]);
    return evidence(parseEstimate(value), this.#endpoint);
  }
  async sendUserOperation(operation) {
    const value = await this.#request("eth_sendUserOperation", [parsePackedUserOperation(operation), this.#entryPoint]);
    return evidence(hash2(value, "userOperationHash"), this.#endpoint);
  }
  async getUserOperationByHash(userOperationHash) {
    const value = await this.#request("eth_getUserOperationByHash", [hash2(userOperationHash, "userOperationHash")]);
    return evidence(value === null ? null : parseByHash(value), this.#endpoint);
  }
  async getUserOperationReceipt(userOperationHash) {
    const value = await this.#request("eth_getUserOperationReceipt", [hash2(userOperationHash, "userOperationHash")]);
    return evidence(value === null ? null : parseReceipt(value), this.#endpoint);
  }
  async #request(method3, params) {
    if (!METHODS.has(method3)) fail13("INVALID_METHOD", "Bundler method is unsupported");
    this.#rateLimit();
    const id3 = ++this.#id, controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response4, textBody;
    try {
      response4 = await fetch(this.#endpoint, { method: "POST", headers: this.#headers, body: JSON.stringify({ jsonrpc: "2.0", id: id3, method: method3, params }), signal: controller.signal });
      textBody = await boundedResponseText(response4, controller, 1048576);
    } catch (error) {
      if (error instanceof WalletAuthError) throw error;
      fail13(error?.name === "AbortError" ? "BUNDLER_TIMEOUT" : "BUNDLER_UNAVAILABLE", error?.name === "AbortError" ? "Bundler request timed out" : "Bundler request failed");
    } finally {
      clearTimeout(timer);
    }
    if (!response4.ok) fail13("BUNDLER_HTTP_ERROR", `Bundler returned HTTP ${response4.status}`);
    let body;
    try {
      body = JSON.parse(textBody);
    } catch {
      fail13("BUNDLER_INVALID_RESPONSE", "Bundler returned invalid JSON");
    }
    ;
    if (body?.jsonrpc !== "2.0" || body?.id !== id3 || typeof body !== "object" || body === null || Array.isArray(body)) fail13("BUNDLER_INVALID_RESPONSE", "Bundler JSON-RPC envelope is invalid");
    const keys = Object.keys(body).sort().join("\n");
    if (keys === "error\nid\njsonrpc") {
      if (typeof body.error?.code !== "number" || typeof body.error?.message !== "string") fail13("BUNDLER_INVALID_RESPONSE", "Bundler JSON-RPC error is malformed");
      fail13("BUNDLER_RPC_ERROR", `Bundler RPC returned error code ${body.error.code}`);
    }
    if (keys !== "id\njsonrpc\nresult") fail13("BUNDLER_INVALID_RESPONSE", "Bundler JSON-RPC fields are invalid");
    return body.result;
  }
  #rateLimit() {
    const now = Date.now();
    this.#requestTimes = this.#requestTimes.filter((value) => now - value < 1e3);
    if (this.#requestTimes.length >= this.#maxRequests) fail13("BUNDLER_LOCAL_RATE_LIMIT", "Bundler local rate limit exceeded");
    this.#requestTimes.push(now);
  }
};
function parseEstimate(value) {
  fields3(value, ESTIMATE_FIELDS_REQUIRED, ESTIMATE_FIELDS_OPTIONAL, "Bundler gas estimate");
  const result = {};
  for (const key of Object.keys(value)) result[key] = quantity(value[key], key);
  return Object.freeze(result);
}
function parseByHash(value) {
  fields3(value, ["userOperation", "entryPoint", "blockNumber", "blockHash", "transactionHash"], [], "Bundler UserOperation result");
  return Object.freeze({ userOperation: parsePackedUserOperation(value.userOperation), entryPoint: address3(value.entryPoint, "entryPoint"), blockNumber: quantity(value.blockNumber, "blockNumber"), blockHash: hash2(value.blockHash, "blockHash"), transactionHash: hash2(value.transactionHash, "transactionHash") });
}
function parseReceipt(value) {
  fields3(value, RECEIPT_REQUIRED, RECEIPT_OPTIONAL, "Bundler UserOperation receipt");
  if (typeof value.success !== "boolean" || !Array.isArray(value.logs) || typeof value.receipt !== "object" || value.receipt === null || Array.isArray(value.receipt)) fail13("BUNDLER_INVALID_RESPONSE", "Bundler receipt values are invalid");
  const result = { userOpHash: hash2(value.userOpHash, "userOpHash"), entryPoint: address3(value.entryPoint, "entryPoint"), sender: address3(value.sender, "sender"), nonce: quantity(value.nonce, "nonce"), actualGasCost: quantity(value.actualGasCost, "actualGasCost"), actualGasUsed: quantity(value.actualGasUsed, "actualGasUsed"), success: value.success, logs: Object.freeze([...value.logs]), receipt: Object.freeze({ ...value.receipt }) };
  if ("paymaster" in value) result.paymaster = address3(value.paymaster, "paymaster");
  if ("reason" in value) {
    if (typeof value.reason !== "string" || value.reason.length > 2048) fail13("BUNDLER_INVALID_RESPONSE", "Bundler receipt reason is invalid");
    result.reason = value.reason;
  }
  return Object.freeze(result);
}
function entryPointList(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) fail13("BUNDLER_INVALID_RESPONSE", "Bundler EntryPoint list is invalid");
  const parsed = value.map((item) => address3(item, "entryPoint"));
  if (new Set(parsed).size !== parsed.length) fail13("BUNDLER_INVALID_RESPONSE", "Bundler EntryPoint list contains duplicates");
  return Object.freeze(parsed);
}
function evidence(value, endpoint2) {
  return Object.freeze({ value, source: endpoint2.origin, asOf: (/* @__PURE__ */ new Date()).toISOString(), version: ERC_7769_VERSION, authority: "bundler-provider-response" });
}
function endpointURL(value) {
  let url2;
  try {
    url2 = new URL(value);
  } catch {
    fail13("INVALID_CONFIG", "Bundler endpoint is invalid");
  }
  ;
  const loopback = url2.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url2.hostname);
  if (url2.protocol !== "https:" && !loopback || url2.username || url2.password || url2.search || url2.hash || url2.pathname.endsWith("/") && url2.pathname !== "/") fail13("INVALID_CONFIG", "Bundler endpoint must be canonical HTTPS (HTTP is loopback-only) without credentials, query or fragment");
  return url2;
}
function fields3(value, required, optional, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail13("BUNDLER_INVALID_RESPONSE", `${label} must be an object`);
  const actual = Object.keys(value), allowed = /* @__PURE__ */ new Set([...required, ...optional]);
  if (required.some((key) => !(key in value)) || actual.some((key) => !allowed.has(key))) fail13("BUNDLER_INVALID_RESPONSE", `${label} fields are invalid`);
}
async function boundedResponseText(response4, controller, limit) {
  const declared = Number(response4.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    controller.abort();
    fail13("BUNDLER_RESPONSE_TOO_LARGE", "Bundler response exceeded one MiB");
  }
  if (!response4.body) return "";
  const reader = response4.body.getReader(), chunks = [];
  let total = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      controller.abort();
      fail13("BUNDLER_RESPONSE_TOO_LARGE", "Bundler response exceeded one MiB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function address3(value, label) {
  return pattern7(value, label, /^0x[0-9a-f]{40}$/);
}
function hash2(value, label) {
  return pattern7(value, label, /^0x[0-9a-f]{64}$/);
}
function quantity(value, label) {
  return pattern7(value, label, /^0x(?:0|[1-9a-f][0-9a-f]*)$/);
}
function data(value, label, maxBytes) {
  const result = pattern7(value, label, /^0x(?:[0-9a-f]{2})*$/);
  if ((result.length - 2) / 2 > maxBytes) fail13("INVALID_USER_OPERATION", `${label} exceeds its byte limit`);
  return result;
}
function nonemptyData(value, label, maxBytes) {
  const result = data(value, label, maxBytes);
  if (result === "0x") fail13("INVALID_USER_OPERATION", `${label} cannot be empty`);
  return result;
}
function dataBytes(value, label, bytes) {
  return pattern7(value, label, new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`));
}
function pattern7(value, label, regex) {
  if (typeof value !== "string" || !regex.test(value)) fail13("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function fail13(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/standard-wallet-connection.js
var EIP1193_PROVIDER_CODE = Object.freeze({
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  PROVIDER_DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  UNKNOWN_CHAIN: 4902
});
var STANDARD_WALLET_METHODS = Object.freeze([
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
  "wallet_requestPermissions",
  "wallet_getPermissions",
  "wallet_revokePermissions",
  "wallet_watchAsset",
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction"
]);
var Eip1193ProviderError = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Eip1193ProviderError";
    this.code = code;
  }
};
var StandardWalletConnection = class {
  #provider;
  #origin;
  #metadata;
  #listeners = /* @__PURE__ */ new Set();
  #session = null;
  #generation = 0;
  #accountsVersion = 0;
  #chainVersion = 0;
  #lastAccounts;
  #lastChain;
  #providerHandlers = /* @__PURE__ */ new Map();
  #active = true;
  // Access-loss events cancel reads; only explicit intents supersede revocation,
  // whose expected effects include accountsChanged([]) and disconnect events.
  #intent = 0;
  #revocation = null;
  constructor(config) {
    exactFields(config, ["provider", "origin", "metadata"], "Standard Wallet connection configuration");
    if (!validProvider(config.provider)) throw providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "EIP-1193 provider is unavailable");
    if (!canonicalHttpsOrigin(config.origin)) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "DApp origin must be an exact HTTPS origin");
    if (!metadata(config.metadata)) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "DApp metadata is invalid");
    this.#provider = config.provider;
    this.#origin = config.origin;
    this.#metadata = Object.freeze({ ...config.metadata });
    this.#bindProviderEvents();
  }
  get current() {
    return this.#session;
  }
  connect() {
    return this.#establish("eth_requestAccounts", false);
  }
  /** Silently query only the constructor-selected provider; never request a grant. */
  restore() {
    return this.#establish("eth_accounts", true);
  }
  async #establish(method3, allowEmpty) {
    this.#intent += 1;
    const generation = ++this.#generation, accountsVersion = this.#accountsVersion;
    this.#active = true;
    this.#bindProviderEvents();
    const accounts = await this.#requestForAttempt({ method: method3 }, generation);
    this.#assertCurrentAttempt(generation);
    const observedAccounts = this.#accountsVersion === accountsVersion ? accounts : this.#lastAccounts;
    if (allowEmpty && Array.isArray(observedAccounts) && observedAccounts.length === 0) {
      this.#session = null;
      return null;
    }
    firstAccount(observedAccounts);
    const chainVersion = this.#chainVersion;
    const chainResponse = await this.#requestForAttempt({ method: "eth_chainId" }, generation);
    this.#assertCurrentAttempt(generation);
    const account = firstAccount(this.#accountsVersion === accountsVersion ? accounts : this.#lastAccounts);
    const chainId = this.#chainVersion === chainVersion ? chainResponse : this.#lastChain;
    if (!canonicalChain(chainId)) throw providerError(EIP1193_PROVIDER_CODE.CHAIN_DISCONNECTED, "Wallet returned an invalid chain ID");
    this.#session = Object.freeze({
      version: "1.0.0",
      transport: "eip1193",
      origin: this.#origin,
      dappMetadata: this.#metadata,
      // Legacy capability fields do not assert that all listed methods are granted.
      selectedAccount: account,
      selectedChain: chainId.toLowerCase(),
      approvedMethods: Object.freeze([...STANDARD_WALLET_METHODS]),
      approvedEvents: Object.freeze(["accountsChanged", "chainChanged", "connect", "disconnect", "message"]),
      connected: true
    });
    return this.#session;
  }
  async #requestForAttempt(input, generation) {
    this.#assertCurrentAttempt(generation);
    try {
      return await this.request(input);
    } catch (error) {
      this.#assertCurrentAttempt(generation);
      throw error;
    }
  }
  /**
   * Explicitly revoke eth_accounts, then confirm account exposure is empty.
   * permissionRevoked=false means unconfirmed, not that a remote grant remains.
   * disconnect() is a separate local action. Neither revokes token approvals.
   */
  revoke() {
    if (this.#revocation?.intent === this.#intent) return this.#revocation.promise;
    const operation = { intent: ++this.#intent, promise: null };
    this.#generation += 1;
    this.#revocation = operation;
    operation.promise = Promise.resolve().then(() => this.#revoke(operation)).finally(() => {
      if (this.#revocation === operation) this.#revocation = null;
    });
    return operation.promise;
  }
  async #revoke(operation) {
    let stage = "revoke";
    try {
      this.#assertRevocation(operation);
      const response4 = await this.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
      this.#assertRevocation(operation);
      if (!revokeAcknowledged(response4)) throw providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "Wallet returned an invalid revocation acknowledgement");
      stage = "readback";
      const accountsVersion = this.#accountsVersion;
      const accounts = await this.request({ method: "eth_accounts" });
      this.#assertRevocation(operation);
      if (!Array.isArray(accounts) || accounts.length !== 0 || accountsVersion !== this.#accountsVersion && (!Array.isArray(this.#lastAccounts) || this.#lastAccounts.length !== 0)) {
        throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet account revocation was not confirmed");
      }
      this.#revocation = null;
      this.disconnect();
      return this.#revokeResult("revoked", true);
    } catch (error) {
      if (operation.intent !== this.#intent) return this.#revokeResult(
        "superseded",
        false,
        providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet revocation was superseded by a newer connection intent")
      );
      const normalized = normalizeProviderError(error);
      const status = stage === "revoke" && normalized.code === EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD ? "unsupported" : stage === "revoke" && normalized.code === EIP1193_PROVIDER_CODE.USER_REJECTED ? "rejected" : "failed";
      return this.#revokeResult(status, false, normalized);
    }
  }
  #assertRevocation(operation) {
    if (operation.intent !== this.#intent) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet revocation was superseded");
  }
  #revokeResult(status, permissionRevoked, error) {
    return Object.freeze({
      status,
      permissionRevoked,
      locallyDisconnected: this.#session === null,
      ...error ? { error: Object.freeze({ code: error.code, message: error.message }) } : {}
    });
  }
  async request(input) {
    const fields4 = Object.keys(input ?? {}).sort();
    if (fields4.join("\n") !== ["method", ...Object.hasOwn(input ?? {}, "params") ? ["params"] : []].sort().join("\n") || typeof input?.method !== "string") {
      throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "Malformed EIP-1193 request");
    }
    if (input.method === "eth_sign") throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "Raw eth_sign is disabled because blind signing is unsafe");
    if (!STANDARD_WALLET_METHODS.includes(input.method)) throw providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "EIP-1193 method is not supported by this transport");
    try {
      return await this.#provider.request(Object.hasOwn(input, "params") ? { method: input.method, params: input.params } : { method: input.method });
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }
  disconnect() {
    this.#intent += 1;
    this.#generation += 1;
    this.#session = null;
    this.#active = false;
    this.#unbindProviderEvents();
    this.#emit("disconnect", Object.freeze({ code: EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, message: "Wallet connection was disconnected" }));
  }
  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Standard Wallet event listener must be a function");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #bindProviderEvents() {
    if (typeof this.#provider.on !== "function") return;
    for (const event of ["accountsChanged", "chainChanged", "connect", "disconnect", "message"]) {
      if (this.#providerHandlers.has(event)) continue;
      const handler = (value) => {
        if (!this.#active || this.#providerHandlers.get(event) !== handler) return;
        if (event === "accountsChanged") {
          this.#accountsVersion += 1;
          this.#lastAccounts = Array.isArray(value) ? [...value] : value;
          try {
            const selectedAccount = firstAccount(value);
            if (this.#session !== null) this.#session = Object.freeze({ ...this.#session, selectedAccount });
          } catch {
            this.#generation += 1;
            this.#session = null;
          }
        }
        if (event === "chainChanged") {
          this.#chainVersion += 1;
          this.#lastChain = value;
          if (canonicalChain(value)) {
            if (this.#session !== null) this.#session = Object.freeze({ ...this.#session, selectedChain: value.toLowerCase() });
          } else {
            this.#generation += 1;
            this.#session = null;
          }
        }
        if (event === "disconnect") {
          this.#generation += 1;
          this.#session = null;
        }
        this.#emit(event, value);
      };
      this.#providerHandlers.set(event, handler);
      this.#provider.on(event, handler);
    }
  }
  #unbindProviderEvents() {
    if (typeof this.#provider.removeListener !== "function") return;
    for (const [event, handler] of this.#providerHandlers) this.#provider.removeListener(event, handler);
    this.#providerHandlers.clear();
  }
  #assertCurrentAttempt(generation) {
    if (generation !== this.#generation) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet connection attempt was cancelled or account access changed");
  }
  #emit(event, value) {
    for (const listener of this.#listeners) {
      try {
        listener(Object.freeze({ event, value }));
      } catch {
      }
    }
  }
};
function validProvider(value) {
  try {
    return typeof value === "object" && value !== null && typeof value.request === "function";
  } catch {
    return false;
  }
}
function canonicalHttpsOrigin(value) {
  try {
    const url2 = new URL(value);
    return url2.protocol === "https:" && url2.origin === value && !url2.username && !url2.password;
  } catch {
    return false;
  }
}
function metadata(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join("\n") === ["name", "url"].join("\n") && typeof value.name === "string" && value.name.trim() === value.name && value.name.length >= 1 && value.name.length <= 128 && canonicalHttpsOrigin(value.url);
}
function canonicalChain(value) {
  return typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value);
}
function firstAccount(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1024 || typeof value[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value[0])) throw providerError(EIP1193_PROVIDER_CODE.UNAUTHORIZED, "Wallet did not approve a valid EVM account");
  return value[0].toLowerCase();
}
function revokeAcknowledged(value) {
  return value === null || typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) && Object.keys(value).length === 0;
}
function providerError(code, message) {
  return new Eip1193ProviderError(code, message);
}
function normalizeProviderError(error) {
  const code = (() => {
    try {
      return Number(error?.code);
    } catch {
      return NaN;
    }
  })();
  if (code === -32601) return providerError(EIP1193_PROVIDER_CODE.UNSUPPORTED_METHOD, "EIP-1193 method is not supported by this provider");
  if (Object.values(EIP1193_PROVIDER_CODE).includes(code)) return providerError(code, safeMessage(error?.message));
  return providerError(EIP1193_PROVIDER_CODE.PROVIDER_DISCONNECTED, "EIP-1193 provider request failed");
}
function safeMessage(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 ? value : "EIP-1193 provider request failed";
}

// packages/wallet-auth/src/product-migration.js
var WALLET_PRODUCT_MIGRATION_SCHEMA_VERSION = 1;
var WALLET_PRODUCT_MIGRATION_PRODUCTS = Object.freeze([
  "Social",
  "Pay",
  "Shop",
  "Exchange",
  "Quant",
  "Developer",
  "Video",
  "Creator Studio",
  "Calendar",
  "Finance",
  "DEX",
  "Card"
]);
var WALLET_PRODUCT_MIGRATION_SCENARIOS = Object.freeze([
  "wallet-not-installed",
  "wallet-installed",
  "approved",
  "rejected",
  "timeout",
  "revoked",
  "second-open",
  "chain-temporary-disconnect-retry"
]);
var WALLET_PRODUCT_MIGRATION_PLATFORMS = Object.freeze([
  "android",
  "ios",
  "macos",
  "web",
  "windows"
]);
var STATUSES = /* @__PURE__ */ new Set(["NO_EVIDENCE", "PROTOCOL_ONLY", "IN_PROGRESS", "MIGRATED"]);
var RESULT_STATUSES = /* @__PURE__ */ new Set(["PASSED", "FAILED"]);
var SHA256 = /^[a-f0-9]{64}$/;
var COMMIT = /^[a-f0-9]{40}$/;
var TOKEN = /^[A-Za-z0-9._:-]{8,200}$/;
function fail14(code, details) {
  throw new WalletAuthError(code, details);
}
function object(value, path3) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail14("MIGRATION_MATRIX_INVALID", { path: path3 });
  return value;
}
function exactKeys(value, expected, path3) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail14("MIGRATION_MATRIX_INVALID", { path: path3, expected: wanted, actual });
}
function string(value, path3) {
  if (typeof value !== "string" || value.length === 0) fail14("MIGRATION_MATRIX_INVALID", { path: path3 });
  return value;
}
function stringList4(value, path3, allowed = null) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    fail14("MIGRATION_MATRIX_INVALID", { path: path3 });
  }
  const sorted = [...value].sort();
  if (new Set(value).size !== value.length || JSON.stringify(value) !== JSON.stringify(sorted)) {
    fail14("MIGRATION_MATRIX_INVALID", { path: path3, reason: "list-must-be-unique-and-sorted" });
  }
  if (allowed && value.some((item) => !allowed.includes(item))) fail14("MIGRATION_MATRIX_INVALID", { path: path3, reason: "unknown-value" });
  return Object.freeze([...value]);
}
function nullableCommit(value, path3) {
  if (value === null) return null;
  if (typeof value !== "string" || !COMMIT.test(value)) fail14("MIGRATION_MATRIX_INVALID", { path: path3 });
  return value;
}
function repositoryPath(value, path3) {
  string(value, path3);
  if (value.startsWith("/") || value.includes("..") || value.includes("\\") || value.includes("://")) {
    fail14("MIGRATION_MATRIX_INVALID", { path: path3, reason: "unsafe-repository-path" });
  }
  return value;
}
function timestamp5(value, path3) {
  string(value, path3);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail14("MIGRATION_MATRIX_INVALID", { path: path3 });
  return value;
}
function evidenceRecord(input, index) {
  const value = object(input, `products[].evidence[${index}]`);
  exactKeys(value, ["platform", "scenario", "status", "evidencePath", "evidenceSha256", "requestIds", "screenshots", "testedAt"], `products[].evidence[${index}]`);
  if (!WALLET_PRODUCT_MIGRATION_PLATFORMS.includes(value.platform)) fail14("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].platform` });
  if (!WALLET_PRODUCT_MIGRATION_SCENARIOS.includes(value.scenario)) fail14("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].scenario` });
  if (!RESULT_STATUSES.has(value.status)) fail14("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].status` });
  repositoryPath(value.evidencePath, `products[].evidence[${index}].evidencePath`);
  if (typeof value.evidenceSha256 !== "string" || !SHA256.test(value.evidenceSha256)) fail14("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].evidenceSha256` });
  const requestIds = stringList4(value.requestIds, `products[].evidence[${index}].requestIds`);
  if (requestIds.some((item) => !TOKEN.test(item))) fail14("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].requestIds` });
  const screenshots = stringList4(value.screenshots, `products[].evidence[${index}].screenshots`);
  if (screenshots.length === 0) fail14("MIGRATION_MATRIX_INVALID", { path: `products[].evidence[${index}].screenshots`, reason: "visible-evidence-required" });
  screenshots.forEach((item, screenshotIndex) => repositoryPath(item, `products[].evidence[${index}].screenshots[${screenshotIndex}]`));
  return Object.freeze({ ...value, requestIds, screenshots, testedAt: timestamp5(value.testedAt, `products[].evidence[${index}].testedAt`) });
}
function productRecord(input, expectedProduct) {
  const value = object(input, `products.${expectedProduct}`);
  exactKeys(value, ["product", "status", "sourceCommit", "sdkSourceCommit", "supportedPlatforms", "evidence", "unverifiedScenarios"], `products.${expectedProduct}`);
  if (value.product !== expectedProduct || !STATUSES.has(value.status)) fail14("MIGRATION_MATRIX_INVALID", { product: expectedProduct });
  const sourceCommit = nullableCommit(value.sourceCommit, `products.${expectedProduct}.sourceCommit`);
  const sdkSourceCommit = nullableCommit(value.sdkSourceCommit, `products.${expectedProduct}.sdkSourceCommit`);
  const supportedPlatforms = stringList4(value.supportedPlatforms, `products.${expectedProduct}.supportedPlatforms`, WALLET_PRODUCT_MIGRATION_PLATFORMS);
  const evidence2 = Object.freeze(value.evidence.map(evidenceRecord));
  const evidenceKeys = evidence2.map((item) => `${item.platform}:${item.scenario}`);
  if (new Set(evidenceKeys).size !== evidenceKeys.length || JSON.stringify(evidenceKeys) !== JSON.stringify([...evidenceKeys].sort())) {
    fail14("MIGRATION_MATRIX_INVALID", { product: expectedProduct, reason: "evidence-must-be-unique-and-sorted" });
  }
  if (evidence2.some((item) => !supportedPlatforms.includes(item.platform))) fail14("MIGRATION_MATRIX_INVALID", { product: expectedProduct, reason: "evidence-platform-not-supported" });
  const unverifiedScenarios = stringList4(value.unverifiedScenarios, `products.${expectedProduct}.unverifiedScenarios`, WALLET_PRODUCT_MIGRATION_SCENARIOS);
  const required = supportedPlatforms.flatMap((platform) => WALLET_PRODUCT_MIGRATION_SCENARIOS.map((scenario) => `${platform}:${scenario}`));
  const passed = new Set(evidence2.filter((item) => item.status === "PASSED").map((item) => `${item.platform}:${item.scenario}`));
  const failed = evidence2.some((item) => item.status === "FAILED");
  const missingScenarios = [...new Set(required.filter((key) => !passed.has(key)).map((key) => key.slice(key.indexOf(":") + 1)))].sort();
  const expectedUnverified = value.status === "NO_EVIDENCE" || value.status === "PROTOCOL_ONLY" ? [...WALLET_PRODUCT_MIGRATION_SCENARIOS].sort() : missingScenarios;
  if (JSON.stringify(unverifiedScenarios) !== JSON.stringify(expectedUnverified)) fail14("MIGRATION_MATRIX_INVALID", { product: expectedProduct, reason: "unverified-scenarios-mismatch", expected: expectedUnverified });
  if (value.status === "NO_EVIDENCE" || value.status === "PROTOCOL_ONLY") {
    if (sourceCommit !== null || sdkSourceCommit !== null || supportedPlatforms.length || evidence2.length) fail14("MIGRATION_UNPROVEN", { product: expectedProduct, status: value.status });
  } else if (value.status === "MIGRATED") {
    if (!sourceCommit || !sdkSourceCommit || !supportedPlatforms.includes("web") || required.length === 0 || failed || passed.size !== required.length || unverifiedScenarios.length) {
      fail14("MIGRATION_UNPROVEN", { product: expectedProduct, status: value.status });
    }
  } else if (!sourceCommit || !sdkSourceCommit || supportedPlatforms.length === 0 || evidence2.length === required.length && !failed && missingScenarios.length === 0) {
    fail14("MIGRATION_UNPROVEN", { product: expectedProduct, status: value.status });
  }
  return Object.freeze({ ...value, sourceCommit, sdkSourceCommit, supportedPlatforms, evidence: evidence2, unverifiedScenarios });
}
function parseWalletProductMigrationMatrix(input) {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  object(value, "matrix");
  exactKeys(value, ["schemaVersion", "protocol", "products"], "matrix");
  if (value.schemaVersion !== WALLET_PRODUCT_MIGRATION_SCHEMA_VERSION || value.protocol !== "wallet-auth-v2") fail14("MIGRATION_MATRIX_INVALID", { path: "matrix" });
  if (!Array.isArray(value.products) || value.products.length !== WALLET_PRODUCT_MIGRATION_PRODUCTS.length) fail14("MIGRATION_MATRIX_INVALID", { path: "products" });
  const products = Object.freeze(value.products.map((item, index) => productRecord(item, WALLET_PRODUCT_MIGRATION_PRODUCTS[index])));
  return Object.freeze({ schemaVersion: value.schemaVersion, protocol: value.protocol, products });
}
function walletProductMigrationSummary(input) {
  const matrix = parseWalletProductMigrationMatrix(input);
  const counts = Object.freeze(Object.fromEntries([...STATUSES].map((status) => [status, matrix.products.filter((item) => item.status === status).length])));
  const migratedProducts = Object.freeze(matrix.products.filter((item) => item.status === "MIGRATED").map((item) => item.product));
  return Object.freeze({ complete: migratedProducts.length === WALLET_PRODUCT_MIGRATION_PRODUCTS.length, counts, migratedProducts, totalProducts: matrix.products.length });
}

// packages/wallet-auth/src/product-session-v2.js
var PRODUCT_SESSION_PROTOCOL_VERSION = "2";
var PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION = 2;
var REQUEST_MAX_LIFETIME_MS = 5 * 6e4;
var CHALLENGE_MAX_LIFETIME_MS = 6e4;
var REQUEST_FIELDS7 = [
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
var APPROVAL_FIELDS2 = [
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
var CHALLENGE_FIELDS4 = [
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
var COMPLETION_FIELDS2 = ["challenge", "deviceSignature"];
var SESSION_FIELDS2 = [
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
var SNAPSHOT_FIELDS4 = ["schemaVersion", "sessions", "issuedChallenges", "consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices", "revokedAccounts"];
function createProductSessionRequest(registryInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, ["productId", "platform", "deviceId", "deviceKey", "scopes", "purpose", "nonce", "state"], "Product Session request input");
  const binding2 = productPlatformBinding(registryInput, input.productId, input.platform);
  const now = validDate11(at);
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
    deviceKey: deviceKey2(input.deviceKey),
    nonce: token2(input.nonce, "nonce"),
    state: token2(input.state, "state"),
    scopes: scopes(input.scopes, binding2.scopes),
    purpose: text7(input.purpose, "purpose", 1, 180),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REQUEST_MAX_LIFETIME_MS).toISOString()
  };
  return parseProductSessionRequest(registryInput, request, now);
}
function migrateLegacyProductSessionRequest(registryInput, legacy, context, at = /* @__PURE__ */ new Date()) {
  exactFields(legacy, ["version", "nonce", "chainId", "requestingProduct", "productClientId", "bundleId", "productDeviceAlgorithm", "productDeviceKey", "callback", "scopes", "purpose", "issuedAt", "expiresAt"], "Legacy Wallet authorization request");
  exactFields(context, ["productId", "platform", "deviceId", "state"], "Legacy Product Session migration context");
  const registry = parseProductSessionRegistry(registryInput);
  const binding2 = productPlatformBinding(registry, context.productId, context.platform);
  const product = registry.products.find((item) => item.productId === context.productId);
  if (legacy.version !== "1" || legacy.chainId !== binding2.chainId || legacy.productClientId !== binding2.clientId || ![product.productId, `ynx-${product.productId}`].includes(legacy.requestingProduct)) fail15("LEGACY_BINDING_MISMATCH", "Legacy request product or chain is not registered");
  if (legacy.bundleId !== product.applicationId || !product.legacyCallbacks.includes(legacy.callback) || legacy.productDeviceAlgorithm !== "p256-sha256") fail15("LEGACY_BINDING_MISMATCH", "Legacy request bundle, callback or device algorithm is not registered");
  const issuedAt = time5(legacy.issuedAt, "issuedAt"), expiresAt = time5(legacy.expiresAt, "expiresAt");
  const now = validDate11(at);
  if (issuedAt > now.toISOString() || expiresAt <= now.toISOString() || Date.parse(expiresAt) - Date.parse(issuedAt) > REQUEST_MAX_LIFETIME_MS) fail15("SESSION_EXPIRED", "Legacy request is expired or outside migration policy");
  const migrated = createProductSessionRequest(registry, {
    productId: context.productId,
    platform: context.platform,
    deviceId: context.deviceId,
    deviceKey: legacy.productDeviceKey,
    scopes: legacy.scopes,
    purpose: legacy.purpose,
    nonce: legacy.nonce,
    state: context.state
  }, new Date(issuedAt));
  return parseProductSessionRequest(registry, { ...migrated, expiresAt }, now);
}
function parseProductSessionRequest(registryInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, REQUEST_FIELDS7, "Product Session request");
  const now = validDate11(at);
  if (input.version !== PRODUCT_SESSION_PROTOCOL_VERSION || input.chainId !== "ynx_6423-1" || !PRODUCT_SESSION_PLATFORMS.includes(input.platform)) fail15("INVALID_SESSION_REQUEST", "Product Session protocol, chain or platform is unsupported");
  const binding2 = productPlatformBinding(registryInput, input.productId, input.platform);
  const request = Object.freeze({
    version: input.version,
    chainId: input.chainId,
    productId: pattern8(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    clientId: pattern8(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/),
    platform: input.platform,
    applicationId: pattern8(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/),
    bundleId: platformIdentity(input.bundleId, "bundleId"),
    packageId: platformIdentity(input.packageId, "packageId"),
    origin: canonicalOrigin(input.origin),
    callback: canonicalCallback2(input.callback),
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: pattern8(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/),
    deviceKey: deviceKey2(input.deviceKey),
    nonce: token2(input.nonce, "nonce"),
    state: token2(input.state, "state"),
    scopes: Object.freeze(scopes(input.scopes, binding2.scopes)),
    purpose: text7(input.purpose, "purpose", 1, 180),
    issuedAt: time5(input.issuedAt, "issuedAt"),
    expiresAt: time5(input.expiresAt, "expiresAt")
  });
  validatePlatformIdentifiers(request);
  for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
    if (request[field] !== binding2[field]) fail15("SESSION_BINDING_MISMATCH", `Product Session request ${field} does not match the registry`);
  }
  const issued = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt);
  if (expires <= issued || expires - issued > REQUEST_MAX_LIFETIME_MS) fail15("INVALID_EXPIRY", "Product Session request lifetime is invalid");
  if (issued > now.getTime() + 3e4) fail15("ISSUED_IN_FUTURE", "Product Session request was issued in the future");
  if (expires <= now.getTime()) fail15("SESSION_EXPIRED", "Product Session request expired");
  return request;
}
function productSessionRequestDigest(registryInput, request, at = /* @__PURE__ */ new Date()) {
  return digestHex("YNX_PRODUCT_SESSION_REQUEST_V2", parseProductSessionRequest(registryInput, request, at));
}
function signProductSessionApproval(registryInput, requestInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, ["accountSecret", "scopes", "expiresAt"], "Product Session approval input");
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  const secret = accountSecret(input.accountSecret);
  const identity = walletIdentity(input.accountSecret);
  const granted = scopes(input.scopes, request.scopes);
  if (granted.join("\n") !== request.scopes.join("\n")) fail15("SCOPE_WIDENING", "Wallet approval scopes must exactly match the requested least-privilege scopes");
  const expiresAt = time5(input.expiresAt, "expiresAt");
  if (expiresAt > request.expiresAt || expiresAt <= validDate11(at).toISOString()) fail15("INVALID_EXPIRY", "Wallet approval expiry is outside the request lifetime");
  const unsigned3 = {
    version: PRODUCT_SESSION_PROTOCOL_VERSION,
    result: "approved",
    requestDigest: productSessionRequestDigest(registryInput, request, at),
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
    account: identity.account,
    accountPublicKey: identity.accountPublicKey,
    scopes: request.scopes,
    issuedAt: validDate11(at).toISOString(),
    expiresAt
  };
  const signature = secp256k1.sign(sha256(utf8ToBytes(approvalSignBytes2(unsigned3))), secret, { prehash: false, format: "compact", lowS: true });
  return parseProductSessionApproval(registryInput, request, { ...unsigned3, walletSignature: bytesToHex(signature) }, at);
}
function parseProductSessionApproval(registryInput, requestInput, input, at = /* @__PURE__ */ new Date()) {
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  exactFields(input, APPROVAL_FIELDS2, "Product Session approval");
  const approval = Object.freeze({
    ...input,
    version: pattern8(input.version, "version", /^2$/),
    result: pattern8(input.result, "result", /^approved$/),
    requestDigest: digest5(input.requestDigest, "requestDigest"),
    productId: pattern8(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/),
    clientId: pattern8(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/),
    applicationId: pattern8(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/),
    bundleId: platformIdentity(input.bundleId, "bundleId"),
    packageId: platformIdentity(input.packageId, "packageId"),
    origin: canonicalOrigin(input.origin),
    callback: canonicalCallback2(input.callback),
    deviceId: opaque(input.deviceId, "deviceId"),
    deviceAlgorithm: pattern8(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/),
    deviceKey: deviceKey2(input.deviceKey),
    nonce: token2(input.nonce, "nonce"),
    state: token2(input.state, "state"),
    account: pattern8(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    accountPublicKey: pattern8(input.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/),
    scopes: Object.freeze(scopes(input.scopes, request.scopes)),
    issuedAt: time5(input.issuedAt, "issuedAt"),
    expiresAt: time5(input.expiresAt, "expiresAt"),
    walletSignature: pattern8(input.walletSignature, "walletSignature", /^[0-9a-f]{128}$/)
  });
  validatePlatformIdentifiers(approval);
  const boundFields = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "deviceId", "deviceAlgorithm", "deviceKey", "nonce", "state"];
  if (approval.requestDigest !== productSessionRequestDigest(registryInput, request, at) || boundFields.some((field) => approval[field] !== request[field]) || approval.scopes.join("\n") !== request.scopes.join("\n")) fail15("SESSION_BINDING_MISMATCH", "Wallet approval does not match the exact Product Session request");
  if (approval.issuedAt < request.issuedAt || approval.issuedAt > validDate11(at).toISOString() || approval.expiresAt > request.expiresAt || approval.expiresAt <= validDate11(at).toISOString()) fail15("INVALID_APPROVAL_TIME", "Wallet approval is outside the request lifetime");
  let valid = false;
  try {
    valid = secp256k1.verify(hexToBytes(approval.walletSignature), sha256(utf8ToBytes(approvalSignBytes2(unsignedApproval2(approval)))), hexToBytes(approval.accountPublicKey), { prehash: false, format: "compact", lowS: true });
  } catch {
    valid = false;
  }
  if (!valid || walletIdentityFromPublicKey(approval.accountPublicKey) !== approval.account) fail15("INVALID_SIGNATURE", "Wallet approval signature is invalid");
  return approval;
}
function createProductSessionChallenge(registryInput, requestInput, approvalInput, input, at = /* @__PURE__ */ new Date()) {
  exactFields(input, ["challenge"], "Product Session challenge input");
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  const approval = parseProductSessionApproval(registryInput, request, approvalInput, at);
  const binding2 = productPlatformBinding(registryInput, request.productId, request.platform);
  const now = validDate11(at);
  const expiresAt = new Date(Math.min(now.getTime() + CHALLENGE_MAX_LIFETIME_MS, Date.parse(approval.expiresAt))).toISOString();
  const sessionExpiresAt = new Date(Math.min(Date.parse(approval.expiresAt), now.getTime() + binding2.sessionDurationSeconds * 1e3)).toISOString();
  return parseChallenge2({
    version: PRODUCT_SESSION_PROTOCOL_VERSION,
    challenge: token2(input.challenge, "challenge"),
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
function signProductSessionChallenge(challengeInput, deviceSecretInput) {
  const challenge = parseChallenge2(challengeInput);
  const secret = deviceSecret(deviceSecretInput);
  if (encodeBase64url(p256.getPublicKey(secret, true)) !== challenge.deviceKey) fail15("DEVICE_CHANGED", "Product device key changed before session completion");
  const signature = p256.sign(utf8ToBytes(challengeSignBytes(challenge)), secret, { format: "der" });
  return Object.freeze({ challenge, deviceSignature: encodeBase64url(signature) });
}
async function signProductSessionChallengeWith(challengeInput, signer) {
  const challenge = parseChallenge2(challengeInput);
  if (typeof signer !== "function") fail15("INVALID_DEVICE", "Product Session requires a platform device signer");
  const payload = encodeBase64url(utf8ToBytes(challengeSignBytes(challenge)));
  let deviceSignature;
  try {
    deviceSignature = await signer(Object.freeze({ purpose: "challenge", algorithm: "p256-sha256", deviceKey: challenge.deviceKey, payload }));
  } catch {
    fail15("DEVICE_SIGNING_FAILED", "Platform device signing failed closed");
  }
  if (typeof deviceSignature !== "string") fail15("INVALID_DEVICE_PROOF", "Platform device signature is invalid");
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url(deviceSignature, "deviceSignature"), decodeBase64url(payload, "device signing payload"), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail15("INVALID_DEVICE_PROOF", "Platform device signature does not match the registered device key");
  return Object.freeze({ challenge, deviceSignature });
}
function parseProductSessionChallenge(input) {
  return parseChallenge2(input);
}
var ProductSessionAuthority = class {
  #registry;
  #state;
  constructor(registryInput, snapshot3 = emptySnapshot4()) {
    this.#registry = parseProductSessionRegistry(registryInput);
    this.#state = parseSnapshot2(snapshot3);
  }
  issueChallenge(input, at = /* @__PURE__ */ new Date()) {
    exactFields(input, ["request", "approval", "challenge"], "Product Session challenge issuance");
    const request = parseProductSessionRequest(this.#registry, input.request, at);
    const approval = parseProductSessionApproval(this.#registry, request, input.approval, at);
    this.#assertApprovalNotRevoked(request, approval);
    if (this.#state.consumedRequests.includes(approval.requestDigest)) fail15("REPLAY", "Product Session request already completed; recover its original completion or obtain a new Wallet approval");
    const challenge = createProductSessionChallenge(this.#registry, request, approval, { challenge: input.challenge }, at);
    if (this.#state.issuedChallenges.some((item) => item.challenge === challenge.challenge) || this.#state.consumedChallenges.includes(challenge.challenge)) fail15("REPLAY", "Product Session challenge already exists");
    const next = clone2(this.#state);
    next.issuedChallenges.push(challenge);
    sortSnapshot(next);
    this.#state = parseSnapshot2(next);
    return challenge;
  }
  complete(input, at = /* @__PURE__ */ new Date()) {
    exactFields(input, ["request", "approval", "completion"], "Product Session completion");
    const request = parseProductSessionRequest(this.#registry, input.request, at);
    const approval = parseProductSessionApproval(this.#registry, request, input.approval, at);
    this.#assertApprovalNotRevoked(request, approval);
    exactFields(input.completion, COMPLETION_FIELDS2, "Product Session device completion");
    const challenge = parseChallenge2(input.completion.challenge);
    const expected = createProductSessionChallenge(this.#registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
    if (canonicalJSON(challenge) !== canonicalJSON(expected)) fail15("SESSION_BINDING_MISMATCH", "Gateway challenge fields were substituted");
    const issued = this.#state.issuedChallenges.find((item) => item.challenge === challenge.challenge);
    if (!issued || canonicalJSON(issued) !== canonicalJSON(challenge)) fail15("CHALLENGE_NOT_ISSUED", "Product Session challenge was not issued by this Gateway");
    if (challenge.expiresAt <= validDate11(at).toISOString()) fail15("SESSION_EXPIRED", "Product Session challenge expired");
    let valid = false;
    try {
      valid = p256.verify(decodeBase64url(input.completion.deviceSignature, "deviceSignature"), utf8ToBytes(challengeSignBytes(challenge)), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
    } catch {
      valid = false;
    }
    if (!valid) fail15("INVALID_DEVICE_PROOF", "Product Session device proof is invalid");
    if (this.#state.consumedNonces.includes(request.nonce) || this.#state.consumedStates.includes(request.state) || this.#state.consumedRequests.includes(approval.requestDigest) || this.#state.consumedChallenges.includes(challenge.challenge)) fail15("REPLAY", "Product Session request, state or challenge was already consumed");
    const session = parseSession({
      version: PRODUCT_SESSION_PROTOCOL_VERSION,
      sessionBinding: digestHex("YNX_PRODUCT_SESSION_BINDING_V2", challenge),
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
      expiresAt: challenge.sessionExpiresAt
    });
    const next = clone2(this.#state);
    next.issuedChallenges = next.issuedChallenges.filter((item) => item.challenge !== challenge.challenge);
    next.sessions.push(session);
    next.consumedNonces.push(request.nonce);
    next.consumedStates.push(request.state);
    next.consumedRequests.push(approval.requestDigest);
    next.consumedChallenges.push(challenge.challenge);
    sortSnapshot(next);
    this.#state = parseSnapshot2(next);
    return session;
  }
  introspect(sessionBindingInput, context, at = /* @__PURE__ */ new Date()) {
    exactFields(context, ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "requiredScopes"], "Product Session introspection context");
    const session = this.#state.sessions.find((item) => item.sessionBinding === digest5(sessionBindingInput, "sessionBinding"));
    if (!session) fail15("SESSION_NOT_FOUND", "Product Session was not found");
    const now = validDate11(at).toISOString();
    if (session.issuedAt > now) fail15("ISSUED_IN_FUTURE", "Product Session was issued in the future");
    if (session.expiresAt <= now) fail15("SESSION_EXPIRED", "Product Session expired");
    if (this.#state.revokedSessions.includes(session.sessionBinding) || this.#state.revokedDevices.includes(session.deviceBinding) || this.#state.revokedAccounts.some((item) => item.account === session.account && session.issuedAt <= item.before)) fail15("SESSION_REVOKED", "Product Session was revoked");
    validatePlatformIdentifiers(context, "CROSS_PRODUCT_SESSION");
    const exact4 = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey"];
    if (exact4.some((field) => context[field] !== session[field])) fail15("CROSS_PRODUCT_SESSION", "Product Session cannot cross product, account, origin, callback or device boundaries");
    const required = requiredScopes(context.requiredScopes, session.scopes);
    if (required.some((scope2) => !session.scopes.includes(scope2))) fail15("SCOPE_WIDENING", "Product Session scope cannot be widened");
    return Object.freeze({ active: true, session });
  }
  revokeSession(sessionBindingInput) {
    const value = digest5(sessionBindingInput, "sessionBinding");
    if (!this.#state.sessions.some((item) => item.sessionBinding === value)) fail15("SESSION_NOT_FOUND", "Product Session was not found");
    this.#revoke("revokedSessions", value);
    return value;
  }
  revokeDevice(deviceBindingInput) {
    const value = digest5(deviceBindingInput, "deviceBinding");
    this.#revoke("revokedDevices", value);
    return value;
  }
  revokeAccount(account, at = /* @__PURE__ */ new Date()) {
    const record2 = { account: pattern8(account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: validDate11(at).toISOString() };
    const previous = this.#state.revokedAccounts.find((item) => item.account === record2.account);
    if (previous && previous.before >= record2.before) return Object.freeze({ ...previous });
    const next = clone2(this.#state);
    next.revokedAccounts = next.revokedAccounts.filter((item) => item.account !== record2.account);
    next.revokedAccounts.push(record2);
    sortSnapshot(next);
    this.#state = parseSnapshot2(next);
    return Object.freeze(record2);
  }
  snapshot() {
    return freezeSnapshot3(clone2(this.#state));
  }
  #assertApprovalNotRevoked(request, approval) {
    if (this.#state.revokedDevices.includes(deviceBinding(request, approval.account)) || this.#state.revokedAccounts.some((item) => item.account === approval.account && approval.issuedAt <= item.before)) fail15("SESSION_REVOKED", "Wallet approval or its product device binding was revoked");
  }
  #revoke(field, value) {
    if (this.#state[field].includes(value)) fail15("ALREADY_REVOKED", "Product Session revocation already exists");
    const next = clone2(this.#state);
    next[field].push(value);
    sortSnapshot(next);
    this.#state = parseSnapshot2(next);
  }
};
function parseProductSession(input) {
  return parseSession(input);
}
function parseProductSessionAuthoritySnapshot(input) {
  return parseSnapshot2(input);
}
function productSessionApprovalDigest(approval) {
  return digestHex("YNX_PRODUCT_SESSION_APPROVAL_V2", approval);
}
function deviceBinding(requestOrSession, account) {
  return digestHex("YNX_PRODUCT_SESSION_DEVICE_V2", { chainId: requestOrSession.chainId, productId: requestOrSession.productId, clientId: requestOrSession.clientId, platform: requestOrSession.platform, applicationId: requestOrSession.applicationId, bundleId: requestOrSession.bundleId, packageId: requestOrSession.packageId, origin: requestOrSession.origin, callback: requestOrSession.callback, account, deviceId: requestOrSession.deviceId, deviceAlgorithm: requestOrSession.deviceAlgorithm, deviceKey: requestOrSession.deviceKey });
}
function parseChallenge2(input) {
  exactFields(input, CHALLENGE_FIELDS4, "Product Session challenge");
  const value = Object.freeze({ ...input, version: pattern8(input.version, "version", /^2$/), challenge: token2(input.challenge, "challenge"), requestDigest: digest5(input.requestDigest, "requestDigest"), approvalDigest: digest5(input.approvalDigest, "approvalDigest"), chainId: pattern8(input.chainId, "chainId", /^ynx_6423-1$/), productId: pattern8(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern8(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), platform: pattern8(input.platform, "platform", /^(android|ios|linux|macos|web|windows)$/), applicationId: pattern8(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: platformIdentity(input.bundleId, "bundleId"), packageId: platformIdentity(input.packageId, "packageId"), origin: canonicalOrigin(input.origin), callback: canonicalCallback2(input.callback), deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern8(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey2(input.deviceKey), nonce: token2(input.nonce, "nonce"), state: token2(input.state, "state"), account: pattern8(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), scopes: Object.freeze(scopes(input.scopes, input.scopes)), issuedAt: time5(input.issuedAt, "issuedAt"), expiresAt: time5(input.expiresAt, "expiresAt"), sessionExpiresAt: time5(input.sessionExpiresAt, "sessionExpiresAt") });
  validatePlatformIdentifiers(value);
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > CHALLENGE_MAX_LIFETIME_MS || value.sessionExpiresAt < value.expiresAt || Date.parse(value.sessionExpiresAt) - Date.parse(value.issuedAt) > REQUEST_MAX_LIFETIME_MS) fail15("INVALID_EXPIRY", "Product Session challenge or session lifetime is invalid");
  return value;
}
function parseSession(input) {
  exactFields(input, SESSION_FIELDS2, "Product Session");
  const value = Object.freeze({ ...input, version: pattern8(input.version, "version", /^2$/), sessionBinding: digest5(input.sessionBinding, "sessionBinding"), chainId: pattern8(input.chainId, "chainId", /^ynx_6423-1$/), productId: pattern8(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern8(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), platform: pattern8(input.platform, "platform", /^(android|ios|linux|macos|web|windows)$/), applicationId: pattern8(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: platformIdentity(input.bundleId, "bundleId"), packageId: platformIdentity(input.packageId, "packageId"), origin: canonicalOrigin(input.origin), callback: canonicalCallback2(input.callback), account: pattern8(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), deviceId: opaque(input.deviceId, "deviceId"), deviceAlgorithm: pattern8(input.deviceAlgorithm, "deviceAlgorithm", /^p256-sha256$/), deviceKey: deviceKey2(input.deviceKey), deviceBinding: digest5(input.deviceBinding, "deviceBinding"), nonce: token2(input.nonce, "nonce"), state: token2(input.state, "state"), scopes: Object.freeze(scopes(input.scopes, input.scopes)), requestDigest: digest5(input.requestDigest, "requestDigest"), approvalDigest: digest5(input.approvalDigest, "approvalDigest"), issuedAt: time5(input.issuedAt, "issuedAt"), expiresAt: time5(input.expiresAt, "expiresAt") });
  validatePlatformIdentifiers(value);
  if (value.expiresAt <= value.issuedAt || value.deviceBinding !== deviceBinding(value, value.account)) fail15("INVALID_SESSION", "Product Session security binding or lifetime is invalid");
  return value;
}
function parseSnapshot2(input) {
  exactFields(input, SNAPSHOT_FIELDS4, "Product Session authority snapshot");
  if (input.schemaVersion !== PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION) fail15("INVALID_SESSION_STORE", "Product Session authority snapshot version is unsupported");
  const value = { schemaVersion: input.schemaVersion, sessions: sortedUnique(input.sessions.map(parseSession), (item) => item.sessionBinding, "sessions"), issuedChallenges: sortedUnique(input.issuedChallenges.map(parseChallenge2), (item) => item.challenge, "issuedChallenges"), consumedNonces: stringSet(input.consumedNonces, /^[A-Za-z0-9_-]{32,64}$/, "consumedNonces"), consumedStates: stringSet(input.consumedStates, /^[A-Za-z0-9_-]{32,64}$/, "consumedStates"), consumedRequests: stringSet(input.consumedRequests, /^[0-9a-f]{64}$/, "consumedRequests"), consumedChallenges: stringSet(input.consumedChallenges, /^[A-Za-z0-9_-]{32,64}$/, "consumedChallenges"), revokedSessions: stringSet(input.revokedSessions, /^[0-9a-f]{64}$/, "revokedSessions"), revokedDevices: stringSet(input.revokedDevices, /^[0-9a-f]{64}$/, "revokedDevices"), revokedAccounts: sortedUnique(input.revokedAccounts.map((item) => {
    exactFields(item, ["account", "before"], "revoked account");
    return Object.freeze({ account: pattern8(item.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), before: time5(item.before, "before") });
  }), (item) => item.account, "revokedAccounts") };
  if (value.sessions.length !== value.consumedNonces.length || value.sessions.length !== value.consumedStates.length || value.sessions.length !== value.consumedRequests.length || value.sessions.length !== value.consumedChallenges.length || value.issuedChallenges.some((item) => value.consumedChallenges.includes(item.challenge))) fail15("INVALID_SESSION_STORE", "Issued and consumed records must exactly cover Product Sessions without overlap");
  return freezeSnapshot3(value);
}
function emptySnapshot4() {
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
function freezeSnapshot3(value) {
  return Object.freeze({ ...value, sessions: Object.freeze(value.sessions), issuedChallenges: Object.freeze(value.issuedChallenges), consumedNonces: Object.freeze(value.consumedNonces), consumedStates: Object.freeze(value.consumedStates), consumedRequests: Object.freeze(value.consumedRequests), consumedChallenges: Object.freeze(value.consumedChallenges), revokedSessions: Object.freeze(value.revokedSessions), revokedDevices: Object.freeze(value.revokedDevices), revokedAccounts: Object.freeze(value.revokedAccounts) });
}
function stringSet(value, regex, label) {
  if (!Array.isArray(value) || value.length > 1e4 || value.some((item) => typeof item !== "string" || !regex.test(item))) fail15("INVALID_SESSION_STORE", `${label} is invalid`);
  return sortedUnique(value, (item) => item, label);
}
function sortedUnique(value, key, label) {
  const keys = value.map(key);
  if (new Set(keys).size !== keys.length || [...keys].sort().join("\n") !== keys.join("\n")) fail15("INVALID_SESSION_STORE", `${label} must be unique and sorted`);
  return Object.freeze(value);
}
function unsignedApproval2(value) {
  const { walletSignature: _signature, ...unsigned3 } = value;
  return unsigned3;
}
function approvalSignBytes2(value) {
  return `YNX_PRODUCT_SESSION_APPROVAL_V2
${canonicalJSON(value)}`;
}
function challengeSignBytes(value) {
  return `YNX_PRODUCT_SESSION_CHALLENGE_V2
${canonicalJSON(value)}`;
}
function scopes(value, allowlist) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) fail15("INVALID_SCOPES", "Product Session scopes are invalid");
  const result = value.map((item) => pattern8(item, "scope", /^[a-z][a-z0-9._:-]{1,63}$/));
  if (new Set(result).size !== result.length || [...result].sort().join("\n") !== result.join("\n") || result.some((item) => !allowlist.includes(item))) fail15("SCOPE_WIDENING", "Product Session scope is duplicated, unsorted or outside the registry");
  return result;
}
function requiredScopes(value, allowlist) {
  if (!Array.isArray(value) || value.length > 8) fail15("INVALID_SCOPES", "Required Product Session scopes are invalid");
  if (value.length === 0) return [];
  return scopes(value, allowlist);
}
function platformIdentity(value, label) {
  return value === null ? null : pattern8(value, label, /^[A-Za-z][A-Za-z0-9.-]{2,131}$/);
}
function validatePlatformIdentifiers(value, errorCode = "SESSION_BINDING_MISMATCH") {
  const expectsBundle = value.platform === "ios" || value.platform === "macos";
  const expectsPackage = value.platform === "android" || value.platform === "linux" || value.platform === "windows";
  if (value.bundleId !== null !== expectsBundle || value.packageId !== null !== expectsPackage || value.bundleId !== null && value.bundleId !== value.applicationId || value.packageId !== null && value.packageId !== value.applicationId) fail15(errorCode, "Product Session bundleId/packageId does not match its registered platform identity");
}
function canonicalOrigin(value) {
  const normalized = text7(value, "origin", 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail15("INVALID_ORIGIN", "Product Session origin is invalid");
  }
  if (parsed.protocol === "https:" && parsed.origin === normalized && !parsed.port) return normalized;
  if (parsed.protocol === "app:" && /^app:\/\/(android|ios|linux|macos|windows)\/[A-Za-z][A-Za-z0-9.-]{2,127}$/.test(normalized)) return normalized;
  fail15("INVALID_ORIGIN", "Product Session origin must be an exact HTTPS or registered native origin");
}
function canonicalCallback2(value) {
  const normalized = text7(value, "callback", 8, 512);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail15("CALLBACK_MISMATCH", "Product Session callback is invalid");
  }
  if (["data:", "file:", "http:", "javascript:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || parsed.search || parsed.toString() !== normalized) fail15("CALLBACK_MISMATCH", "Product Session callback is unsafe or non-canonical");
  return normalized;
}
function deviceKey2(value) {
  const normalized = pattern8(value, "deviceKey", /^[A-Za-z0-9_-]{44}$/);
  const bytes = decodeBase64url(normalized, "deviceKey");
  if (bytes.length !== 33 || encodeBase64url(bytes) !== normalized) fail15("INVALID_DEVICE_KEY", "Product Session device key is invalid");
  try {
    p256.Point.fromBytes(bytes);
  } catch {
    fail15("INVALID_DEVICE_KEY", "Product Session device key is not P-256");
  }
  return normalized;
}
function accountSecret(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail15("INVALID_SECRET", "Wallet account secret is invalid");
  const bytes = hexToBytes(value);
  if (!secp256k1.utils.isValidSecretKey(bytes)) fail15("INVALID_SECRET", "Wallet account secret is outside secp256k1");
  return bytes;
}
function deviceSecret(value) {
  const bytes = decodeBase64url(value, "deviceSecret");
  if (bytes.length !== 32 || !p256.utils.isValidSecretKey(bytes)) fail15("INVALID_SECRET", "Product device secret is invalid");
  return bytes;
}
function token2(value, label) {
  return pattern8(value, label, /^[A-Za-z0-9_-]{32,64}$/);
}
function opaque(value, label) {
  return pattern8(value, label, /^[A-Za-z0-9._:-]{8,128}$/);
}
function digest5(value, label) {
  return pattern8(value, label, /^[0-9a-f]{64}$/);
}
function pattern8(value, label, regex) {
  const normalized = text7(value, label, 1, 512);
  if (!regex.test(normalized)) fail15("INVALID_FIELD", `${label} is invalid`);
  return normalized;
}
function text7(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.trim() !== value) fail15("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time5(value, label) {
  const normalized = pattern8(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail15("INVALID_TIME", `${label} is invalid`);
  return normalized;
}
function validDate11(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail15("INVALID_TIME", "Product Session time is invalid");
  return value;
}
function clone2(value) {
  return JSON.parse(JSON.stringify(value));
}
function fail15(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-router.js
var WALLET_ROUTE_STATUS = Object.freeze({
  READY: "ready",
  WALLET_NOT_INSTALLED: "wallet-not-installed",
  SCHEME_NOT_REGISTERED: "scheme-not-registered",
  SESSION_EXPIRED: "session-expired",
  CALLBACK_MISMATCH: "callback-mismatch",
  USER_REJECTED: "user-rejected",
  NETWORK_UNAVAILABLE: "network-unavailable"
});
function walletConnectionChoices(registryInput, productId, availability) {
  const registry = parseProductSessionRegistry(registryInput);
  exactFields(availability, ["ynxWalletInstalled", "metaMaskAvailable"], "Wallet availability");
  if (typeof availability.ynxWalletInstalled !== "boolean" || typeof availability.metaMaskAvailable !== "boolean") fail16("INVALID_WALLET_AVAILABILITY", "Wallet availability flags must be boolean");
  const product = registry.products.find((item) => item.productId === productId);
  if (!product) fail16("UNKNOWN_PRODUCT", "Product is not registered for Wallet connection");
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
  const registry = parseProductSessionRegistry(registryInput);
  const request = parseProductSessionRequest(registry, requestInput, at);
  const target2 = new URL(registry.wallet.authorizeCallback);
  target2.searchParams.set("request", encodeBase64url(new TextEncoder().encode(canonicalJSON(request))));
  return target2.toString();
}
function parseProductSessionWalletURL(registryInput, url2, at = /* @__PURE__ */ new Date()) {
  const registry = parseProductSessionRegistry(registryInput);
  const parsed = safeURL(url2, "SCHEME_NOT_REGISTERED", "Wallet URL is invalid");
  const expected = new URL(registry.wallet.authorizeCallback);
  const keys = [...parsed.searchParams.keys()];
  if (parsed.protocol !== expected.protocol || parsed.host !== expected.host || parsed.pathname !== expected.pathname || parsed.hash || parsed.username || parsed.password || keys.length !== 1 || keys[0] !== "request") fail16("SCHEME_NOT_REGISTERED", "Wallet scheme, route or parameters are not registered");
  const raw = decodeJSON(parsed.searchParams.get("request"), "Wallet request");
  return parseProductSessionRequest(registry, raw, at);
}
function prepareWalletOpen(registryInput, requestInput, environment, at = /* @__PURE__ */ new Date()) {
  exactFields(environment, ["networkAvailable", "walletInstalled", "schemeRegistered"], "Wallet open environment");
  if (!environment.networkAvailable) return routeState(WALLET_ROUTE_STATUS.NETWORK_UNAVAILABLE, "Retry when network connectivity returns", ["retry", "return-to-product"]);
  let request;
  try {
    request = parseProductSessionRequest(registryInput, requestInput, at);
  } catch (error) {
    if (error instanceof WalletAuthError && (error.code === "SESSION_EXPIRED" || error.code === "EXPIRED")) return routeState(WALLET_ROUTE_STATUS.SESSION_EXPIRED, "Start a new Wallet connection request", ["retry", "return-to-product"]);
    throw error;
  }
  if (!environment.walletInstalled) return routeState(WALLET_ROUTE_STATUS.WALLET_NOT_INSTALLED, "Install YNX Wallet or return to Guest / Try mode", ["download", "guest", "return-to-product"]);
  if (!environment.schemeRegistered) return routeState(WALLET_ROUTE_STATUS.SCHEME_NOT_REGISTERED, "Repair or reinstall YNX Wallet, then retry", ["download", "retry", "return-to-product"]);
  return Object.freeze({ status: WALLET_ROUTE_STATUS.READY, url: encodeProductSessionWalletURL(registryInput, request, at), request, actions: Object.freeze([]) });
}
function prepareWalletAttempt(registryInput, requestInput, at = /* @__PURE__ */ new Date()) {
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  return Object.freeze({
    status: WALLET_ROUTE_STATUS.READY,
    url: encodeProductSessionWalletURL(registryInput, request, at),
    request,
    installation: "unverified",
    automatic: false,
    actions: Object.freeze([])
  });
}
function createProductSessionReturnURL(registryInput, requestInput, result, at = /* @__PURE__ */ new Date()) {
  const request = parseProductSessionRequest(registryInput, requestInput, at);
  exactFields(result, result.result === "approved" ? ["result", "approval"] : ["result", "reason"], "Product Session return result");
  const target2 = new URL(request.callback);
  if (result.result === "approved") {
    const approval = parseProductSessionApproval(registryInput, request, result.approval, at);
    target2.searchParams.set("result", "approved");
    target2.searchParams.set("approval", encodeBase64url(new TextEncoder().encode(canonicalJSON(approval))));
  } else if (result.result === "rejected" && result.reason === "user_rejected") {
    target2.searchParams.set("result", "rejected");
    target2.searchParams.set("reason", "user_rejected");
  } else {
    fail16("INVALID_RETURN_RESULT", "Wallet return result is unsupported");
  }
  target2.searchParams.set("nonce", request.nonce);
  target2.searchParams.set("state", request.state);
  return target2.toString();
}
function parseProductSessionReturnURL(registryInput, pendingRequest, url2, at = /* @__PURE__ */ new Date()) {
  let request;
  try {
    request = parseProductSessionRequest(registryInput, pendingRequest, at);
  } catch (error) {
    if (error instanceof WalletAuthError && error.code === "SESSION_EXPIRED") return routeState(WALLET_ROUTE_STATUS.SESSION_EXPIRED, "The Wallet approval request expired", ["retry", "return-to-product"]);
    throw error;
  }
  const parsed = safeURL(url2, "CALLBACK_MISMATCH", "Wallet callback is invalid");
  const expected = new URL(request.callback);
  const result = parsed.searchParams.get("result");
  const allowed = result === "approved" ? ["approval", "nonce", "result", "state"] : ["nonce", "reason", "result", "state"];
  const keys = [...parsed.searchParams.keys()].sort();
  parsed.search = "";
  if (parsed.toString() !== expected.toString() || parsed.hash || parsed.username || parsed.password || keys.join("\n") !== allowed.join("\n") || parsed.protocol === "http:" || parsed.protocol === "file:" || parsed.protocol === "javascript:") return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Return to the product and start a new Wallet request", ["retry", "return-to-product"]);
  if (new URL(url2).searchParams.get("nonce") !== request.nonce || new URL(url2).searchParams.get("state") !== request.state) return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet callback nonce or state did not match", ["retry", "return-to-product"]);
  if (result === "rejected" && new URL(url2).searchParams.get("reason") === "user_rejected") return routeState(WALLET_ROUTE_STATUS.USER_REJECTED, "No Product Session was created", ["guest", "retry", "return-to-product"]);
  if (result !== "approved") return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet callback result was not recognized", ["retry", "return-to-product"]);
  try {
    const approval = parseProductSessionApproval(registryInput, request, decodeJSON(new URL(url2).searchParams.get("approval"), "Wallet approval"), at);
    return Object.freeze({ status: WALLET_ROUTE_STATUS.READY, request, approval, actions: Object.freeze([]) });
  } catch (error) {
    if (error instanceof WalletAuthError) return routeState(WALLET_ROUTE_STATUS.CALLBACK_MISMATCH, "Wallet approval did not match the pending product request", ["retry", "return-to-product"]);
    throw error;
  }
}
function canonicalReturnTarget(registryInput, productId, platform) {
  const binding2 = productPlatformBinding(registryInput, productId, platform);
  return Object.freeze({ productId, platform, origin: binding2.origin, callback: binding2.callback, applicationId: binding2.applicationId, bundleId: binding2.bundleId, packageId: binding2.packageId });
}
function routeState(status, message, actions) {
  return Object.freeze({ status, message, actions: Object.freeze(actions) });
}
function decodeJSON(value, label) {
  try {
    const bytes = decodeBase64url(value ?? "", label);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail16("INVALID_ROUTE_PAYLOAD", `${label} encoding is invalid`);
  }
}
function safeURL(value, code, message) {
  if (typeof value !== "string" || value.length > 4096) fail16(code, message);
  try {
    return new URL(value);
  } catch {
    fail16(code, message);
  }
}
function fail16(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/metamask-evm-adapter.js
var METAMASK_EVM_CONNECTION_STATUS = Object.freeze({
  CONNECTED: "connected-evm"
});
var METAMASK_EVM_CHAIN_ID = 6423;
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
var MetaMaskEvmConnectionAdapter = class {
  #productId;
  #provider;
  constructor(config) {
    exactFields(config, ["registry", "productId", "provider"], "MetaMask EVM adapter configuration");
    const registry = parseProductSessionRegistry(config.registry);
    const product = registry.products.find((item) => item.productId === config.productId);
    if (!product) fail17("UNKNOWN_PRODUCT", "Product is not registered for Wallet connection");
    if (!product.evmCompatible) fail17("EVM_NOT_SUPPORTED", "Product is not registered for an EVM Wallet connection");
    if (typeof config.productId !== "string") fail17("INVALID_METAMASK_CONFIG", "MetaMask productId is invalid");
    this.#productId = product.productId;
    this.#provider = config.provider;
  }
  async connect() {
    const provider = this.#provider;
    if (provider === null || provider === void 0) fail17("METAMASK_NOT_INSTALLED", "MetaMask EIP-1193 provider was not detected");
    if (!isExplicitMetaMaskProvider(provider)) {
      fail17("INVALID_METAMASK_PROVIDER", "Detected provider is not an explicit MetaMask EIP-1193 provider");
    }
    let chainId = parseChainQuantity(await providerRequest(provider, "eth_chainId"));
    if (chainId !== METAMASK_EVM_CHAIN_ID) {
      try {
        await providerRequest(provider, "wallet_switchEthereumChain", [{ chainId: METAMASK_EVM_CHAIN_QUANTITY }], true);
      } catch (error) {
        if (!(error instanceof WalletAuthError) || error.code !== "CHAIN_NOT_AVAILABLE") throw error;
        try {
          await providerRequest(provider, "wallet_addEthereumChain", [METAMASK_EVM_CHAIN]);
        } catch (addError) {
          if (addError instanceof WalletAuthError && addError.code === "USER_REJECTED") throw addError;
          fail17("CHAIN_NOT_AVAILABLE", "YNX EVM chain 6423 could not be added to MetaMask");
        }
        await providerRequest(provider, "wallet_switchEthereumChain", [{ chainId: METAMASK_EVM_CHAIN_QUANTITY }], true);
      }
      chainId = parseChainQuantity(await providerRequest(provider, "eth_chainId"));
    }
    if (chainId !== METAMASK_EVM_CHAIN_ID) fail17("WRONG_NETWORK", "MetaMask did not switch to YNX EVM chain 6423");
    const address4 = firstAccount2(await providerRequest(provider, "eth_requestAccounts"));
    chainId = parseChainQuantity(await providerRequest(provider, "eth_chainId"));
    if (chainId !== METAMASK_EVM_CHAIN_ID) fail17("WRONG_NETWORK", "MetaMask changed networks during account approval");
    return Object.freeze({
      status: METAMASK_EVM_CONNECTION_STATUS.CONNECTED,
      wallet: "metamask",
      connectionMode: "evm-only",
      authority: "eip-1193-provider-only",
      productId: this.#productId,
      chainId: METAMASK_EVM_CHAIN_ID,
      chainQuantity: METAMASK_EVM_CHAIN_QUANTITY,
      address: address4,
      ynxProductSession: false,
      productSession: null,
      limitations: LIMITATIONS
    });
  }
};
async function providerRequest(provider, method3, params, switching = false) {
  try {
    return await provider.request(params === void 0 ? { method: method3 } : { method: method3, params });
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    const code = providerErrorCode(error);
    if (code === 4001 || code === "4001") fail17("USER_REJECTED", "MetaMask connection was rejected by the user");
    if (switching && (code === 4902 || code === "4902")) fail17("CHAIN_NOT_AVAILABLE", "YNX EVM chain 6423 is not configured in MetaMask");
    if (code === 4900 || code === "4900" || code === 4901 || code === "4901") fail17("WALLET_UNAVAILABLE", "MetaMask is disconnected from the requested chain");
    fail17("WALLET_UNAVAILABLE", "MetaMask EIP-1193 request failed closed");
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
    fail17("INVALID_WALLET_RESPONSE", "MetaMask returned a non-canonical chain quantity");
  }
  const chainId = Number(BigInt(value));
  if (!Number.isSafeInteger(chainId)) fail17("INVALID_WALLET_RESPONSE", "MetaMask returned an unsupported chain quantity");
  return chainId;
}
function normalizeAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    fail17("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid EVM account address");
  }
  return value.toLowerCase();
}
function firstAccount2(value) {
  try {
    if (!Array.isArray(value) || value.length < 1 || value.length > 1024) fail17("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid account list");
    return normalizeAddress(value[0]);
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    fail17("INVALID_WALLET_RESPONSE", "MetaMask returned an invalid account list");
  }
}
function fail17(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/wallet-provider-discovery.js
var WALLET_PROVIDER_DISCOVERY_AUTHORITY = "unverified-injected-candidate";
var WALLET_PROVIDER_KIND = Object.freeze({ YNX: "ynx-wallet", METAMASK: "metamask" });
var YNX_RDNS = /* @__PURE__ */ new Set(["com.ynx.wallet", "com.ynx.wallet.companion"]);
var METAMASK_RDNS = /* @__PURE__ */ new Set(["io.metamask", "io.metamask.flask"]);
var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
        if (validProvider2(provider)) announcedProviders.add(provider);
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
async function discoverWalletProviders(scope2 = globalThis, waitMs = 160) {
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
  const ynxCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND.YNX);
  const metaMaskCandidates = candidates.filter((item) => item.kind === WALLET_PROVIDER_KIND.METAMASK);
  const ambiguities = [];
  if (ynxCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.YNX);
  if (metaMaskCandidates.length > 1) ambiguities.push(WALLET_PROVIDER_KIND.METAMASK);
  return Object.freeze({
    ynx: ynxCandidates.length === 1 ? ynxCandidates[0] : null,
    metamask: metaMaskCandidates.length === 1 ? metaMaskCandidates[0] : null,
    candidates: Object.freeze(candidates),
    ambiguities: Object.freeze(ambiguities),
    conflictedAnnouncements,
    authority: WALLET_PROVIDER_DISCOVERY_AUTHORITY
  });
}
function walletAvailabilityFromDiscovery(discovery) {
  if (!validDiscovery(discovery)) throw new TypeError("Wallet provider discovery result is invalid");
  return Object.freeze({ ynxWalletInstalled: discovery.ynx !== null, metaMaskAvailable: discovery.metamask !== null });
}
function candidate(provider, info, source) {
  if (!validProvider2(provider) || source !== "eip6963" && source !== "legacy-injected") return null;
  const providerInfo = object2(info) ? info : null;
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
    kind: ynx ? WALLET_PROVIDER_KIND.YNX : WALLET_PROVIDER_KIND.METAMASK,
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
  return object2(value) && validProvider2(safely(() => value.provider)) && Object.values(WALLET_PROVIDER_KIND).includes(safely(() => value.kind)) && safely(() => value.authority) === WALLET_PROVIDER_DISCOVERY_AUTHORITY;
}
function validDiscovery(value) {
  const ynx = safely(() => value?.ynx), metamask = safely(() => value?.metamask), ambiguities = safely(() => value?.ambiguities), authority = safely(() => value?.authority), conflicts = safely(() => value?.conflictedAnnouncements);
  return object2(value) && (ynx === null || validCandidate(ynx) && ynx.kind === WALLET_PROVIDER_KIND.YNX) && (metamask === null || validCandidate(metamask) && metamask.kind === WALLET_PROVIDER_KIND.METAMASK) && Array.isArray(ambiguities) && new Set(ambiguities).size === ambiguities.length && ambiguities.every((item) => Object.values(WALLET_PROVIDER_KIND).includes(item)) && Number.isSafeInteger(conflicts) && conflicts >= 0 && authority === WALLET_PROVIDER_DISCOVERY_AUTHORITY;
}
function validProvider2(value) {
  return object2(value) && typeof safely(() => value.request) === "function";
}
function canonicalUuid(value) {
  return typeof value === "string" && UUID3.test(value) ? value.toLowerCase() : null;
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
function object2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safely(read) {
  try {
    return read();
  } catch {
    return void 0;
  }
}

// packages/wallet-auth/src/product-session-proof-v2.js
var PROOF_FIELDS3 = ["version", "sessionBinding", "productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt", "signature"];
var INPUT_FIELDS3 = ["method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];
function createProductSessionProofV2(sessionInput, input, deviceSecretInput) {
  const session = parseProductSession(sessionInput);
  exactFields(input, INPUT_FIELDS3, "Product Session v2 proof input");
  const secret = decodeBase64url(deviceSecretInput, "deviceSecret");
  if (secret.length !== 32 || encodeBase64url(p256.getPublicKey(secret, true)) !== session.deviceKey) fail18("DEVICE_CHANGED", "Product Session proof device changed");
  const unsigned3 = parseUnsigned3({ version: "2", sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, ...input });
  const signature = encodeBase64url(p256.sign(utf8ToBytes(productSessionProofV2SignBytes(unsigned3)), secret, { format: "der" }));
  return parseProductSessionProofV2({ ...unsigned3, signature });
}
async function createProductSessionProofV2With(sessionInput, input, signer) {
  const session = parseProductSession(sessionInput);
  exactFields(input, INPUT_FIELDS3, "Product Session v2 proof input");
  if (typeof signer !== "function") fail18("INVALID_DEVICE", "Product Session proof requires a platform device signer");
  const unsigned3 = parseUnsigned3({ version: "2", sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, ...input });
  const payload = encodeBase64url(utf8ToBytes(productSessionProofV2SignBytes(unsigned3)));
  let signature;
  try {
    signature = await signer(Object.freeze({ purpose: "http-proof", algorithm: "p256-sha256", deviceKey: session.deviceKey, payload }));
  } catch {
    fail18("DEVICE_SIGNING_FAILED", "Platform device proof signing failed closed");
  }
  const proof = parseProductSessionProofV2({ ...unsigned3, signature });
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url(proof.signature, "signature"), decodeBase64url(payload, "device signing payload"), decodeBase64url(session.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail18("INVALID_DEVICE_PROOF", "Platform device proof signature does not match the registered device key");
  return proof;
}
function parseProductSessionProofV2(input) {
  exactFields(input, PROOF_FIELDS3, "Product Session v2 proof");
  const { signature, ...unsigned3 } = input;
  const bytes = decodeBase64url(pattern9(signature, "signature", /^[A-Za-z0-9_-]{90,96}$/), "signature");
  if (bytes.length < 68 || bytes.length > 72 || encodeBase64url(bytes) !== signature) fail18("INVALID_DEVICE_PROOF", "Product Session proof signature is invalid");
  return Object.freeze({ ...parseUnsigned3(unsigned3), signature });
}
function verifyProductSessionProofV2(proofInput, sessionInput, request, at = /* @__PURE__ */ new Date()) {
  const proof = parseProductSessionProofV2(proofInput), session = parseProductSession(sessionInput);
  exactFields(request, ["method", "path", "bodyDigest"], "Product Session v2 proof request context");
  const bindingFields = ["sessionBinding", "productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey"];
  if (bindingFields.some((field) => proof[field] !== session[field])) fail18("CROSS_PRODUCT_SESSION", "Product Session proof crosses a session binding");
  if (proof.method !== method2(request.method) || proof.path !== path2(request.path) || proof.bodyDigest !== digest6(request.bodyDigest, "bodyDigest")) fail18("HTTP_BINDING_MISMATCH", "Product Session proof does not match the HTTP request");
  const now = validDate12(at).toISOString();
  if (proof.issuedAt < session.issuedAt || proof.issuedAt > now) fail18("ISSUED_IN_FUTURE", "Product Session proof issue time is invalid");
  if (proof.expiresAt <= now || proof.expiresAt > session.expiresAt) fail18("SESSION_EXPIRED", "Product Session proof is expired or exceeds its session");
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url(proof.signature, "signature"), utf8ToBytes(productSessionProofV2SignBytes(unsigned2(proof))), decodeBase64url(proof.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail18("INVALID_DEVICE_PROOF", "Product Session proof signature is invalid");
  return proof;
}
function productSessionProofV2SignBytes(input) {
  return `YNX_PRODUCT_SESSION_HTTP_PROOF_V2
${canonicalJSON(parseUnsigned3(input))}`;
}
function productSessionProofV2Digest(input) {
  return digestHex("YNX_PRODUCT_SESSION_HTTP_PROOF_DIGEST_V2", parseProductSessionProofV2(input));
}
function parseUnsigned3(input) {
  exactFields(input, PROOF_FIELDS3.filter((field) => field !== "signature"), "Unsigned Product Session v2 proof");
  const value = Object.freeze({ version: pattern9(input.version, "version", /^2$/), sessionBinding: digest6(input.sessionBinding, "sessionBinding"), productId: pattern9(input.productId, "productId", /^[a-z][a-z0-9-]{1,31}$/), clientId: pattern9(input.clientId, "clientId", /^[a-z][a-z0-9._-]{2,63}$/), applicationId: pattern9(input.applicationId, "applicationId", /^[A-Za-z][A-Za-z0-9.-]{2,131}$/), bundleId: nullableIdentity(input.bundleId, "bundleId"), packageId: nullableIdentity(input.packageId, "packageId"), origin: url(input.origin, "origin"), callback: url(input.callback, "callback"), account: pattern9(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/), deviceId: pattern9(input.deviceId, "deviceId", /^[A-Za-z0-9._:-]{8,128}$/), deviceKey: pattern9(input.deviceKey, "deviceKey", /^[A-Za-z0-9_-]{44}$/), method: method2(input.method), path: path2(input.path), bodyDigest: digest6(input.bodyDigest, "bodyDigest"), nonce: pattern9(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/), issuedAt: time6(input.issuedAt, "issuedAt"), expiresAt: time6(input.expiresAt, "expiresAt") });
  if (value.bundleId !== null && value.bundleId !== value.applicationId || value.packageId !== null && value.packageId !== value.applicationId || value.bundleId !== null && value.packageId !== null) fail18("INVALID_FIELD", "Product Session proof application identity is inconsistent");
  if (value.expiresAt <= value.issuedAt || Date.parse(value.expiresAt) - Date.parse(value.issuedAt) > 6e4) fail18("INVALID_EXPIRY", "Product Session proof lifetime must be at most sixty seconds");
  return value;
}
function unsigned2(value) {
  const { signature: _signature, ...result } = value;
  return result;
}
function url(value, label) {
  const normalized = pattern9(value, label, /^(https|app|[a-z][a-z0-9+.-]*):\/\/[^\s#?]+$/);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    fail18("INVALID_FIELD", `${label} is invalid`);
  }
  const canonical = label === "origin" && parsed.protocol === "https:" ? parsed.origin === normalized : parsed.toString() === normalized;
  if (!canonical || ["http:", "file:", "javascript:", "data:"].includes(parsed.protocol)) fail18("INVALID_FIELD", `${label} is unsafe`);
  return normalized;
}
function method2(value) {
  return pattern9(value, "method", /^(DELETE|GET|PATCH|POST|PUT)$/);
}
function path2(value) {
  const normalized = pattern9(value, "path", /^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/);
  if (normalized.includes("//") || normalized.endsWith("/") || normalized.includes("?") || normalized.includes("#")) fail18("INVALID_PATH", "Product Session proof path is non-canonical");
  return normalized;
}
function digest6(value, label) {
  return pattern9(value, label, /^[0-9a-f]{64}$/);
}
function nullableIdentity(value, label) {
  return value === null ? null : pattern9(value, label, /^[A-Za-z][A-Za-z0-9.-]{2,131}$/);
}
function pattern9(value, label, regex) {
  if (typeof value !== "string" || value.trim() !== value || !regex.test(value)) fail18("INVALID_FIELD", `${label} is invalid`);
  return value;
}
function time6(value, label) {
  const normalized = pattern9(value, label, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) fail18("INVALID_TIME", `${label} is invalid`);
  return normalized;
}
function validDate12(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail18("INVALID_TIME", "Product Session proof time is invalid");
  return value;
}
function fail18(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-revocation-intent.js
var BINDING_FIELDS = ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"];
function createRevocationIntent(binding2, device2, intentId, session) {
  return parseRevocationIntent(canonicalJSON({ version: 1, intentId, scope: scope(binding2, device2), session }), binding2, device2);
}
function parseRevocationIntent(raw, binding2, device2) {
  if (typeof raw !== "string" || raw.length > 16384) fail19("INVALID_SESSION_STORE", "Pending revocation intent is invalid");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail19("INVALID_SESSION_STORE", "Pending revocation intent is not valid JSON");
  }
  exactFields(value, ["version", "intentId", "scope", "session"], "Pending Product Session revocation intent");
  if (value.version !== 1 || !/^[A-Za-z0-9_-]{32,64}$/.test(value.intentId) || value.scope !== scope(binding2, device2)) fail19("CROSS_PRODUCT_SESSION", "Pending revocation intent does not match this product device");
  const session = value.session === null ? null : parseProductSession(value.session);
  if (session && (BINDING_FIELDS.some((field) => session[field] !== binding2[field]) || session.deviceId !== device2.id || session.deviceKey !== device2.key || canonicalJSON(session.scopes) !== canonicalJSON(device2.scopes))) fail19("CROSS_PRODUCT_SESSION", "Pending revocation target does not match this product device");
  return Object.freeze({ version: 1, intentId: value.intentId, scope: value.scope, session });
}
function revocationSessionMatches(raw, session) {
  if (raw === null || session === null) return false;
  try {
    return canonicalJSON(parseProductSession(JSON.parse(raw))) === canonicalJSON(session);
  } catch {
    return false;
  }
}
function scope(binding2, device2) {
  return digestHex("YNX_PRODUCT_SESSION_LOCAL_REVOCATION_SCOPE_V1", { ...Object.fromEntries(BINDING_FIELDS.map((field) => [field, binding2[field]])), deviceId: device2.id, deviceKey: device2.key, scopes: device2.scopes });
}
function fail19(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-completion-record.js
function parseCompletionRecord(registry, raw, at) {
  if (typeof raw !== "string" || raw.length > 16384) fail20("INVALID_SESSION_STORE", "Protected completion record is invalid");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail20("INVALID_SESSION_STORE", "Protected completion record is not valid JSON");
  }
  exactFields(value, ["request", "approval", "completion"], "Protected Product Session completion");
  const request = parseProductSessionRequest(registry, value.request, at);
  const approval = parseProductSessionApproval(registry, request, value.approval, at);
  exactFields(value.completion, ["challenge", "deviceSignature"], "Protected Product Session device completion");
  const challenge = parseProductSessionChallenge(value.completion.challenge);
  const expected = createProductSessionChallenge(registry, request, approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
  if (canonicalJSON(challenge) !== canonicalJSON(expected)) fail20("SESSION_BINDING_MISMATCH", "Protected completion challenge changed");
  let valid = false;
  try {
    valid = p256.verify(decodeBase64url(value.completion.deviceSignature, "deviceSignature"), new TextEncoder().encode(`YNX_PRODUCT_SESSION_CHALLENGE_V2
${canonicalJSON(challenge)}`), decodeBase64url(challenge.deviceKey, "deviceKey"), { format: "der", lowS: false });
  } catch {
    valid = false;
  }
  if (!valid) fail20("INVALID_DEVICE_PROOF", "Protected completion signature is invalid");
  return Object.freeze({ request, approval, completion: Object.freeze({ challenge, deviceSignature: value.completion.deviceSignature }) });
}
function deriveCompletionTarget(registry, raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail20("INVALID_SESSION_STORE", "Protected completion record is not valid JSON");
  }
  const at = new Date(value?.completion?.challenge?.issuedAt);
  const record2 = parseCompletionRecord(registry, raw, at);
  const verifier = new ProductSessionAuthority(registry);
  verifier.issueChallenge({ request: record2.request, approval: record2.approval, challenge: record2.completion.challenge.challenge }, at);
  return verifier.complete(record2, at);
}
function fail20(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-gateway-snapshot-v2.js
var PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION = 2;
var SNAPSHOT_FIELDS5 = ["schemaVersion", "authority", "consumedProofs", "idempotency", "audit"];
var SNAPSHOT_V1_FIELDS3 = ["schemaVersion", "authority", "consumedProofs", "audit"];
var IDEMPOTENCY_FIELDS = ["requestId", "path", "bodyDigest", "responseBody", "subject", "expiresAt"];
var IDEMPOTENT_PATHS = /* @__PURE__ */ new Set(["/v2/product-sessions/challenge", "/v2/product-sessions/complete"]);
function parseProductSessionGatewaySnapshot(input) {
  exactFields(input, SNAPSHOT_FIELDS5, "Product Session Gateway snapshot");
  if (input.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway snapshot version is unsupported");
  const authority = parseProductSessionAuthoritySnapshot(input.authority);
  const consumedProofs = stringSet2(input.consumedProofs, /^[0-9a-f]{64}$/, "consumedProofs");
  const idempotency = parseIdempotency(input.idempotency);
  if (!Array.isArray(input.audit) || input.audit.length > 2e4) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway audit is invalid");
  const audit = input.audit.map((item, index) => {
    exactFields(item, ["sequence", "requestId", "path", "outcome", "code", "subject", "at"], "Product Session Gateway audit event");
    if (item.sequence !== index + 1 || !/^req_[A-Za-z0-9_-]{12,80}$/.test(item.requestId) || !/^\/[A-Za-z0-9/_-]{1,255}$/.test(item.path) || !["ok", "rejected", "idempotent"].includes(item.outcome) || item.code !== null && (typeof item.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(item.code)) || typeof item.subject !== "string" || item.subject.length > 128 || !isCanonicalIsoDate(item.at)) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway audit event is invalid");
    return Object.freeze({ ...item });
  });
  return Object.freeze({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority, consumedProofs: Object.freeze(consumedProofs), idempotency: Object.freeze(idempotency), audit: Object.freeze(audit) });
}
function migrateProductSessionGatewaySnapshotV1(input) {
  exactFields(input, SNAPSHOT_V1_FIELDS3, "Product Session Gateway snapshot v1");
  if (input.schemaVersion !== 1) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway snapshot v1 is unsupported");
  return parseProductSessionGatewaySnapshot({ ...input, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, idempotency: [] });
}
function stringSet2(value, regex, label) {
  if (!Array.isArray(value) || value.length > 2e4 || value.some((item) => typeof item !== "string" || !regex.test(item)) || new Set(value).size !== value.length || [...value].sort().join("\n") !== value.join("\n")) fail21("INVALID_GATEWAY_STORE", `${label} must be unique and sorted`);
  return [...value];
}
function parseIdempotency(value) {
  if (!Array.isArray(value) || value.length > 2e4) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency store is invalid");
  const entries = value.map((item) => {
    exactFields(item, IDEMPOTENCY_FIELDS, "Product Session Gateway idempotency entry");
    if (typeof item.requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(item.requestId) || !IDEMPOTENT_PATHS.has(item.path) || typeof item.bodyDigest !== "string" || !/^[0-9a-f]{64}$/.test(item.bodyDigest) || typeof item.responseBody !== "string" || item.responseBody.length > 32768 || typeof item.subject !== "string" || item.subject.length > 128 || !isCanonicalIsoDate(item.expiresAt)) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency entry is invalid");
    let payload;
    try {
      payload = JSON.parse(item.responseBody);
    } catch {
      fail21("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency response is invalid");
    }
    exactFields(payload, ["ok", "requestId", "result", "schemaVersion"], "Product Session Gateway idempotency response");
    if (canonicalJSON(payload) !== item.responseBody || payload.ok !== true || payload.requestId !== item.requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency response is not canonical");
    const result = item.path.endsWith("/challenge") ? parseProductSessionChallenge(payload.result) : parseProductSession(payload.result);
    const subject = result.sessionBinding ?? result.challenge;
    if (subject !== item.subject || result.expiresAt !== item.expiresAt) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency subject or expiry is inconsistent");
    return Object.freeze({ ...item });
  });
  if (new Set(entries.map((item) => item.requestId)).size !== entries.length || [...entries].sort((left, right) => left.requestId.localeCompare(right.requestId)).map((item) => item.requestId).join("\n") !== entries.map((item) => item.requestId).join("\n")) fail21("INVALID_GATEWAY_STORE", "Product Session Gateway idempotency request IDs must be unique and sorted");
  return entries;
}
function isCanonicalIsoDate(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function fail21(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/wallet-session-control.js
var WALLET_SESSION_CONTROL_PROOF_HEADER = "x-ynx-wallet-control-proof-v2";
var WALLET_SESSION_CONTROL_AUDIENCE = "https://wallet-auth.ynxweb4.com";
var WALLET_SESSION_CONTROL_PATHS = Object.freeze(["/v2/product-sessions/wallet/sessions", "/v2/product-sessions/wallet/sessions/revoke"]);
var WALLET_SESSION_CONTROL_INTENT_PATHS = Object.freeze(["/v2/product-sessions/wallet/sessions/revoke-all", "/v2/product-sessions/wallet/devices/revoke"]);
var WALLET_SESSION_CONTROL_REPLAY_PREFIX = "f9c24e16a803b572";
var CLOCK_ANCHOR_PREFIX = "e4ab6187c05d932f";
var CLOCK_ANCHOR_PATTERN = new RegExp(`^${CLOCK_ANCHOR_PREFIX}[0-9a-f]{12}0{36}$`);
var FIELDS3 = ["version", "chainId", "audience", "account", "accountPublicKey", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];
var INPUT_FIELDS4 = ["accountSecret", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt"];
function createWalletSessionControlProof(input) {
  exactFields(input, INPUT_FIELDS4, "Wallet session control proof input");
  const { accountSecret: accountSecret2, ...context } = input;
  const identity = walletIdentity(accountSecret2);
  const unsigned3 = parseUnsigned4({ version: "2", chainId: "ynx_6423-1", audience: WALLET_SESSION_CONTROL_AUDIENCE, ...identity, ...context });
  const signature = secp256k1.sign(sha256(utf8ToBytes(signBytes(unsigned3))), hexToBytes(accountSecret2), { prehash: false, format: "compact", lowS: true });
  return Object.freeze({ ...unsigned3, signature: bytesToHex(signature) });
}
function parseWalletSessionControlProof(input) {
  exactFields(input, [...FIELDS3, "signature"], "Wallet session control proof");
  const { signature, ...unsigned3 } = input;
  return Object.freeze({ ...parseUnsigned4(unsigned3), signature: pattern10(signature, "signature", /^[0-9a-f]{128}$/) });
}
function verifyWalletSessionControlProof(input, expected, at = /* @__PURE__ */ new Date()) {
  const proof = parseWalletSessionControlProof(input);
  exactFields(expected, ["method", "path", "bodyDigest"], "Wallet session control HTTP context");
  if (proof.method !== expected.method || proof.path !== expected.path || proof.bodyDigest !== expected.bodyDigest) fail22("HTTP_BINDING_MISMATCH", "Wallet session control proof does not match this request");
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail22("INVALID_TIME", "Wallet session control time is invalid");
  if (proof.issuedAt > at.toISOString()) fail22("ISSUED_IN_FUTURE", "Wallet session control proof was issued in the future");
  if (proof.expiresAt <= at.toISOString()) fail22("SESSION_EXPIRED", "Wallet session control proof has expired");
  const { signature, ...unsigned3 } = proof;
  let valid = false;
  try {
    valid = walletIdentityFromPublicKey(proof.accountPublicKey) === proof.account && secp256k1.verify(hexToBytes(signature), sha256(utf8ToBytes(signBytes(unsigned3))), hexToBytes(proof.accountPublicKey), { prehash: false, format: "compact", lowS: true });
  } catch {
    valid = false;
  }
  if (!valid) fail22("INVALID_SIGNATURE", "Wallet session control requires the owning account signature");
  return proof;
}
function walletSessionControlReplayKey(input) {
  const proof = parseWalletSessionControlProof(input);
  const expires = Date.parse(proof.expiresAt).toString(16).padStart(12, "0");
  return `${WALLET_SESSION_CONTROL_REPLAY_PREFIX}${expires}${digestHex("YNX_WALLET_SESSION_CONTROL_NONCE_V2", { account: proof.account, nonce: proof.nonce }).slice(0, 36)}`;
}
function walletSessionControlReplayExpiry(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value) || !value.startsWith(WALLET_SESSION_CONTROL_REPLAY_PREFIX)) return null;
  const expires = Number.parseInt(value.slice(16, 28), 16);
  return Number.isSafeInteger(expires) && expires >= 0 && Number.isFinite(new Date(expires).getTime()) ? expires : null;
}
function walletSessionControlClockAnchor(at) {
  const milliseconds = at.getTime();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 281474976710655) fail22("INVALID_TIME", "Wallet session control clock cannot be represented");
  return `${CLOCK_ANCHOR_PREFIX}${milliseconds.toString(16).padStart(12, "0")}${"0".repeat(36)}`;
}
function walletSessionControlClockAnchorTime(value) {
  if (typeof value !== "string" || !CLOCK_ANCHOR_PATTERN.test(value)) return null;
  return Number.parseInt(value.slice(16, 28), 16);
}
function walletSessionControlClockFloor(snapshot3) {
  return snapshot3.consumedProofs.reduce((latest, value) => Math.max(latest, walletSessionControlClockAnchorTime(value) ?? 0), snapshot3.audit.reduce((latest, event) => Math.max(latest, Date.parse(event.at)), 0));
}
function encodeWalletSessionControlProofHeader(input) {
  const proof = parseWalletSessionControlProof(input);
  return encodeBase64url(utf8ToBytes(canonicalJSON(proof)));
}
function decodeWalletSessionControlProofHeader(value) {
  if (typeof value !== "string" || value.length > 16384) fail22("INVALID_PROOF_HEADER", "Wallet session control header is invalid");
  let text8, input;
  try {
    text8 = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(value, "Wallet session control proof header"));
    input = JSON.parse(text8);
  } catch {
    fail22("INVALID_PROOF_HEADER", "Wallet session control header is invalid");
  }
  if (canonicalJSON(input) !== text8) fail22("INVALID_PROOF_HEADER", "Wallet session control header must use canonical JSON");
  return parseWalletSessionControlProof(input);
}
function parseUnsigned4(input) {
  exactFields(input, FIELDS3, "Unsigned Wallet session control proof");
  if (input.version !== "2" || input.chainId !== "ynx_6423-1" || input.audience !== WALLET_SESSION_CONTROL_AUDIENCE || input.method !== "POST" || ![...WALLET_SESSION_CONTROL_PATHS, ...WALLET_SESSION_CONTROL_INTENT_PATHS].includes(input.path)) fail22("INVALID_CONTROL_BINDING", "Wallet session control chain, audience or route is invalid");
  const proof = {
    version: "2",
    chainId: input.chainId,
    audience: input.audience,
    account: pattern10(input.account, "account", /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/),
    accountPublicKey: pattern10(input.accountPublicKey, "accountPublicKey", /^(02|03)[0-9a-f]{64}$/),
    method: "POST",
    path: input.path,
    bodyDigest: pattern10(input.bodyDigest, "bodyDigest", /^[0-9a-f]{64}$/),
    nonce: pattern10(input.nonce, "nonce", /^[A-Za-z0-9_-]{32,64}$/),
    issuedAt: time7(input.issuedAt),
    expiresAt: time7(input.expiresAt)
  };
  if (proof.expiresAt <= proof.issuedAt || Date.parse(proof.expiresAt) - Date.parse(proof.issuedAt) > 3e4) fail22("INVALID_EXPIRY", "Wallet session control proof lifetime must be at most thirty seconds");
  return Object.freeze(proof);
}
function signBytes(unsigned3) {
  return `YNX_WALLET_SESSION_CONTROL_PROOF_V2
${canonicalJSON(unsigned3)}`;
}
function time7(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) < 0 || new Date(value).toISOString() !== value) fail22("INVALID_TIME", "Wallet session control timestamp is invalid");
  return value;
}
function pattern10(value, label, regex) {
  if (typeof value !== "string" || !regex.test(value)) fail22("INVALID_FIELD", `Wallet session control ${label} is invalid`);
  return value;
}
function fail22(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-control-capacity.js
var PRODUCT_SESSION_CONTROL_MAX_INTENTS = 1e4;
var DEFAULT_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY = Object.freeze({ maxOwners: 256, intentsPerOwner: 32 });
function parseProductSessionControlCapacityPolicy(input = DEFAULT_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY) {
  exactFields(input, ["maxOwners", "intentsPerOwner"], "Control capacity policy");
  for (const field of ["maxOwners", "intentsPerOwner"]) if (!Number.isSafeInteger(input[field]) || input[field] < 1 || input[field] > PRODUCT_SESSION_CONTROL_MAX_INTENTS) fail23("INVALID_CONTROL_CAPACITY_POLICY", "Control owner and intent limits must be positive integers within the snapshot limit");
  if (input.maxOwners * input.intentsPerOwner > PRODUCT_SESSION_CONTROL_MAX_INTENTS) fail23("INVALID_CONTROL_CAPACITY_POLICY", "Every admitted owner must have a reserved intent allocation within the snapshot limit");
  return Object.freeze({ maxOwners: input.maxOwners, intentsPerOwner: input.intentsPerOwner });
}
function inspectProductSessionControlCapacity(snapshot3, policyInput) {
  const policy = parseProductSessionControlCapacityPolicy(policyInput);
  const counts = /* @__PURE__ */ new Map();
  for (const item of [...snapshot3.authority.sessions, ...snapshot3.authority.issuedChallenges, ...snapshot3.authority.revokedAccounts, ...snapshot3.authority.revokedDeviceScopes]) counts.set(item.account, 0);
  for (const { intent } of snapshot3.controlIntents) counts.set(intent.account, (counts.get(intent.account) ?? 0) + 1);
  const reservedIntents = [...counts.values()].reduce((total, count) => total + Math.max(policy.intentsPerOwner, count), 0);
  return { policy, counts, admittedOwners: counts.size, reservedIntents, overReserved: counts.size > policy.maxOwners || reservedIntents > PRODUCT_SESSION_CONTROL_MAX_INTENTS };
}
function assertProductSessionControlOwnerAdmission(snapshot3, account, policyInput) {
  const capacity = inspectProductSessionControlCapacity(snapshot3, policyInput);
  if (capacity.counts.has(account)) return capacity;
  if (capacity.admittedOwners >= capacity.policy.maxOwners || capacity.reservedIntents + capacity.policy.intentsPerOwner > PRODUCT_SESSION_CONTROL_MAX_INTENTS) fail23("CONTROL_OWNER_ADMISSION", "New owner admission is full; existing owner reservations and receipts are retained");
  return capacity;
}
function assertProductSessionControlOwnerIntentCapacity(snapshot3, account, policyInput) {
  const capacity = assertProductSessionControlOwnerAdmission(snapshot3, account, policyInput);
  if ((capacity.counts.get(account) ?? 0) >= capacity.policy.intentsPerOwner) fail23("CONTROL_OWNER_CAPACITY", "This owner has reached its permanent intent allocation; retry existing intents or use individual session revocation");
  if (capacity.reservedIntents > PRODUCT_SESSION_CONTROL_MAX_INTENTS) fail23("CONTROL_OWNER_ADMISSION", "Legacy owner reservations exceed this snapshot tier; existing receipts remain recoverable");
}
function fail23(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-control-intent.js
var PATHS = Object.freeze({
  "account-logout": "/v2/product-sessions/wallet/sessions/revoke-all",
  "device-logout": "/v2/product-sessions/wallet/devices/revoke"
});
var MAX_INTENTS = PRODUCT_SESSION_CONTROL_MAX_INTENTS;
var ACCOUNT = /^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$/;
var HASH = /^[0-9a-f]{64}$/;
var TOKEN2 = /^[A-Za-z0-9_-]{32,64}$/;
var GATEWAY_FIELDS = ["schemaVersion", "authority", "consumedProofs", "idempotency", "audit", "controlIntents"];
var AUTHORITY_FIELDS = ["schemaVersion", "sessions", "issuedChallenges", "consumedNonces", "consumedStates", "consumedRequests", "consumedChallenges", "revokedSessions", "revokedDevices", "revokedAccounts", "revokedDeviceScopes"];
var RECEIPT_FIELDS = ["version", "account", "intentId", "intentDigest", "operation", "target", "cutoff", "appliedAt", "revoked", "sessionBindings", "challengeIds", "revokedSessionCount", "cancelledChallengeCount"];
function parseProductSessionControlIntent(input) {
  exactFields(input, ["account", "operation", "body"], "Product Session control intent");
  const account = pattern11(input.account, ACCOUNT, "account");
  if (!Object.hasOwn(PATHS, input.operation)) fail24("INVALID_CONTROL_INTENT", "Control intent operation is invalid");
  const device2 = input.operation === "device-logout";
  exactFields(input.body, ["intentId", "intentIssuedAt", "intentExpiresAt", ...device2 ? ["deviceBinding"] : []], "Control intent body");
  const body = {
    intentId: pattern11(input.body.intentId, TOKEN2, "intentId"),
    intentIssuedAt: time8(input.body.intentIssuedAt),
    intentExpiresAt: time8(input.body.intentExpiresAt),
    ...device2 ? { deviceBinding: pattern11(input.body.deviceBinding, HASH, "deviceBinding") } : {}
  };
  const lifetime = Date.parse(body.intentExpiresAt) - Date.parse(body.intentIssuedAt);
  if (lifetime <= 0 || lifetime > 6e5) fail24("INVALID_CONTROL_INTENT", "Control intent lifetime must be positive and at most ten minutes");
  return freeze3({ account, operation: input.operation, body });
}
function productSessionControlIntentDigest(input) {
  const intent = parseProductSessionControlIntent(input);
  return digestHex("YNX_PRODUCT_SESSION_CONTROL_INTENT_V1", {
    chainId: "ynx_6423-1",
    audience: WALLET_SESSION_CONTROL_AUDIENCE,
    method: "POST",
    path: PATHS[intent.operation],
    ...intent
  });
}
function parseProductSessionControlSnapshot(input) {
  exactFields(input, GATEWAY_FIELDS, "Control intent candidate snapshot");
  exactFields(input.authority, AUTHORITY_FIELDS, "Control intent candidate authority");
  if (input.schemaVersion !== 3 || input.authority.schemaVersion !== 3) fail24("INVALID_CONTROL_STORE", "Control intent candidate requires explicit snapshot version three");
  const { controlIntents, ...gateway2 } = input;
  const { revokedDeviceScopes, ...authority } = gateway2.authority;
  const old = parseProductSessionGatewaySnapshot({ ...gateway2, schemaVersion: 2, authority: { ...authority, schemaVersion: 2 } });
  const scopes3 = orderedRecords(revokedDeviceScopes, (item) => {
    exactFields(item, ["account", "deviceBinding", "before"], "Revoked product device scope");
    return { account: pattern11(item.account, ACCOUNT, "account"), deviceBinding: pattern11(item.deviceBinding, HASH, "deviceBinding"), before: time8(item.before) };
  }, scopeKey, MAX_INTENTS);
  const records = orderedRecords(controlIntents, parseRecord, recordKey, MAX_INTENTS);
  const state2 = { ...old, schemaVersion: 3, authority: { ...old.authority, schemaVersion: 3, revokedDeviceScopes: scopes3 }, controlIntents: records };
  const sessions = new Map(state2.authority.sessions.map((session) => [session.sessionBinding, session]));
  const challenges = new Map(state2.authority.issuedChallenges.map((challenge) => [challenge.challenge, challenge]));
  for (const { intent, receipt } of records) {
    const cutoff = cutoffFor(state2, intent);
    if (cutoff === null || cutoff < receipt.cutoff) fail24("INVALID_CONTROL_STORE", "Control receipt has no durable cutoff");
    if (intent.operation === "device-logout" && !ownsDevice(state2, intent)) fail24("INVALID_CONTROL_STORE", "Control receipt device ownership cannot be established");
    for (const binding2 of receipt.sessionBindings) {
      const session = sessions.get(binding2);
      if (!session || !matchesScope(session, intent) || session.issuedAt > receipt.cutoff || session.expiresAt <= receipt.cutoff || !state2.authority.revokedSessions.includes(binding2)) fail24("INVALID_CONTROL_STORE", "Control receipt session scope or exact tombstone is missing");
    }
    for (const id3 of receipt.challengeIds) {
      const challenge = challenges.get(id3);
      if (!challenge || !matchesScope(challenge, intent) || challenge.issuedAt > receipt.cutoff || challenge.expiresAt <= receipt.cutoff) fail24("INVALID_CONTROL_STORE", "Control receipt challenge is outside the original scope or cutoff");
    }
  }
  for (const scope2 of scopes3) {
    const receipts = records.filter(({ intent }) => intent.operation === "device-logout" && intent.account === scope2.account && intent.body.deviceBinding === scope2.deviceBinding);
    if (!receipts.length || scope2.before !== receipts.reduce((latest, { receipt }) => maxTime(latest, receipt.cutoff), "")) fail24("INVALID_CONTROL_STORE", "Device cutoff requires its exact maximum committed receipt");
  }
  return freeze3(state2);
}
function projectProductSessionControlSnapshotV2(input) {
  const { controlIntents, ...state2 } = parseProductSessionControlSnapshot(input);
  const { revokedDeviceScopes, ...authority } = state2.authority;
  return parseProductSessionGatewaySnapshot({ ...state2, schemaVersion: 2, authority: { ...authority, schemaVersion: 2 } });
}
function prepareProductSessionControlIntent(input, intentInput, at, capacity = MAX_INTENTS, capacityPolicy) {
  const state2 = parseProductSessionControlSnapshot(input), intent = parseProductSessionControlIntent(intentInput);
  const instant5 = checkedInstant(state2, at);
  const previous = matchingRecord(state2, intent);
  if (previous) return plan(state2, state2, previous.receipt, false);
  if (intent.body.intentIssuedAt > instant5) fail24("ISSUED_IN_FUTURE", "Control intent was issued in the future");
  if (intent.body.intentExpiresAt <= instant5) fail24("INTENT_EXPIRED", "An uncommitted expired control intent cannot be applied");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_INTENTS) fail24("INVALID_CONTROL_CAPACITY", "Control intent capacity is invalid");
  if (state2.controlIntents.length >= capacity) fail24("CONTROL_INTENT_CAPACITY", "Control intent storage is full; no revocation was prepared");
  assertProductSessionControlOwnerIntentCapacity(state2, intent.account, capacityPolicy);
  if (intent.operation === "device-logout" && !ownsDevice(state2, intent)) fail24("DEVICE_NOT_FOUND", "Owned product device scope was not found");
  const sessionBindings = state2.authority.sessions.filter((session) => matchesScope(session, intent) && session.issuedAt <= instant5 && session.expiresAt > instant5 && !recordRevoked(state2, session)).map((session) => session.sessionBinding).sort();
  const challengeIds = state2.authority.issuedChallenges.filter((challenge) => matchesScope(challenge, intent) && challenge.issuedAt <= instant5 && challenge.expiresAt > instant5 && !recordRevoked(state2, challenge)).map((challenge) => challenge.challenge).sort();
  const receipt = {
    version: 1,
    account: intent.account,
    intentId: intent.body.intentId,
    intentDigest: productSessionControlIntentDigest(intent),
    operation: intent.operation,
    target: target(intent),
    cutoff: instant5,
    appliedAt: instant5,
    revoked: true,
    sessionBindings,
    challengeIds,
    revokedSessionCount: sessionBindings.length,
    cancelledChallengeCount: challengeIds.length
  };
  const next = clone3(state2);
  next.authority.revokedSessions = [.../* @__PURE__ */ new Set([...next.authority.revokedSessions, ...sessionBindings])].sort();
  if (intent.operation === "account-logout") {
    const previousCutoff = next.authority.revokedAccounts.find((item) => item.account === intent.account);
    next.authority.revokedAccounts = next.authority.revokedAccounts.filter((item) => item.account !== intent.account);
    next.authority.revokedAccounts.push({ account: intent.account, before: maxTime(previousCutoff?.before ?? "", instant5) });
    next.authority.revokedAccounts.sort((a, b) => compare(a.account, b.account));
  } else {
    const key = `${intent.account}:${intent.body.deviceBinding}`;
    const previousCutoff = next.authority.revokedDeviceScopes.find((item) => scopeKey(item) === key);
    next.authority.revokedDeviceScopes = next.authority.revokedDeviceScopes.filter((item) => scopeKey(item) !== key);
    next.authority.revokedDeviceScopes.push({ account: intent.account, deviceBinding: intent.body.deviceBinding, before: maxTime(previousCutoff?.before ?? "", instant5) });
    next.authority.revokedDeviceScopes.sort((a, b) => compare(scopeKey(a), scopeKey(b)));
  }
  next.controlIntents.push({ intent, receipt });
  next.controlIntents.sort((a, b) => compare(recordKey(a), recordKey(b)));
  return plan(state2, parseProductSessionControlSnapshot(next), receipt, true);
}
function assertProductSessionControlPlanBase(prepared, latestInput, capacityPolicy) {
  exactFields(prepared, ["status", "revocationConfirmed", "baseStateDigest", "candidateStateDigest", "mutationRequired", "preparedReceipt", "candidate"], "Prepared control plan");
  if (prepared.status !== "prepared" || prepared.revocationConfirmed !== false || typeof prepared.mutationRequired !== "boolean") fail24("INVALID_CONTROL_PLAN", "Prepared control plan cannot assert confirmation");
  const latest = parseProductSessionControlSnapshot(latestInput), candidate2 = parseProductSessionControlSnapshot(prepared.candidate);
  if (snapshotDigest(latest) !== prepared.baseStateDigest) fail24("STALE_CONTROL_STATE", "Control plan must be prepared again from the latest durable state");
  const record2 = candidate2.controlIntents.find((item) => canonicalJSON(item.receipt) === canonicalJSON(prepared.preparedReceipt));
  if (snapshotDigest(candidate2) !== prepared.candidateStateDigest || !record2) fail24("INVALID_CONTROL_PLAN", "Control plan receipt and candidate are inconsistent");
  const expected = prepareProductSessionControlIntent(latest, record2.intent, new Date(Math.max(productSessionControlClockFloor(latest), Date.parse(record2.receipt.appliedAt))), MAX_INTENTS, capacityPolicy);
  if (expected.candidateStateDigest !== prepared.candidateStateDigest || expected.mutationRequired !== prepared.mutationRequired) fail24("INVALID_CONTROL_PLAN", "Control plan changes state outside its fixed intent transition");
  return candidate2;
}
function assertProductSessionControlApprovalAllowed(input, registry, request, approval, at) {
  const state2 = parseProductSessionControlSnapshot(input);
  checkedInstant(state2, at);
  const verified = parseProductSessionApproval(registry, request, approval, at);
  if (recordRevoked(state2, verified)) fail24("SESSION_REVOKED", "Wallet approval predates the account or product device logout");
  return verified;
}
function assertProductSessionControlSessionAllowed(input, sessionBinding, at) {
  const state2 = parseProductSessionControlSnapshot(input), instant5 = checkedInstant(state2, at);
  const session = state2.authority.sessions.find((item) => item.sessionBinding === pattern11(sessionBinding, HASH, "sessionBinding"));
  if (!session) fail24("SESSION_NOT_FOUND", "Product Session was not found");
  if (session.expiresAt <= instant5) fail24("SESSION_EXPIRED", "Product Session has expired");
  if (recordRevoked(state2, session)) fail24("SESSION_REVOKED", "Product Session was revoked");
  return session;
}
function parseRecord(input) {
  exactFields(input, ["intent", "receipt"], "Committed control intent");
  const intent = parseProductSessionControlIntent(input.intent), receipt = input.receipt;
  exactFields(receipt, RECEIPT_FIELDS, "Control intent receipt");
  const cutoff = time8(receipt.cutoff), appliedAt = time8(receipt.appliedAt);
  if (receipt.version !== 1 || receipt.revoked !== true || receipt.account !== intent.account || receipt.intentId !== intent.body.intentId || receipt.intentDigest !== productSessionControlIntentDigest(intent) || receipt.operation !== intent.operation || canonicalJSON(receipt.target) !== canonicalJSON(target(intent)) || cutoff !== appliedAt || cutoff < intent.body.intentIssuedAt || cutoff >= intent.body.intentExpiresAt) fail24("INVALID_CONTROL_STORE", "Control receipt is not bound to its original intent and execution time");
  const sessionBindings = stringSet3(receipt.sessionBindings, HASH), challengeIds = stringSet3(receipt.challengeIds, TOKEN2);
  if (receipt.revokedSessionCount !== sessionBindings.length || receipt.cancelledChallengeCount !== challengeIds.length) fail24("INVALID_CONTROL_STORE", "Control receipt counts do not match the frozen target lists");
  return { intent, receipt: { ...receipt, target: target(intent), sessionBindings, challengeIds } };
}
function matchingRecord(state2, intent) {
  const record2 = state2.controlIntents.find((item) => recordKey(item) === recordKey({ intent }));
  if (record2 && productSessionControlIntentDigest(intent) !== record2.receipt.intentDigest) fail24("IDEMPOTENCY_CONFLICT", "The original account intent ID is already bound to a different operation or body");
  return record2;
}
function target(intent) {
  return { account: intent.account, ...intent.operation === "device-logout" ? { deviceBinding: intent.body.deviceBinding } : {} };
}
function recordKey({ intent }) {
  return `${intent.account}:${intent.body.intentId}`;
}
function scopeKey(item) {
  return `${item.account}:${item.deviceBinding}`;
}
function binding(record2) {
  return deviceBinding(record2, record2.account);
}
function matchesScope(record2, intent) {
  return record2.account === intent.account && (intent.operation === "account-logout" || binding(record2) === intent.body.deviceBinding);
}
function ownsDevice(state2, intent) {
  return [...state2.authority.sessions, ...state2.authority.issuedChallenges].some((record2) => matchesScope(record2, intent));
}
function cutoffFor(state2, intent) {
  return intent.operation === "account-logout" ? state2.authority.revokedAccounts.find((item) => item.account === intent.account)?.before ?? null : state2.authority.revokedDeviceScopes.find((item) => item.account === intent.account && item.deviceBinding === intent.body.deviceBinding)?.before ?? null;
}
function recordRevoked(state2, record2) {
  const authority = state2.authority, device2 = binding(record2);
  return Boolean(record2.sessionBinding && authority.revokedSessions.includes(record2.sessionBinding)) || authority.revokedDevices.includes(device2) || authority.revokedAccounts.some((item) => item.account === record2.account && record2.issuedAt <= item.before) || authority.revokedDeviceScopes.some((item) => item.account === record2.account && item.deviceBinding === device2 && record2.issuedAt <= item.before);
}
function checkedInstant(state2, at) {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) fail24("INVALID_TIME", "Control operation requires a valid authority instant");
  const instant5 = time8(at.toISOString());
  if (at.getTime() < productSessionControlClockFloor(state2)) fail24("CLOCK_UNAVAILABLE", "Control operation authority clock is behind committed state");
  return instant5;
}
function productSessionControlClockFloor(state2) {
  const timestamps = [...state2.authority.revokedAccounts.map((item) => item.before), ...state2.authority.revokedDeviceScopes.map((item) => item.before), ...state2.controlIntents.map((item) => item.receipt.appliedAt), ...state2.authority.sessions.map((item) => item.issuedAt), ...state2.authority.issuedChallenges.map((item) => item.issuedAt)];
  return timestamps.reduce((floor, timestamp6) => Math.max(floor, Date.parse(timestamp6)), walletSessionControlClockFloor(state2));
}
function snapshotDigest(state2) {
  return digestHex("YNX_PRODUCT_SESSION_CONTROL_STATE_V3", state2);
}
function plan(base, candidate2, receipt, mutationRequired) {
  return freeze3({ status: "prepared", revocationConfirmed: false, baseStateDigest: snapshotDigest(base), candidateStateDigest: snapshotDigest(candidate2), mutationRequired, preparedReceipt: receipt, candidate: candidate2 });
}
function stringSet3(input, expression) {
  if (!Array.isArray(input) || input.length > 2e4 || input.some((value) => typeof value !== "string" || !expression.test(value)) || input.some((value, index) => index && input[index - 1] >= value)) fail24("INVALID_CONTROL_STORE", "Control receipt targets must be valid, unique and sorted");
  return [...input];
}
function orderedRecords(input, parse, key, limit) {
  if (!Array.isArray(input) || input.length > limit) fail24("INVALID_CONTROL_STORE", "Control state collection is invalid or exceeds capacity");
  const values = input.map(parse);
  if (values.some((value, index) => index && key(values[index - 1]) >= key(value))) fail24("INVALID_CONTROL_STORE", "Control state records must be unique and sorted");
  return values;
}
function time8(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) < 0 || new Date(value).toISOString() !== value) fail24("INVALID_TIME", "Control timestamp is invalid");
  return value;
}
function pattern11(value, expression, label) {
  if (typeof value !== "string" || !expression.test(value)) fail24("INVALID_CONTROL_INTENT", `Control intent ${label} is invalid`);
  return value;
}
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function maxTime(a, b) {
  return a > b ? a : b;
}
function clone3(value) {
  return JSON.parse(canonicalJSON(value));
}
function freeze3(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze3(child);
    Object.freeze(value);
  }
  return value;
}
function fail24(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-gateway.js
var INPUT_FIELDS5 = ["requestId", "method", "path", "body", "proof", "networkAvailable"];
var IDEMPOTENT_PATHS2 = /* @__PURE__ */ new Set(["/v2/product-sessions/challenge", "/v2/product-sessions/complete"]);
var ProductSessionGatewayKernel = class {
  #registry;
  #authority;
  #tokens;
  #proofs;
  #idempotency;
  #audit;
  #controlIntents;
  #deviceScopes;
  #capacityPolicy;
  constructor(registryInput, tokenFactory2, snapshot3, capacityPolicy) {
    this.#capacityPolicy = parseProductSessionControlCapacityPolicy(capacityPolicy);
    this.#registry = parseProductSessionRegistry(registryInput);
    if (typeof tokenFactory2 !== "function") fail25("INVALID_RANDOM_SOURCE", "Product Session Gateway requires a cryptographic challenge source");
    this.#tokens = () => {
      const value = tokenFactory2();
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(value)) fail25("INVALID_RANDOM_SOURCE", "Gateway challenge source returned an invalid token");
      return value;
    };
    const parsed = snapshot3 === void 0 ? Object.freeze({ schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority: new ProductSessionAuthority(this.#registry).snapshot(), consumedProofs: Object.freeze([]), idempotency: Object.freeze([]), audit: Object.freeze([]) }) : snapshot3.schemaVersion === 3 ? parseProductSessionControlSnapshot(snapshot3) : parseProductSessionGatewaySnapshot(snapshot3);
    this.#controlIntents = parsed.schemaVersion === 3 ? [...parsed.controlIntents] : null;
    this.#deviceScopes = parsed.schemaVersion === 3 ? [...parsed.authority.revokedDeviceScopes] : [];
    const legacy = parsed.schemaVersion === 3 ? projectProductSessionControlSnapshotV2(parsed) : parsed;
    this.#authority = new ProductSessionAuthority(this.#registry, legacy.authority);
    this.#proofs = [...parsed.consumedProofs];
    this.#idempotency = [...parsed.idempotency];
    this.#audit = [...parsed.audit];
  }
  dispatch(input, at = /* @__PURE__ */ new Date()) {
    const instant5 = validDate13(at);
    const lastSeen = this.#controlIntents === null ? walletSessionControlClockFloor({ consumedProofs: this.#proofs, audit: this.#audit }) : productSessionControlClockFloor(this.snapshot());
    const clockRegressed = instant5.getTime() < lastSeen, auditTime = new Date(Math.max(instant5.getTime(), lastSeen));
    const requiresAnchor = this.#proofs.some((value) => walletSessionControlReplayExpiry(value) !== null || walletSessionControlClockAnchorTime(value) !== null);
    const withoutAnchors = this.#proofs.filter((value) => walletSessionControlClockAnchorTime(value) === null);
    const anchorAtCapacity = requiresAnchor && withoutAnchors.length >= 2e4;
    if (requiresAnchor && !anchorAtCapacity) this.#proofs = [...withoutAnchors, walletSessionControlClockAnchor(auditTime)].sort();
    if (!clockRegressed && !anchorAtCapacity) {
      const sessions = new Map(this.#authority.snapshot().sessions.map((session) => [session.sessionBinding, session]));
      this.#idempotency = this.#idempotency.filter((item) => {
        if (item.expiresAt > instant5.toISOString()) return true;
        if (item.path !== "/v2/product-sessions/challenge") return false;
        const challenge = JSON.parse(item.responseBody).result;
        const session = sessions.get(digestHex("YNX_PRODUCT_SESSION_BINDING_V2", challenge));
        return session !== void 0 && session.expiresAt > instant5.toISOString();
      });
      this.#proofs = this.#proofs.filter((value) => {
        const expires = walletSessionControlReplayExpiry(value);
        return expires === null || expires > instant5.getTime();
      });
    }
    let requestId = "req_invalid_request_000";
    const beforeAuthority = this.#authority.snapshot();
    const beforeIntents = this.#controlIntents, beforeScopes = this.#deviceScopes;
    const beforeProofs = [...this.#proofs];
    const beforeIdempotency = [...this.#idempotency];
    try {
      const request = parseInput(input);
      requestId = request.requestId;
      if (anchorAtCapacity) fail25("CAPACITY", "Wallet session control cannot preserve its durable clock at the current replay capacity");
      if (clockRegressed) fail25("CLOCK_UNAVAILABLE", "Product Session authority clock moved behind its durable history");
      if (!request.networkAvailable) fail25("NETWORK_UNAVAILABLE", "Product Session Gateway network dependency is unavailable");
      const walletControl = WALLET_SESSION_CONTROL_PATHS.includes(request.path) || WALLET_SESSION_CONTROL_INTENT_PATHS.includes(request.path);
      if (walletControl ? request.proof !== null : request.walletControlProof != null) fail25("UNEXPECTED_PROOF", "Wallet owner and product device proofs cannot be interchanged");
      if (IDEMPOTENT_PATHS2.has(request.path) && request.proof !== null) fail25("UNEXPECTED_PROOF", "Challenge and completion do not accept a Product Session proof");
      const bodyDigest = httpBodyDigest(canonicalJSON(request.body));
      const cached = this.#idempotency.find((item) => item.requestId === request.requestId);
      if (cached) {
        if (cached.path !== request.path || cached.bodyDigest !== bodyDigest) fail25("IDEMPOTENCY_CONFLICT", "Product Session request ID was reused with a different route or body");
        this.#assertCachedResponseUsable(cached, request, instant5);
        this.#record(requestId, request.path, "idempotent", null, cached.subject, instant5);
        return cachedResponse(cached.responseBody, requestId);
      }
      const result = this.#route(request, instant5);
      const completed = response2(200, requestId, { ok: true, result });
      if (IDEMPOTENT_PATHS2.has(request.path)) {
        if (this.#idempotency.length >= 2e4) fail25("CAPACITY", "Product Session idempotency store is at capacity");
        const subject = result?.sessionBinding ?? result?.challenge ?? "none";
        this.#idempotency.push(Object.freeze({ requestId, path: request.path, bodyDigest, responseBody: completed.body, subject, expiresAt: result.expiresAt }));
        this.#idempotency.sort((left, right) => left.requestId.localeCompare(right.requestId));
      }
      this.#record(requestId, request.path, "ok", null, result?.preparedReceipt?.intentDigest ?? result?.sessionBinding ?? result?.session?.sessionBinding ?? result?.revoked ?? result?.challenge ?? "none", instant5);
      return completed;
    } catch (error) {
      this.#authority = new ProductSessionAuthority(this.#registry, beforeAuthority);
      this.#controlIntents = beforeIntents;
      this.#deviceScopes = beforeScopes;
      this.#proofs = beforeProofs;
      this.#idempotency = beforeIdempotency;
      const publicError2 = normalizeError(error);
      this.#record(requestId, auditPath(input?.path), "rejected", publicError2.code, "none", auditTime);
      return response2(publicError2.status, requestId, { ok: false, error: { code: publicError2.code, message: publicError2.message } });
    }
  }
  snapshot() {
    const base = { schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION, authority: this.#authority.snapshot(), consumedProofs: Object.freeze([...this.#proofs]), idempotency: Object.freeze([...this.#idempotency]), audit: Object.freeze([...this.#audit]) };
    return this.#controlIntents === null ? Object.freeze(base) : Object.freeze({ ...base, schemaVersion: 3, authority: Object.freeze({ ...base.authority, schemaVersion: 3, revokedDeviceScopes: Object.freeze([...this.#deviceScopes]) }), controlIntents: Object.freeze([...this.#controlIntents]) });
  }
  #assertCachedResponseUsable(cached, request, at) {
    const approval = this.#controlIntents === null ? parseProductSessionApproval(this.#registry, request.body.request, request.body.approval, at) : assertProductSessionControlApprovalAllowed(this.snapshot(), this.#registry, request.body.request, request.body.approval, at);
    const snapshot3 = this.#authority.snapshot();
    if (snapshot3.revokedDevices.includes(deviceBinding(approval, approval.account)) || snapshot3.revokedAccounts.some((item) => item.account === approval.account && approval.issuedAt <= item.before)) fail25("SESSION_REVOKED", "Wallet approval or its product device binding was revoked");
    const result = JSON.parse(cached.responseBody).result;
    let session;
    if (cached.path === "/v2/product-sessions/complete") {
      session = parseProductSession(result);
    } else {
      const challenge = parseProductSessionChallenge(result);
      const issued = snapshot3.issuedChallenges.find((item) => item.challenge === challenge.challenge);
      if (issued && canonicalJSON(issued) === canonicalJSON(challenge)) return;
      session = snapshot3.sessions.find((item) => item.sessionBinding === digestHex("YNX_PRODUCT_SESSION_BINDING_V2", challenge));
      if (!session) fail25("CHALLENGE_NOT_ISSUED", "Cached Product Session challenge is no longer available");
    }
    if (this.#controlIntents !== null) assertProductSessionControlSessionAllowed(this.snapshot(), session.sessionBinding, at);
    this.#authority.introspect(session.sessionBinding, {
      chainId: session.chainId,
      productId: session.productId,
      clientId: session.clientId,
      platform: session.platform,
      applicationId: session.applicationId,
      bundleId: session.bundleId,
      packageId: session.packageId,
      origin: session.origin,
      callback: session.callback,
      account: session.account,
      deviceId: session.deviceId,
      deviceKey: session.deviceKey,
      requiredScopes: []
    }, at);
  }
  #route(request, at) {
    if (WALLET_SESSION_CONTROL_INTENT_PATHS.includes(request.path)) return this.#walletIntent(request, at);
    if (WALLET_SESSION_CONTROL_PATHS.includes(request.path)) return this.#walletControl(request, at);
    if (request.path === "/v2/product-sessions/challenge") {
      if (request.proof !== null) fail25("UNEXPECTED_PROOF", "Challenge issuance does not accept a Product Session proof");
      exactFields(request.body, ["request", "approval"], "Product Session Gateway challenge body");
      if (this.#controlIntents !== null) {
        const snapshot3 = this.snapshot();
        const approval = assertProductSessionControlApprovalAllowed(snapshot3, this.#registry, request.body.request, request.body.approval, at);
        assertProductSessionControlOwnerAdmission(snapshot3, approval.account, this.#capacityPolicy);
      }
      return this.#authority.issueChallenge({ request: request.body.request, approval: request.body.approval, challenge: this.#tokens() }, at);
    }
    if (request.path === "/v2/product-sessions/complete") {
      if (request.proof !== null) fail25("UNEXPECTED_PROOF", "Session completion does not accept an existing Product Session proof");
      exactFields(request.body, ["request", "approval", "completion"], "Product Session Gateway completion body");
      if (this.#controlIntents !== null) assertProductSessionControlApprovalAllowed(this.snapshot(), this.#registry, request.body.request, request.body.approval, at);
      return this.#authority.complete(request.body, at);
    }
    if (request.path === "/v2/product-sessions/introspect") {
      exactFields(request.body, ["requiredScopes"], "Product Session introspection body");
      return this.#authorize(request, request.body.requiredScopes, at);
    }
    if (request.path === "/v2/product-sessions/revoke") {
      exactFields(request.body, [], "Product Session revoke body");
      const authorized = this.#authorize(request, [], at);
      this.#authority.revokeSession(authorized.session.sessionBinding);
      return Object.freeze({ revoked: authorized.session.sessionBinding });
    }
    if (request.path === "/v2/product-sessions/devices/revoke") {
      exactFields(request.body, [], "Product Session device revoke body");
      const authorized = this.#authorize(request, [], at);
      this.#authority.revokeDevice(authorized.session.deviceBinding);
      return Object.freeze({ revoked: authorized.session.deviceBinding });
    }
    fail25("ROUTE_NOT_FOUND", "Product Session Gateway route is not registered");
  }
  #verifyOwner(request, at) {
    if (request.walletControlProof == null) fail25("PROOF_REQUIRED", "Wallet account owner proof is required");
    const proof = verifyWalletSessionControlProof(request.walletControlProof, { method: request.method, path: request.path, bodyDigest: httpBodyDigest(canonicalJSON(request.body)) }, at);
    const replayKey = walletSessionControlReplayKey(proof);
    const controlRecords = this.#proofs.filter((value) => walletSessionControlReplayExpiry(value) !== null);
    if (controlRecords.some((value) => value.slice(28) === replayKey.slice(28))) fail25("REPLAY", "Wallet session control nonce was already consumed");
    const needsAnchor = !this.#proofs.some((value) => walletSessionControlClockAnchorTime(value) !== null);
    if (controlRecords.length >= 512 || this.#proofs.length + Number(needsAnchor) >= 18e3) fail25("CAPACITY", "Wallet session control replay budget is unavailable");
    return { proof, replayKey, needsAnchor };
  }
  #walletIntent(request, at) {
    if (this.#controlIntents === null) fail25("CONTROL_STORE_REQUIRED", "Wallet batch logout requires an explicitly migrated version-three store");
    const { proof, replayKey, needsAnchor } = this.#verifyOwner(request, at);
    const intent = parseProductSessionControlIntent({ account: proof.account, operation: request.path.endsWith("/revoke-all") ? "account-logout" : "device-logout", body: request.body });
    const before = this.snapshot(), prepared = prepareProductSessionControlIntent(before, intent, at, void 0, this.#capacityPolicy);
    const candidate2 = assertProductSessionControlPlanBase(prepared, before, this.#capacityPolicy);
    this.#authority = new ProductSessionAuthority(this.#registry, projectProductSessionControlSnapshotV2(candidate2).authority);
    this.#deviceScopes = [...candidate2.authority.revokedDeviceScopes];
    this.#controlIntents = [...candidate2.controlIntents];
    if (needsAnchor) this.#proofs.push(walletSessionControlClockAnchor(at));
    this.#proofs.push(replayKey);
    this.#proofs.sort();
    return Object.freeze({ status: "prepared", revocationConfirmed: false, preparedReceipt: prepared.preparedReceipt });
  }
  #walletControl(request, at) {
    const revoke = request.path.endsWith("/revoke");
    exactFields(request.body, revoke ? ["sessionBinding"] : [], "Wallet session control body");
    if (revoke && (typeof request.body.sessionBinding !== "string" || !/^[0-9a-f]{64}$/.test(request.body.sessionBinding))) fail25("INVALID_FIELD", "Wallet session control target binding is invalid");
    const { proof, replayKey, needsAnchor } = this.#verifyOwner(request, at);
    const snapshot3 = this.#authority.snapshot(), asOf = at.toISOString();
    let result;
    if (revoke) {
      const session = snapshot3.sessions.find((item) => item.sessionBinding === request.body.sessionBinding && item.account === proof.account);
      if (!session) fail25("SESSION_NOT_FOUND", "Wallet-owned Product Session was not found");
      const alreadyRevoked = snapshot3.revokedSessions.includes(session.sessionBinding);
      if (!alreadyRevoked) this.#authority.revokeSession(session.sessionBinding);
      result = Object.freeze({ account: proof.account, sessionBinding: session.sessionBinding, revoked: true, alreadyRevoked, asOf });
    } else {
      const sessions = snapshot3.sessions.filter((session) => session.account === proof.account).map((session) => {
        const registration = this.#registry.products.find((product) => product.productId === session.productId && product.clientId === session.clientId);
        if (!registration) fail25("UNKNOWN_PRODUCT", "Stored Product Session registration is unavailable");
        const inactiveReasons = [];
        if (snapshot3.revokedSessions.includes(session.sessionBinding)) inactiveReasons.push("session-revoked");
        if (snapshot3.revokedDevices.includes(session.deviceBinding)) inactiveReasons.push("device-revoked");
        if (this.#deviceScopes.some((item) => item.account === session.account && item.deviceBinding === session.deviceBinding && session.issuedAt <= item.before)) inactiveReasons.push("device-logout");
        if (snapshot3.revokedAccounts.some((item) => item.account === proof.account && session.issuedAt <= item.before)) inactiveReasons.push("account-revoked");
        if (session.expiresAt <= asOf) inactiveReasons.push("expired");
        if (session.issuedAt > asOf) inactiveReasons.push("issued-in-future");
        return Object.freeze({ sessionBinding: session.sessionBinding, productId: session.productId, clientId: session.clientId, displayName: registration.displayName, platform: session.platform, applicationId: session.applicationId, origin: session.origin, callback: session.callback, deviceId: session.deviceId, deviceBinding: session.deviceBinding, scopes: session.scopes, issuedAt: session.issuedAt, expiresAt: session.expiresAt, active: inactiveReasons.length === 0, inactiveReasons: Object.freeze(inactiveReasons) });
      });
      result = Object.freeze({ account: proof.account, asOf, sessions: Object.freeze(sessions) });
    }
    if (needsAnchor) this.#proofs.push(walletSessionControlClockAnchor(at));
    this.#proofs.push(replayKey);
    this.#proofs.sort();
    return result;
  }
  #authorize(request, requiredScopes2, at) {
    if (request.proof === null) fail25("PROOF_REQUIRED", "A sender-constrained Product Session proof is required");
    const session = this.#authority.snapshot().sessions.find((item) => item.sessionBinding === request.proof?.sessionBinding);
    if (!session) fail25("SESSION_NOT_FOUND", "Product Session was not found");
    const proof = verifyProductSessionProofV2(request.proof, session, { method: request.method, path: request.path, bodyDigest: httpBodyDigest(canonicalJSON(request.body)) }, at);
    const proofDigest = productSessionProofV2Digest(proof);
    if (this.#proofs.includes(proofDigest)) fail25("REPLAY", "Product Session proof was already consumed");
    if (this.#proofs.length >= 2e4) fail25("CAPACITY", "Product Session proof replay store is at capacity");
    if (this.#controlIntents !== null) assertProductSessionControlSessionAllowed(this.snapshot(), session.sessionBinding, at);
    const result = this.#authority.introspect(session.sessionBinding, { chainId: session.chainId, productId: session.productId, clientId: session.clientId, platform: session.platform, applicationId: session.applicationId, bundleId: session.bundleId, packageId: session.packageId, origin: session.origin, callback: session.callback, account: session.account, deviceId: session.deviceId, deviceKey: session.deviceKey, requiredScopes: requiredScopes2 }, at);
    this.#proofs.push(proofDigest);
    this.#proofs.sort();
    return result;
  }
  #record(requestId, path3, outcome, code, subject, at) {
    if (this.#audit.length >= 2e4) {
      this.#audit.shift();
      this.#audit = this.#audit.map((event, index) => Object.freeze({ ...event, sequence: index + 1 }));
    }
    this.#audit.push(Object.freeze({ sequence: this.#audit.length + 1, requestId, path: path3, outcome, code, subject, at: validDate13(at).toISOString() }));
  }
};
function parseInput(input) {
  exactFields(input, input && Object.hasOwn(input, "walletControlProof") ? [...INPUT_FIELDS5, "walletControlProof"] : INPUT_FIELDS5, "Product Session Gateway input");
  if (typeof input.requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(input.requestId)) fail25("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid");
  if (input.method !== "POST") fail25("METHOD_NOT_ALLOWED", "Product Session Gateway accepts POST only");
  if (typeof input.path !== "string" || !/^\/[A-Za-z0-9/_-]{1,255}$/.test(input.path) || input.path.includes("//") || input.path.endsWith("/")) fail25("INVALID_PATH", "Product Session Gateway path is invalid");
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body)) fail25("INVALID_BODY", "Product Session Gateway body must be an object");
  if (input.proof !== null && (!input.proof || typeof input.proof !== "object" || Array.isArray(input.proof))) fail25("INVALID_PROOF", "Product Session Gateway proof is invalid");
  if (input.walletControlProof != null && (typeof input.walletControlProof !== "object" || Array.isArray(input.walletControlProof))) fail25("INVALID_PROOF", "Wallet account owner proof is invalid");
  if (typeof input.networkAvailable !== "boolean") fail25("INVALID_NETWORK_STATE", "Product Session Gateway network state is invalid");
  return Object.freeze(input);
}
function response2(status, requestId, payload) {
  return Object.freeze({ status, headers: Object.freeze({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId }), body: canonicalJSON({ ...payload, requestId, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION }) });
}
function normalizeError(error) {
  if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Product Session Gateway failed closed" };
  const forbidden = ["CROSS_PRODUCT_SESSION", "INVALID_DEVICE_PROOF", "INVALID_SIGNATURE", "SESSION_REVOKED", "SESSION_EXPIRED", "SCOPE_WIDENING", "PROOF_REQUIRED"];
  const conflict = ["REPLAY", "ALREADY_REVOKED", "IDEMPOTENCY_CONFLICT", "INTENT_EXPIRED", "STALE_CONTROL_STATE"];
  const status = ["NETWORK_UNAVAILABLE", "CLOCK_UNAVAILABLE"].includes(error.code) ? 503 : error.code === "METHOD_NOT_ALLOWED" ? 405 : error.code === "ROUTE_NOT_FOUND" || (error.code === "SESSION_NOT_FOUND" || error.code === "DEVICE_NOT_FOUND") ? 404 : conflict.includes(error.code) ? 409 : forbidden.includes(error.code) ? 403 : 400;
  return { status, code: error.code, message: error.message.length <= 300 ? error.message : "Product Session Gateway rejected the request" };
}
function auditPath(value) {
  return typeof value === "string" && /^\/[A-Za-z0-9/_-]{1,255}$/.test(value) && !value.includes("//") && !value.endsWith("/") ? value : "/invalid";
}
function cachedResponse(body, requestId) {
  return Object.freeze({ status: 200, headers: Object.freeze({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId }), body });
}
function validDate13(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail25("INVALID_TIME", "Product Session Gateway time is invalid");
  return value;
}
function fail25(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-gateway-client.js
var PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2 = "x-ynx-product-session-proof-v2";
var MAX_RESPONSE_BYTES = 1048576;
var gatewayAuthorities = /* @__PURE__ */ new WeakMap();
function productSessionGatewayAuthority(adapter) {
  if (!gatewayAuthorities.has(adapter)) fail26("INVALID_GATEWAY", "Browser storage requires an authority-bound Product Session Gateway fetch adapter");
  return gatewayAuthorities.get(adapter);
}
var ProductSessionGatewayFetchAdapter = class {
  #endpoint;
  #fetch;
  #walletInstalled;
  #schemeRegistered;
  #timeoutMs;
  constructor(config) {
    exactFields(config, ["endpoint", "fetch", "walletInstalled", "schemeRegistered", "timeoutMs"], "Product Session Gateway fetch adapter configuration");
    this.#endpoint = endpoint(config.endpoint);
    if (typeof config.fetch !== "function" || typeof config.walletInstalled !== "function" || typeof config.schemeRegistered !== "function") fail26("INVALID_GATEWAY", "Product Session Gateway fetch adapter dependencies are invalid");
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1e3 || config.timeoutMs > 3e4) fail26("INVALID_GATEWAY", "Product Session Gateway timeout must be between one and thirty seconds");
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
    exactFields(input, ["requestId"], "Product Session Gateway time request");
    try {
      const result = await this.#request(input.requestId, "/v2/product-sessions/time", null, null, "GET");
      exactFields(result, ["serverTime"], "Product Session Gateway time response");
      const now = new Date(result.serverTime);
      if (typeof result.serverTime !== "string" || !Number.isFinite(now.getTime()) || now.toISOString() !== result.serverTime) fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway time is invalid");
      return now;
    } catch (error) {
      if (error instanceof WalletAuthError && error.code === "NETWORK_UNAVAILABLE") throw error;
      fail26("CLOCK_UNAVAILABLE", "Product Session authority time could not be verified; Retry when Auth is available");
    }
  }
  async challenge(input) {
    exactFields(input, ["requestId", "request", "approval"], "Product Session Gateway challenge request");
    return this.#request(input.requestId, "/v2/product-sessions/challenge", { request: input.request, approval: input.approval }, null);
  }
  async complete(input) {
    exactFields(input, ["requestId", "request", "approval", "completion"], "Product Session Gateway completion request");
    return this.#request(input.requestId, "/v2/product-sessions/complete", { request: input.request, approval: input.approval, completion: input.completion }, null);
  }
  async introspect(input) {
    exactFields(input, ["requestId", "sessionBinding", "requiredScopes", "proof"], "Product Session Gateway introspection request");
    const proof = parseProductSessionProofV2(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail26("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/introspect", { requiredScopes: input.requiredScopes }, proof);
  }
  async revoke(input) {
    exactFields(input, ["requestId", "sessionBinding", "proof"], "Product Session Gateway revoke request");
    const proof = parseProductSessionProofV2(input.proof);
    if (proof.sessionBinding !== input.sessionBinding) fail26("CROSS_PRODUCT_SESSION", "Product Session proof does not match the requested session binding");
    return this.#request(input.requestId, "/v2/product-sessions/revoke", {}, proof);
  }
  async #request(requestId, path3, body, proof, method3 = "POST") {
    if (typeof requestId !== "string" || !/^req_[A-Za-z0-9_-]{12,80}$/.test(requestId)) fail26("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid");
    const encodedBody = method3 === "GET" ? void 0 : canonicalJSON(body);
    const headers = { "accept": "application/json", "x-request-id": requestId };
    if (method3 === "POST") headers["content-type"] = "application/json";
    if (proof !== null) headers[PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2] = encodeProductSessionGatewayProofHeaderV2(proof);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response4;
    try {
      const fetch2 = this.#fetch;
      response4 = await fetch2(`${this.#endpoint}${path3}`, { method: method3, headers, body: encodedBody, cache: "no-store", credentials: "omit", redirect: "error", signal: controller.signal });
    } catch {
      clearTimeout(timeout);
      fail26("NETWORK_UNAVAILABLE", "Product Session Gateway is unavailable; no local response was substituted");
    }
    try {
      if (!response4 || typeof response4.status !== "number" || !response4.headers || typeof response4.headers.get !== "function" || typeof response4.text !== "function") fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is invalid");
      const contentType = response4.headers.get("content-type") ?? "";
      const responseRequestId = response4.headers.get("x-request-id");
      const cacheControl = response4.headers.get("cache-control") ?? "";
      const contentLength = response4.headers.get("content-length");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) || responseRequestId !== requestId || !/(^|,)\s*no-store\s*(,|$)/i.test(cacheControl)) fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response headers are invalid");
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let text8;
      try {
        text8 = await response4.text();
      } catch {
        fail26("NETWORK_UNAVAILABLE", "Product Session Gateway response stream was interrupted; no local response was substituted");
      }
      if (new TextEncoder().encode(text8).length > MAX_RESPONSE_BYTES) fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response exceeds policy");
      let payload;
      try {
        payload = JSON.parse(text8);
      } catch {
        fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not JSON");
      }
      if (canonicalJSON(payload) !== text8) fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway response is not canonical JSON");
      if (response4.status >= 200 && response4.status < 300) {
        exactFields(payload, ["ok", "requestId", "result", "schemaVersion"], "Product Session Gateway success response");
        if (payload.ok !== true || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION) fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway success response binding is invalid");
        return payload.result;
      }
      exactFields(payload, ["error", "ok", "requestId", "schemaVersion"], "Product Session Gateway error response");
      exactFields(payload.error, ["code", "message"], "Product Session Gateway public error");
      if (payload.ok !== false || payload.requestId !== requestId || payload.schemaVersion !== PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION || typeof payload.error.code !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(payload.error.code) || typeof payload.error.message !== "string" || payload.error.message.length > 300) fail26("INVALID_GATEWAY_RESPONSE", "Product Session Gateway error response binding is invalid");
      throw new WalletAuthError(payload.error.code, payload.error.message);
    } finally {
      clearTimeout(timeout);
    }
  }
};
function decodeProductSessionGatewayProofHeaderV2(value) {
  if (typeof value !== "string" || value.length > 16384) fail26("INVALID_PROOF_HEADER", "Product Session proof header is invalid");
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(value, "Product Session proof header")));
  } catch {
    fail26("INVALID_PROOF_HEADER", "Product Session proof header is invalid");
  }
  return parseProductSessionProofV2(parsed);
}
function encodeProductSessionGatewayProofHeaderV2(value) {
  const proof = parseProductSessionProofV2(value);
  const encoded = encodeBase64url(new TextEncoder().encode(canonicalJSON(proof)));
  if (encoded.length > 16384) fail26("INVALID_PROOF_HEADER", "Product Session proof header exceeds policy");
  return encoded;
}
function endpoint(value) {
  if (typeof value !== "string" || value.length > 512) fail26("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail26("INVALID_GATEWAY", "Product Session Gateway endpoint is invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || parsed.pathname !== "/" || value !== parsed.origin) fail26("INVALID_GATEWAY", "Product Session Gateway endpoint must be a canonical HTTPS origin");
  return parsed.origin;
}
function capability(value, label) {
  if (typeof value !== "boolean") fail26("INVALID_GATEWAY", `${label} must return a boolean`);
  return value;
}
function fail26(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-recovery.js
var PRODUCT_SESSION_CLIENT_STATE = Object.freeze({
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  GUEST: "guest",
  EXPIRED: "expired",
  NETWORK_UNAVAILABLE: "network-unavailable",
  RETRY_REQUIRED: "retry-required"
});
var REVOCATION_PENDING = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Product Session revocation is pending; API authorization is suspended", { actions: ["retry"] });
var RecoverableProductSessionClient = class {
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
    exactFields(config, ["registry", "productId", "platform", "storage", "gateway", "device", "tokenFactory", "clock"], "Recoverable Product Session client configuration");
    this.#registry = parseProductSessionRegistry(config.registry);
    this.#binding = productPlatformBinding(this.#registry, config.productId, config.platform);
    this.#storage = secureStorage(config.storage, config.platform, config.device);
    this.#gateway = gateway(config.gateway);
    this.#device = device(config.device);
    this.#tokens = tokenFactory(config.tokenFactory);
    this.#clock = clock(config.clock);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "No authoritative Product Session is active");
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
    return this.#disconnectPromise !== null || this.#revocationRequested && [PRODUCT_SESSION_CLIENT_STATE.CONNECTED, PRODUCT_SESSION_CLIENT_STATE.CONNECTING, PRODUCT_SESSION_CLIENT_STATE.GUEST].includes(this.#state.status) ? REVOCATION_PENDING : this.#state;
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
      if (error instanceof WalletAuthError) throw error;
      fail27("WALLET_UNAVAILABLE", "Wallet availability detection failed closed");
    }
    if (typeof walletInstalled !== "boolean" || typeof schemeRegistered !== "boolean") fail27("INVALID_GATEWAY_RESPONSE", "Wallet availability detection returned invalid values");
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
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Stored Product Session is invalid; explicit Retry is required", { actions: ["retry", "guest"] });
    return this.#state;
  }
  async begin(environment, automatic = false) {
    exactFields(environment, ["walletInstalled", "schemeRegistered"], "Product Session connection environment");
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
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry", "guest"] });
      return this.#state;
    };
    let request;
    try {
      if (typeof raw !== "string" || raw.length > 16384) fail27("INVALID_SESSION_STORE", "Pending Wallet request exceeds policy");
      const input = JSON.parse(raw);
      request = parseProductSessionRequest(this.#registry, input, new Date(input?.issuedAt));
      for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
        if (request[field] !== this.#binding[field]) fail27("SESSION_BINDING_MISMATCH", "Pending Wallet request belongs to another product binding");
      }
      if (request.deviceId !== this.#device.id || request.deviceKey !== this.#device.key || canonicalJSON(request.scopes) !== canonicalJSON(this.#device.scopes)) fail27("SESSION_BINDING_MISMATCH", "Pending Wallet request belongs to another device or scope selection");
    } catch {
      return retained("The saved Wallet request is invalid or belongs to another binding; it was retained. Start a new explicit request to replace it.");
    }
    let now;
    try {
      if (typeof this.#gateway.currentTime !== "function") fail27("CLOCK_UNAVAILABLE", "Pending request recovery requires authority time");
      now = await this.#now();
    } catch {
      if (epoch !== this.#beginEpoch) return this.current;
      return this.#offline("Authority time is unavailable; the original Wallet request was retained for Retry");
    }
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while checking the original Wallet request; it was retained for Retry");
    try {
      request = parseProductSessionRequest(this.#registry, request, now);
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
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTING, "The original Wallet approval is still pending; explicitly open the same request", { request, route, automatic: false, installation: "unverified" });
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
    const revoking = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (revoking) return this.#pendingRevocation();
    if (!this.#networkAvailable) return this.#offline();
    const networkEpoch = this.#networkEpoch;
    let now;
    try {
      if (explicit && typeof this.#gateway.currentTime !== "function") fail27("CLOCK_UNAVAILABLE", "Explicit Wallet opening requires the authority-time adapter");
      now = await this.#now();
    } catch (error) {
      if (epoch !== this.#beginEpoch) return this.current;
      if (isNetworkUnavailable(error) || explicit && !(error instanceof WalletAuthError)) return this.#offline("Authority time is unavailable; Retry before opening Wallet");
      throw error;
    }
    if (epoch !== this.#beginEpoch) return this.current;
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading authority time; explicit Retry is required");
    const pendingRevocation = await this.#loadRevocationIntent();
    if (epoch !== this.#beginEpoch) return this.current;
    if (pendingRevocation) return this.#pendingRevocation();
    const request = createProductSessionRequest(this.#registry, {
      productId: this.#binding.productId,
      platform: this.#binding.platform,
      deviceId: this.#device.id,
      deviceKey: this.#device.key,
      scopes: this.#device.scopes,
      purpose: this.#device.purpose,
      nonce: this.#tokens(),
      state: this.#tokens()
    }, now);
    const mutation = this.#beginMutation.then(async () => {
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while preparing the Wallet request; explicit Retry is required");
      const key = `${this.storageKey}:pending`, raw = canonicalJSON(request);
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
        if (stored !== raw) fail27("INSECURE_STORAGE", "Pending Wallet request did not read back exactly");
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while protecting the Wallet request; explicit Retry is required");
        const route = explicit ? prepareWalletAttempt(this.#registry, request, now) : prepareWalletOpen(this.#registry, request, { networkAvailable: true, walletInstalled: environment.walletInstalled, schemeRegistered: environment.schemeRegistered }, now);
        this.#state = route.status === WALLET_ROUTE_STATUS.READY ? state(PRODUCT_SESSION_CLIENT_STATE.CONNECTING, automatic ? "Controlled reconnect requires Wallet approval" : "Wallet approval is pending", { request, route, automatic, ...explicit ? { installation: "unverified" } : {} }) : state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, route.message, { request, route, automatic, actions: route.actions });
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
      if (this.#returnOperation.url !== url2) fail27("CONCURRENT_CALLBACK", "A different Wallet callback is already being verified");
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
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "No pending Wallet request matches this callback", { actions: ["retry", "guest"] });
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
      request = parseProductSessionRequest(this.#registry, JSON.parse(raw), now);
    } catch {
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Pending Wallet request expired or is invalid", { actions: ["retry", "guest"] });
      return this.#state;
    }
    const returned = parseProductSessionReturnURL(this.#registry, request, url2, now);
    if (returned.status === WALLET_ROUTE_STATUS.USER_REJECTED) {
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, "Wallet approval was rejected; no session was created", { actions: returned.actions });
      return this.#state;
    }
    if (returned.status !== WALLET_ROUTE_STATUS.READY) {
      await this.#storage.remove(`${this.storageKey}:return`);
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, returned.message, { actions: returned.actions });
      return this.#state;
    }
    await this.#storage.set(`${this.storageKey}:return`, url2);
    try {
      const storedCompletion = await this.#storage.get(`${this.storageKey}:completion`);
      let completion;
      if (storedCompletion !== null) {
        const record2 = parseCompletionRecord(this.#registry, storedCompletion, now);
        if (canonicalJSON(record2.request) !== canonicalJSON(request) || canonicalJSON(record2.approval) !== canonicalJSON(returned.approval) || record2.completion.challenge.deviceId !== this.#device.id || record2.completion.challenge.deviceKey !== this.#device.key) fail27("SESSION_BINDING_MISMATCH", "Protected completion belongs to another exact Wallet approval");
        if (record2.completion.challenge.sessionExpiresAt <= now.toISOString()) fail27("SESSION_EXPIRED", "Previously completed Product Session has expired");
        completion = record2.completion;
      } else {
        const challenge = parseProductSessionChallenge(await this.#gateway.challenge({ requestId: gatewayRequestId("c", request.nonce), request, approval: returned.approval }));
        if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while receiving the Gateway challenge; protected callback was retained for Retry");
        const expectedChallenge = createProductSessionChallenge(this.#registry, request, returned.approval, { challenge: challenge.challenge }, new Date(challenge.issuedAt));
        if (canonicalJSON(challenge) !== canonicalJSON(expectedChallenge)) fail27("SESSION_BINDING_MISMATCH", "Gateway challenge did not match the exact product request and Wallet approval");
        if (challenge.expiresAt <= (await this.#now()).toISOString()) fail27("SESSION_EXPIRED", "Gateway challenge expired before product device signing");
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) return this.#networkTransition("Network changed while reading challenge time; protected callback was retained for Retry");
        if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
        completion = this.#device.sign ? await signProductSessionChallengeWith(challenge, this.#device.sign) : signProductSessionChallenge(challenge, this.#device.secret);
        await this.#storage.set(`${this.storageKey}:completion`, canonicalJSON({ request, approval: returned.approval, completion }));
      }
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during platform challenge signing; protected callback was retained for Retry");
      if (await this.#loadRevocationIntent()) return this.#pendingRevocation();
      const session = parseProductSession(await this.#gateway.complete({ requestId: gatewayRequestId("f", request.state), request, approval: returned.approval, completion }));
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
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session connected", { session });
      return this.#state;
    } catch (error) {
      if (this.#revocationRequested || error?.code === "REVOCATION_PENDING") return this.#pendingRevocation();
      if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while completing Wallet approval; the protected callback was retained for Retry");
      await this.#storage.remove(this.storageKey);
      await this.#clearPending();
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not issue or confirm a valid Product Session", { actions: ["retry", "guest"] });
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
    return walletConnectionChoices(this.#registry, this.#binding.productId, availability);
  }
  setNetworkAvailable(available) {
    this.#networkEpoch += 1;
    this.#networkAvailable = Boolean(available);
    if (!this.#networkAvailable) return this.#offline();
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Network restored; authoritative re-introspection is required", { actions: ["retry"] });
    return this.#state;
  }
  enterGuest() {
    this.#beginEpoch += 1;
    if (this.#revocationRequested) return this.#pendingRevocation();
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.GUEST, "Guest / Try mode: not signed in; balances, transactions and Chain authority are unavailable", { limitations: ["not-signed-in", "no-wallet-balance", "no-transactions", "no-chain-authority"] });
    return this.#state;
  }
  async disconnect() {
    if (this.#disconnectPromise !== null) return this.#disconnectPromise;
    this.#beginEpoch += 1;
    this.#revocationRequested = true;
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
          session = parseProductSession(JSON.parse(raw));
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
        if (!this.#networkAvailable) fail27("NETWORK_UNAVAILABLE", "Network unavailable before Product Session revocation");
        const now = await this.#now();
        if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail27("NETWORK_UNAVAILABLE", "Network changed while reading revocation authority time");
        sessionExpired = typeof this.#gateway.currentTime === "function" && session.expiresAt <= now.toISOString();
        if (!sessionExpired) {
          const body = {};
          const proof = await this.#proof(session, "/v2/product-sessions/revoke", body, now);
          if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail27("NETWORK_UNAVAILABLE", "Network changed during Product Session revocation signing");
          const result = await this.#gateway.revoke({ requestId: gatewayRequestId("r", proof.nonce), sessionBinding: session.sessionBinding, proof });
          if (result?.revoked !== session.sessionBinding) fail27("INVALID_GATEWAY_RESPONSE", "Gateway did not confirm the exact Product Session revocation");
        }
      } catch (error) {
        if (isNetworkUnavailable(error)) return this.#offline("Network unavailable while revoking the Product Session; protected state was retained for Retry");
        if (!(error instanceof WalletAuthError) || error.code !== "SESSION_REVOKED") {
          this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, "Gateway did not confirm Product Session revocation; protected state was retained", { actions: ["retry"] });
          return this.#state;
        }
      }
    }
    if (session === null && await this.#storage.get(`${this.storageKey}:return`) !== null) return this.#pendingRevocation("A prior completion has not yielded its exact target; sign-out confirmation is still pending.");
    try {
      await this.#finishRevocationIntent();
    } catch {
      return this.#pendingRevocation("The authority result was received but secure cleanup is pending; Retry the same sign-out target.");
    }
    this.#revocationRequested = false;
    this.#revocationIntent = null;
    this.#state = state(sessionExpired ? PRODUCT_SESSION_CLIENT_STATE.EXPIRED : PRODUCT_SESSION_CLIENT_STATE.DISCONNECTED, session === null ? "No authoritative Product Session was present; local connection request was removed" : sessionExpired ? "Auth confirmed that the exact Product Session expired; no revocation receipt was claimed" : "Auth confirmed revocation of the exact Product Session", { revocationConfirmed: session !== null && !sessionExpired, ...session ? { sessionBinding: session.sessionBinding } : {} });
    return this.#state;
  }
  async createIntrospectionProof(requiredScopes2) {
    const expected = this.current, epoch = this.#beginEpoch, networkEpoch = this.#networkEpoch;
    const active2 = () => {
      if (this.#revocationRequested || this.#disconnectPromise !== null) fail27("REVOCATION_PENDING", "Pending sign-out blocks Product Session API proofs");
      if (!this.#networkAvailable || networkEpoch !== this.#networkEpoch) fail27("NETWORK_UNAVAILABLE", "Network changed during Product Session API authorization");
      if (this.current !== expected || epoch !== this.#beginEpoch || expected.status !== PRODUCT_SESSION_CLIENT_STATE.CONNECTED || !expected.session) fail27("SESSION_INACTIVE", "Connect and verify the same Product Session before signing an API proof");
    };
    active2();
    const session = parseProductSession(expected.session);
    for (const field of ["chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback"]) {
      if (session[field] !== this.#binding[field]) fail27("SESSION_BINDING_MISMATCH", "API proof session belongs to another product binding");
    }
    if (session.deviceId !== this.#device.id || session.deviceKey !== this.#device.key) fail27("SESSION_BINDING_MISMATCH", "API proof session belongs to another product device");
    const scopeCount = Array.isArray(requiredScopes2) ? requiredScopes2.length : 0;
    if (!Number.isInteger(scopeCount) || scopeCount < 1 || scopeCount > 8) fail27("SCOPE_WIDENING", "API proof scopes must be a nonempty sorted unique subset of the granted session");
    const scopes3 = Object.freeze(Array.from({ length: scopeCount }, (_, index) => requiredScopes2[index]));
    if (scopes3.some((scope2) => typeof scope2 !== "string" || !session.scopes.includes(scope2) || !this.#device.scopes.includes(scope2) || !this.#binding.scopes.includes(scope2)) || new Set(scopes3).size !== scopes3.length || [...scopes3].sort().join("\n") !== scopes3.join("\n")) fail27("SCOPE_WIDENING", "API proof scopes must be a nonempty sorted unique subset of the granted session");
    const body = Object.freeze({ requiredScopes: scopes3 });
    let originalRaw;
    const readback = async () => {
      active2();
      if (await this.#loadRevocationIntent()) fail27("REVOCATION_PENDING", "Pending sign-out blocks Product Session API proofs");
      active2();
      const raw = await this.#storage.get(this.storageKey);
      active2();
      let stored;
      try {
        if (typeof raw !== "string" || raw.length > 16384) fail27("SESSION_INACTIVE", "Stored Product Session is unavailable");
        stored = parseProductSession(JSON.parse(raw));
      } catch {
        fail27("SESSION_INACTIVE", "Stored Product Session is invalid; no API proof was released");
      }
      if (canonicalJSON(stored) !== canonicalJSON(session) || originalRaw !== void 0 && raw !== originalRaw) fail27("SESSION_INACTIVE", "Stored Product Session changed during API authorization");
      originalRaw = raw;
      if (await this.#loadRevocationIntent()) fail27("REVOCATION_PENDING", "Sign-out started during Product Session API authorization");
      active2();
    };
    await readback();
    active2();
    if (typeof this.#gateway.currentTime !== "function") fail27("CLOCK_UNAVAILABLE", "Product Session API proofs require authority time");
    let now;
    try {
      now = new Date((await this.#now()).getTime());
    } catch (error) {
      active2();
      if (isNetworkUnavailable(error)) throw error;
      fail27("CLOCK_UNAVAILABLE", "Product Session authority time is unavailable");
    }
    active2();
    if (now.toISOString() < session.issuedAt || now.toISOString() >= session.expiresAt) fail27("SESSION_EXPIRED", "Product Session is outside its authority-time validity window");
    const proof = await this.#proof(session, "/v2/product-sessions/introspect", body, now, { active: active2, readback });
    const result = Object.freeze({ proof, proofHeader: encodeProductSessionGatewayProofHeaderV2(proof), requestId: gatewayRequestId("i", this.#tokens()), body: canonicalJSON(body) });
    await readback();
    active2();
    return result;
  }
  async #introspect(session) {
    if (await this.#loadRevocationIntent()) fail27("REVOCATION_PENDING", "Pending sign-out blocks Product Session authorization");
    const networkEpoch = this.#networkEpoch;
    if (!this.#networkAvailable) fail27("NETWORK_UNAVAILABLE", "Network unavailable before Product Session introspection");
    const body = { requiredScopes: session.scopes };
    const proof = await this.#proof(session, "/v2/product-sessions/introspect", body);
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail27("NETWORK_UNAVAILABLE", "Network changed during Product Session introspection signing");
    const result = await this.#gateway.introspect({ requestId: gatewayRequestId("i", proof.nonce), sessionBinding: session.sessionBinding, requiredScopes: session.scopes, proof });
    if (await this.#loadRevocationIntent()) fail27("REVOCATION_PENDING", "Sign-out started during Product Session authorization");
    if (result?.active !== true || canonicalJSON(parseProductSession(result.session)) !== canonicalJSON(session)) fail27("SESSION_INACTIVE", "Gateway did not confirm the exact Product Session");
    return result;
  }
  async #proof(session, path3, body, authorityTime, guard = null) {
    if (path3 !== "/v2/product-sessions/revoke" && await this.#loadRevocationIntent()) fail27("REVOCATION_PENDING", "Pending sign-out blocks Product Session authorization");
    const networkEpoch = this.#networkEpoch;
    const now = authorityTime ?? await this.#now();
    if (networkEpoch !== this.#networkEpoch || !this.#networkAvailable) fail27("NETWORK_UNAVAILABLE", "Network changed while reading proof authority time");
    const expiresAt = new Date(Math.min(now.getTime() + 3e4, Date.parse(session.expiresAt))).toISOString();
    if (expiresAt <= now.toISOString()) fail27("SESSION_EXPIRED", "Product Session expired before sender-constrained authorization");
    const input = {
      method: "POST",
      path: path3,
      bodyDigest: httpBodyDigest(canonicalJSON(body)),
      nonce: this.#tokens(),
      issuedAt: now.toISOString(),
      expiresAt
    };
    if (guard !== null) {
      await guard.readback();
      guard.active();
    }
    const proof = this.#device.sign ? await createProductSessionProofV2With(session, input, this.#device.sign) : createProductSessionProofV2(session, input, this.#device.secret);
    if (guard !== null) {
      await guard.readback();
      guard.active();
    }
    return proof;
  }
  async #now() {
    const value = typeof this.#gateway.currentTime === "function" ? await this.#gateway.currentTime({ requestId: gatewayRequestId("t", this.#tokens()) }) : this.#clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail27("CLOCK_UNAVAILABLE", "Product Session authority time is invalid");
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
      const session = parseProductSession(JSON.parse(raw));
      await this.#introspect(session);
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed during Product Session re-introspection; protected state was retained for Retry");
      await this.#clearPending(epoch);
      if (epoch !== this.#beginEpoch) return this.current;
      if (networkEpoch !== this.#networkEpoch) return this.#networkTransition("Network changed while restoring the Product Session; protected state was retained for Retry");
      this.#state = state(PRODUCT_SESSION_CLIENT_STATE.CONNECTED, "Authoritative Product Session restored", { session });
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
      if (raw !== null) session = parseProductSession(JSON.parse(raw));
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
    const raw = canonicalJSON(intent), key = `${this.storageKey}:revoke`;
    if (typeof this.#storage.saveRevocationIntent === "function") {
      this.#revocationIntent = parseRevocationIntent(await this.#storage.saveRevocationIntent(key, raw), this.#binding, this.#device);
    } else {
      await this.#storage.set(key, raw);
      if (await this.#storage.get(key) !== raw) fail27("INSECURE_STORAGE", "Pending sign-out intent did not read back exactly");
      this.#revocationIntent = intent;
    }
  }
  async #finishRevocationIntent() {
    const intent = this.#revocationIntent, key = `${this.storageKey}:revoke`, raw = canonicalJSON(intent);
    if (typeof this.#storage.finishRevocationIntent === "function") return this.#storage.finishRevocationIntent(key, raw);
    if (await this.#storage.get(key) !== raw) fail27("REVOCATION_CHANGED", "Pending sign-out target changed during confirmation");
    if (revocationSessionMatches(await this.#storage.get(this.storageKey), intent.session)) await this.#storage.remove(this.storageKey);
    await this.#clearPending();
    await this.#storage.remove(key);
  }
  #pendingRevocation(message = "Sign-out confirmation is pending; only explicit Retry may contact Auth. Product authorization is suspended.") {
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry"], revocationPending: true });
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
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE, message, { actions: this.#revocationRequested ? ["retry"] : ["retry", "guest"], ...this.#revocationRequested ? { revocationPending: true } : {} });
    return this.#state;
  }
  #networkTransition(message) {
    if (!this.#networkAvailable) return this.#offline(message);
    this.#state = state(PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED, message, { actions: ["retry", "guest"] });
    return this.#state;
  }
};
function state(status, message, extra = {}) {
  return Object.freeze({ status, message, ...extra, ...extra.actions ? { actions: Object.freeze(extra.actions) } : {}, ...extra.limitations ? { limitations: Object.freeze(extra.limitations) } : {} });
}
function secureStorage(value, platform, device2) {
  const nativeProtected = value && ["hardware-backed", "os-protected"].includes(value.securityLevel);
  const browserProtected = value?.securityLevel === "webcrypto-nonextractable" && platform === "web" && typeof device2?.sign === "function" && !("secret" in device2);
  if (!nativeProtected && !browserProtected || ["get", "set", "remove"].some((name) => typeof value[name] !== "function")) fail27("INSECURE_STORAGE", "Product Sessions require OS/hardware protection or a Web-only non-extractable device signer");
  return value;
}
function gateway(value) {
  if (!value || ["challenge", "complete", "introspect", "revoke", "walletInstalled", "schemeRegistered"].some((name) => typeof value[name] !== "function")) fail27("INVALID_GATEWAY", "Product Session client requires a real Gateway adapter");
  return value;
}
function device(value) {
  const fields4 = Object.keys(value ?? {}).sort().join("\n");
  const secretFields = ["id", "key", "secret", "scopes", "purpose"].sort().join("\n");
  const signerFields = ["id", "key", "sign", "scopes", "purpose"].sort().join("\n");
  if (fields4 !== secretFields && fields4 !== signerFields) fail27("UNKNOWN_OR_MISSING_FIELD", "Product Session device configuration fields do not match the protocol schema");
  if (typeof value.id !== "string" || typeof value.key !== "string" || !Array.isArray(value.scopes) || typeof value.purpose !== "string" || (fields4 === secretFields ? typeof value.secret !== "string" : typeof value.sign !== "function")) fail27("INVALID_DEVICE", "Product Session device configuration is invalid");
  return Object.freeze({ ...value, scopes: Object.freeze([...value.scopes]) });
}
function tokenFactory(value) {
  if (typeof value !== "function") fail27("INVALID_RANDOM_SOURCE", "Product Session client requires a cryptographic token factory");
  return () => {
    const token3 = value();
    if (typeof token3 !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(token3)) fail27("INVALID_RANDOM_SOURCE", "Product Session token factory returned an invalid token");
    return token3;
  };
}
function clock(value) {
  if (typeof value !== "function") fail27("INVALID_TIME", "Product Session client requires a clock");
  return () => {
    const result = value();
    if (!(result instanceof Date) || !Number.isFinite(result.getTime())) fail27("INVALID_TIME", "Product Session clock returned invalid time");
    return result;
  };
}
function isNetworkUnavailable(error) {
  return error instanceof WalletAuthError && ["NETWORK_UNAVAILABLE", "CLOCK_UNAVAILABLE"].includes(error.code);
}
function gatewayRequestId(kind, token3) {
  return `req_ps_${kind}_${token3}`;
}
function fail27(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/wallet-connection-coordinator.js
var WALLET_CONNECTION_COORDINATOR_STATUS = Object.freeze({
  OPTIONS_READY: "options-ready",
  SESSION_STATE: "session-state",
  WALLET_OPENED: "wallet-opened",
  WALLET_OPEN_FAILED: "wallet-open-failed",
  YNX_WALLET_PREFERRED: "ynx-wallet-preferred",
  EVM_CONNECTED: "evm-connected",
  EVM_UNAVAILABLE: "evm-unavailable"
});
var WalletConnectionCoordinator = class {
  #registry;
  #productId;
  #client;
  #scope;
  #waitMs;
  #openWallet;
  #openTimeoutMs;
  #evmGeneration = 0;
  constructor(config) {
    exactFields(config, ["registry", "productId", "sessionClient", "scope", "discoveryWaitMs", "openWallet", "openTimeoutMs"], "Wallet connection coordinator configuration");
    this.#registry = parseProductSessionRegistry(config.registry);
    if (typeof config.productId !== "string" || !this.#registry.products.some((item) => item.productId === config.productId)) fail28("UNKNOWN_PRODUCT", "Wallet connection product is not registered");
    if (!(config.sessionClient instanceof RecoverableProductSessionClient) || config.sessionClient.connectionBinding.productId !== config.productId) fail28("CROSS_PRODUCT_REUSE", "Wallet connection coordinator requires the exact product session client");
    if (typeof config.scope !== "object" && typeof config.scope !== "function" || config.scope === null) fail28("INVALID_WALLET_SCOPE", "Wallet provider discovery scope is invalid");
    if (!Number.isSafeInteger(config.discoveryWaitMs) || config.discoveryWaitMs < 0 || config.discoveryWaitMs > 2e3) fail28("INVALID_WALLET_SCOPE", "Wallet provider discovery wait is invalid");
    if (typeof config.openWallet !== "function") fail28("INVALID_WALLET_OPENER", "Wallet connection coordinator requires a platform opener");
    if (!Number.isSafeInteger(config.openTimeoutMs) || config.openTimeoutMs < 10 || config.openTimeoutMs > 3e4) fail28("INVALID_WALLET_OPENER", "Wallet opener timeout is invalid");
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
    const [discovery, environment] = await Promise.all([discoverWalletProviders(this.#scope, this.#waitMs), this.#client.detectWalletEnvironment()]);
    const injected = walletAvailabilityFromDiscovery(discovery);
    const availability = Object.freeze({ ynxWalletInstalled: environment.walletInstalled || injected.ynxWalletInstalled, metaMaskAvailable: injected.metaMaskAvailable });
    const choices = this.#client.connectionChoices(availability);
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.OPTIONS_READY, discovery, environment, availability, choices });
  }
  async restore(networkAvailable = true) {
    const sessionState = await this.#client.restore(networkAvailable);
    if (sessionState.automatic !== true) return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState });
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
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState: await this.#client.handleReturn(url2) });
  }
  setNetworkAvailable(available) {
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState: this.#client.setNetworkAvailable(available) });
  }
  enterGuest() {
    this.#evmGeneration += 1;
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState: this.#client.enterGuest() });
  }
  async disconnect() {
    this.#evmGeneration += 1;
    return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState: await this.#client.disconnect() });
  }
  async connectMetaMask() {
    const generation = ++this.#evmGeneration;
    const discovery = await discoverWalletProviders(this.#scope, this.#waitMs);
    const environment = null;
    const choices = this.#client.connectionChoices(walletAvailabilityFromDiscovery(discovery));
    if (generation !== this.#evmGeneration) return cancelledEvmConnection();
    if (discovery.metamask === null) {
      const ambiguous = discovery.ambiguities.includes("metamask"), download = choices.find((item) => item.id === "metamask" && item.action === "download-evm-wallet");
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.EVM_UNAVAILABLE, code: ambiguous ? "AMBIGUOUS_WALLET_PROVIDER" : "METAMASK_NOT_INSTALLED", message: ambiguous ? "Multiple MetaMask providers require an explicit platform chooser" : "MetaMask is not installed", actions: ambiguous ? ["retry", "guest", "return-to-product"] : ["download-metamask", "guest", "return-to-product"], ...download ? { downloadUrl: download.url } : {}, discovery, environment, choices });
    }
    try {
      const connection = await new MetaMaskEvmConnectionAdapter({ registry: this.#registry, productId: this.#productId, provider: discovery.metamask.provider }).connect();
      if (generation !== this.#evmGeneration) return cancelledEvmConnection();
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.EVM_CONNECTED, connection, discovery, environment, choices });
    } catch (error) {
      if (generation !== this.#evmGeneration) return cancelledEvmConnection();
      const code = error instanceof WalletAuthError ? error.code : "WALLET_UNAVAILABLE";
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.EVM_UNAVAILABLE, code, message: coordinatorErrorMessage(code), actions: coordinatorActions(code), discovery, environment, choices });
    }
  }
  async #openIfConnecting(sessionState) {
    if (sessionState.status !== PRODUCT_SESSION_CLIENT_STATE.CONNECTING) return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.SESSION_STATE, sessionState });
    const route = sessionState.route, requestId = `req_ps_open_${sessionState.request.nonce}`;
    try {
      const result = await withTimeout(this.#openWallet(Object.freeze({ url: route.url, request: sessionState.request, requestId, automatic: sessionState.automatic === true, productId: this.#productId, platform: this.#client.connectionBinding.platform })), this.#openTimeoutMs);
      exactFields(result, result?.opened === true ? ["opened"] : ["opened", "code"], "Wallet opener result");
      if (result.opened !== true) fail28(openerCode(result.code), "Platform did not open the registered Wallet route");
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPENED, requestId, url: route.url, automatic: sessionState.automatic === true, sessionState });
    } catch (error) {
      const code = error instanceof WalletAuthError ? error.code : "WALLET_OPEN_FAILED";
      return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.WALLET_OPEN_FAILED, requestId, code, message: coordinatorErrorMessage(code), actions: coordinatorActions(code), sessionState });
    }
  }
};
function cancelledEvmConnection() {
  return frozen({ status: WALLET_CONNECTION_COORDINATOR_STATUS.EVM_UNAVAILABLE, code: "WALLET_CONNECTION_CANCELLED", message: "Wallet connection was cancelled", actions: ["retry", "return-to-product"] });
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
      timer = setTimeout(() => reject(new WalletAuthError("WALLET_OPEN_TIMEOUT", "Wallet opener timed out")), timeoutMs);
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
function fail28(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/wallet-downloads.js
var WALLET_DOWNLOAD_MANIFEST_SCHEMA_VERSION = 1;
var PLATFORMS = ["android", "ios", "linux", "macos", "web-extension", "windows"];
var ARCHITECTURES = ["any", "arm64", "universal", "x64"];
var BROWSERS = ["chromium", "firefox", "safari"];
var FIELDS4 = ["id", "status", "sourceCommit", "sha256", "bytes", "filename", "mimeType", "platform", "architecture", "browser", "installation", "url", "storeStatus"];
var FORMATS = Object.freeze({
  apk: { platform: "android", architectures: ["arm64", "x64", "universal"], browser: null, extension: ".apk", mime: ["application/vnd.android.package-archive"] },
  "ios-ad-hoc": { platform: "ios", architectures: ["arm64"], browser: null, extension: ".ipa", mime: ["application/octet-stream", "application/x-itunes-ipa"] },
  dmg: { platform: "macos", architectures: ["arm64", "x64", "universal"], browser: null, extension: ".dmg", mime: ["application/x-apple-diskimage", "application/octet-stream"] },
  exe: { platform: "windows", architectures: ["arm64", "x64"], browser: null, extension: ".exe", mime: ["application/vnd.microsoft.portable-executable", "application/x-msdownload", "application/octet-stream"] },
  deb: { platform: "linux", architectures: ["arm64", "x64"], browser: null, extension: ".deb", mime: ["application/vnd.debian.binary-package", "application/x-debian-package", "application/octet-stream"] },
  rpm: { platform: "linux", architectures: ["arm64", "x64"], browser: null, extension: ".rpm", mime: ["application/x-rpm", "application/octet-stream"] },
  appimage: { platform: "linux", architectures: ["arm64", "x64"], browser: null, extension: ".AppImage", mime: ["application/vnd.appimage", "application/octet-stream"] },
  "extension-unpacked": { platform: "web-extension", architectures: ["any"], browser: "chromium", extension: ".zip", mime: ["application/zip"] },
  "extension-temporary": { platform: "web-extension", architectures: ["any"], browser: "firefox", extension: ".zip", mime: ["application/zip"] }
});
function parseWalletDownloadManifest(input) {
  let value = input;
  if (typeof input === "string") {
    if (new TextEncoder().encode(input).length > 1048576) fail29("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release manifest exceeds its byte limit");
    try {
      value = JSON.parse(input);
    } catch {
      fail29("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release manifest is not JSON");
    }
    if (canonicalJSON(value) !== input) fail29("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release manifest must use exact canonical JSON");
  }
  exactFields(value, ["schemaVersion", "product", "artifacts"], "Wallet download manifest");
  if (value.schemaVersion !== 1 || value.product !== "ynx-wallet" || !Array.isArray(value.artifacts) || value.artifacts.length > 128) fail29("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release manifest version, product or capacity is invalid");
  const artifacts = value.artifacts.map(parseArtifact), ids = /* @__PURE__ */ new Set(), published = /* @__PURE__ */ new Set();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) fail29("INVALID_WALLET_DOWNLOAD_MANIFEST", "Wallet release artifact IDs must be unique");
    ids.add(artifact.id);
    const target2 = selectionKey(artifact);
    if (artifact.status === "published") {
      if (published.has(target2)) fail29("AMBIGUOUS_WALLET_DOWNLOAD", "A target must have exactly one active published artifact");
      published.add(target2);
    }
  }
  return freeze4({ schemaVersion: 1, product: "ynx-wallet", artifacts });
}
function selectWalletDownload(manifestInput, selector2 = {}) {
  const manifest = parseWalletDownloadManifest(manifestInput), target2 = parseSelector(selector2);
  if (target2.platform === void 0) return choose("platform", PLATFORMS, target2);
  if (!PLATFORMS.includes(target2.platform)) return unavailable("unsupported-target", target2, []);
  if (target2.platform !== "web-extension" && target2.browser !== void 0) return unavailable("incompatible-target", target2, []);
  if (target2.platform === "web-extension") {
    if (target2.browser === void 0) return choose("browser", ["chromium", "firefox"], target2);
    if (!BROWSERS.includes(target2.browser) || target2.browser === "safari") return unavailable("unsupported-target", target2, []);
    if (target2.architecture === void 0) target2.architecture = "any";
  }
  if (target2.architecture === void 0) {
    const choices = [...new Set(Object.values(FORMATS).filter((format) => format.platform === target2.platform).flatMap((format) => format.architectures))].sort();
    return choose("architecture", choices, target2);
  }
  if (!ARCHITECTURES.includes(target2.architecture)) return unavailable("unsupported-target", target2, []);
  const formats = Object.entries(FORMATS).filter(([, format]) => format.platform === target2.platform && format.architectures.includes(target2.architecture) && format.browser === (target2.browser ?? null));
  if (!formats.length) return unavailable("incompatible-target", target2, []);
  if (target2.installation === void 0) {
    if (formats.length > 1) return choose("installation", formats.map(([name]) => name).sort(), target2);
    target2.installation = formats[0][0];
  }
  if (!formats.some(([name]) => name === target2.installation)) return unavailable("incompatible-target", target2, []);
  const exact4 = manifest.artifacts.filter((artifact) => selectionKey(artifact) === selectionKey(target2));
  const universal = ["android", "macos"].includes(target2.platform) && ["arm64", "x64"].includes(target2.architecture) ? manifest.artifacts.filter((artifact) => selectionKey(artifact) === selectionKey({ ...target2, architecture: "universal" })) : [];
  const matches = [...exact4, ...universal];
  const published = matches.find((artifact) => artifact.status === "published");
  if (published) return freeze4({ status: "download", url: published.url, artifact: published });
  const states = [...new Set(matches.map((artifact) => artifact.status))].sort();
  return unavailable(states.length ? "not-published" : "no-artifact", target2, states);
}
function parseArtifact(input) {
  exactFields(input, FIELDS4, "Wallet release artifact");
  const artifact = {
    id: pattern12(input.id, /^[a-z0-9][a-z0-9._-]{0,95}$/, "artifact ID"),
    status: input.status,
    sourceCommit: pattern12(input.sourceCommit, /^[0-9a-f]{40}$/, "source commit"),
    sha256: pattern12(input.sha256, /^[0-9a-f]{64}$/, "artifact SHA-256"),
    bytes: input.bytes,
    filename: pattern12(input.filename, /^ynx-wallet-[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/, "official artifact filename"),
    mimeType: input.mimeType,
    platform: input.platform,
    architecture: input.architecture,
    browser: input.browser,
    installation: input.installation,
    url: input.url,
    storeStatus: input.storeStatus
  };
  if (!["published", "local-only", "local-failed"].includes(artifact.status) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.storeStatus !== "not-a-store-release") fail29("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact status, positive byte count or direct-file distribution is invalid");
  if (typeof artifact.installation !== "string" || !Object.hasOwn(FORMATS, artifact.installation)) fail29("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact installation format is unsupported");
  const format = FORMATS[artifact.installation];
  if (artifact.platform !== format.platform || !format.architectures.includes(artifact.architecture) || artifact.browser !== format.browser || !format.mime.includes(artifact.mimeType) || !artifact.filename.endsWith(format.extension)) fail29("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact platform, architecture, browser, filename, MIME and installation format disagree");
  filenameBinding(artifact, format);
  if (artifact.status !== "published") {
    if (artifact.url !== null) fail29("UNPUBLISHED_WALLET_DOWNLOAD", "Local-only or failed artifacts cannot expose a download URL");
  } else immutableURL(artifact);
  return artifact;
}
function filenameBinding(artifact, format) {
  if (artifact.filename.includes("..")) fail29("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact filename cannot contain dot traversal");
  const stem = artifact.filename.slice(0, -format.extension.length);
  if (!/^ynx-wallet-[a-z0-9][a-z0-9._-]*$/.test(stem)) fail29("INVALID_WALLET_DOWNLOAD_ARTIFACT", "Artifact basename must be safe and canonical");
}
function immutableURL(artifact) {
  if (typeof artifact.url !== "string" || artifact.url.length > 1024) fail29("INVALID_WALLET_DOWNLOAD_URL", "Published artifact requires an immutable official file URL");
  const match = /^https:\/\/(www\.ynxweb4\.com|wallet\.ynxweb4\.com|downloads\.ynxweb4\.com)\/(downloads\/(wallet|wallet-web)|wallet)\/sha256-([0-9a-f]{64})\/([A-Za-z0-9._-]+)$/.exec(artifact.url);
  if (!match || match[4] !== artifact.sha256 || match[5] !== artifact.filename || (match[1] === "downloads.ynxweb4.com" ? match[2] !== "wallet" : !match[2].startsWith("downloads/")) || match[3] === "wallet-web" && artifact.platform !== "web-extension") fail29("INVALID_WALLET_DOWNLOAD_URL", "URL must bind the official host, immutable SHA-256 directory and exact artifact filename");
  const parsed = new URL(artifact.url);
  if (parsed.href !== artifact.url || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) fail29("INVALID_WALLET_DOWNLOAD_URL", "Artifact URL must already be canonical");
}
function parseSelector(input) {
  const allowed = ["platform", "architecture", "browser", "installation"];
  exactFields(input, Object.keys(input ?? {}).filter((key) => allowed.includes(key)), "Wallet download selector");
  const target2 = {};
  for (const key of allowed) {
    if (input[key] === void 0 || input[key] === null) continue;
    target2[key] = pattern12(input[key], /^[a-z][a-z0-9-]{0,31}$/, `selected ${key}`);
  }
  return target2;
}
function selectionKey(value) {
  return [value.platform, value.architecture, value.browser ?? "", value.installation].join("|");
}
function choose(field, choices, target2) {
  return freeze4({ status: "selection-required", field, choices: [...choices], target: { ...target2 } });
}
function unavailable(reason, target2, candidateStates) {
  return freeze4({ status: "unavailable", reason, target: { ...target2 }, candidateStates });
}
function pattern12(value, expression, label) {
  if (typeof value !== "string" || !expression.test(value)) fail29("INVALID_WALLET_DOWNLOAD_ARTIFACT", `Wallet ${label} is invalid`);
  return value;
}
function freeze4(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze4);
    Object.freeze(value);
  }
  return value;
}
function fail29(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-server.js
var INTROSPECT = "/v2/product-sessions/introspect";
var TUPLE = ["productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback"];
var SENDER = ["sessionBinding", "account", "deviceId", "deviceKey"];
var ProductSessionServerAuthorizer = class {
  #binding;
  #gateway;
  #clock;
  constructor(config) {
    exactFields(config, ["registry", "productId", "platform", "endpoint", "fetch", "timeoutMs", ...Object.hasOwn(config, "clock") ? ["clock"] : []], "Server Product Session configuration");
    this.#binding = productPlatformBinding(config.registry, config.productId, config.platform);
    this.#clock = config.clock ?? (() => /* @__PURE__ */ new Date());
    if (typeof this.#clock !== "function") fail30("INVALID_SERVER_POLICY", "Server time source is invalid");
    this.#gateway = new ProductSessionGatewayFetchAdapter({ endpoint: config.endpoint, fetch: config.fetch, timeoutMs: config.timeoutMs, walletInstalled: () => false, schemeRegistered: () => false });
  }
  /** No caching or automatic retries. A lost response requires a fresh client
   * proof, because the original may already have been consumed by the authority.
   * `origin` may be null for native requests or a read-only web GET, since
   * browsers can omit Origin on same-origin GET. The signed proof remains
   * mandatory; Origin/Fetch-Metadata are never credentials. Web mutation
   * methods still require the registered Origin. GET routes must be read-only.
   * Caller must reject duplicate proof/Origin headers before creating this input.
   */
  async authorize(input) {
    exactFields(input, ["proofHeader", "origin", "method", "path", "requiredScopes"], "Server Product Session request");
    if (input.origin !== this.#binding.origin && !(input.origin === null && (this.#binding.platform !== "web" || input.method === "GET"))) fail30("ORIGIN_MISMATCH", "Request origin does not match the configured product");
    if (typeof input.method !== "string" || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(input.method) || typeof input.path !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@\/-]{1,255}$/.test(input.path) || input.path.includes("//")) fail30("INVALID_ROUTE_POLICY", "Server route metadata is invalid");
    const requiredScopes2 = scopes2(input.requiredScopes, this.#binding.scopes);
    const proof = decodeProductSessionGatewayProofHeaderV2(input.proofHeader);
    if (TUPLE.some((key) => proof[key] !== this.#binding[key])) fail30("CROSS_PRODUCT_SESSION", "Proof does not match the fixed server product identity");
    const body = canonicalJSON({ requiredScopes: requiredScopes2 });
    if (proof.method !== "POST" || proof.path !== INTROSPECT || proof.bodyDigest !== httpBodyDigest(body)) fail30("HTTP_BINDING_MISMATCH", "Proof must bind the exact route-required introspection scopes");
    const before = instant4(this.#clock());
    active(proof, before);
    const requestId = randomRequestId();
    const result = await this.#gateway.introspect({ requestId, sessionBinding: proof.sessionBinding, requiredScopes: requiredScopes2, proof });
    exactFields(result, ["active", "session"], "Live Product Session result");
    if (result.active !== true) fail30("SESSION_INACTIVE", "The authority did not confirm an active session");
    const session = parseProductSession(result.session);
    if (session.chainId !== this.#binding.chainId || session.platform !== this.#binding.platform || TUPLE.some((key) => session[key] !== this.#binding[key]) || SENDER.some((key) => session[key] !== proof[key])) fail30("SESSION_BINDING_MISMATCH", "Authority response changed the requested product or sender");
    const after = instant4(this.#clock());
    if (after < before) fail30("CLOCK_UNAVAILABLE", "Server clock moved backwards during authorization");
    active(proof, after);
    active(session, after);
    if (proof.issuedAt < session.issuedAt || proof.expiresAt > session.expiresAt) fail30("SESSION_EXPIRED", "Proof does not fit within the live session lifetime");
    if (session.scopes.some((scope2) => !this.#binding.scopes.includes(scope2)) || requiredScopes2.some((scope2) => !session.scopes.includes(scope2))) fail30("SCOPE_WIDENING", "The live session does not grant the required scopes");
    return session;
  }
};
function scopes2(value, allowed) {
  if (!Array.isArray(value)) fail30("INVALID_ROUTE_POLICY", "Route scopes must be an array");
  const snapshot3 = [...value];
  if (!snapshot3.length || snapshot3.length > 32 || snapshot3.some((scope2) => typeof scope2 !== "string" || !allowed.includes(scope2)) || new Set(snapshot3).size !== snapshot3.length || snapshot3.some((scope2, index) => index > 0 && snapshot3[index - 1] >= scope2)) fail30("INVALID_ROUTE_POLICY", "Route scopes must be a nonempty canonical subset of the configured product");
  return Object.freeze(snapshot3);
}
function active(value, now) {
  if (Date.parse(value.issuedAt) > now || Date.parse(value.expiresAt) <= now) fail30("SESSION_EXPIRED", "Session proof is not currently valid");
}
function instant4(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail30("CLOCK_UNAVAILABLE", "Valid server time is required");
  return value.getTime();
}
function randomRequestId() {
  if (typeof globalThis.crypto?.getRandomValues !== "function") fail30("RANDOM_UNAVAILABLE", "Server cryptographic random source is unavailable");
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
  return "req_product_" + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function fail30(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-gateway-http.js
var PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES = 1048576;
var INPUT_FIELDS6 = ["requestId", "method", "path", "contentType", "body", "proofHeader", "networkAvailable"];
var ProductSessionGatewayHttpHandler = class {
  #kernel;
  constructor(registry, tokenFactory2, snapshot3, capacityPolicy) {
    this.#kernel = new ProductSessionGatewayKernel(registry, tokenFactory2, snapshot3, capacityPolicy);
  }
  handle(input, at = /* @__PURE__ */ new Date()) {
    let requestId = validRequestId(input?.requestId) ? input.requestId : "req_invalid_request_000";
    try {
      exactFields(input, input && Object.hasOwn(input, "walletControlProofHeader") ? [...INPUT_FIELDS6, "walletControlProofHeader"] : INPUT_FIELDS6, "Product Session Gateway HTTP request");
      requestId = requestIdValue(input.requestId);
      if (input.contentType !== "application/json") fail31("UNSUPPORTED_MEDIA_TYPE", "Product Session Gateway requires application/json");
      if (typeof input.body !== "string") fail31("INVALID_BODY", "Product Session Gateway body must be a canonical JSON string");
      if (new TextEncoder().encode(input.body).length > PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES) fail31("BODY_TOO_LARGE", "Product Session Gateway body exceeds policy");
      let body;
      try {
        body = JSON.parse(input.body);
      } catch {
        fail31("INVALID_BODY", "Product Session Gateway body is not JSON");
      }
      if (canonicalJSON(body) !== input.body) fail31("NON_CANONICAL_BODY", "Product Session Gateway body must be canonical JSON");
      if (input.proofHeader !== null && typeof input.proofHeader !== "string") fail31("INVALID_PROOF_HEADER", "Product Session proof header must be a string or null");
      if (input.walletControlProofHeader != null && typeof input.walletControlProofHeader !== "string") fail31("INVALID_PROOF_HEADER", "Wallet account owner proof header must be a string or null");
      if (input.proofHeader !== null && input.walletControlProofHeader != null) fail31("UNEXPECTED_PROOF", "Wallet owner and product device proof headers cannot be combined");
      const proof = input.proofHeader === null ? null : decodeProductSessionGatewayProofHeaderV2(input.proofHeader);
      const walletControlProof = input.walletControlProofHeader == null ? null : decodeWalletSessionControlProofHeader(input.walletControlProofHeader);
      return this.#kernel.dispatch({ requestId, method: input.method, path: input.path, body, proof, walletControlProof, networkAvailable: input.networkAvailable }, at);
    } catch (error) {
      const normalized = normalize(error);
      return response3(normalized.status, requestId, { ok: false, error: { code: normalized.code, message: normalized.message } });
    }
  }
  snapshot() {
    return this.#kernel.snapshot();
  }
};
function normalize(error) {
  if (!(error instanceof WalletAuthError)) return { status: 500, code: "INTERNAL", message: "Product Session Gateway HTTP boundary failed closed" };
  const status = error.code === "UNSUPPORTED_MEDIA_TYPE" ? 415 : error.code === "BODY_TOO_LARGE" ? 413 : error.code === "NETWORK_UNAVAILABLE" ? 503 : 400;
  return { status, code: error.code, message: error.message.length <= 300 ? error.message : "Product Session Gateway HTTP request was rejected" };
}
function response3(status, requestId, payload) {
  return Object.freeze({ status, headers: Object.freeze({ "cache-control": "no-store", "content-type": "application/json; charset=utf-8", "x-request-id": requestId }), body: canonicalJSON({ ...payload, requestId, schemaVersion: PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION }) });
}
function requestIdValue(value) {
  if (!validRequestId(value)) fail31("INVALID_REQUEST_ID", "Product Session Gateway request ID is invalid");
  return value;
}
function validRequestId(value) {
  return typeof value === "string" && /^req_[A-Za-z0-9_-]{12,80}$/.test(value);
}
function fail31(code, message) {
  throw new WalletAuthError(code, message);
}

// packages/wallet-auth/src/product-session-browser.js
var BROWSER_PRODUCT_SESSION_SECURITY_LEVEL = "webcrypto-nonextractable";
var DATABASE = "ynx-product-session-web-v2";
var DEVICE_STORE = "devices";
var STATE_STORE = "state";
async function createBrowserProductSessionClient(config) {
  const { registry, productId, scopes: scopes3, purpose, gateway: gateway2, environment = globalThis, clock: clock2 = () => /* @__PURE__ */ new Date() } = config ?? {};
  if (!config || Object.keys(config).some((key) => !["registry", "productId", "scopes", "purpose", "gateway", "environment", "clock"].includes(key))) fail32("INVALID_DEVICE", "Browser Product Session configuration is invalid");
  const binding2 = productPlatformBinding(registry, productId, "web");
  const authority = productSessionGatewayAuthority(gateway2);
  if (environment?.isSecureContext !== true || environment.location?.origin !== binding2.origin) fail32("ORIGIN_NOT_ALLOWED", "Browser Product Sessions require the registered product HTTPS origin");
  const crypto = environment.crypto;
  if (!crypto?.subtle || typeof crypto.getRandomValues !== "function" || typeof environment.indexedDB?.open !== "function") fail32("INSECURE_STORAGE", "This browser cannot persist a non-extractable WebCrypto device key");
  validateScopes(scopes3, binding2.scopes);
  if (typeof purpose !== "string" || purpose.length < 1 || purpose.length > 180 || purpose.trim() !== purpose || typeof clock2 !== "function") fail32("INVALID_DEVICE", "Browser Product Session purpose or clock is invalid");
  const approvedScopes = Object.freeze([...scopes3]);
  const namespace = canonicalJSON({ authority, chainId: binding2.chainId, productId, clientId: binding2.clientId, applicationId: binding2.applicationId, origin: binding2.origin, callback: binding2.callback, scopes: approvedScopes });
  const storageKey = `ynx.product-session.v2:${productId}:web:${binding2.applicationId}`;
  const revocationKey = `${storageKey}:revoke`;
  const allowedKeys = /* @__PURE__ */ new Set([storageKey, `${storageKey}:pending`, `${storageKey}:return`, `${storageKey}:completion`, revocationKey]);
  const randomToken = () => encodeBase64url(crypto.getRandomValues(new Uint8Array(32)));
  const db = await openDatabase(environment.indexedDB);
  let closed = false, revocationAttempted = false;
  const close = () => {
    closed = true;
    db.close();
  };
  db.onversionchange = close;
  try {
    let assertStorageKey = function(key) {
      if (!allowedKeys.has(key)) fail32("CROSS_PRODUCT_SESSION", "Browser storage key is outside this product binding");
    }, assertStoredValue = function(key, value) {
      if (typeof value !== "string" || value.length > 16384) fail32("INSECURE_STORAGE", "Browser Product Session storage value is invalid");
      if (key === `${storageKey}:return`) return;
      if (key === revocationKey) {
        parseRevocationIntent(value, binding2, device2);
        return;
      }
      let input;
      try {
        input = JSON.parse(value);
      } catch {
        fail32("INVALID_SESSION_STORE", "Browser Product Session storage is invalid JSON");
      }
      if (key === `${storageKey}:completion`) input = parseCompletionRecord(registry, value, new Date(input.completion?.challenge?.issuedAt)).request;
      if (key === storageKey) input = parseProductSession(input);
      for (const field of ["chainId", "productId", "clientId", "applicationId", "origin", "callback"]) if (input?.[field] !== binding2[field]) fail32("CROSS_PRODUCT_SESSION", "Stored browser session crosses its registered product binding");
      if (input.platform !== "web" || input.bundleId !== null || input.packageId !== null || input.deviceId !== record2.deviceId || input.deviceKey !== record2.deviceKey) fail32("DEVICE_CHANGED", "Stored browser session does not match this device key");
      if (canonicalJSON(input.scopes) !== canonicalJSON(approvedScopes)) fail32("SCOPE_WIDENING", "Stored browser session does not match this scope binding");
    }, readIntent = function(state2) {
      const raw = state2.values[revocationKey] ?? null;
      return raw === null ? null : parseRevocationIntent(raw, binding2, device2);
    }, stateOperation = function(mode, callback2) {
      if (closed || environment.location?.origin !== binding2.origin) fail32("INSECURE_STORAGE", "Browser Product Session storage is no longer available at this origin");
      return transact(db, mode, namespace, (context) => {
        assertRecord(context.device, context.state, namespace, allowedKeys, authority);
        if (context.device.deviceId !== record2.deviceId || context.device.deviceKey !== record2.deviceKey) fail32("DEVICE_CHANGED", "Persisted browser device changed; start a new explicit connection");
        return callback2(context);
      });
    }, currentRecord = function() {
      return stateOperation("readonly", ({ device: device3 }) => device3);
    }, signingRecord = function(subject, purpose2) {
      return stateOperation("readonly", ({ device: current, state: state2 }) => {
        const pending = readIntent(state2);
        if (pending || revocationAttempted) {
          const target2 = pending?.session;
          if (purpose2 !== "http-proof" || subject.path !== "/v2/product-sessions/revoke" || subject.method !== "POST" || subject.bodyDigest !== httpBodyDigest("{}") || !target2 || subject.sessionBinding !== target2.sessionBinding || subject.account !== target2.account) fail32("REVOCATION_PENDING", "Pending sign-out permits only the exact target revocation proof");
        } else if (purpose2 === "http-proof") {
          const raw = state2.values[storageKey], session = raw ? parseProductSession(JSON.parse(raw)) : null;
          if (!session || subject.sessionBinding !== session.sessionBinding || subject.account !== session.account) fail32("SESSION_INACTIVE", "Stored Product Session changed before signing");
        }
        return current;
      });
    };
    let record2 = await transact(db, "readonly", namespace, ({ device: device3, state: state2 }) => {
      if (device3 === void 0 && state2 === void 0) return null;
      assertRecord(device3, state2, namespace, allowedKeys, authority);
      return device3;
    });
    if (record2 === null) {
      let pair;
      try {
        pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      } catch {
        fail32("INSECURE_STORAGE", "Browser WebCrypto device key generation failed");
      }
      const candidate2 = { version: 2, authority, namespace, deviceId: `web_${randomToken()}`, deviceKey: await publicDeviceKey(crypto, pair.publicKey), privateKey: pair.privateKey, publicKey: pair.publicKey };
      record2 = await transact(db, "readwrite", namespace, ({ device: device3, state: state2, devices, states }) => {
        if (device3 !== void 0 || state2 !== void 0) {
          assertRecord(device3, state2, namespace, allowedKeys, authority);
          return device3;
        }
        const initial = { version: 2, authority, deviceId: candidate2.deviceId, deviceKey: candidate2.deviceKey, values: {} };
        assertRecord(candidate2, initial, namespace, allowedKeys, authority);
        devices.add(candidate2, namespace);
        states.add(initial, namespace);
        return candidate2;
      });
    }
    const persisted = await currentRecord();
    await verifyKeyPair(crypto, persisted);
    const device2 = Object.freeze({ id: record2.deviceId, key: record2.deviceKey, scopes: approvedScopes, purpose, sign });
    const storage = Object.freeze({
      securityLevel: BROWSER_PRODUCT_SESSION_SECURITY_LEVEL,
      async get(key) {
        assertStorageKey(key);
        return stateOperation("readonly", ({ state: state2 }) => {
          const value = state2.values[key] ?? null;
          if (value !== null) assertStoredValue(key, value);
          return value;
        });
      },
      async set(key, value) {
        assertStorageKey(key);
        assertStoredValue(key, value);
        return stateOperation("readwrite", ({ state: state2, states }) => {
          const pending = readIntent(state2);
          if (pending && key !== revocationKey) {
            if (key !== storageKey) fail32("REVOCATION_PENDING", "Sign-out blocks new connection requests");
            const session = parseProductSession(JSON.parse(value));
            if (pending.session !== null && !revocationSessionMatches(value, pending.session)) fail32("REVOCATION_PENDING", "Sign-out target cannot be replaced by another session");
            if (pending.session === null) state2.values[revocationKey] = canonicalJSON(createRevocationIntent(binding2, device2, pending.intentId, session));
          }
          state2.values[key] = value;
          states.put(state2, namespace);
        });
      },
      async remove(key) {
        assertStorageKey(key);
        return stateOperation("readwrite", ({ state: state2, states }) => {
          delete state2.values[key];
          states.put(state2, namespace);
        });
      },
      async saveRevocationIntent(key, raw) {
        if (key !== revocationKey) fail32("CROSS_PRODUCT_SESSION", "Sign-out intent key is invalid");
        revocationAttempted = true;
        const candidate2 = parseRevocationIntent(raw, binding2, device2);
        return stateOperation("readwrite", ({ state: state2, states }) => {
          let intent = readIntent(state2);
          if (intent === null) intent = candidate2;
          else if (intent.intentId === candidate2.intentId && intent.session === null && candidate2.session !== null) intent = candidate2;
          if (intent.session === null && state2.values[storageKey]) intent = createRevocationIntent(binding2, device2, intent.intentId, parseProductSession(JSON.parse(state2.values[storageKey])));
          const value = canonicalJSON(intent);
          state2.values[revocationKey] = value;
          states.put(state2, namespace);
          return value;
        });
      },
      async finishRevocationIntent(key, raw) {
        if (key !== revocationKey) fail32("CROSS_PRODUCT_SESSION", "Sign-out intent key is invalid");
        const intent = parseRevocationIntent(raw, binding2, device2);
        await stateOperation("readwrite", ({ state: state2, states }) => {
          if (state2.values[revocationKey] !== raw) fail32("REVOCATION_CHANGED", "Sign-out target changed before secure cleanup");
          const current = state2.values[storageKey] ?? null;
          if (revocationSessionMatches(current, intent.session)) delete state2.values[storageKey];
          if (current === null || revocationSessionMatches(current, intent.session)) {
            delete state2.values[`${storageKey}:pending`];
            delete state2.values[`${storageKey}:return`];
            delete state2.values[`${storageKey}:completion`];
          }
          delete state2.values[revocationKey];
          states.put(state2, namespace);
        });
        revocationAttempted = false;
      }
    });
    const client = new RecoverableProductSessionClient({ registry, productId, platform: "web", storage, gateway: gateway2, device: device2, tokenFactory: randomToken, clock: clock2 });
    const capabilities = Object.freeze({ securityLevel: BROWSER_PRODUCT_SESSION_SECURITY_LEVEL, privateKeyExtractable: false, persistedCryptoKey: true, osProtected: false, hardwareBacked: false, origin: binding2.origin, productId, scopes: approvedScopes });
    return Object.freeze({ client, device: device2, storage, capabilities, createIntrospectionProof, close });
    async function sign(input) {
      exactFields(input, ["purpose", "algorithm", "deviceKey", "payload"], "Browser device signing request");
      if (!["challenge", "http-proof"].includes(input.purpose) || input.algorithm !== "p256-sha256" || input.deviceKey !== record2.deviceKey || typeof input.payload !== "string" || input.payload.length > 16384) fail32("INVALID_DEVICE_PROOF", "Browser device signing request does not match this key");
      const payload = decodeBase64url(input.payload, "browser signing payload");
      const prefix = input.purpose === "challenge" ? "YNX_PRODUCT_SESSION_CHALLENGE_V2\n" : "YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n";
      const text8 = new TextDecoder("utf-8", { fatal: true }).decode(payload);
      if (!text8.startsWith(prefix)) fail32("INVALID_DEVICE_PROOF", "Browser device signing purpose does not match its payload");
      let subject;
      try {
        subject = JSON.parse(text8.slice(prefix.length));
      } catch {
        fail32("INVALID_DEVICE_PROOF", "Browser device signing payload is invalid");
      }
      for (const field of ["productId", "clientId", "applicationId", "origin", "callback"]) if (subject[field] !== binding2[field]) fail32("CROSS_PRODUCT_SESSION", "Browser signer cannot sign for another product binding");
      if (subject.deviceId !== record2.deviceId || subject.deviceKey !== record2.deviceKey || subject.bundleId !== null || subject.packageId !== null) fail32("DEVICE_CHANGED", "Browser signing payload does not match this device");
      if (input.purpose === "challenge" && (subject.platform !== "web" || canonicalJSON(subject.scopes) !== canonicalJSON(approvedScopes))) fail32("SCOPE_WIDENING", "Browser challenge crosses the configured scope binding");
      const active2 = await signingRecord(subject, input.purpose);
      let signature;
      try {
        signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, active2.privateKey, payload));
        if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, active2.publicKey, signature, payload)) fail32("DEVICE_CHANGED", "Browser device key pair no longer matches");
      } catch (error) {
        if (error instanceof WalletAuthError) throw error;
        fail32("DEVICE_SIGNING_FAILED", "Browser device signing failed");
      }
      await signingRecord(subject, input.purpose);
      return encodeBase64url(p1363ToDER(signature));
    }
    async function assertAPIActive(expected) {
      if (client.current !== expected) fail32("SESSION_INACTIVE", "Product Session changed during API authorization");
      await stateOperation("readonly", ({ state: state2 }) => {
        if (readIntent(state2) !== null || revocationAttempted || !revocationSessionMatches(state2.values[storageKey] ?? null, expected.session)) fail32("SESSION_INACTIVE", "Pending sign-out or a changed stored session blocks API authorization");
      });
    }
    async function createIntrospectionProof(requiredScopes2) {
      const count = Array.isArray(requiredScopes2) ? requiredScopes2.length : 0;
      if (!Number.isInteger(count) || count < 1 || count > 8) fail32("SCOPE_WIDENING", "Browser Product Session scopes must be an exact sorted registered subset");
      const selectedScopes = Object.freeze(Array.from({ length: count }, (_, index) => requiredScopes2[index]));
      validateScopes(selectedScopes, approvedScopes);
      const state2 = client.current;
      if (state2.status !== "connected" || !state2.session) fail32("SESSION_INACTIVE", "Connect and verify a Product Session before signing an API proof");
      await assertAPIActive(state2);
      const session = state2.session;
      const now = typeof gateway2.currentTime === "function" ? await gateway2.currentTime({ requestId: `req_web_t_${randomToken()}` }) : clock2();
      if (client.current !== state2) fail32("SESSION_INACTIVE", "Product Session changed while reading authority time");
      await assertAPIActive(state2);
      if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(session.expiresAt) <= now.getTime()) fail32("SESSION_EXPIRED", "Product Session expired before API authorization");
      const body = canonicalJSON({ requiredScopes: selectedScopes });
      const proof = await createProductSessionProofV2With(session, { method: "POST", path: "/v2/product-sessions/introspect", bodyDigest: httpBodyDigest(body), nonce: randomToken(), issuedAt: now.toISOString(), expiresAt: new Date(Math.min(now.getTime() + 3e4, Date.parse(session.expiresAt))).toISOString() }, sign);
      if (client.current !== state2) fail32("SESSION_INACTIVE", "Product Session changed during API proof signing");
      await assertAPIActive(state2);
      return Object.freeze({ proof, proofHeader: encodeProductSessionGatewayProofHeaderV2(proof), requestId: `req_web_${randomToken()}`, body });
    }
  } catch (error) {
    close();
    throw error;
  }
}
function assertRecord(device2, state2, namespace, allowedKeys, authority) {
  if (!device2 || !state2) fail32("DEVICE_CHANGED", "Browser device or session storage is missing; automatic key replacement is forbidden");
  exactFields(device2, ["version", "authority", "namespace", "deviceId", "deviceKey", "privateKey", "publicKey"], "Persisted browser device");
  exactFields(state2, ["version", "authority", "deviceId", "deviceKey", "values"], "Persisted browser session state");
  if (device2.version !== 2 || device2.authority !== authority || state2.authority !== authority || device2.namespace !== namespace || !/^web_[A-Za-z0-9_-]{43}$/.test(device2.deviceId) || !/^[A-Za-z0-9_-]{44}$/.test(device2.deviceKey) || state2.version !== 2 || state2.deviceId !== device2.deviceId || state2.deviceKey !== device2.deviceKey) fail32("DEVICE_CHANGED", "Persisted browser device binding is invalid");
  for (const [key, type, usage] of [[device2.privateKey, "private", "sign"], [device2.publicKey, "public", "verify"]]) {
    if (!key || key.type !== type || key.algorithm?.name !== "ECDSA" || key.algorithm.namedCurve !== "P-256" || key.usages?.length !== 1 || key.usages[0] !== usage || type === "private" && key.extractable !== false) fail32("INSECURE_STORAGE", "Persisted browser key must be a non-extractable P-256 signing key");
  }
  if (!state2.values || typeof state2.values !== "object" || Array.isArray(state2.values) || Object.keys(state2.values).some((key) => !allowedKeys.has(key) || typeof state2.values[key] !== "string" || state2.values[key].length > 16384)) fail32("INVALID_SESSION_STORE", "Persisted browser session state crosses its storage binding");
}
async function publicDeviceKey(crypto, key) {
  let raw;
  try {
    raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  } catch {
    fail32("INSECURE_STORAGE", "Browser device public key cannot be verified");
  }
  if (raw.length !== 65 || raw[0] !== 4) fail32("INVALID_DEVICE_KEY", "Browser P-256 public key encoding is invalid");
  return encodeBase64url(Uint8Array.of(2 | raw[64] & 1, ...raw.slice(1, 33)));
}
async function verifyKeyPair(crypto, record2) {
  if (await publicDeviceKey(crypto, record2.publicKey) !== record2.deviceKey) fail32("DEVICE_CHANGED", "Persisted browser public key does not match its device binding");
  const payload = crypto.getRandomValues(new Uint8Array(32));
  try {
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, record2.privateKey, payload);
    if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, record2.publicKey, signature, payload)) fail32("DEVICE_CHANGED", "Persisted browser private and public keys do not match");
  } catch (error) {
    if (error instanceof WalletAuthError) throw error;
    fail32("INSECURE_STORAGE", "Persisted browser CryptoKey cannot sign after restoration");
  }
}
function p1363ToDER(signature) {
  if (signature.length !== 64) fail32("INVALID_DEVICE_PROOF", "Browser ECDSA signature must use P-256 IEEE P1363 encoding");
  const integer = (bytes) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const value = bytes.slice(start);
    return value[0] & 128 ? Uint8Array.of(0, ...value) : value;
  };
  const r = integer(signature.slice(0, 32)), s = integer(signature.slice(32));
  return Uint8Array.of(48, r.length + s.length + 4, 2, r.length, ...r, 2, s.length, ...s);
}
function validateScopes(scopes3, allowed) {
  if (!Array.isArray(scopes3) || scopes3.length < 1 || scopes3.length > 8 || scopes3.some((scope2) => typeof scope2 !== "string" || !allowed.includes(scope2)) || new Set(scopes3).size !== scopes3.length || [...scopes3].sort().join("\n") !== scopes3.join("\n")) fail32("SCOPE_WIDENING", "Browser Product Session scopes must be an exact sorted registered subset");
}
function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    let settled = false, request;
    const rejected = () => {
      settled = true;
      reject(new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device storage is unavailable"));
    };
    try {
      request = indexedDB.open(DATABASE, 1);
    } catch {
      rejected();
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [DEVICE_STORE, STATE_STORE]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onerror = rejected;
    request.onblocked = rejected;
    request.onsuccess = () => {
      if (settled) request.result.close();
      else {
        settled = true;
        resolve(request.result);
      }
    };
  });
}
function transact(db, mode, namespace, operation) {
  return new Promise((resolve, reject) => {
    let transaction, result, caught;
    try {
      transaction = db.transaction([DEVICE_STORE, STATE_STORE], mode);
      const devices = transaction.objectStore(DEVICE_STORE), states = transaction.objectStore(STATE_STORE);
      const deviceRequest = devices.get(namespace), stateRequest = states.get(namespace);
      let received = 0;
      const ready = () => {
        if (++received !== 2) return;
        try {
          result = operation({ device: deviceRequest.result, state: stateRequest.result, devices, states });
        } catch (error) {
          caught = error;
          transaction.abort();
        }
      };
      deviceRequest.onsuccess = ready;
      stateRequest.onsuccess = ready;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(caught ?? new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device transaction failed"));
    } catch {
      reject(new WalletAuthError("INSECURE_STORAGE", "Browser IndexedDB device transaction is unavailable"));
    }
  });
}
function fail32(code, message) {
  throw new WalletAuthError(code, message);
}
export {
  APPLICATION_ACTION_CHAIN_ID,
  APPLICATION_ACTION_DOMAIN,
  APPLICATION_ACTION_FEE_YNXT,
  BROWSER_PRODUCT_SESSION_SECURITY_LEVEL,
  CANONICAL_GATEWAY_ADAPTER_SCHEMA_VERSION,
  CANONICAL_GATEWAY_HTTP_MAX_BODY_BYTES,
  CANONICAL_GATEWAY_HTTP_SCHEMA_VERSION,
  CARD_APPLICATION_APPROVAL_DOMAIN,
  CENTRAL_PRODUCT_SCHEMA_VERSION,
  CENTRAL_REGISTRY_DOCUMENT_VERSION,
  CENTRAL_REGISTRY_PRODUCT_COUNT,
  CENTRAL_REGISTRY_SCHEMA_VERSION,
  CENTRAL_VERIFIER_VERSION,
  CENTRAL_WALLET_SESSION_INVENTORY_SCHEMA_VERSION,
  CENTRAL_WALLET_SESSION_STORE_SCHEMA_VERSION,
  CLIENT_LIFECYCLE_ACTIVE,
  CanonicalWalletGatewayAdapter,
  CanonicalWalletGatewayHttpKernel,
  CentralWalletSessionStore,
  ClientRetiredError,
  EIP1193_PROVIDER_CODE,
  ERC7769BundlerClient,
  ERC_7769_VERSION,
  Eip1193ProviderError,
  MAX_REQUEST_LIFETIME_MS,
  METAMASK_EVM_CHAIN,
  METAMASK_EVM_CHAIN_ID,
  METAMASK_EVM_CHAIN_QUANTITY,
  METAMASK_EVM_CONNECTION_STATUS,
  MetaMaskEvmConnectionAdapter,
  NATIVE_TRANSACTION_CHAIN_ID,
  NATIVE_TRANSACTION_DOMAIN,
  NATIVE_TRANSACTION_FEE_YNXT,
  OneTimeNonceStore,
  PRODUCT_DEVICE_ALGORITHM,
  PRODUCT_SESSION_AUTHORITY_SCHEMA_VERSION,
  PRODUCT_SESSION_CLIENT_STATE,
  PRODUCT_SESSION_GATEWAY_HTTP_MAX_BODY_BYTES,
  PRODUCT_SESSION_GATEWAY_PROOF_HEADER_V2,
  PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION,
  PRODUCT_SESSION_PLATFORMS,
  PRODUCT_SESSION_PROTOCOL_VERSION,
  PRODUCT_SESSION_REGISTRY_VERSION,
  ProductSessionAuthority,
  ProductSessionGatewayFetchAdapter,
  ProductSessionGatewayHttpHandler,
  ProductSessionGatewayKernel,
  ProductSessionServerAuthorizer,
  RecoverableProductSessionClient,
  SMART_ACCOUNT_CHAIN_ID,
  SMART_ACCOUNT_SCHEMA_VERSION,
  STANDARD_WALLET_METHODS,
  STRATEGY_ACTION_SCHEMA_VERSION,
  STRATEGY_MANDATE_SCHEMA_VERSION,
  STRATEGY_MANDATE_STORE_SCHEMA_VERSION,
  StandardWalletConnection,
  StrategyMandateStore,
  WALLET_AUTH_VERSION,
  WALLET_CONNECTION_COORDINATOR_STATUS,
  WALLET_DOWNLOAD_MANIFEST_SCHEMA_VERSION,
  WALLET_PRODUCT_MIGRATION_PLATFORMS,
  WALLET_PRODUCT_MIGRATION_PRODUCTS,
  WALLET_PRODUCT_MIGRATION_SCENARIOS,
  WALLET_PRODUCT_MIGRATION_SCHEMA_VERSION,
  WALLET_PROVIDER_DISCOVERY_AUTHORITY,
  WALLET_PROVIDER_KIND,
  WALLET_ROUTE_STATUS,
  WALLET_SESSION_CONTROL_AUDIENCE,
  WALLET_SESSION_CONTROL_INTENT_PATHS,
  WALLET_SESSION_CONTROL_PATHS,
  WALLET_SESSION_CONTROL_PROOF_HEADER,
  WALLET_SESSION_CONTROL_REPLAY_PREFIX,
  WalletAuthError,
  WalletConnectionCoordinator,
  YNX_EVM_CHAIN_ID,
  YNX_NATIVE_CHAIN_ID,
  YNX_TESTNET_CHAIN_QUANTITY,
  applicationActionHash,
  applicationActionPayloadHash,
  applicationActionRequestDigest,
  applicationActionSignJSON,
  applyClientRetirementToGatewaySnapshot,
  approvalSignBytes,
  assertCentralWalletSessionActive,
  assertClientLifecycleActive,
  assertClientReturnTargetActive,
  assertSessionClientActive,
  assertSignedIntentActive,
  authorizeStrategyAction,
  canonicalJSON,
  canonicalReturnTarget,
  cardApplicationApprovalId,
  cardApplicationApprovalRequestDigest,
  cardApplicationDetailsHash,
  centralApprovalDigest,
  centralDeviceBinding,
  centralProtocolEntry,
  centralRegisteredWebOrigins,
  centralRegistrationByProduct,
  clientRetirementRecord,
  createApplicationActionRequest,
  createApplicationActionReturnURL,
  createApprovalPayload,
  createBrowserProductSessionClient,
  createCallbackURL,
  createCardApplicationApprovalRequest,
  createCardApplicationApprovalReturnURL,
  createGatewayChallenge,
  createProductSessionChallenge,
  createProductSessionProof,
  createProductSessionProofV2,
  createProductSessionProofV2With,
  createProductSessionRequest,
  createProductSessionReturnURL,
  createSignedApplicationAction,
  createSignedCardApplicationApproval,
  createSignedIntent,
  createSignedNativeTransfer,
  createWalletSessionControlProof,
  credentialCandidateDigest,
  decodeBase64url,
  decodeProductSessionGatewayProofHeaderV2,
  decodeWalletSessionControlProofHeader,
  deviceBinding,
  digestHex,
  discoverEip6963WalletProviders,
  discoverInjectedWalletProviders,
  discoverWalletProviders,
  encodeApplicationActionWalletURL,
  encodeBase64url,
  encodeCardApplicationApprovalWalletURL,
  encodeProductSessionGatewayProofHeaderV2,
  encodeProductSessionWalletURL,
  encodeRequestDeepLink,
  encodeWalletSessionControlProofHeader,
  evaluateSponsorship,
  evmAddressFromYNX,
  exactFields,
  exportSignedIntent,
  gatewayChallengeSignBytes,
  gatewayStateDigest,
  httpBodyDigest,
  isPlainObject,
  migrateCentralRegistryDocumentV1,
  migrateCentralRegistryEntry,
  migrateLegacyCallback,
  migrateLegacyProductSessionRequest,
  migrateProductSessionGatewaySnapshotV1,
  migrateProductSessionRegistryV1,
  nativeTransferHash,
  nativeTransferSignJSON,
  parseApplicationActionRequest,
  parseApplicationActionReturnURL,
  parseApplicationActionWalletURL,
  parseAuthorizationRequest,
  parseAuthorizationResponse,
  parseCallbackURL,
  parseCapitalProductReview,
  parseCardApplicationApprovalRequest,
  parseCardApplicationApprovalReturnURL,
  parseCardApplicationApprovalWalletURL,
  parseCentralProductRegistration,
  parseCentralRegistryDocument,
  parseCentralRegistryEntry,
  parseCentralWalletSession,
  parseCentralWalletStoreSnapshot,
  parseClientLifecycle,
  parseClientRetirementRecord,
  parseCredentialCandidate,
  parseGatewayAdapterSnapshot,
  parseGatewayChallenge,
  parsePackedUserOperation,
  parseProductSession,
  parseProductSessionApproval,
  parseProductSessionAuthoritySnapshot,
  parseProductSessionChallenge,
  parseProductSessionGatewaySnapshot,
  parseProductSessionProof,
  parseProductSessionProofV2,
  parseProductSessionRegistry,
  parseProductSessionRequest,
  parseProductSessionReturnURL,
  parseProductSessionWalletURL,
  parseSignedApplicationAction,
  parseSignedCardApplicationApproval,
  parseSignedIntent,
  parseSignedNativeTransfer,
  parseSponsorshipPolicy,
  parseSponsorshipRequest,
  parseStrategyAction,
  parseStrategyMandate,
  parseStrategyMandateStoreSnapshot,
  parseUserOperationEnvelope,
  parseWalletDeepLink,
  parseWalletDownloadManifest,
  parseWalletProductMigrationMatrix,
  parseWalletSessionControlProof,
  prepareWalletAttempt,
  prepareWalletOpen,
  productPlatformBinding,
  productSessionApprovalDigest,
  productSessionProofDigest,
  productSessionProofSignBytes,
  productSessionProofV2Digest,
  productSessionProofV2SignBytes,
  productSessionRequestDigest,
  registryParserBinding,
  requestDigest,
  retirementMatchesAuthorization,
  retirementMatchesSession,
  retirementRecord,
  selectWalletDownload,
  selectWalletProviderCandidates,
  signAuthorization,
  signGatewayChallenge,
  signProductSessionApproval,
  signProductSessionChallenge,
  signProductSessionChallengeWith,
  signedIntentDigest,
  strategyActionNonceKey,
  strategyMandateDigest,
  unsignedApproval,
  userOperationDigest,
  verifyAuthorization,
  verifyCentralWalletSession,
  verifyGatewayCompletion,
  verifyProductSessionProof,
  verifyProductSessionProofV2,
  verifySignedApplicationAction,
  verifySignedCardApplicationApproval,
  verifyWalletSessionControlProof,
  walletAvailabilityFromDiscovery,
  walletConnectionChoices,
  walletIdentity,
  walletIdentityFromPublicKey,
  walletProductMigrationSummary,
  walletSessionControlReplayExpiry,
  walletSessionControlReplayKey,
  ynxAddressFromEVM
};
/*! Bundled license information:

@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/weierstrass.js:
@noble/curves/nist.js:
@noble/curves/secp256k1.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
