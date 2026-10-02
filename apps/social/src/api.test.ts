import assert from "node:assert/strict";
import test from "node:test";

import {
  adoptRotatedSession,
  SocialAPI,
  type DeviceRotationResponse,
  type Session,
} from "./api";
import type {SessionProof} from "./scopedSessionBridge";

function proof(account:string):SessionProof{return {proof:{account},proofHeader:"synthetic-test-proof"} as unknown as SessionProof}
function deferred<T>(){let resolve!:(value:T)=>void, reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}

test("stale unauthorized HTTP response cannot invalidate a newer authorization",async()=>{
  const api=new SocialAPI("http://127.0.0.1:6431"),pending=deferred<Response>(),started=deferred<boolean>();
  let invalidations=0,fetches=0;api.onPrivateInvalidated=()=>{invalidations++};
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{fetches++;if(fetches===1){started.resolve(true);return pending.promise}return new Response(JSON.stringify({record:{id:"account-b"}}),{status:200})};
  try{
    api.useProductSession(async()=>proof("account-a"),"account-a");
    const stale=assert.rejects(api.profile(),/authorization changed/);
    await started.promise;api.useProductSession(async()=>proof("account-b"),"account-b");
    pending.resolve(new Response(JSON.stringify({error:"old permission expired"}),{status:401}));
    await stale;assert.equal(invalidations,0);assert.equal((await api.profile()).record.id,"account-b");
  }finally{globalThis.fetch=original}
});

for(const outcome of ["resolve","reject"] as const){
  for(const nextAccount of ["account-b","account-a"]){
    test(`late ${outcome} cannot invalidate replacement ${nextAccount} generation`,async()=>{
      const api=new SocialAPI("http://127.0.0.1:6431"),pending=deferred<SessionProof>();
      let invalidations=0,fetches=0;
      api.onPrivateInvalidated=()=>{invalidations++};
      const original=globalThis.fetch;
      globalThis.fetch=async()=>{fetches++;return new Response(JSON.stringify({record:{id:nextAccount}}),{status:200})};
      try{
        api.useProductSession(()=>pending.promise,"account-a");
        const stale=assert.rejects(api.profile());
        api.useProductSession(async()=>proof(nextAccount),nextAccount);
        if(outcome==="resolve")pending.resolve(proof("account-a"));else pending.reject(new Error("old proof failed"));
        await stale;
        assert.equal(invalidations,0);
        assert.equal(fetches,0);
        assert.equal((await api.profile()).record.id,nextAccount);
        assert.equal(fetches,1);
      }finally{globalThis.fetch=original}
    });
  }
  test(`late ${outcome} after logout cannot resurrect or reinvalidate authorization`,async()=>{
    const api=new SocialAPI("http://127.0.0.1:6431"),pending=deferred<SessionProof>();let invalidations=0;
    api.onPrivateInvalidated=()=>{invalidations++};api.useProductSession(()=>pending.promise,"account-a");
    const stale=assert.rejects(api.profile());api.setToken(null);
    if(outcome==="resolve")pending.resolve(proof("account-a"));else pending.reject(new Error("old proof failed"));
    await stale;assert.equal(invalidations,1);await assert.rejects(api.profile(),/locked/);
  });
}
for(const outcome of ["reject","wrong-account"]){
  test(`current proof ${outcome} still invalidates current authorization`,async()=>{
    const api=new SocialAPI("http://127.0.0.1:6431");let invalidations=0;
    api.onPrivateInvalidated=()=>{invalidations++};
    api.useProductSession(async()=>{if(outcome==="reject")throw new Error("current proof failed");return proof("different-account")},"account-a");
    await assert.rejects(api.profile());assert.equal(invalidations,1);await assert.rejects(api.profile(),/locked/);
  });
}

test("device rotation adopts the replacement session token without losing profile state", () => {
  const previous: Session = {
    token: "token-old",
    session: {
      id: "session-old",
      account: "ynx1socialaccount",
      deviceId: "device-old",
      scopes: ["social.profile", "social.messaging"],
      createdAt: "2026-07-27T12:00:00Z",
      expiresAt: "2026-07-28T12:00:00Z",
    },
    profile: {
      id: "ynx1socialaccount",
      handle: "alice",
      displayName: "Alice",
    },
  };
  const result: DeviceRotationResponse = {
    record: { id: "rotation-1" },
    replayed: false,
    token: "token-new",
    session: {
      ...previous.session,
      id: "session-new",
      deviceId: "device-new",
    },
  };

  const next = adoptRotatedSession(previous, result);

  assert.notStrictEqual(next, previous);
  assert.equal(next.token, result.token);
  assert.strictEqual(next.session, result.session);
  assert.strictEqual(next.profile, previous.profile);
  assert.equal(previous.token, "token-old");
  assert.equal(previous.session.deviceId, "device-old");
});
