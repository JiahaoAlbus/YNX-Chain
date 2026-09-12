// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNativeActionJournal, type NativeJournalStore } from './native-action-journal';
import { createApplicationActionLauncher } from './vendor/application-actions-browser.mjs';
import { nativeFixture } from './fixtures/native-fixture';
import registry from './vendor/native-runtime-registry.json';
const ACCOUNT='ynx1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3z4qf3ax';
const NOW=new Date('2026-09-12T11:30:00.000Z');
class Store implements NativeJournalStore {
  value:string|null=null;
  async update(_key:string,change:(value:string|null)=>string|null){this.value=change(this.value);return this.value;}
}
// Explicit environment doubles, not installed handler or actual user evidence.
class Click {
  type='click';isTrusted=true;defaultPrevented=false;button=0;eventPhase=2;currentTarget={};
  preventDefault(){this.defaultPrevented=true;}
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);vi.stubGlobal('location',{origin:'https://dex.ynxweb4.com'});vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No network');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.useRealTimers();vi.unstubAllGlobals();});
async function fixture(){
  const store=new Store(),journal=createNativeActionJournal(store),snapshot=nativeFixture('0x2222222222222222222222222222222222222222');
  const draft=await journal.prepare({account:ACCOUNT,action:'dex_swap_exact_input',snapshot,payload:{poolId:snapshot.pools[0].id,assetIn:'YNXT',amountIn:10,minAmountOut:1,deadlineUnix:Date.now()/1000+240}});
  const state={account:ACCOUNT},assign=vi.fn();
  const environment={location:{origin:'https://dex.ynxweb4.com',assign},MouseEvent:Click,navigator:{userActivation:{isActive:true}},addEventListener:vi.fn(),removeEventListener:vi.fn(),document:{addEventListener:vi.fn(),removeEventListener:vi.fn()}};
  const make=()=>createApplicationActionLauncher(registry,{productId:'dex',getActiveAccount:()=>state.account,loadPendingRequest:async()=>{const saved=await journal.read(ACCOUNT);return saved?.status==='pending'?saved.request:null;},environment:environment as unknown as Window});
  return {store,journal,draft,state,environment,assign,make,launcher:make()};
}
it('3720 launcher reads the original ff5b journal without minting or extending intent, then explicit click alone dispatches',async()=>{
  const f=await fixture(),before=f.store.value,target=await f.launcher.prepare();
  expect(target.status).toBe('ready');expect(f.assign).not.toHaveBeenCalled();expect(f.store.value).toBe(before);
  if(target.status!=='ready')throw Error('not ready');
  expect(target).toMatchObject({requestDigest:f.draft.digest,installation:'unknown',automatic:false,expiresAt:f.draft.request.expiresAt});
  expect(f.launcher.open(new Click() as unknown as MouseEvent,target.requestDigest)).toMatchObject({status:'launch-attempted',installation:'unknown',automatic:false});
  expect(f.assign).toHaveBeenCalledExactlyOnceWith(target.walletURL);expect(f.store.value).toBe(before);
});
it('cold page preparation keeps exact request URL and permits a fresh explicit click, not an installation claim',async()=>{
  const f=await fixture(),first=await f.launcher.prepare();f.launcher.dispose();vi.setSystemTime(new Date(NOW.getTime()+30_000));
  const cold=f.make(),second=await cold.prepare();expect(second).toEqual(first);
  expect(f.assign).not.toHaveBeenCalled();cold.open(new Click() as unknown as MouseEvent,f.draft.digest);expect(f.assign).toHaveBeenCalledTimes(1);
});
it('untrusted synthetic DOM click and mismatched review digest fail before dispatch',async()=>{
  const f=await fixture();await f.launcher.prepare();const click=new Click();click.isTrusted=false;
  expect(()=>f.launcher.open(click as unknown as MouseEvent,f.draft.digest)).toThrow();
  expect(()=>f.launcher.open(new Click() as unknown as MouseEvent,'other')).toThrow();expect(f.assign).not.toHaveBeenCalled();
});
it.each(['invalidate','account','origin','expiry'] as const)('%s invalidates the prepared action without changing durable state',async change=>{
  const f=await fixture(),saved=f.store.value;await f.launcher.prepare();
  if(change==='invalidate')f.launcher.invalidate();if(change==='account')f.state.account='different';if(change==='origin')f.environment.location.origin='https://other.invalid';if(change==='expiry')vi.setSystemTime(new Date(f.draft.request.expiresAt));
  expect(()=>f.launcher.open(new Click() as unknown as MouseEvent,f.draft.digest)).toThrow();expect(f.assign).not.toHaveBeenCalled();expect(f.store.value).toBe(saved);
});
it('discard and commit invalidation do not recreate an intent or silently prepare a fresh nonce',async()=>{
  const f=await fixture();await f.launcher.prepare();await f.journal.discardUnsigned(ACCOUNT,f.draft.digest);f.launcher.invalidate();
  expect(()=>f.launcher.open(new Click() as unknown as MouseEvent,f.draft.digest)).toThrow();
  expect(await f.launcher.prepare()).toMatchObject({status:'no-pending-request',installation:'unknown'});expect(f.store.value).toBeNull();expect(f.assign).not.toHaveBeenCalled();
});
