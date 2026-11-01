import test from 'node:test';
import assert from 'node:assert/strict';
import {createMutationIntents} from '../mutation-intents.js';
import {runInventoryBatchCLI} from '../native/inventory-batch-cli.mjs';
const body={StoreID:'store_original',Items:[{ProductID:'product_one',VariantID:'v1',ExpectedRevision:'7',Inventory:'9223372036854775807'},{ProductID:'product_two',VariantID:'v2',ExpectedRevision:'8',Inventory:'4'}]};
const products=()=>[{ID:'product_one',StoreID:body.StoreID,Revision:'8',Variants:[{ID:'v1',Inventory:'9223372036854775807',Reserved:'0'}]},{ID:'product_two',StoreID:body.StoreID,Revision:'9',Variants:[{ID:'v2',Inventory:'4',Reserved:'0'}]}];
const outcome=query=>({StoreID:body.StoreID,RequestHash:'ab'.repeat(32),OriginalApplied:true,QueryOnly:query,Products:products()});
test('CLI inspect reads exact current version/count strings without a mutation journal',async()=>{
 const selected={StoreID:body.StoreID,Items:body.Items.map(({ProductID,VariantID})=>({ProductID,VariantID}))};
 const reply=await runInventoryBatchCLI({command:'inspect',body:selected,account:()=> 'PUBLIC-owner',current(){},async api(path,r){assert.equal(path,'/seller/inventory/read');assert.equal(r.beforeDispatch,undefined);assert.deepEqual(JSON.parse(r.body),selected);return {StoreID:body.StoreID,Products:products(),QueryOnly:true}}});
 assert.equal(reply.result.Products[0].Variants[0].Inventory,'9223372036854775807');assert.equal(Object.hasOwn(reply.result,'OriginalApplied'),false);
});
function fixture(){
 const rows=new Map(),locks=new Map();let actor='PUBLIC-owner';
 const storage={getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
 const withLock=async(k,work)=>{const previous=locks.get(k)??Promise.resolve();let release;const pending=new Promise(r=>release=r);locks.set(k,pending);await previous;try{return await work()}finally{release();if(locks.get(k)===pending)locks.delete(k)}};
 const account=()=>actor;
 return {rows,setActor:v=>actor=v,options:{storage,withLock},create:api=>({account,current(){},api,intents:createMutationIntents(account,{storage,withLock})})};
}
test('CLI cold recovery uses only the exact original lookup after a lost batch reply',async()=>{
 const f=fixture();let writes=0,reads=0,original;
 await assert.rejects(runInventoryBatchCLI({...f.create(async(path,request)=>{assert.equal(path,'/seller/inventory/batch');request.beforeDispatch();writes++;original=JSON.parse(request.body);throw Error('PUBLIC lost result')}),command:'apply',body}),/lost result/);
 const reply=await runInventoryBatchCLI({...f.create(async(path,request)=>{reads++;assert.equal(path,'/seller/mutations/lookup');const query=JSON.parse(request.body);assert.deepEqual(JSON.parse(query.OriginalBody),original);return {Actor:'PUBLIC-owner',Method:'POST',Path:query.Path,IdempotencyKey:original.IdempotencyKey,Result:outcome(true)}}),command:'recover',body});
 assert.equal(writes,1);assert.equal(reads,1);assert.equal(reply.inventoryOnly,true);assert.equal(reply.fundsVerified,false);assert.equal(reply.result.QueryOnly,true);
 assert.equal([...f.rows.keys()].filter(k=>!k.endsWith(':revision')).length,0);
});
test('CLI retains unknown after rebound readback and never applies changed operands',async()=>{
 const f=fixture();let writes=0;
 await assert.rejects(runInventoryBatchCLI({...f.create(async(_,r)=>{r.beforeDispatch();writes++;throw Error('lost')}),command:'apply',body}));
 const changed=structuredClone(body);changed.Items[0].Inventory='2';
 await assert.rejects(runInventoryBatchCLI({...f.create(()=>assert.fail('new send')),command:'apply',body:changed}),{code:'SELLER_MUTATION_UNRESOLVED'});
 await assert.rejects(runInventoryBatchCLI({...f.create(async(_,r)=>{const q=JSON.parse(r.body),o=JSON.parse(q.OriginalBody);return {Actor:'PUBLIC-other',Method:'POST',Path:q.Path,IdempotencyKey:o.IdempotencyKey,Result:outcome(true)}}),command:'recover',body}),{code:'SHOP_INVENTORY_BATCH_RESULT_UNCONFIRMED'});
 assert.equal(writes,1);assert.equal(f.rows.size,1);
});
test('CLI no original recovery, noncanonical operands and late account change cannot complete',async()=>{
 const f=fixture(),runtime=f.create(()=>assert.fail('dispatch'));
 await assert.rejects(runInventoryBatchCLI({...runtime,command:'recover',body}),/No original/);
 for(const count of ['01','-1','9223372036854775808',Number.MAX_SAFE_INTEGER]){
  const wrong=structuredClone(body);wrong.Items[0].Inventory=count;
  await assert.rejects(runInventoryBatchCLI({...runtime,command:'apply',body:wrong}),{code:'SHOP_INVENTORY_BATCH_INPUT_INVALID'});
 }
 await assert.rejects(runInventoryBatchCLI({...f.create(async(_,r)=>{r.beforeDispatch();f.setActor('PUBLIC-other');return outcome(false)}),command:'apply',body}));
 assert.equal(f.rows.size,1);
});
test('unsafe numeric or missing SKU response cannot clear the original recovery identity',async()=>{
 for(const mode of ['numeric','missing']){
  const f=fixture();
  await assert.rejects(runInventoryBatchCLI({...f.create(async(_,r)=>{r.beforeDispatch();const reply=outcome(false);if(mode==='numeric')reply.Products[0].Variants[0].Inventory=9223372036854775807;else reply.Products[0].Variants=[];return reply}),command:'apply',body}),{code:'SHOP_INVENTORY_BATCH_RESULT_UNCONFIRMED'});
  assert.equal(f.rows.size,1);
 }
});
