import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizationRequest } from "@ynx-chain/wallet-auth";
import { PersistentNonceStore } from "./replayStore";

const request={nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",expiresAt:"2026-07-15T12:04:00.000Z"} as AuthorizationRequest;
class Memory {values=new Map<string,string>();async getItem(k:string){return this.values.get(k)??null}async setItem(k:string,v:string){this.values.set(k,v)}async deleteItem(k:string){this.values.delete(k)}}

class DelayedFirstWrite extends Memory {
  readonly writeStarted:Promise<void>;
  private markWriteStarted!:()=>void;
  private releaseWrite!:()=>void;
  private readonly released:Promise<void>;
  private writes=0;
  constructor(){super();this.writeStarted=new Promise((resolve)=>{this.markWriteStarted=resolve});this.released=new Promise((resolve)=>{this.releaseWrite=resolve})}
  release(){this.releaseWrite()}
  override async setItem(k:string,v:string){this.writes++;if(this.writes===1){this.markWriteStarted();await this.released}await super.setItem(k,v)}
}

test("replay protection survives deterministic restart",async()=>{
  const storage=new Memory();
  await new PersistentNonceStore(storage).consume(request,new Date("2026-07-15T12:00:00.000Z"));
  await assert.rejects(new PersistentNonceStore(storage).consume(request,new Date("2026-07-15T12:01:00.000Z")),/already used/);
});

test("tampered replay storage fails closed",async()=>{
  for(const value of [
    [[request.nonce,"not-a-time",true]],
    [["short","2026-07-15T12:04:00.000Z"]],
    [[request.nonce,"2026-07-15T12:04:00Z"]],
    [[request.nonce,"2026-07-15T12:04:00.000Z"],[request.nonce,"2026-07-15T12:05:00.000Z"]],
  ]){
    const storage=new Memory();storage.values.set("ynx.wallet.auth-nonces.v1",JSON.stringify(value));
    await assert.rejects(new PersistentNonceStore(storage).consume(request,new Date("2026-07-15T12:00:00.000Z")),/invalid|canonical/);
  }
});

test("concurrent duplicate callbacks are serialized and exactly one consumes the nonce",async()=>{
  const storage=new DelayedFirstWrite(),store=new PersistentNonceStore(storage),at=new Date("2026-07-15T12:00:00.000Z");
  const first=store.consume(request,at);
  await storage.writeStarted;
  const second=store.consume(request,at);
  storage.release();
  await first;
  await assert.rejects(second,/already used/);
  assert.deepEqual(JSON.parse(storage.values.get("ynx.wallet.auth-nonces.v1")!),[[request.nonce,request.expiresAt]]);
});
