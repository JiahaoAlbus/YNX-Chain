import test from "node:test";
import assert from "node:assert/strict";
import {API} from "./api";

test("native API uses exact product erasure confirmation and dedicated receipt route",async()=>{
  const calls:Array<{url:string;method:string;authorization:string;body?:string}>=[];
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const headers=new Headers(init.headers);
    calls.push({url:String(input),method:init.method||"GET",authorization:headers.get("Authorization")||"",body:typeof init.body==="string"?init.body:undefined});
    return new Response(JSON.stringify(init.method==="DELETE"?{schemaVersion:1,id:"erasure_1",ownerHash:"a".repeat(64),product:"cloud",status:"logical-erasure-complete-known-provider-deletions-complete",pendingBlobs:0,completedBlobs:1,requestedAt:"2026-07-23T00:00:00Z",updatedAt:"2026-07-23T00:00:01Z",deleted:{objects:1},retained:{},coverage:"known references"}:[]),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try{
    const api=new API("https://cloud.invalid/api/v1","dedicated-session");
    await api.erase();
    await api.erasureReceipts();
  }finally{globalThis.fetch=original}
  assert.deepEqual(calls,[
    {url:"https://cloud.invalid/api/v1/account-data",method:"DELETE",authorization:"Bearer dedicated-session",body:JSON.stringify({confirm:"DELETE CLOUD DATA"})},
    {url:"https://cloud.invalid/api/v1/account-data/erasures",method:"GET",authorization:"Bearer dedicated-session",body:undefined},
  ]);
});
