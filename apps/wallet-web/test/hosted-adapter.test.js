import assert from "node:assert/strict";
import test from "node:test";
import { createHostedWalletAdapter } from "../src/hosted-adapter.js";
import { HOSTED_WALLET_ORIGIN, hostedEnvelope, parseHostedConnect } from "../src/hosted-protocol.js";

const account = `0x${"ab".repeat(20)}`;
function fixture() {
  let message;
  const popup = { closed: false, sent: [], postMessage(value) { this.sent.push(value); } };
  const browserWindow = {
    location: { origin: "https://finance.ynxweb4.com" },
    addEventListener(name, listener) { if (name === "message") message = listener; },
    removeEventListener() {},
    open(url) { popup.request = parseHostedConnect(new URL(url).hash.slice(9)); return popup; },
    setInterval, clearInterval, setTimeout, clearTimeout,
  };
  const adapter = createHostedWalletAdapter({ window: browserWindow });
  const send = (type, extra = {}) => message({ source: popup, origin: HOSTED_WALLET_ORIGIN, data: hostedEnvelope(popup.request, type, extra) });
  return { adapter, popup, send };
}
test("throwing account listener cannot leave connect pending or prevent other listeners", async t => {
  const { adapter, popup, send } = fixture(), events = [];
  t.after(() => adapter.detach());
  adapter.on("accountsChanged", () => { throw new Error("consumer callback"); });
  adapter.on("accountsChanged", value => events.push(value));
  adapter.on("connect", () => { throw new Error("consumer callback"); });
  const connected = adapter.connect();
  send("ready");
  assert.equal(popup.sent.at(-1).type, "hello");
  send("connected", { replyTo: popup.sent.at(-1).messageId, account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 - 1000 });
  assert.deepEqual(await Promise.race([connected, new Promise((_, reject) => setTimeout(() => reject(new Error("connect pending")), 500))]), [account]);
  assert.deepEqual(events, [[account]]);
  assert.equal(adapter.connected, true);
  assert.ok(popup.request.expiresAt - Date.now() <= 120_000, "the initial handshake stays bounded");
  await adapter.detach();
  assert.deepEqual(events.at(-1), []);
});
test("synchronous detach inside a listener cannot revive an old connection", async t => {
  const { adapter, popup, send } = fixture();
  t.after(() => adapter.detach());
  adapter.on("accountsChanged", accounts => { if (accounts.length) void adapter.detach(); });
  const connected = adapter.connect();
  send("ready");
  send("connected", { replyTo: popup.sent.at(-1).messageId, account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 - 1000 });
  await assert.rejects(connected, { code: "HOSTED_DISCONNECTED" });
  assert.equal(adapter.connected, false);
  assert.deepEqual(await adapter.restore(), []);
});
test("connected approval extends the channel beyond handshake but never beyond one hour", async t => {
  const { adapter, popup, send } = fixture();
  t.after(() => adapter.detach());
  const connected = adapter.connect();
  send("connected", { replyTo: "unsolicited", account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 - 1000 });
  assert.equal(adapter.connected, false, "unsolicited connected is ignored");
  send("ready");
  send("connected", { replyTo: popup.sent.at(-1).messageId, account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 + 60_000 });
  assert.equal(adapter.connected, false, "an unbounded approval envelope is ignored");
  send("connected", { replyTo: popup.sent.at(-1).messageId, account, chainId: "0x1917", sessionExpiresAt: Date.now() + 60 * 60_000 - 1000 });
  assert.deepEqual(await connected, [account]);
  await adapter.detach();
});
