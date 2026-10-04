// node_modules/@noble/hashes/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
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
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
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
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    clean(this.buffer.subarray(pos));
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer[i] = 0;
    view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
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

// src/localContentDisplay.ts
var CONTENT_CATEGORIES = ["gore", "explicit_violence", "sexual_content"];
var DEFAULT_CONTENT_FILTER = Object.freeze({
  enabled: false,
  thresholds: Object.freeze({ gore: 0.7, explicit_violence: 0.7, sexual_content: 0.7 })
});
function checkedScores(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid device classification result");
  }
  const source = value;
  const scores = {};
  for (const category of CONTENT_CATEGORIES) {
    const score = source[category];
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error("Invalid device classification score");
    }
    scores[category] = score;
  }
  return Object.freeze(scores);
}
function preferences(value) {
  if (typeof value.enabled !== "boolean" || CONTENT_CATEGORIES.some((category) => !Number.isFinite(value.thresholds[category]) || value.thresholds[category] <= 0 || value.thresholds[category] > 1)) {
    throw new Error("Invalid local content filter preferences");
  }
  return Object.freeze({ enabled: value.enabled, thresholds: Object.freeze({ ...value.thresholds }) });
}
var LocalContentDisplay = class {
  constructor(classifier, limits = { maxConcurrent: 2, maxBytes: 8 * 1024 * 1024, timeoutMs: 1e4 }) {
    this.classifier = classifier;
    this.limits = limits;
    if (![limits.maxConcurrent, limits.maxBytes, limits.timeoutMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new Error("Invalid local content filter limits");
    }
    this.limits = Object.freeze({ ...limits });
    this.mimeTypes = new Set(classifier?.supportedMimeTypes ?? []);
  }
  classifier;
  limits;
  settings = DEFAULT_CONTENT_FILTER;
  revision = 0;
  active = /* @__PURE__ */ new Map();
  decisions = /* @__PURE__ */ new Map();
  mimeTypes;
  configure(value) {
    const next = preferences(value);
    ++this.revision;
    this.settings = next;
    this.decisions.clear();
    for (const pending of this.active.values()) {
      pending.abort.abort();
      pending.stop();
    }
    this.active.clear();
  }
  /** Synchronous initial decision lets consumers withhold the original before
   * awaiting inference. Never render an enabled original based on a pending job.
   */
  begin(contentId, original, mimeType) {
    if (!contentId || contentId.length > 512) throw new Error("Invalid display content identity");
    const revision = this.revision;
    const decide = (status, reason, flagged = []) => Object.freeze({ contentId, revision, status, ...reason ? { reason } : {}, flagged: Object.freeze([...flagged]) });
    const immediate = (decision) => Object.freeze({
      initial: decision,
      completed: Promise.resolve(decision),
      cancel: () => {
      }
    });
    const previous = this.active.get(contentId);
    if (previous) {
      previous.abort.abort();
      previous.stop();
      this.active.delete(contentId);
    }
    this.decisions.delete(contentId);
    if (!this.settings.enabled) return immediate(decide("disabled"));
    if (!this.classifier) return immediate(decide("unavailable", "model_unavailable"));
    if (!this.mimeTypes.has(mimeType)) return immediate(decide("unavailable", "unsupported"));
    if (!original.byteLength || original.byteLength > this.limits.maxBytes || this.active.size >= this.limits.maxConcurrent) {
      return immediate(decide("unavailable", "resource_limit"));
    }
    const bytes = original.slice();
    const digest = bytesToHex(sha256(bytes));
    const abort = new AbortController();
    const initial = decide("pending");
    const thresholds = this.settings.thresholds;
    let stop = () => {
    };
    const stopped = new Promise((resolve) => {
      stop = () => resolve("cancelled");
    });
    const pending = { abort, stop };
    this.active.set(contentId, pending);
    this.decisions.set(contentId, { digest, decision: initial });
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve("timeout");
      }, this.limits.timeoutMs);
    });
    const classification = Promise.resolve().then(() => {
      if (abort.signal.aborted) return "cancelled";
      return this.classifier.classify(bytes, mimeType, abort.signal);
    }).catch(() => "classification_failed");
    const completed = Promise.race([classification, stopped, timeout]).then((result) => {
      let decision;
      if (revision !== this.revision || this.active.get(contentId) !== pending) {
        decision = decide("unavailable", "stale");
      } else if (typeof result === "string") {
        decision = decide("unavailable", result);
      } else if (abort.signal.aborted) {
        decision = decide("unavailable", "cancelled");
      } else {
        try {
          const scores = checkedScores(result);
          const flagged = CONTENT_CATEGORIES.filter((category) => scores[category] >= thresholds[category]);
          decision = decide(flagged.length ? "folded" : "clear", void 0, flagged);
        } catch {
          decision = decide("unavailable", "classification_failed");
        }
      }
      if (timer !== void 0) clearTimeout(timer);
      if (this.active.get(contentId) === pending) {
        this.active.delete(contentId);
        this.decisions.set(contentId, { digest, decision });
      }
      bytes.fill(0);
      return decision;
    });
    return Object.freeze({ initial, completed, cancel: () => {
      abort.abort();
      stop();
    } });
  }
  /** Mandatory final render fence. All previews/notifications/search consumers
   * must use it with the original bytes, not just trust a fulfilled Promise.
   * Permission/legality checks remain the caller's responsibility; this gate
   * cannot authorize content and offers no bypass of service rules.
   */
  canDisplay(contentId, original, decision) {
    if (decision.contentId !== contentId || decision.revision !== this.revision) return false;
    if (!this.settings.enabled) return decision.status === "disabled";
    if (decision.status !== "clear") return false;
    const record = this.decisions.get(contentId);
    return record?.decision === decision && record.digest === bytesToHex(sha256(original));
  }
  dispose() {
    this.configure({ ...this.settings, enabled: false });
  }
};

// web/matrix/local-filter-ui.mjs
var preferenceKey = "ynx.social.local-content-filter.enabled.v1";
function mountLocalContentFilter({ root, settingsContainer, onChanged = () => {
}, classifier, storage }) {
  const document = root.ownerDocument, zh = document.documentElement?.lang?.startsWith("zh");
  const text = zh ? {
    title: "\u5185\u5BB9\u4E0E\u9690\u79C1",
    toggle: "\u5F00\u542F AI \u5185\u5BB9\u5BA1\u67E5\uFF08\u672C\u5730\u8FC7\u6EE4\uFF09",
    off: "\u672C\u8BBE\u5907\u8FC7\u6EE4\u5DF2\u5173\u95ED\u3002",
    unavailable: "\u672C\u5730\u6A21\u578B\u672A\u5B89\u88C5\u6216\u4E0D\u53EF\u7528\u3002\u5F00\u542F\u8FC7\u6EE4\u65F6\uFF0C\u672A\u7ECF\u68C0\u6D4B\u7684\u5185\u5BB9\u4FDD\u6301\u9690\u85CF\u3002",
    pending: "\u6B63\u5728\u672C\u8BBE\u5907\u68C0\u67E5\u5185\u5BB9\u2026",
    folded: "\u5185\u5BB9\u5DF2\u6298\u53E0\u3002\u81EA\u52A8\u5224\u65AD\u53EF\u80FD\u51FA\u9519\u3002",
    hidden: "\u5185\u5BB9\u672A\u68C0\u6D4B\uFF0C\u5DF2\u9690\u85CF\u3002",
    attachment: "\u672A\u68C0\u6D4B\u9644\u4EF6\u4E0D\u80FD\u5728\u8FC7\u6EE4\u5F00\u542F\u65F6\u4E0B\u8F7D\u3002\u5173\u95ED\u8FC7\u6EE4\u540E\u53EF\u6309\u539F\u6743\u9650\u6D41\u7A0B\u91CD\u8BD5\u3002"
  } : {
    title: "Content and privacy",
    toggle: "Enable AI content review (local filtering)",
    off: "Local filtering is off on this device.",
    unavailable: "Local model unavailable. Unchecked content stays hidden while filtering is on.",
    pending: "Checking content on this device\u2026",
    folded: "Content folded. Automatic judgments can be wrong.",
    hidden: "Unchecked content hidden.",
    attachment: "Unchecked attachments are unavailable while filtering is on. Turn filtering off to retry through the original permission flow."
  };
  let enabled = false;
  try {
    storage ??= document.defaultView?.localStorage;
    enabled = storage?.getItem(preferenceKey) === "true";
  } catch {
  }
  const gates = new Map(["messages", "moments"].map((scope) => [scope, new LocalContentDisplay(classifier)])), jobs = /* @__PURE__ */ new Map(), nodes = /* @__PURE__ */ new Map();
  const settings = document.createElement("fieldset"), legend = document.createElement("legend"), label = document.createElement("label"), checkbox = document.createElement("input"), status = document.createElement("p");
  legend.textContent = text.title;
  checkbox.type = "checkbox";
  checkbox.checked = enabled;
  checkbox.name = "ynxLocalContentFilter";
  checkbox.setAttribute("aria-label", text.toggle);
  label.append(checkbox, document.createTextNode(text.toggle));
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  settings.dataset.localFilterSettings = "true";
  settings.append(legend, label, status);
  (settingsContainer ?? root).append(settings);
  function configure() {
    for (const gate of gates.values()) gate.configure({ ...DEFAULT_CONTENT_FILTER, enabled });
    status.textContent = enabled ? text.unavailable : text.off;
    status.dataset.modelState = enabled ? "unavailable" : "off";
  }
  function cancel(scope) {
    if (scope !== void 0 && !gates.has(scope)) throw new Error("Unknown content display panel");
    for (const [job, owner] of jobs) if (scope === void 0 || owner === scope) {
      job.cancel();
      jobs.delete(job);
    }
    for (const [node, owner] of nodes) if (scope === void 0 || owner === scope) {
      node.textContent = text.hidden;
      nodes.delete(node);
    }
    for (const [owner, gate] of gates) if (scope === void 0 || owner === scope) gate.configure({ ...DEFAULT_CONTENT_FILTER, enabled });
  }
  configure();
  checkbox.onchange = () => {
    enabled = checkbox.checked === true;
    cancel();
    configure();
    try {
      storage?.setItem(preferenceKey, String(enabled));
    } catch {
    }
    onChanged();
  };
  function renderText(node, original, { id, assertCurrent, scope = "messages" }) {
    assertCurrent();
    const gate = gates.get(scope);
    if (!gate) throw new Error("Unknown content display panel");
    const bytes = new TextEncoder().encode(original), job = gate.begin(id, bytes, "text/plain");
    nodes.set(node, scope);
    jobs.set(job, scope);
    const show = (decision) => {
      try {
        assertCurrent();
        node.textContent = gate.canDisplay(id, bytes, decision) ? original : decision.status === "pending" ? text.pending : decision.status === "folded" ? text.folded : text.hidden;
        node.dataset.localFilterState = decision.status;
      } catch {
      }
    };
    show(job.initial);
    void job.completed.then(show).finally(() => {
      jobs.delete(job);
      bytes.fill(0);
    });
  }
  return Object.freeze({
    get enabled() {
      return enabled;
    },
    renderText,
    preview(original) {
      return enabled ? text.hidden : original;
    },
    assertAttachmentAllowed() {
      if (enabled) throw Object.assign(new Error(text.attachment), { code: "LOCAL_FILTER_UNAVAILABLE" });
    },
    cancel,
    destroy() {
      cancel();
      checkbox.onchange = null;
      settings.remove();
    }
  });
}
export {
  mountLocalContentFilter
};
