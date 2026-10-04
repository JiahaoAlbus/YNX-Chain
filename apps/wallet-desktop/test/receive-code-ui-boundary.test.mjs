import assert from "node:assert/strict";
import test from "node:test";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {drawReceiveCode, createReceiveCodeUI} from "../src/receive-code-ui.mjs";

// Public fixture only: no account-status, wallet-auth, custody or signing provider.
const account = "ynx1sj7g39cewyrc63g2clxrrkdywawkuvr9fmrvvt";
const uri = `ynx:${account}?chainId=ynx_6423-1&asset=YNXT`;
function code() {
  const {modules} = QRCode.create(uri, {errorCorrectionLevel: "M"});
  return {account, chainId: "ynx_6423-1", asset: "YNXT", uri,
    size: modules.size, modules: Array.from(modules.data)};
}
function pixelsCanvas(beforeContext = () => {}) {
  let pixels;
  const context = {fillStyle: "", fillRect(x, y, width, height) {
    pixels ??= new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const color = this.fillStyle === "#002FA7" ? [0, 47, 167, 255] : [255, 255, 255, 255];
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
      pixels.set(color, (row * canvas.width + column) * 4);
    }
  }};
  const canvas = {getContext() {beforeContext(); return context;}};
  return {canvas, decode: () => jsQR(pixels, canvas.width, canvas.height)?.data};
}

test("dense public matrix renders an independently decodable exact Testnet URI", () => {
  const h = pixelsCanvas(); drawReceiveCode(h.canvas, code(), account);
  assert.equal(h.decode(), uri);
});
for (const sparse of ["all holes", "one missing module", "inherited module"]) {
  test(`rejects ${sparse} before changing canvas dimensions`, () => {
    const value = code();
    if (sparse === "all holes") value.modules = new Array(value.size ** 2);
    else {
      delete value.modules[0];
      if (sparse === "inherited module") {
        const inherited = Object.create(Array.prototype); inherited[0] = 1;
        Object.setPrototypeOf(value.modules, inherited);
      }
    }
    const canvas = {getContext() {throw new Error("must not allocate pixels");}};
    assert.throws(() => drawReceiveCode(canvas, value, account), /Invalid receiving code/);
    assert.equal(canvas.width, undefined);
  });
}
for (const field of ["account", "size", "modules"]) {
  test(`rejects accessor ${field} without invoking it`, () => {
    const value = code(), saved = value[field]; let reads = 0;
    Object.defineProperty(value, field, {get() {reads++; return saved;}});
    assert.throws(() => drawReceiveCode({}, value, account), /Invalid receiving code/);
    assert.equal(reads, 0);
  });
}
test("rejects accessor modules without invoking them", () => {
  const value = code(); let reads = 0;
  Object.defineProperty(value.modules, "0", {get() {reads++; return 1;}});
  assert.throws(() => drawReceiveCode({}, value, account), /Invalid receiving code/);
  assert.equal(reads, 0);
});
test("painting uses the validated snapshot even if the source changes during canvas setup", () => {
  const value = code();
  const h = pixelsCanvas(() => {value.modules.fill(0); value.size = 21; value.uri = "other";});
  drawReceiveCode(h.canvas, value, account);
  assert.equal(h.decode(), uri);
});
test("a truthy non-boolean IPC success cannot display a receiving code", async () => {
  let draws = 0;
  const canvas = {}, status = {textContent: ""};
  const ui = createReceiveCodeUI({canvas, status, requestCode: async () => ({ok: "true", value: code()}), draw() {draws++;}});
  await ui.refresh(account);
  assert.equal(draws, 0); assert.equal(canvas.hidden, true);
  assert.match(status.textContent, /unavailable/);
});
test("invalid matrix remains hidden and reopening retries through the original request adapter", async () => {
  let calls = 0; const canvas = {}, status = {textContent: ""};
  const ui = createReceiveCodeUI({canvas, status, requestCode: async expected => {
    assert.equal(expected, account); calls++;
    const value = code(); if (calls === 1) value.modules = new Array(value.size ** 2);
    return {ok: true, value};
  }});
  canvas.getContext = () => ({fillRect() {}});
  await ui.refresh(account); assert.equal(canvas.hidden, true);
  await ui.refresh(account); assert.equal(canvas.hidden, false); assert.equal(calls, 2);
});
test("closing Receive discards a late valid public matrix without painting or feedback", async () => {
  let resolve, draws = 0;
  const pending = new Promise(done => {resolve = done;});
  const canvas = {}, status = {textContent: ""};
  const ui = createReceiveCodeUI({canvas, status, requestCode: () => pending, draw() {draws++;}});
  const job = ui.refresh(account); ui.clear(); resolve({ok: true, value: code()}); await job;
  assert.equal(draws, 0); assert.equal(canvas.hidden, true); assert.equal(status.textContent, "");
});
test("reopening the same account retires both late success and late failure from the old request", async () => {
  for (const oldResult of [{ok: true, value: code()}, {ok: false}]) {
    let resolve, calls = 0, draws = 0;
    const pending = new Promise(done => {resolve = done;});
    const canvas = {}, status = {textContent: ""};
    const ui = createReceiveCodeUI({canvas, status, requestCode: () => ++calls === 1 ? pending : Promise.resolve({ok: true, value: code()}), draw() {draws++;}});
    const old = ui.refresh(account); ui.clear(); await ui.refresh(account);
    const feedback = status.textContent; resolve(oldResult); await old;
    assert.equal(draws, 1); assert.equal(canvas.hidden, false); assert.equal(status.textContent, feedback);
  }
});
