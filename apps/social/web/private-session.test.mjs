import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSocialPrivateSession, SOCIAL_AUTHORITY, SOCIAL_PRIVATE_SCOPES } from "./private-session.js";

function fixture(options = {}) {
  const calls = [];
  const controller = createSocialPrivateSession({
    environment: { navigator: { onLine: true }, async fetch() { calls.push("registry"); return { ok: true, json: async () => ({}) }; } },
    factory: async config => {
      assert.equal(config.productId, "social");
      assert.deepEqual(config.scopes, ["account:read", "profile:link"]);
      return { client: {
        async begin(value) { calls.push(["begin", value]); return {status:"connecting"}; },
        async restore(value) { calls.push(["restore", value]); return {status:"connected",session:{account:"test-identity"}}; },
        async handleReturn(value) { calls.push(["return",value]); return {status:"disconnected"}; },
        async disconnect() { calls.push("revoke"); return {status:"disconnected"}; },
      }};
    }, ...options,
  });
  return {calls, controller};
}

test("private artifacts match the frozen owner bytes", async () => {
  for(const [name,size,sha] of [
    ["product-session-browser.mjs",209272,"db921598fb17ac504a7f42b3fce58e4688f2abafd0d0103159fc6ac9d18b4f04"],
    ["product-session-registry.json",7444,"0b96a9ff464586c003d7099803d3c56c32d4efdbba16e60e315a8e66f3185eee"],
  ]) {
    const data = await readFile(new URL(`./vendor/${name}`, import.meta.url));
    assert.equal(data.length,size); assert.equal(createHash("sha256").update(data).digest("hex"),sha);
  }
});
test("guest controller construction creates no keys or authority requests", () => {
  const {calls} = fixture(); assert.deepEqual(calls,[]);
  assert.equal(SOCIAL_AUTHORITY,"https://wallet-auth.ynxweb4.com");
  assert.deepEqual(SOCIAL_PRIVATE_SCOPES,["account:read","profile:link"]);
});
test("unknown native launcher cannot be reported as installed", async () => {
  const {calls,controller}=fixture();
  await assert.rejects(controller.begin(),{code:"WALLET_LAUNCH_UNVERIFIED"});
  assert.deepEqual(calls,["registry"]);
});
test("restore and revoke call shared private lifecycle independently", async () => {
  const {calls,controller}=fixture();
  assert.equal((await controller.restore()).status,"connected");
  assert.equal((await controller.disconnect()).status,"disconnected");
  assert.deepEqual(calls,["registry",["restore",true],"revoke"]);
});
test("registered callback is passed intact and foreign callback is refused", async () => {
  const {calls,controller}=fixture();
  const url="https://social.ynxweb4.com/wallet-auth/callback?state=synthetic&approval=synthetic";
  await controller.handleReturn(url);
  await assert.rejects(controller.handleReturn("https://other.example/wallet-auth/callback"));
  assert.deepEqual(calls,["registry",["return",url]]);
});
test("callback document assets resolve from root and launch is user-only", async () => {
  const html=await readFile(new URL("./index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("./private-session-ui.js",import.meta.url),"utf8");
  assert.match(html,/<base href="\/"/);
  assert.match(ui,/privateSession\.handleReturn\(location\.href\)/);
  assert.doesNotMatch(ui,/window\.open|location\.(href|assign)\s*=/);
});
