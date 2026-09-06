import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createReceiveCode } from "../src/receive-code.mjs";
import { drawReceiveCode } from "../src/receive-code-ui.mjs";
import { parsePaymentRecipient, decodePaymentRecipientQR } from "../src/payment-recipient.mjs";
import { createPaymentRecipientUI } from "../src/payment-recipient-ui.mjs";

const account = "ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt", evm = "0x84bc88971971078d450ac7cc31d9a4775d6e3065";
const uri = `ynx:${account}?chainId=ynx_6423-1&asset=YNXT`;
const success = value => ({ ok: true, value });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(overrides = {}) {
  const context = { account: evm, keyRevision: 1, locked: false, open: true }, applied = [], reports = [], calls = [];
  const ui = createPaymentRecipientUI({ getContext: () => ({ ...context }), parse: async input => { calls.push(input); return success(parsePaymentRecipient(input)); }, decode: async input => { calls.push(input); return success(parsePaymentRecipient(uri)); }, apply: address => applied.push(address), report: value => reports.push(value), ...overrides });
  return { context, applied, reports, calls, ui };
}

test("native receiving URI, both exact parameter orders and raw identities resolve to the same public recipient", () => {
  for (const input of [uri, `ynx:${account}?asset=YNXT&chainId=ynx_6423-1`, account, evm, ` ${uri}\n`]) {
    const value = parsePaymentRecipient(input);
    assert.equal(value.account, evm); assert.equal(value.ynxAccount, account);
    assert.equal(value.chainId, "ynx_6423-1"); assert.equal(value.asset, "YNXT");
    assert.deepEqual(Object.keys(value).sort(), ["account", "asset", "chainId", "kind", "ynxAccount"]);
  }
});

test("payment links reject wrong networks, authority, encoded or duplicate parameters, hidden text and changed checksums", () => {
  for (const input of [null, {}, uri.replace("6423", "1"), uri.replace("YNXT", "YNX"), `${uri}&amount=100`, `${uri}&asset=YNXT`, `${uri}&chainId=ynx_6423-1`, `${uri}#pay`, uri.replace("chainId", "%63hainId"), uri.replace("&", ";"), uri.replace("ynx:", "ynx://"), uri.toUpperCase(), uri.replace(account, evm), `https://wallet.invalid/${uri}`, `ynxwallet:${account}`, "wc:1234@2?x=y", uri.replace(account, account.slice(0, -1) + "x"), account + "\u202e", "0x84bc88971971078d450Ac7cc31d9a4775d6e3065", "x".repeat(513)]) {
    assert.throws(() => parsePaymentRecipient(input), { code: "INVALID_PAYMENT_RECIPIENT" }, String(input));
  }
  assert.throws(() => parsePaymentRecipient(account, { requireURI: true }));
});

test("actual generated Klein blue QR pixels are decoded by jsQR into the exact Send recipient", async () => {
  const code = await createReceiveCode(account, async () => ({ initialized: true, account: evm, ynxAccount: account }));
  let bgra;
  const canvas = { getContext: () => ({ fillStyle: "", fillRect(x, y, width, height) {
    bgra ??= Buffer.alloc(canvas.width * canvas.height * 4);
    const color = this.fillStyle === "#002FA7" ? [167, 47, 0, 255] : [255, 255, 255, 255];
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) bgra.set(color, (row * canvas.width + col) * 4);
  } }) };
  // nativeImage is the injected image boundary; QR generation/pixel conversion/jsQR/parser are real.
  drawReceiveCode(canvas, code, account);
  const result = decodePaymentRecipientQR({ bytes: Buffer.from([1]), mimeType: "image/png", createImage: () => ({ isEmpty: () => false, getSize: () => ({ width: canvas.width, height: canvas.height }), toBitmap: () => bgra }) });
  assert.equal(result.ynxAccount, account); assert.equal(result.account, evm);
});

test("untrusted QR image bounds and WalletConnect/URL content cannot become payment recipients", () => {
  const createImage = () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toBitmap: () => Buffer.alloc(4) });
  for (const data of ["https://malicious.invalid", "wc:abcd@2?relay-protocol=irn", `${uri}&amount=1`]) {
    assert.throws(() => decodePaymentRecipientQR({ bytes: Buffer.from([1]), mimeType: "image/png", createImage, decode: () => ({ data }) }));
  }
  for (const delta of [{ mimeType: "image/svg+xml" }, { bytes: Buffer.alloc(0) }, { bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }, { createImage: () => ({ isEmpty: () => false, getSize: () => ({ width: 4097, height: 1 }), toBitmap: () => { throw new Error("must not allocate"); } }) }]) {
    assert.throws(() => decodePaymentRecipientQR({ bytes: Buffer.from([1]), mimeType: "image/png", createImage, ...delta }));
  }
});

test("explicit paste only applies one address and invalidates a pending review before clipboard reading", async () => {
  const order = [], h = harness({ onStart: () => order.push("invalidate-review") });
  await h.ui.text(async () => { order.push("clipboard-read"); return uri; });
  assert.deepEqual(order, ["invalidate-review", "clipboard-read"]); assert.deepEqual(h.applied, [account]); assert.deepEqual(h.calls, [uri]);
  assert.match(h.reports.at(-1), /Enter the amount/);
});

test("close, lock, key revision, account changes and editing reject a late clipboard result before parsing", async () => {
  for (const mutation of [h => { h.context.open = false; }, h => { h.context.locked = true; }, h => { h.context.keyRevision++; }, h => { h.context.account = "different"; }, h => h.ui.invalidate()]) {
    const pending = deferred(), h = harness(), job = h.ui.text(() => pending.promise); mutation(h); pending.resolve(uri); await job;
    assert.deepEqual(h.applied, []); assert.deepEqual(h.calls, []);
  }
});

test("a late decode cannot overwrite a newer paste, resurrect a closed sheet or replace the current error", async () => {
  const first = deferred(), h = harness({ decode: () => first.promise });
  const imageJob = h.ui.image({ type: "image/png", size: 1, arrayBuffer: async () => new ArrayBuffer(1) });
  await new Promise(resolve => setImmediate(resolve));
  await h.ui.text("invalid-link"); const latest = h.reports.at(-1);
  first.resolve(success(parsePaymentRecipient(uri))); await imageJob;
  assert.deepEqual(h.applied, []); assert.equal(h.reports.at(-1), latest);
  const second = deferred(), closed = harness({ parse: () => second.promise });
  const job = closed.ui.text(uri); await new Promise(resolve => setImmediate(resolve)); closed.context.open = false;
  second.resolve(success(parsePaymentRecipient(uri))); await job; assert.deepEqual(closed.applied, []);
});

test("locked or missing-account drafts do not read clipboard; oversized/mismatched images do not call decoder", async () => {
  for (const delta of [{ locked: true }, { account: null }, { open: false }]) {
    const h = harness(); Object.assign(h.context, delta); let reads = 0;
    await h.ui.text(async () => { reads++; return uri; }); assert.equal(reads, 0); assert.deepEqual(h.applied, []);
  }
  for (const file of [{ type: "image/svg+xml", size: 1 }, { type: "image/png", size: 10 * 1024 * 1024 + 1 }, { type: "image/png", size: 2, arrayBuffer: async () => new ArrayBuffer(1) }]) {
    const h = harness(); await h.ui.image(file); assert.deepEqual(h.calls, []); assert.deepEqual(h.applied, []);
  }
});

test("actual Send submit handler cannot open a late review after close, edit or a newer recipient read", async () => {
  const source = await readFile(new URL("../src/renderer.js", import.meta.url), "utf8");
  const start = source.indexOf('document.querySelector("#transfer-form").addEventListener("submit"');
  const end = source.indexOf("\nasync function actOnTransfer", start);
  assert(start >= 0 && end > start);
  for (const mutation of ["close", "edit", "new-read"]) {
    const pending = deferred(); let submit, shown = 0;
    const nodes = new Map();
    for (const id of ["transfer-form", "prepare-transfer", "transfer-result", "transfer-review", "transfer-to", "transfer-amount", "send-sheet"]) nodes.set(`#${id}`, { hidden: true, disabled: false, value: "", open: false, textContent: "", addEventListener: (_type, listener) => { submit = listener; }, showModal: () => { shown++; } });
    nodes.get("#send-sheet").open = true; nodes.get("#transfer-to").value = account; nodes.get("#transfer-amount").value = "1";
    const context = { document: { querySelector: id => { assert(nodes.has(id), id); return nodes.get(id); } }, keyState: { locked: false, revision: 1 }, paymentDraftRevision: 0, transferReview: null, window: { ynxWallet: { prepareTransfer: () => pending.promise } } };
    context.invalidatePaymentInput = () => { context.paymentDraftRevision++; };
    runInNewContext(source.slice(start, end), context);
    const job = submit({ preventDefault() {} });
    if (mutation === "close") nodes.get("#send-sheet").open = false;
    if (mutation === "edit") nodes.get("#transfer-to").value = evm;
    if (mutation === "new-read") context.invalidatePaymentInput();
    pending.resolve({ ok: true, value: { account: evm, id: "must-not-review" } }); await job;
    assert.equal(shown, 0); assert.equal(context.transferReview, null);
  }
});
