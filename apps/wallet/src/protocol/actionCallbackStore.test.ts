import assert from "node:assert/strict";
import { test } from "node:test";
import { PersistentActionCallbackStore, type ActionCallbackBinding } from "./actionCallbackStore";

const KEY=`exchange:${"a".repeat(64)}`,ACCOUNT=`ynx1${"q".repeat(38)}`,CALLBACK="ynxexchange://wallet-auth/callback",URL=`${CALLBACK}?response=${"A".repeat(64)}`;
const binding:ActionCallbackBinding={key:KEY,expiresAt:"2026-08-14T12:05:00.000Z",account:ACCOUNT,bundleId:"com.ynxweb4.exchange",callback:CALLBACK};
class Memory{values=new Map<string,string>();async getItem(key:string){return this.values.get(key)??null}async setItem(key:string,value:string){this.values.set(key,value)}async deleteItem(key:string){this.values.delete(key)}}
class DelayedFirstWrite extends Memory{readonly started:Promise<void>;private start!:()=>void;private releaseWrite!:()=>void;private released:Promise<void>;private writes=0;constructor(){super();this.started=new Promise(resolve=>{this.start=resolve});this.released=new Promise(resolve=>{this.releaseWrite=resolve})}release(){this.releaseWrite()}override async setItem(key:string,value:string){if(++this.writes===1){this.start();await this.released}await super.setItem(key,value)}}
const now=()=>new Date("2026-08-14T12:00:00.000Z");

test("pending callback survives reconstruction and resumes without signing again",async()=>{
  const storage=new Memory();let creates=0;
  assert.equal(await new PersistentActionCallbackStore(storage).prepare(binding,async()=>{creates++;return URL},now),URL);
  assert.equal(await new PersistentActionCallbackStore(storage).prepare(binding,async()=>{creates++;return "unused"},now),URL);
  assert.equal(creates,1);
  const stored=storage.values.get("ynx.wallet.action-callbacks.v2")!;
  assert.ok(stored.includes(URL));assert.equal(stored.includes("private-key-canary"),false);
});

test("successful completion removes response payload but preserves replay rejection",async()=>{
  const storage=new Memory(),store=new PersistentActionCallbackStore(storage);
  await store.prepare(binding,async()=>URL,now);await store.complete(KEY,URL);
  const stored=storage.values.get("ynx.wallet.action-callbacks.v2")!;
  assert.equal(stored.includes(URL),false);assert.match(stored,/"state":"delivered"/);
  await assert.rejects(new PersistentActionCallbackStore(storage).prepare(binding,async()=>URL,now),/already delivered/);
});

test("account, package, callback, response and completion substitution fail closed",async()=>{
  for(const changed of [{...binding,account:`ynx1${"p".repeat(38)}`},{...binding,bundleId:"com.attacker.app"},{...binding,callback:"attacker://wallet-auth/callback"}]){
    const storage=new Memory(),store=new PersistentActionCallbackStore(storage);await store.prepare(binding,async()=>URL,now);
    await assert.rejects(store.prepare(changed,async()=>URL,now),/binding differs/);
  }
  await assert.rejects(new PersistentActionCallbackStore(new Memory()).prepare(binding,async()=>`${URL}&response=attacker`,now),/does not match/);
  const storage=new Memory(),store=new PersistentActionCallbackStore(storage);await store.prepare(binding,async()=>URL,now);
  await assert.rejects(store.complete(KEY,`${CALLBACK}?response=attacker`),/differs/);
});

test("legacy replay markers remain terminal and expired bindings never stage",async()=>{
  const storage=new Memory();storage.values.set("ynx.wallet.action-replays.v1",JSON.stringify([[KEY,binding.expiresAt]]));
  await assert.rejects(new PersistentActionCallbackStore(storage).prepare(binding,async()=>URL,now),/already used/);
  await assert.rejects(new PersistentActionCallbackStore(new Memory()).prepare(binding,async()=>URL,()=>new Date(binding.expiresAt)),/expired/);
});

test("lifecycle cancellation before the storage linearization point writes nothing",async()=>{
  const storage=new Memory(),store=new PersistentActionCallbackStore(storage);
  await assert.rejects(store.prepare(binding,async()=>URL,now,()=>{throw new Error("backgrounded")}),/backgrounded/);
  assert.equal(storage.values.get("ynx.wallet.action-callbacks.v2"),undefined);
});

test("concurrent preparation creates and persists one exact pending response",async()=>{
  const storage=new DelayedFirstWrite(),store=new PersistentActionCallbackStore(storage);let creates=0;
  const first=store.prepare(binding,async()=>{creates++;return URL},now);await storage.started;
  const second=store.prepare(binding,async()=>{creates++;return `${CALLBACK}?response=attacker`},now);storage.release();
  assert.equal(await first,URL);assert.equal(await second,URL);assert.equal(creates,1);
});

test("tampered, ambiguous and conflicting persistent state fails closed",async()=>{
  const bad=["not-json",JSON.stringify({schemaVersion:2,records:[{...binding,state:"pending",responseURL:`${URL}&x=1`}]}),JSON.stringify({schemaVersion:2,records:[{...binding,state:"delivered",responseURL:URL}]})];
  for(const raw of bad){const storage=new Memory();storage.values.set("ynx.wallet.action-callbacks.v2",raw);await assert.rejects(new PersistentActionCallbackStore(storage).prepare({...binding,key:`quant:${"b".repeat(64)}`},async()=>URL,now),/unreadable|does not match|must not retain/)}
  const storage=new Memory();storage.values.set("ynx.wallet.action-replays.v1",JSON.stringify([[KEY,binding.expiresAt]]));storage.values.set("ynx.wallet.action-callbacks.v2",JSON.stringify({schemaVersion:2,records:[{...binding,state:"pending",responseURL:URL}]}));
  await assert.rejects(new PersistentActionCallbackStore(storage).prepare(binding,async()=>URL,now),/conflicts/);
});

test("process reconstruction strips expired pending responses but preserves terminal replay",async()=>{
  const storage=new Memory(),store=new PersistentActionCallbackStore(storage);await store.prepare(binding,async()=>URL,now);
  assert.equal(await new PersistentActionCallbackStore(storage).discardExpired(new Date(binding.expiresAt)),1);
  const raw=storage.values.get("ynx.wallet.action-callbacks.v2")!;assert.equal(raw.includes(URL),false);assert.match(raw,/"state":"delivered"/);
  await assert.rejects(new PersistentActionCallbackStore(storage).prepare(binding,async()=>URL,now),/already delivered/);
  assert.equal(await new PersistentActionCallbackStore(storage).discardExpired(new Date(binding.expiresAt)),0);
});
