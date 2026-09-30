import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../src/main.mjs", import.meta.url), "utf8");
function installHandler(name, end, context) {
  let handler;
  const start = source.indexOf(`handleWalletIPC("${name}"`);
  runInNewContext(source.slice(start, source.indexOf(end, start)), {
    handleWalletIPC: (_name, value) => { handler = value; }, ...context
  });
  return handler;
}

test("native provider approval retains its existing authority without requiring a Pair inbox entry", async () => {
  let approved = 0;
  const handler = installHandler("wallet:provider-action", "\nasync function handleCallback", {
    sensitiveIPC: async (action, options) => { options.assertCurrent(); return action(); },
    keyAccess: { current: () => ({}) }, walletConnectRequests: new Map(),
    walletConnectInbox: { assertLive: () => { throw new Error("Native requests must not use the Pair inbox"); } },
    walletAuthority: { approve: async id => { assert.equal(id, "native-review"); approved++; return { status: "success" }; } },
    accountChangeInProgress: false
  });
  const result = await handler(null, "native-review", "approve");
  assert.equal(result.status, "success");
  assert.equal(result.responseDelivered, false);
  assert.equal(approved, 1);
});

test("local disconnect ends only its own queued requests before SDK disconnect, without waiting for a delete event", async () => {
  const ended = [], order = [], entries = [{ key: "a", event: { topic: "topic-a" } }, { key: "b", event: { topic: "topic-b" } }];
  const handler = installHandler("wallet:walletconnect-disconnect", '\nhandleWalletIPC("wallet:walletconnect-proposal-action"', {
    safeIPC: action => action(),
    walletConnectInbox: { pending: () => entries, finish: key => { ended.push(key); } },
    terminateWalletConnectReview: async entry => { order.push(`end:${entry.key}`); },
    walletAuthority: { revokeOrigin: async () => { order.push("revoke"); } },
    walletConnect: { sessionOrigin: () => "https://dapp.example", disconnectSession: async () => { order.push("disconnect"); return { disconnected: true }; } },
    mainWindow: null
  });
  const result = await handler(null, "topic-a");
  assert.deepEqual(ended, ["a"]);
  assert.deepEqual(order, ["end:a", "revoke", "disconnect"]);
  assert.equal(result.localPermissionRevoked, true);
});
