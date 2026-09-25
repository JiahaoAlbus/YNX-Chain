import assert from "node:assert/strict";
import test from "node:test";
import { assertWalletIPC } from "../src/wallet-ipc-policy.mjs";
const url = "file:///fixture/installed-wallet/index.html";
test("password and approval IPC require the exact live local main frame", () => {
  const frame = { url }, contents = { mainFrame: frame, isDestroyed: () => false }, event = { sender: contents, senderFrame: frame };
  assert.doesNotThrow(() => assertWalletIPC(event, contents, url));
  for (const bad of [{ sender: { ...contents }, senderFrame: frame }, { sender: contents, senderFrame: { url } }, { sender: contents, senderFrame: null }]) assert.throws(() => assertWalletIPC(bad, contents, url), error => error.data.code === "UNTRUSTED_WALLET_FRAME");
  for (const wrongURL of ["https://wallet.example/", `${url}?from=remote`, `${url}#unexpected`, "file:///fixture/another.html"]) { frame.url = wrongURL; assert.throws(() => assertWalletIPC(event, contents, url)); }
  frame.url = url; contents.isDestroyed = () => true; assert.throws(() => assertWalletIPC(event, contents, url));
});
