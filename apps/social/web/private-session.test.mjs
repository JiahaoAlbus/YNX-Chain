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
      return { storage: {get: async () => null}, client: {
        storageKey: "synthetic-session",
        async beginExplicit() { calls.push("beginExplicit"); return {status:"connecting",installation:"unverified",automatic:false}; },
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
    ["product-session-browser.mjs",214746,"5dc94d97925e4c0271c8c45255e0e409f257258e4e621f71fda26c4e2407a6e0"],
    ["product-session-registry.json",7546,"85c6995eddfbc175efaac01dbad31a4f5ef8878aab91613da2d689ef79921ab3"],
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
test("explicit launch uses official unverified entry without installation probes", async () => {
  const {calls,controller}=fixture();
  const pending=await controller.begin();
  assert.equal(pending.installation,"unverified");
  assert.equal(pending.automatic,false);
  assert.deepEqual(calls,["registry","beginExplicit"]);
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
test("pending-only retry cannot rotate the official pending nonce", async () => {
  let restores=0;
  const {controller}=fixture({factory:async()=>({storage:{get:async()=>'{"nonce":"pending-synthetic"}'},client:{storageKey:"synthetic-session",restore:async()=>{restores++;}}})});
  const result=await controller.restore();
  assert.equal(result.status,"connecting");
  assert.equal(result.automatic,false);
  assert.equal(restores,0);
});
test("callback document assets resolve from root and launch is user-only", async () => {
  const html=await readFile(new URL("./index.html",import.meta.url),"utf8");
  const ui=await readFile(new URL("./private-session-ui.js",import.meta.url),"utf8");
  assert.match(html,/<base href="\/"/);
  assert.match(ui,/privateSession\.handleReturn\(location\.href\)/);
  assert.doesNotMatch(ui,/window\.open|location\.(href|assign)\s*=/);
});
