import assert from "node:assert/strict";
import test from "node:test";
import type { SocialAPI } from "./api";
import { ContactRequestFlow } from "./contactRequestFlow";

test("Native cancelled never-settling send permits fresh review and preserves original unknown intent", async () => {
  let generation = 0;
  let resolveOld!: () => void;
  let resolveNew!: () => void;
  const sends: unknown[][] = [];
  const api = {
    authorizationGuard: () => { const current = generation; return () => generation === current; },
    previewContact: async (_source: string, value: string) => ({person:{id:"sp_"+"a".repeat(32),handle:value,displayName:value}}),
    requestContact: (...args: unknown[]) => {
      sends.push(args);
      return new Promise<void>(resolve => { if(sends.length===1)resolveOld=resolve;else resolveNew=resolve; });
    },
  } as unknown as SocialAPI;
  const flow = new ContactRequestFlow(api, async () => "a".repeat(32));
  const original = await flow.preview("handle", "alice");
  const old = flow.confirm(original,"original note");
  const cancelled = assert.rejects(old,/cancelled/);
  flow.cancel();
  const next = await flow.preview("handle","bob");
  await cancelled;
  assert.equal(flow.uncertainRequests.length,1);
  const uncertain=flow.uncertainRequests[0];
  assert.ok(uncertain);
  assert.equal(uncertain.review,original);
  assert.equal(uncertain.message,"original note");
  const current = flow.confirm(next,"new note");
  resolveOld();
  await Promise.resolve();
  assert.equal(flow.isCurrent(next),true);
  await assert.rejects(flow.confirm(next,"new note"),/already being sent/);
  assert.equal(sends.length,2);
  resolveNew();
  await current;
  assert.equal(flow.uncertainRequests.length,1);
  generation++;
  assert.equal(flow.uncertainRequests.length,0);
});

test("Native cancellation bounds a never-settling preview before fresh review", async () => {
  let previewCount=0;
  const api={
    authorizationGuard:()=>()=>true,
    previewContact:()=>++previewCount===1?new Promise(()=>{}):Promise.resolve({person:{id:"sp_"+"b".repeat(32),handle:"bob",displayName:"Bob"}}),
  } as unknown as SocialAPI;
  const flow=new ContactRequestFlow(api,async()=>"b".repeat(32));
  const first=flow.preview("handle","alice");
  const rejected=assert.rejects(first,/cancelled/);
  flow.cancel();
  const next=await flow.preview("handle","bob");
  await rejected;
  assert.equal(flow.isCurrent(next),true);
});
