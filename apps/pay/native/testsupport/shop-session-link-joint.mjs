// PUBLIC pipe connects the original Go owned LINK client, not an Auth Source
// constructor. Actual SDK signature verification/session inventory stay in Go.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {createNativePayMainEntry} from '../r6/main-entry.mjs';
import {composeNativePayProductSource} from '../r6/product-source.mjs';
const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const read=async()=>{const line=await lines.next();assert(!line.done);return JSON.parse(line.value);};
const initial=await read(),file=process.env.PAY_MAIN_PRODUCT_MODULE;
assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),process.env.PAY_MAIN_PRODUCT_SHA256);
const {createWalletNativePayProduct}=await import(pathToFileURL(file).href);
let sourceReads=0,preparations=0,retired=0,joined=0,closed=0;
const forbidden=()=>{throw Error('read-only joint entered signing/review');};
const main={pendingRequests:()=>[],requestPQTypedAction:forbidden,requestPQPayBroadcast:forbidden,reject:forbidden};
const entry=createNativePayMainEntry({getMain:()=>null,getContext:()=>({account:initial.account,revision:1,focused:true})});
const loan={current(){},retire(){retired++;},join(){joined++;},close(){closed++;},
 pay:{createInvoiceIntent(original,current){current();preparations++;assert.deepEqual(JSON.parse(JSON.stringify(original)),initial.expected);throw Object.assign(Error(),{code:'PUBLIC_PAY_SOURCE_NOT_SUPPLIED'});}},
 async readOriginalShopNativeInvoiceRequestDATA(order,current){
  current();assert.equal(order,initial.expected.sourceOrder);sourceReads++;
  process.stdout.write(JSON.stringify({type:'original-read',order})+'\n');
  const packet=await read();current();assert.equal(packet.status,200);assert.equal(packet.physicallyClosed,true);
  return JSON.parse(Buffer.from(packet.body,'base64').toString('utf8'));
 }};
const source=await composeNativePayProductSource(entry,{acquireOriginalProductSource:()=>loan,isOriginalProductSource:v=>v===loan});
const service=createWalletNativePayProduct({entry:{...entry,invoke:entry.invokeResult},getMain:()=>main,getGuard:()=>({account:initial.account,assert(){}}),publishReview:forbidden});
try{
 const result=await service.invoke({action:'create-intent',productId:'shop.order',sourceOrder:initial.expected.sourceOrder});
 assert.equal(result.ok,false);assert.equal(result.code,'PUBLIC_PAY_SOURCE_NOT_SUPPLIED');assert.equal(result.outcome,'UNKNOWN');assert.equal(result.bill,undefined);assert.equal(result.walletRequest,undefined);assert.equal(result.canRetry,false);
 assert.equal(sourceReads,1);assert.equal(preparations,1);service.assertSafeToClose();
}finally{source.retire();await source.join();await source.close();source.assertSafeToClose();await lines.return();}
assert.deepEqual([retired,joined,closed],[1,1,1]);
process.stdout.write(JSON.stringify({type:'done',pinnedOriginalMainWrapper:true,originalRead:sourceReads,validatedOriginalRequests:preparations,payDispatched:0,signing:0,RootAdmission:false,SourceAdmission:false})+'\n');
