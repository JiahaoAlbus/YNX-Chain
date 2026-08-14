import assert from "node:assert/strict";
import { test } from "node:test";
import { PersistentActionCallbackStore, type ActionCallbackBinding } from "../protocol/actionCallbackStore";
import { completePersistentActionCallbackHandoff } from "./actionCallbackHandoffPolicy";

const binding:ActionCallbackBinding={key:`dex:${"c".repeat(64)}`,expiresAt:"2026-08-14T12:05:00.000Z",account:`ynx1${"q".repeat(38)}`,bundleId:"com.ynxweb4.dex",callback:"ynxdex://wallet-auth/callback"};
const url=`${binding.callback}?response=${"D".repeat(64)}`,now=()=>new Date("2026-08-14T12:00:00.000Z");
class Memory{values=new Map<string,string>();async getItem(key:string){return this.values.get(key)??null}async setItem(key:string,value:string){this.values.set(key,value)}async deleteItem(key:string){this.values.delete(key)}}

test("failed OS handoff remains pending and restart reuses the exact signed response",async()=>{
  const storage=new Memory();let creates=0,completed=0;
  await assert.rejects(completePersistentActionCallbackHandoff(new PersistentActionCallbackStore(storage),binding,now,()=>{},async()=>{creates++;return url},async()=>{throw new Error("OS open failed")},()=>{completed++}),/OS open failed/);
  const opened:string[]=[];
  await completePersistentActionCallbackHandoff(new PersistentActionCallbackStore(storage),binding,now,()=>{},async()=>{creates++;return "unused"},async(value)=>{opened.push(value)},()=>{completed++});
  assert.equal(creates,1);assert.deepEqual(opened,[url]);assert.equal(completed,1);
});

test("lifecycle must remain active before OS handoff but expected background after open is allowed",async()=>{
  const storage=new Memory();let active=true,opened=0,completed=0;
  await completePersistentActionCallbackHandoff(new PersistentActionCallbackStore(storage),binding,now,()=>{if(!active)throw new Error("inactive")},async()=>url,async()=>{opened++;active=false},()=>{completed++});
  assert.equal(opened,1);assert.equal(completed,1);
});
