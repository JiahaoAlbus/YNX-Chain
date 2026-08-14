import assert from "node:assert/strict";
import { test } from "node:test";
import { PersistentActionReplayStore } from "./actionReplayStore";

const record={key:`exchange:${"a".repeat(64)}`,expiresAt:"2026-08-14T12:05:00.000Z"};
class Memory {values=new Map<string,string>();async getItem(key:string){return this.values.get(key)??null}async setItem(key:string,value:string){this.values.set(key,value)}async deleteItem(key:string){this.values.delete(key)}}
class DelayedFirstWrite extends Memory {readonly started:Promise<void>;private start!:()=>void;private releaseWrite!:()=>void;private released:Promise<void>;private writes=0;constructor(){super();this.started=new Promise(resolve=>{this.start=resolve});this.released=new Promise(resolve=>{this.releaseWrite=resolve})}release(){this.releaseWrite()}override async setItem(key:string,value:string){if(++this.writes===1){this.start();await this.released}await super.setItem(key,value)}}

test("action replay consumption survives process reconstruction and separates exact domains",async()=>{
  const storage=new Memory(),at=new Date("2026-08-14T12:00:00.000Z");
  await new PersistentActionReplayStore(storage).consume(record,at);
  await assert.rejects(new PersistentActionReplayStore(storage).consume(record,at),/already used/);
  await new PersistentActionReplayStore(storage).consume({key:`dex:${"a".repeat(64)}`,expiresAt:record.expiresAt},at);
});

test("expired, malformed and tampered action replay state fails closed",async()=>{
  const at=new Date("2026-08-14T12:05:00.000Z");
  await assert.rejects(new PersistentActionReplayStore(new Memory()).consume(record,at),/expired/);
  for(const value of [[[record.key,"bad-time"]],[["wrong:"+"a".repeat(64),record.expiresAt]],[[record.key,record.expiresAt],[record.key,record.expiresAt]]]){
    const storage=new Memory();storage.values.set("ynx.wallet.action-replays.v1",JSON.stringify(value));
    await assert.rejects(new PersistentActionReplayStore(storage).consume({key:`quant:${"b".repeat(64)}`,expiresAt:"2026-08-14T12:06:00.000Z"},new Date("2026-08-14T12:00:00.000Z")),/invalid|canonical/);
  }
});

test("concurrent duplicate action callbacks persist exactly one consumption",async()=>{
  const storage=new DelayedFirstWrite(),store=new PersistentActionReplayStore(storage),at=new Date("2026-08-14T12:00:00.000Z");
  const first=store.consume(record,at);await storage.started;const second=store.consume(record,at);storage.release();await first;await assert.rejects(second,/already used/);
  assert.deepEqual(JSON.parse(storage.values.get("ynx.wallet.action-replays.v1")!),[[record.key,record.expiresAt]]);
});
