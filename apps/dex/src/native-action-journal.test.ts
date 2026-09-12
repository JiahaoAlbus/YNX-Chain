// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createNativeActionJournal, type NativeJournalStore } from './native-action-journal';
import { nativeFixture } from './fixtures/native-fixture';
import { createApplicationActionReturnURL, parseApplicationActionWalletURL, type NativeRequest } from './vendor/application-actions-browser.mjs';
import registry from './vendor/native-action-registry.json';

// Public synthetic key 1, never user/Wallet storage, no network or chain action.
const SIGNER='0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
const A='ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80';
const B='ynx1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3z4qf3ax';
const NOW=new Date('2026-09-12T11:30:00.000Z');
class MemoryStore implements NativeJournalStore {
  values=new Map<string,string>();tail:Promise<unknown>=Promise.resolve();writes=0;
  update(key:string,change:(value:string|null)=>string|null):Promise<string|null>{
    const task=this.tail.then(()=>{const old=this.values.get(key)??null,value=change(old);if(value!==old){this.writes++;if(value===null)this.values.delete(key);else this.values.set(key,value);}return value;});
    this.tail=task.catch(()=>{});return task;
  }
}
function input(account=A,signer=SIGNER){
  const snapshot=nativeFixture(signer);
  return {account,action:'dex_swap_exact_input' as const,payload:{poolId:snapshot.pools[0].id,assetIn:'YNXT',amountIn:10,minAmountOut:1,deadlineUnix:Math.floor(Date.now()/1000)+240},snapshot};
}
const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
function signedFixture(request:NativeRequest){
  const payload={poolId:request.payload.poolId,assetIn:request.payload.assetIn,amountIn:request.payload.amountIn,minAmountOut:request.payload.minAmountOut,deadlineUnix:request.payload.deadlineUnix};
  const unsigned={version:1,chainId:6423,type:'application_action',signer:SIGNER,nonce:request.nonce,action:request.action,payload,payloadHash:hash(JSON.stringify(payload)),fee:1,aiUnits:0,payUnits:0,publicKey:'0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'};
  const signature=secp256k1.sign(Buffer.from(hash(JSON.stringify({domain:'YNX_APPLICATION_ACTION_V1',...unsigned})),'hex'),Buffer.from('0'.repeat(63)+'1','hex'),{prehash:false,format:'der',lowS:true});
  return JSON.stringify({...unsigned,signature:Buffer.from(signature).toString('hex')});
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);vi.stubGlobal('location',{origin:'https://dex.ynxweb4.com',href:'https://dex.ynxweb4.com/'});vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No transport is permitted');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.useRealTimers();vi.unstubAllGlobals();});

describe('fixed SDK native intent journal; synthetic local evidence only',()=>{
  it('commits exact pending before exposing an SDK URL, without navigation or proof requests',async()=>{
    const store=new MemoryStore(),journal=createNativeActionJournal(store),before=location.href;
    const draft=await journal.prepare(input());expect(draft.request.nonce).toBe(4);expect(store.writes).toBe(1);
    expect(draft).not.toHaveProperty('url');expect(draft.signed).toBeNull();
    const url=await journal.walletURL(A,draft.digest);
    expect(parseApplicationActionWalletURL(registry,url)).toEqual(draft.request);
    expect(draft.request.callback).toBe('https://dex.ynxweb4.com/wallet-auth/callback');
    expect(location.href).toBe(before);expect(store.writes).toBe(1);
  });
  it('requires commit success, not an optimistic in-memory save',async()=>{
    const broken:NativeJournalStore={update:async()=>{throw Error('disk blocked');}};
    await expect(createNativeActionJournal(broken).prepare(input())).rejects.toThrow('disk blocked');
    const lying:NativeJournalStore={update:async()=>null};
    await expect(createNativeActionJournal(lying).prepare(input())).rejects.toMatchObject({code:'NATIVE_DRAFT_PERSISTENCE_FAILED'});
  });
  it('serializes competing tabs to one pending nonce, with independent users',async()=>{
    const store=new MemoryStore(),one=createNativeActionJournal(store),two=createNativeActionJournal(store);
    const results=await Promise.allSettled([one.prepare(input()),two.prepare(input())]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    await two.prepare(input(B,'0x2222222222222222222222222222222222222222'));
    expect(store.values.size).toBe(2);expect((await one.read(A))?.request.account).toBe(A);expect((await one.read(B))?.request.account).toBe(B);
  });
  it('cold restoration retains original request, state, nonce and URL',async()=>{
    const store=new MemoryStore(),one=createNativeActionJournal(store),draft=await one.prepare(input());
    const url=await one.walletURL(A,draft.digest),cold=createNativeActionJournal(store);
    vi.setSystemTime(new Date(NOW.getTime()+30_000));
    expect(await cold.read(A)).toEqual(draft);expect(await cold.walletURL(A,draft.digest)).toBe(url);
    await expect(cold.prepare(input())).rejects.toMatchObject({code:'NATIVE_INTENT_ALREADY_EXISTS'});
  });
  it('does not mint a new intent on expiry; explicit discard is digest-bound',async()=>{
    const journal=createNativeActionJournal(new MemoryStore()),draft=await journal.prepare(input());
    vi.setSystemTime(new Date(NOW.getTime()+301_000));
    expect(await journal.read(A)).toEqual(draft);
    await expect(journal.walletURL(A,draft.digest)).rejects.toMatchObject({code:'EXPIRED_APPLICATION_ACTION'});
    await expect(journal.prepare(input())).rejects.toMatchObject({code:'NATIVE_INTENT_ALREADY_EXISTS'});
    await expect(journal.discardUnsigned(A,'other')).rejects.toMatchObject({code:'NATIVE_DRAFT_SUPERSEDED'});
    await journal.discardUnsigned(A,draft.digest);expect(await journal.read(A)).toBeNull();
  });
  it('accepts exact rejection idempotently; tamper, duplicate fields, wrong callback and cross-account fail closed',async()=>{
    const journal=createNativeActionJournal(new MemoryStore()),draft=await journal.prepare(input());
    const url=createApplicationActionReturnURL(registry,draft.request,{status:'rejected',reason:'USER_REJECTED'});
    for(const bad of [url.replace('dex.ynxweb4.com','evil.example'),url+'&other=1',url+'#x',url.replace('applicationActionResult=','result=')])await expect(journal.acceptReturn(A,bad)).rejects.toThrow();
    await expect(journal.acceptReturn(B,url)).rejects.toMatchObject({code:'NATIVE_PENDING_REQUIRED'});
    const changed={...draft.request,state:'a'.repeat(64)};
    await expect(journal.acceptReturn(A,createApplicationActionReturnURL(registry,changed,{status:'rejected',reason:'USER_REJECTED'}))).rejects.toMatchObject({code:'BINDING_MISMATCH'});
    const result=await journal.acceptReturn(A,url);expect(result.status).toBe('rejected');expect(result.signed).toBeNull();expect(await journal.acceptReturn(A,url)).toEqual(result);
    await expect(journal.walletURL(A,draft.digest)).rejects.toMatchObject({code:'NATIVE_DRAFT_SUPERSEDED'});
  });
  it('cryptographically verifies synthetic signed callback, preserves exact wire bytes/hash and never broadcasts',async()=>{
    const store=new MemoryStore(),journal=createNativeActionJournal(store),draft=await journal.prepare(input());
    const signed=signedFixture(draft.request),url=createApplicationActionReturnURL(registry,draft.request,{status:'approved',signed});
    const result=await journal.acceptReturn(A,url);
    expect(result.signed).toBe(signed);expect(result.transactionHash).toBe('0x'+hash(signed));
    expect(await createNativeActionJournal(store).acceptReturn(A,url)).toEqual(result);
    await expect(journal.discardUnsigned(A,draft.digest)).rejects.toMatchObject({code:'NATIVE_SIGNED_INTENT_MUST_BE_RETAINED'});
    vi.setSystemTime(new Date(NOW.getTime()+3600_000));
    expect((await journal.read(A))?.transactionHash).toBe(result.transactionHash);
    await expect(journal.prepare(input())).rejects.toMatchObject({code:'NATIVE_INTENT_ALREADY_EXISTS'});
  });
  it('rejects conflicting decision after callback consumption',async()=>{
    const journal=createNativeActionJournal(new MemoryStore()),draft=await journal.prepare(input());
    await journal.acceptReturn(A,createApplicationActionReturnURL(registry,draft.request,{status:'rejected',reason:'USER_REJECTED'}));
    await expect(journal.acceptReturn(A,createApplicationActionReturnURL(registry,draft.request,{status:'approved',signed:signedFixture(draft.request)}))).rejects.toMatchObject({code:'NATIVE_CALLBACK_ALREADY_CONSUMED'});
  });
  it('requires exact current snapshot, supported integer nonce, pool and assets before storage',async()=>{
    for(const mutate of [
      (i:ReturnType<typeof input>)=>{i.snapshot.asOf=i.snapshot.updatedAt=new Date(NOW.getTime()-15_001).toISOString();},
      (i:ReturnType<typeof input>)=>{i.snapshot.account.nonce='9007199254740991';i.snapshot.account.nextNonce='9007199254740992';},
      (i:ReturnType<typeof input>)=>{i.payload.poolId='dex_unknown';},
      (i:ReturnType<typeof input>)=>{i.payload.assetIn='unknown-asset';},
      (i:ReturnType<typeof input>)=>{i.payload.amountIn=Number.MAX_SAFE_INTEGER+1;},
      (i:ReturnType<typeof input>)=>{i.snapshot.chainId='1';},
    ]){const store=new MemoryStore(),value=input();mutate(value);await expect(createNativeActionJournal(store).prepare(value)).rejects.toThrow();expect(store.values.size).toBe(0);}
  });
  it('detaches payload and refuses accessor caller fields without evaluating them',async()=>{
    const journal=createNativeActionJournal(new MemoryStore()),value=input(),draft=await journal.prepare(value);value.payload.amountIn=999;
    expect(draft.request.payload.amountIn).toBe(10);
    let reads=0;const evil=input();Object.defineProperty(evil,'account',{enumerable:true,get(){reads++;return A;}});
    await expect(journal.prepare(evil)).rejects.toMatchObject({code:'NATIVE_REVIEW_INVALID'});expect(reads).toBe(0);
  });
  it('quarantines corrupted records instead of silently discarding or regenerating',async()=>{
    const store=new MemoryStore(),journal=createNativeActionJournal(store);await journal.prepare(input());
    const k=[...store.values.keys()][0],corrupt=JSON.parse(store.values.get(k)!);corrupt.request.nonce=999;store.values.set(k,JSON.stringify(corrupt));
    await expect(journal.read(A)).rejects.toMatchObject({code:'NATIVE_DRAFT_BINDING_MISMATCH'});
    expect(store.values.has(k)).toBe(true);await expect(journal.prepare(input())).rejects.toMatchObject({code:'NATIVE_INTENT_ALREADY_EXISTS'});
  });
  it('never claims canonical production origin from a local test page',async()=>{
    vi.stubGlobal('location',{origin:'http://127.0.0.1:4198'});const store=new MemoryStore();
    await expect(createNativeActionJournal(store).prepare(input())).rejects.toMatchObject({code:'NATIVE_ACTION_ORIGIN_UNAVAILABLE'});expect(store.values.size).toBe(0);
  });
});
