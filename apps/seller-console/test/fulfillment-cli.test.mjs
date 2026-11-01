import test from 'node:test';
import assert from 'node:assert/strict';
import {createMutationIntents} from '../mutation-intents.js';
import {runFulfillmentCLI} from '../native/fulfillment-cli.mjs';
const orderID='order_original',storeID='store_original',body={Carrier:'Actual original carrier',TrackingNumber:'Original shipment 01'};
const order=()=>({ID:orderID,StoreID:storeID,Status:'shipped',Shipment:{...body,Status:'shipped',UpdatedAt:'2026-11-01T00:00:00Z'},Buyer:'PUBLIC-private-buyer',Address:{Line1:'PUBLIC-private-address'}});
function fixture(){let actor='PUBLIC-owner';const rows=new Map(),account=()=>actor;return {rows,actor:v=>actor=v,runtime:api=>({orderID,storeID,body,account,current(){},api,intents:createMutationIntents(account,{storage:{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},withLock:async(_,work)=>work()})})};}
test('lost shipment reply cold recovery reads only exact original with no second shipment',async()=>{
 const f=fixture();let sent,writes=0;
 await assert.rejects(runFulfillmentCLI({...f.runtime(async(path,r)=>{assert.equal(path,`/orders/${orderID}/transition`);r.beforeDispatch();sent=JSON.parse(r.body);writes++;throw Error('PUBLIC lost response');}),command:'ship'}));
 const saved=[...f.rows];
 await assert.rejects(runFulfillmentCLI({...f.runtime(()=>assert.fail('replacement or resend')),command:'ship',body:{...body,TrackingNumber:'replacement'}}),{code:'SELLER_MUTATION_UNRESOLVED'});assert.deepEqual([...f.rows],saved);
 const result=await runFulfillmentCLI({...f.runtime(async(path,r)=>{assert.equal(path,'/seller/mutations/lookup');const query=JSON.parse(r.body);assert.deepEqual(JSON.parse(query.OriginalBody),sent);return {Actor:'PUBLIC-owner',Method:'POST',Path:query.Path,IdempotencyKey:sent.IdempotencyKey,Result:order()};}),command:'recover-ship'});
 assert.equal(writes,1);assert.equal(result.result.Shipment.TrackingNumber,body.TrackingNumber);assert.equal(result.fundsVerified,false);assert.equal(result.result.Address,undefined);assert.equal(result.result.Buyer,undefined);assert.equal([...f.rows.keys()].filter(k=>!k.endsWith(':revision')).length,0);
});
test('wrong original order/store/shipment/actor and changed Source retain UNKNOWN',async()=>{
 for(const mode of ['order','store','carrier','tracking','account']){
  const f=fixture();await assert.rejects(runFulfillmentCLI({...f.runtime(async(_,r)=>{r.beforeDispatch();const value=order();if(mode==='order')value.ID='other';if(mode==='store')value.StoreID='other';if(mode==='carrier')value.Shipment.Carrier='other';if(mode==='tracking')value.Shipment.TrackingNumber='other';if(mode==='account')f.actor('foreign');return value;}),command:'ship'}));assert.equal(f.rows.size,1);
 }
 const f=fixture();await assert.rejects(runFulfillmentCLI({...f.runtime(async(_,r)=>{r.beforeDispatch();throw Error('PUBLIC lost');}),command:'ship'}));const before=[...f.rows];await assert.rejects(runFulfillmentCLI({...f.runtime(async(_,r)=>{const query=JSON.parse(r.body);return {Actor:'foreign',Method:'POST',Path:query.Path,IdempotencyKey:JSON.parse(query.OriginalBody).IdempotencyKey,Result:order()};}),command:'recover-ship'}));assert.deepEqual([...f.rows],before);
});
test('inspect is original authorized read-only bounded DATA and excludes private contacts',async()=>{
 const f=fixture();const result=await runFulfillmentCLI({...f.runtime(async(path,r)=>{assert.equal(path,`/orders/${orderID}`);assert.equal(r.method,'GET');assert.equal(r.body,undefined);return order();}),body:{},command:'inspect'});assert.equal(f.rows.size,0);assert.equal(result.result.Address,undefined);assert.equal(result.result.Shipment.Carrier,body.Carrier);
 for(const invalid of [{Carrier:'',TrackingNumber:'x'},{...body,paid:true},{Carrier:'a'.repeat(121),TrackingNumber:'x'},{Carrier:'actual',TrackingNumber:'字'.repeat(67)}])await assert.rejects(runFulfillmentCLI({...f.runtime(()=>assert.fail('invalid input dispatched')),body:invalid,command:'ship'}));
});
