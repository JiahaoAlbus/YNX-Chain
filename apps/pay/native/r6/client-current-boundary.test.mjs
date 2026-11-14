import test from 'node:test';import assert from 'node:assert/strict';import {NativePayBusinessClient} from './pay-business-client.mjs';
test('a non-void current result rejects before original invoice read and after a late change',async()=>{
 let calls=0,invalid=true;const client=new NativePayBusinessClient({current(){if(invalid)return true},pay:{async readInvoice(){calls++;invalid=true;return {id:'original-fixture'}}}});
 await assert.rejects(client.openInvoice('merchant','invoice'),{code:'NATIVE_PAY_PRODUCT_CURRENT_RESULT'});assert.equal(calls,0);assert.equal(client.snapshot().bill,null);
 invalid=false;await assert.rejects(client.openInvoice('merchant','invoice'),{code:'NATIVE_PAY_PRODUCT_CURRENT_RESULT'});assert.equal(calls,1);assert.equal(client.snapshot().bill,null);assert.equal(client.snapshot().phase,'unavailable');
});
