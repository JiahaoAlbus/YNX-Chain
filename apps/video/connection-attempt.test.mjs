import test from 'node:test';
import assert from 'node:assert/strict';
import {connectMediaWallet as video} from './session-events.js';
import {connectMediaWallet as creator} from '../creator-studio/session-events.js';
for(const [name,connectMediaWallet] of [['Video',video],['Creator Studio',creator]]) {
 test(name+' transport invokes synchronously, releases cancelled and late connections, and rejects late identity',async()=>{
  const abort=new AbortController();let complete,calls=0,closes=0;
  const pending=connectMediaWallet({connect:()=>{calls++;return new Promise(r=>complete=r)},release:()=>{closes++},signal:abort.signal});assert.equal(calls,1);
  abort.abort();await assert.rejects(pending,{code:'PRODUCT_APPROVAL_CANCELLED'});assert.equal(closes,1);complete({request(){}});await new Promise(r=>setImmediate(r));assert.equal(closes,2);
  calls=0;await assert.rejects(connectMediaWallet({connect:()=>{calls++},signal:abort.signal}),{code:'PRODUCT_APPROVAL_CANCELLED'});assert.equal(calls,0);
  let current=true,finish;const changed=connectMediaWallet({connect:()=>new Promise(r=>finish=r),isCurrent:()=>current});current=false;finish({request(){}});await assert.rejects(changed,{code:'PRODUCT_APPROVAL_CANCELLED'});
 });
 test(name+' real 15 second deadline settles an ignored transport, safe cleanup and new attempt succeed',async()=>{
  let closed=0;const start=Date.now();await assert.rejects(connectMediaWallet({connect:()=>new Promise(()=>{}),release:()=>{closed++;throw Error('Transport cleanup failed')}}),{code:'PRODUCT_CONNECTION_TIMEOUT'});assert.ok(Date.now()-start>=14900);assert.equal(closed,1);
  const provider={request(){}};assert.equal(await connectMediaWallet({connect:()=>provider}),provider);
 });
}
