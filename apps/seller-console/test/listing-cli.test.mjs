import test from 'node:test';
import assert from 'node:assert/strict';
import {createMutationIntents} from '../mutation-intents.js';
import {runListingCLI} from '../native/listing-cli.mjs';
const productID='product-original',body={StoreID:'store-original',ExpectedRevision:'3',Title:'Original listing',Description:'Original description',Category:'Original',Media:[{URL:'https://images.example.test/original.png',AltText:'Original reviewed image',Kind:'image'}],Variants:[{ID:'v-original',Name:'Original',SKU:'SKU-original',PriceYNXT:'9223372036854775807',Inventory:'9223372036854775807'}]};
function result(query=false){return {OriginalApplied:true,QueryOnly:query,Product:{ID:productID,StoreID:body.StoreID,Revision:'4',Title:body.Title,Description:body.Description,Category:body.Category,Published:true,Media:structuredClone(body.Media),Variants:body.Variants.map(v=>({...v,Reserved:'1'}))}}}
function fixture(){let actor='PUBLIC-owner';const rows=new Map(),account=()=>actor;return {rows,actor:v=>actor=v,runtime:api=>({productID,body:structuredClone(body),account,current(){},api,intents:createMutationIntents(account,{storage:{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},withLock:async(_,work)=>work()})})}}
test('original listing integers and opaque journal survive lost publish and cold lookup without another publish',async()=>{
 const f=fixture();let sent,writes=0;
 await assert.rejects(runListingCLI({...f.runtime(async(path,r)=>{assert.equal(path,`/seller/products/${productID}/native-listing`);r.beforeDispatch();sent=JSON.parse(r.body);assert.equal(sent.Variants[0].PriceYNXT,'9223372036854775807');writes++;throw Error('PUBLIC response lost')}),command:'publish'}));const saved=[...f.rows];
 await assert.rejects(runListingCLI({...f.runtime(()=>assert.fail('replaced original')),command:'publish',body:{...body,Title:'edited'}}),{code:'SELLER_MUTATION_UNRESOLVED'});assert.deepEqual([...f.rows],saved);
 const recovered=await runListingCLI({...f.runtime(async(path,r)=>{assert.equal(path,'/seller/mutations/lookup');const q=JSON.parse(r.body);assert.deepEqual(JSON.parse(q.OriginalBody),sent);const later=result(true);later.Product.Published=false;later.Product.Title='Later legitimate title';return {Actor:'PUBLIC-owner',Method:q.Method,Path:q.Path,IdempotencyKey:sent.IdempotencyKey,Result:later}}),command:'recover'});
 assert.equal(writes,1);assert.equal(recovered.fundsVerified,false);assert.equal(recovered.result.Product.Published,false);assert.equal([...f.rows.keys()].filter(k=>!k.endsWith(':revision')).length,0);
});
test('foreign, malformed or stale-source listing replies preserve UNKNOWN instead of confirming publication',async()=>{
 for(const mode of ['product','store','integer','scope','private-field']){const f=fixture();await assert.rejects(runListingCLI({...f.runtime(async(_,r)=>{r.beforeDispatch();const out=result();if(mode==='product')out.Product.ID='other';if(mode==='store')out.Product.StoreID='other';if(mode==='integer')out.Product.Variants[0].PriceYNXT=8;if(mode==='scope')f.actor('other');if(mode==='private-field')out.Product.BuyerAddress='PUBLIC-private';return out}),command:'publish'}));assert.equal(f.rows.size,1)}
});
test('inspect is a current Seller-only read and invalid full listing operands never send or create identities',async()=>{
 const f=fixture();const out=await runListingCLI({...f.runtime(async(path,r)=>{assert.equal(path,'/seller/listing/read');assert.deepEqual(JSON.parse(r.body),{StoreID:body.StoreID,ProductID:productID});assert.equal(r.beforeDispatch,undefined);return {...result(true),OriginalApplied:false}}),command:'inspect',body:{StoreID:body.StoreID}});assert.equal(out.result.OriginalApplied,false);assert.equal(f.rows.size,0);
 for(const change of [{ExpectedRevision:'03'},{Variants:[{...body.Variants[0],Inventory:'9223372036854775808'}]},{Variants:[{...body.Variants[0],PriceYNXT:8}]},{Variants:[body.Variants[0],body.Variants[0]]},{Media:[],SourceGrant:true}])await assert.rejects(runListingCLI({...f.runtime(()=>assert.fail('invalid listing sent')),command:'publish',body:{...body,...change}}));assert.equal(f.rows.size,0);
});
test('captured whole listing survives outside form edits and foreign original readback cannot clear UNKNOWN',async()=>{
 const f=fixture(),original=structuredClone(body);let sent;
 const pending=runListingCLI({...f.runtime(async(_,r)=>{r.beforeDispatch();sent=JSON.parse(r.body);return result()}),command:'publish',body:original});original.Title='Outside form edit';original.Variants[0].PriceYNXT='1';await pending;assert.equal(sent.Title,body.Title);assert.equal(sent.Variants[0].PriceYNXT,body.Variants[0].PriceYNXT);
 const cold=fixture();await assert.rejects(runListingCLI({...cold.runtime(async(_,r)=>{r.beforeDispatch();throw Error('PUBLIC lost reply')}),command:'publish'}));const before=[...cold.rows];await assert.rejects(runListingCLI({...cold.runtime(async(_,r)=>{const q=JSON.parse(r.body);return {Actor:'foreign',Method:q.Method,Path:q.Path,IdempotencyKey:JSON.parse(q.OriginalBody).IdempotencyKey,Result:result(true)}}),command:'recover'}));assert.deepEqual([...cold.rows],before);
});
