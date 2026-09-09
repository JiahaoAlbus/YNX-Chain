import assert from "node:assert/strict";
import test from "node:test";
import {createVerifiedProductSessionStorage,isNativeStorageOwnerExpiredError} from "./productWalletStorage";

function fixture(input:Readonly<{dropSet?:boolean;dropDelete?:boolean}>={}){
  const records=new Map<string,string>();let uncertain=false;
  const store={
    getItemAsync:async(key:string)=>records.get(key)??null,
    setItemAsync:async(key:string,value:string)=>{if(!input.dropSet)records.set(key,value);},
    deleteItemAsync:async(key:string)=>{if(!input.dropDelete)records.delete(key);},
  };
  return {records,storage:createVerifiedProductSessionStorage({store,mapKey:key=>`mapped:${key}`,isUncertain:()=>uncertain,markUncertain:()=>{uncertain=true;}}),uncertain:()=>uncertain};
}

test("Card rejects a dropped pending write without replacing the prior record and then isolates native storage",async()=>{
  const value=fixture({dropSet:true});value.records.set("mapped:pending","prior-pending");
  await assert.rejects(()=>value.storage.set("pending","new-pending"),/did not preserve/);
  assert.equal(value.records.get("mapped:pending"),"prior-pending");assert.equal(value.uncertain(),true);
  await assert.rejects(()=>value.storage.get("pending"),/uncertain/);
});

test("Card rejects a dropped remove, retains the pending record, and isolates native storage",async()=>{
  const value=fixture({dropDelete:true});value.records.set("mapped:pending","pending-request");
  await assert.rejects(()=>value.storage.remove("pending"),/did not remove/);
  assert.equal(value.records.get("mapped:pending"),"pending-request");assert.equal(value.uncertain(),true);
});

test("Card confirms a revoke marker by exact readback and serializes concurrent secure mutations",async()=>{
  const value=fixture();await Promise.all([value.storage.set("revoke","revoke-marker"),value.storage.set("completion","completion-marker")]);
  assert.equal(await value.storage.get("revoke"),"revoke-marker");assert.equal(await value.storage.get("completion"),"completion-marker");assert.equal(value.uncertain(),false);
});

test("Card shares native storage serialization across controllers and rejects stale lease mutations after the new pending record commits",async()=>{
  const records=new Map<string,string>([["mapped:pending","old-pending"]]);let oldActive=true,releaseDelete:(()=>void)|null=null,enteredDelete:(()=>void)|null=null;
  const deleting=new Promise<void>(resolve=>{releaseDelete=resolve}),entered=new Promise<void>(resolve=>{enteredDelete=resolve});
  const store={getItemAsync:async(key:string)=>records.get(key)??null,setItemAsync:async(key:string,value:string)=>{records.set(key,value);},deleteItemAsync:async(key:string)=>{enteredDelete?.();await deleting;records.delete(key);}};
  const old=createVerifiedProductSessionStorage({store,mapKey:key=>`mapped:${key}`,isUncertain:()=>false,markUncertain:()=>{},isOwnerActive:()=>oldActive});
  const fresh=createVerifiedProductSessionStorage({store,mapKey:key=>`mapped:${key}`,isUncertain:()=>false,markUncertain:()=>{},isOwnerActive:()=>true});
  const oldRemove=old.remove("pending");await entered;oldActive=false;
  const newPending=fresh.set("pending","new-pending");releaseDelete?.();await assert.rejects(()=>oldRemove,/lease expired/);await newPending;
  await assert.rejects(()=>old.set("pending","old-pending"),/lease expired/);
  assert.equal(await fresh.get("pending"),"new-pending");
});

test("Card never classifies an arbitrary storage error code as an owner cancellation",()=>{
  assert.equal(isNativeStorageOwnerExpiredError(Object.assign(new Error("native storage failed"),{code:"NATIVE_STORAGE_OWNER_EXPIRED"})),false);
});
