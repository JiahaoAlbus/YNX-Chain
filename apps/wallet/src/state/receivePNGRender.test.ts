import test from 'node:test';
import assert from 'node:assert/strict';
import {exportReceivePNG} from './receivePNG';

const account='ynx1zp6c2ra98djygdwldzx75jqwzgvgyjy7gu862s';
// Public PNG header fixture for render orchestration, not native image validation.
const png='iVBORw0KGgoAAA==';

test('renderer throwing after a synchronous callback cannot open the picker',async()=>{
 let calls=0;const failure=Error('renderer failed after callback');
 await assert.rejects(exportReceivePNG(account,cb=>{cb(png);throw failure},async()=>{calls++;return {status:'saved'}},()=>{}),error=>error===failure);
 assert.equal(calls,0);
});

test('normal synchronous and asynchronous callbacks still save exactly once',async()=>{
 for(const asynchronous of [false,true]){
  let calls=0;
  const result=await exportReceivePNG(account,cb=>{if(asynchronous)queueMicrotask(()=>cb(png));else cb(png)},async bytes=>{calls++;assert.equal(bytes,png);return {status:'saved'}},()=>{});
  assert.deepEqual(result,{status:'saved'});assert.equal(calls,1);
 }
});

test('duplicate callback cannot replace the first result or save twice',async()=>{
 let calls=0;
 await exportReceivePNG(account,cb=>{cb(png);cb('invalid')},async bytes=>{calls++;assert.equal(bytes,png);return {status:'saved'}},()=>{});
 assert.equal(calls,1);
 await assert.rejects(exportReceivePNG(account,cb=>{cb('invalid');cb(png)},async()=>{calls++;return {status:'saved'}},()=>{}),/INVALID_RECEIVE_PNG/);
 assert.equal(calls,1);
});

test('throwing renderer retires a retained callback without a later save',async()=>{
 let late:((value:string)=>void)|undefined,calls=0;
 await assert.rejects(exportReceivePNG(account,cb=>{late=cb;throw Error('render failed')},async()=>{calls++;return {status:'saved'}},()=>{}),/render failed/);
 late?.(png);await Promise.resolve();assert.equal(calls,0);
});

test('timed out renderer cannot open a picker from its late callback',async()=>{
 let late:((value:string)=>void)|undefined,calls=0;
 await assert.rejects(exportReceivePNG(account,cb=>{late=cb},async()=>{calls++;return {status:'saved'}},()=>{},5),/PNG_RENDER_TIMEOUT/);
 late?.(png);await Promise.resolve();assert.equal(calls,0);
});
