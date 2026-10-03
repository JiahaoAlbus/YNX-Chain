import test from "node:test";
import assert from "node:assert/strict";
import { SocialAPI, SocialAPIError } from "./api";

test("confirmed deletion invalidates the original local authorization", async () => {
  const originalFetch=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async (_url,init)=>{
    requests++;
    assert.equal(init?.method,"DELETE");
    assert.equal((init?.headers as Record<string,string>)["X-YNX-Confirm-Delete"],"DELETE MY SOCIAL DATA");
    return new Response(JSON.stringify({deleted:true}),{status:200});
  };
  try{
    const api=new SocialAPI("https://social.example","original-token");
    const current=api.authorizationGuard();
    assert.deepEqual(await api.deleteAccount(),{deleted:true});
    assert.equal(current(),false);
    await assert.rejects(api.profile(),/Social session is locked/);
    assert.equal(requests,1);
  }finally{globalThis.fetch=originalFetch;}
});

test("failed deletion retains authorization for explicit recovery", async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async ()=>new Response(JSON.stringify({error:"Service unavailable"}),{status:503});
  try{
    const api=new SocialAPI("https://social.example","original-token");
    const current=api.authorizationGuard();
    await assert.rejects(api.deleteAccount(),error=>error instanceof SocialAPIError&&error.status===503);
    assert.equal(current(),true);
  }finally{globalThis.fetch=originalFetch;}
});

test("late deletion response cannot invalidate a switched account", async () => {
  const originalFetch=globalThis.fetch;
  let complete!: (response:Response)=>void;
  globalThis.fetch=async ()=>new Promise<Response>(resolve=>{complete=resolve;});
  try{
    const api=new SocialAPI("https://social.example","original-token");
    const deletion=api.deleteAccount();
    api.setToken("new-account-token");
    const newCurrent=api.authorizationGuard();
    complete(new Response(JSON.stringify({deleted:true}),{status:200}));
    await assert.rejects(deletion,/Social authorization changed/);
    assert.equal(newCurrent(),true);
  }finally{globalThis.fetch=originalFetch;}
});
