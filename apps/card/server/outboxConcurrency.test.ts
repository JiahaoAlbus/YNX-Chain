import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {CardStore} from './storage.ts';
import {CardService} from './service.ts';
import {CHAIN,unavailableWallet,unavailableCore,type Principal} from './contracts.ts';
const alice='0x'+'a'.repeat(40),bob='0x'+'b'.repeat(40);
const principal=(owner:string):Principal=>({owner,chainId:CHAIN,expiresAt:'2099-01-01T00:00:00Z',scopes:['account:read','card:application:write']});
function fixture(t:any){
  const directory=mkdtempSync(join(tmpdir(),'ynx-card-outbox-concurrency-')),key=randomBytes(32),file=join(directory,'card.sqlite');
  let store=new CardStore(file,key),service=new CardService({store,wallet:unavailableWallet,core:unavailableCore});
  t.after(()=>{store.close();key.fill(0)});
  return {get service(){return service},reopen(){store.close();store=new CardStore(file,key);service=new CardService({store,wallet:unavailableWallet,core:unavailableCore})}};
}
const draft=(service:CardService,owner=alice)=>service.createApplication(principal(owner),{nickname:'Software fixture',useCase:'Outbox concurrency only',limitWei:'100',riskAccepted:false},'draft');
test('same-owner concurrent flush coalesces while another owner progresses',async t=>{
  const f=fixture(t);draft(f.service);draft(f.service,bob);
  let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);let calls=0;
  const first=f.service.flushEvents(alice,{publish:async()=>{calls++;entered();await gate}});await ready;
  const second=f.service.flushEvents(alice,{publish:async()=>{throw Error('must not start duplicate worker')}});
  const otherIds:string[]=[];assert.deepEqual(await f.service.flushEvents(bob,{publish:async event=>{otherIds.push(event.id)}}),[]);
  assert.equal(otherIds.length,1);release();assert.deepEqual(await first,[]);assert.deepEqual(await second,[]);assert.equal(calls,1);
});
test('immutable outbound snapshot cannot change persisted event or acknowledgement identity',async t=>{
  const f=fixture(t);draft(f.service);let original='';
  const pending=await f.service.flushEvents(alice,{publish:async event=>{
    original=event.id;assert.ok(Object.isFrozen(event));assert.ok(Object.isFrozen(event.details));
    assert.throws(()=>{event.id='tampered'});assert.throws(()=>{event.details.secret='not persisted'});
    throw Error('explicit fixture outage');
  }});
  assert.equal(pending.length,1);assert.equal(pending[0]?.id,original);assert.deepEqual(pending[0]?.details,{});assert.equal(pending[0]?.attempts,1);
  f.reopen();const ids:string[]=[];assert.deepEqual(await f.service.flushEvents(alice,{publish:async event=>{ids.push(event.id)}}),[]);assert.deepEqual(ids,[original]);
});
test('transport failure releases owner lock and keeps stable event for retry',async t=>{
  const f=fixture(t);draft(f.service);const first=await f.service.flushEvents(alice,{publish:async()=>{throw Error('outage')}});
  assert.equal(first[0]?.attempts,1);const ids:string[]=[];
  assert.deepEqual(await f.service.flushEvents(alice,{publish:async event=>{ids.push(event.id)}}),[]);assert.deepEqual(ids,[first[0]?.id]);
  assert.deepEqual(await f.service.flushEvents(alice,{publish:async()=>{throw Error('already delivered must not publish')}}),[]);
});
