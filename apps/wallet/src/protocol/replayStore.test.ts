import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizationRequest } from "@ynx-chain/wallet-auth";
import { PersistentNonceStore } from "./replayStore";

const request={nonce:"nonce_abcdefghijklmnopqrstuvwxyz12",expiresAt:"2026-07-15T12:04:00.000Z"} as AuthorizationRequest;
class Memory {values=new Map<string,string>();async getItem(k:string){return this.values.get(k)??null}async setItem(k:string,v:string){this.values.set(k,v)}async deleteItem(k:string){this.values.delete(k)}}

test("replay protection survives deterministic restart",async()=>{
  const storage=new Memory();
  await new PersistentNonceStore(storage).consume(request,new Date("2026-07-15T12:00:00.000Z"));
  await assert.rejects(new PersistentNonceStore(storage).consume(request,new Date("2026-07-15T12:01:00.000Z")),/already used/);
});

test("tampered replay storage fails closed",async()=>{
  const storage=new Memory();storage.values.set("ynx.wallet.auth-nonces.v1",JSON.stringify([[request.nonce,"not-a-time",true]]));
  await assert.rejects(new PersistentNonceStore(storage).consume(request,new Date("2026-07-15T12:00:00.000Z")),/invalid/);
});
