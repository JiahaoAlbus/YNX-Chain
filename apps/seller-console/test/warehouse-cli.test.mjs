import test from 'node:test';
import assert from 'node:assert/strict';
import {createMutationIntents} from '../mutation-intents.js';
import {runWarehouseCLI} from '../native/warehouse-cli.mjs';
const orderID='order_original',storeID='store_original',body={ReturnID:'return_original',EvidenceReference:'warehouse_original',Items:[{ProductID:'product_one',VariantID:'v1',Quantity:'1'}]};
const raw=stocked=>({ID:orderID,StoreID:storeID,ReturnReceipts:[{ID:'receipt_original',ReturnID:body.ReturnID,EvidenceReference:body.EvidenceReference,Items:body.Items,...(stocked?{RestockedAt:'2026-11-01T00:00:00Z',RestockedBy:'PUBLIC-inventory'}:{})}]});
function fixture(){const rows=new Map();let actor='PUBLIC-owner';const account=()=>actor;return {rows,setActor:v=>actor=v,create:api=>({orderID,storeID,account,current(){},api,intents:createMutationIntents(account,{storage:{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},withLock:async(_,work)=>work()})})}}
test('partial receive and independent restock each recover only their own original request',async()=>{
 const f=fixture();let writes=0;
 for(const action of ['receive','restock']){
  const input=action==='receive'?body:{ReceiptID:'receipt_original'};let original;
  await assert.rejects(runWarehouseCLI({...f.create(async(_,r)=>{r.beforeDispatch();writes++;original=JSON.parse(r.body);throw Error('PUBLIC lost response')}),command:action,body:input}));
  const result=await runWarehouseCLI({...f.create(async(path,r)=>{assert.equal(path,'/seller/mutations/lookup');const q=JSON.parse(r.body);assert.deepEqual(JSON.parse(q.OriginalBody),original);return {Actor:'PUBLIC-owner',Method:'POST',Path:q.Path,IdempotencyKey:original.IdempotencyKey,Result:raw(action==='restock')}}),command:'recover-'+action,body:input});
  assert.equal(result.fundsVerified,false);assert.equal(result.result.Receipt.Restocked,action==='restock');
 }
 assert.equal(writes,2);assert.equal([...f.rows.keys()].filter(k=>!k.endsWith(':revision')).length,0);
});
test('wrong original, unstocked reply, edited UNKNOWN and current account loss retain recovery',async()=>{
 for(const mode of ['wrong-order','unstocked','account']){
  const f=fixture();
  await assert.rejects(runWarehouseCLI({...f.create(async(_,r)=>{r.beforeDispatch();const value=raw(mode!=='unstocked');if(mode==='wrong-order')value.ID='other';if(mode==='account')f.setActor('other');return value}),command:'restock',body:{ReceiptID:'receipt_original'}}));
  assert.equal(f.rows.size,1);
 }
 const f=fixture();await assert.rejects(runWarehouseCLI({...f.create(async(_,r)=>{r.beforeDispatch();throw Error('lost')}),command:'receive',body}));
 await assert.rejects(runWarehouseCLI({...f.create(()=>assert.fail('resend')),command:'receive',body:{...body,EvidenceReference:'replacement'}}),{code:'SELLER_MUTATION_UNRESOLVED'});
});
test('inspection is bounded exact warehouse DATA and does not create a mutation identity',async()=>{
 const view={OrderID:orderID,StoreID:storeID,Status:'return_approved',ApprovedReturns:[body.ReturnID],Lines:[{ProductID:'product_one',VariantID:'v1',OrderedQuantity:'2',ReceivedQuantity:'1',RemainingQuantity:'1'}],Receipts:[{ReceiptID:'receipt_original',...body,Restocked:false}],QueryOnly:true,FundsVerified:false};
 const f=fixture();const result=await runWarehouseCLI({...f.create(async(path,r)=>{assert.equal(path,`/seller/orders/${orderID}/warehouse`);assert.equal(r.beforeDispatch,undefined);return view}),command:'inspect'});
 assert.equal(result.result.Lines[0].RemainingQuantity,'1');assert.equal(f.rows.size,0);
 view.Lines[0].ReceivedQuantity='2';await assert.rejects(runWarehouseCLI({...f.create(async()=>view),command:'inspect'}),{code:'SHOP_WAREHOUSE_ORIGINAL_UNCONFIRMED'});
});
