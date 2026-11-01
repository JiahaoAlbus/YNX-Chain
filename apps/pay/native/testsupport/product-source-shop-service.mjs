// PUBLIC interprocess test bridge to the original Go LINK client. No normal
// Source/authority is constructed by these JSON messages or this recognizer.
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {openNativePayProductSource} from '../product-source.mjs';
import {nativeInvoiceProductIntentData} from '../invoice-product-intent.mjs';
const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const read=async()=>{const next=await lines.next();if(next.done)throw Error('Original fixture bridge closed');return JSON.parse(next.value);};
const {ref,expected}=await read();
let calls=0;
const loan={pay:{},current(){},retire(){},async join(){},async close(){},
 async readOriginalShopNativeInvoiceRequestDATA(order,current){
  current();assert.equal(order,ref.sourceOrder);calls++;
  process.stdout.write(JSON.stringify({type:'read',...ref})+'\n');
  const packet=await read();current();
  if(packet.status!==200)throw Object.assign(Error('ORIGINAL_SHOP_READ_REFUSED'),{code:'ORIGINAL_SHOP_READ_REFUSED',status:packet.status});
  return JSON.parse(Buffer.from(packet.body,'base64').toString('utf8'));
 }};
const source=await openNativePayProductSource({acquireOriginalProductSource:async()=>loan,isOriginalProductSource:value=>value===loan});
try{
 const want=nativeInvoiceProductIntentData(expected);
 for(let i=0;i<2;i++)assert.deepEqual(await source.readOriginalInvoiceIntent(ref,()=>{}),want);
 await assert.rejects(source.readOriginalInvoiceIntent(ref,()=>{}),{code:'ORIGINAL_SHOP_READ_REFUSED',status:403});
 assert.equal(calls,3);
 process.stdout.write(JSON.stringify({type:'done',originalReads:2,revokedDenied:true,SourceAdmission:false})+'\n');
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();await lines.return();}
