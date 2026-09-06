import assert from "node:assert/strict";
import test from "node:test";
import jsQR from "jsqr";
import { createReceiveCode } from "../src/receive-code.mjs";
import { createReceiveCodeUI, drawReceiveCode } from "../src/receive-code-ui.mjs";

const account = "ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt";
const evm = "0x84bc88971971078d450ac7cc31d9a4775d6e3065";
const status = { initialized: true, account: evm, ynxAccount: account };
const uri = `ynx:${account}?chainId=ynx_6423-1&asset=YNXT`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("actual Klein blue QR pixels decode independently to the exact native receiving identity and Testnet", async () => {
  let reads = 0;
  const code = await createReceiveCode(account, async () => { reads++; return status; });
  assert.equal(reads, 2);
  assert.equal(code.uri, uri);
  let pixels;
  const context = { fillStyle: "", fillRect(x, y, width, height) {
    pixels ??= new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const color = this.fillStyle === "#002FA7" ? [0, 47, 167, 255] : [255, 255, 255, 255];
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) pixels.set(color, (row * canvas.width + column) * 4);
  } };
  const canvas = { getContext: () => context };
  drawReceiveCode(canvas, code, account);
  assert.equal(canvas.width, canvas.height);
  assert.deepEqual([...pixels.slice(0, 4)], [255, 255, 255, 255]);
  assert.equal(jsQR(pixels, canvas.width, canvas.height)?.data, uri);
  assert.deepEqual(Object.keys(code).sort(), ["account", "asset", "chainId", "modules", "size", "uri"]);
});

test("uninitialized, unknown, malformed and mismatched receiving identities are rejected", async () => {
  for (const candidate of [null, { ...status, initialized: false }, { ...status, account: "0x" + "11".repeat(20) }, { ...status, ynxAccount: account.slice(0, -1) + "x" }]) {
    await assert.rejects(createReceiveCode(account, async () => candidate), { code: "RECEIVE_ACCOUNT_UNAVAILABLE" });
  }
  for (const value of [undefined, {}, evm, account.toUpperCase(), account + "?asset=OTHER"]) {
    await assert.rejects(createReceiveCode(value, async () => status), { code: "RECEIVE_ACCOUNT_UNAVAILABLE" });
  }
});

test("account invalidation during generation cannot return the previous receiving code", async () => {
  let reads = 0;
  await assert.rejects(createReceiveCode(account, async () => ++reads === 1 ? status : null), { code: "RECEIVE_ACCOUNT_UNAVAILABLE" });
});

test("renderer rejects a wrong account/network/asset/URI or malformed matrix before allocating pixels", async () => {
  const code = await createReceiveCode(account, async () => status);
  const canvas = { getContext: () => { throw new Error("must not draw"); } };
  for (const delta of [{ account: evm }, { chainId: "ynx_1-1" }, { asset: "YNX" }, { uri: "https://remote.invalid" }, { size: 100000 }, { size: 22 }, { modules: [1] }, { modules: code.modules.map((value, i) => i === 0 ? 2 : value) }]) {
    assert.throws(() => drawReceiveCode(canvas, { ...code, ...delta }, account), /Invalid receiving code/);
    assert.equal(canvas.width, undefined);
  }
});

test("out-of-order account responses and late failures cannot overwrite the latest code", async () => {
  const first = deferred(), second = deferred(), drawn = [];
  const canvas = {}, label = { textContent: "" };
  const ui = createReceiveCodeUI({ canvas, status: label, requestCode: value => value === "first" ? first.promise : second.promise, draw: (_canvas, value, expected) => drawn.push({ value, expected }) });
  const a = ui.refresh("first"), b = ui.refresh("second");
  second.resolve({ ok: true, value: "second-code" }); await b;
  const feedback = label.textContent;
  first.resolve({ ok: false }); await a;
  assert.deepEqual(drawn, [{ value: "second-code", expected: "second" }]);
  assert.equal(label.textContent, feedback);
  assert.equal(canvas.hidden, false);
});

test("closing Receive or clearing a failed account invalidates in-flight generation", async () => {
  const pending = deferred(); let draws = 0;
  const canvas = {}, label = { textContent: "" };
  const ui = createReceiveCodeUI({ canvas, status: label, requestCode: () => pending.promise, draw: () => draws++ });
  const job = ui.refresh(account);
  ui.clear();
  pending.resolve({ ok: true, value: {} }); await job;
  assert.equal(draws, 0);
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.width, 1);
  assert.equal(label.textContent, "");
});

test("local generation and drawing failures hide the QR without a network fallback", async () => {
  for (const requestCode of [async () => { throw new Error("read failed"); }, async () => ({ ok: false }), async () => ({ ok: true, value: {} })]) {
    const canvas = {}, label = { textContent: "" };
    const ui = createReceiveCodeUI({ canvas, status: label, requestCode });
    await ui.refresh(account);
    assert.equal(canvas.hidden, true);
    assert.match(label.textContent, /unavailable/);
    await ui.refresh(null);
    assert.equal(label.textContent, "");
  }
});
