import assert from "node:assert/strict";
import { test } from "node:test";
import { openRegisteredCallbackFailClosed } from "./registeredCallbackHandoffPolicy";

const response="A".repeat(32),custom="ynx-social://com.ynx.social",customURL=`${custom}?response=${response}`,web="https://social.ynxweb4.com/wallet-auth/callback",webURL=`${web}?response=${response}`;

test("Android custom-scheme callback targets only the exact registered package",async()=>{
  const exact:string[]=[],fallback:string[]=[];
  await openRegisteredCallbackFailClosed(customURL,custom,"com.ynx.social","android",async(url,pkg)=>{exact.push(`${pkg}\n${url}`)},async(url)=>fallback.push(url));
  assert.deepEqual(exact,[`com.ynx.social\n${customURL}`]);
  assert.deepEqual(fallback,[]);
});

test("Android custom callback fails closed without its package bridge",async()=>{
  const fallback:string[]=[];
  await assert.rejects(openRegisteredCallbackFailClosed(customURL,custom,"com.ynx.social","android",null,async(url)=>fallback.push(url)),/bridge is unavailable/);
  assert.deepEqual(fallback,[]);
  await assert.rejects(openRegisteredCallbackFailClosed(customURL,custom,"web social","android",async()=>{},async()=>{}),/package is invalid/);
});

test("HTTPS and non-Android callbacks use only the canonical fallback",async()=>{
  const exact:string[]=[],fallback:string[]=[];
  await openRegisteredCallbackFailClosed(webURL,web,"web.ynx.social","android",async()=>exact.push("exact"),async(url)=>fallback.push(url));
  await openRegisteredCallbackFailClosed(customURL,custom,"com.ynx.social","ios",async()=>exact.push("exact"),async(url)=>fallback.push(url));
  assert.deepEqual(exact,[]);
  assert.deepEqual(fallback,[webURL,customURL]);
});

test("route substitution, callback ambiguity and insecure web callbacks are rejected",async()=>{
  const open=async()=>{};
  await assert.rejects(openRegisteredCallbackFailClosed(customURL.replace("com.ynx.social","attacker"),custom,"com.ynx.social","android",open,open),/does not match/);
  await assert.rejects(openRegisteredCallbackFailClosed(`${customURL}&response=attacker`,custom,"com.ynx.social","android",open,open),/does not match/);
  await assert.rejects(openRegisteredCallbackFailClosed(customURL,`${custom}#fragment`,"com.ynx.social","android",open,open),/not canonical/);
  const insecure="http://social.ynxweb4.com/callback";
  await assert.rejects(openRegisteredCallbackFailClosed(`${insecure}?response=${response}`,insecure,"web.ynx.social","android",open,open),/Insecure/);
});
