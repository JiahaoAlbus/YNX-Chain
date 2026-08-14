import assert from "node:assert/strict";
import { test } from "node:test";
import { unlockAccountFailClosed } from "./unlockPolicy";

test("unlock requires biometrics, exact SecureStore account material and stable selection in order",async()=>{
  const events:string[]=[];
  await unlockAccountFailClosed("one",async()=>{events.push("biometric")},async(account)=>{events.push(`secret:${account}`)},()=>{events.push("selected");return "one"},(account)=>events.push(`unlock:${account}`));
  assert.deepEqual(events,["biometric","selected","secret:one","selected","unlock:one"]);
});

test("biometric, SecureStore and account-drift failures never unlock",async()=>{
  const unlocked:string[]=[];
  await assert.rejects(unlockAccountFailClosed("one",async()=>{throw new Error("biometric denied")},async()=>{},()=>"one",(account)=>unlocked.push(account)),/biometric denied/);
  await assert.rejects(unlockAccountFailClosed("one",async()=>{},async()=>{throw new Error("secure material unavailable")},()=>"one",(account)=>unlocked.push(account)),/secure material unavailable/);
  await assert.rejects(unlockAccountFailClosed("one",async()=>{},async()=>{},()=>"two",(account)=>unlocked.push(account)),/account changed/);
  let reads=0;
  await assert.rejects(unlockAccountFailClosed("one",async()=>{},async()=>{},()=>++reads===1?"one":"two",(account)=>unlocked.push(account)),/account changed/);
  assert.deepEqual(unlocked,[]);
});
