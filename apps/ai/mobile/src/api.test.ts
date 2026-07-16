import assert from "node:assert/strict";
import test from "node:test";
import {API_BASE} from "./api";
test("sensitive prompt route is POST-body-only contract",()=>{
  const prompt="secret prompt ? recovery=never";
  const route=`${API_BASE}/api/conversations/conv_1/generate`;
  assert.equal(route.includes(prompt),false);
  assert.equal(JSON.parse(JSON.stringify({prompt})).prompt,prompt);
});

test("formal Wallet endpoint response uses the server walletUrl field",async()=>{
  const source=await import("node:fs/promises").then(fs=>fs.readFile(new URL("./api.ts",import.meta.url),"utf8"));
  assert.match(source,/walletUrl:string/);
  assert.doesNotMatch(source,/request<[^>]*deepLink:string/);
});
