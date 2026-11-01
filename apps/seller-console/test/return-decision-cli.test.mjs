import test from 'node:test';
import assert from 'node:assert/strict';
import {createMutationIntents} from '../mutation-intents.js';
import {runReturnDecisionCLI} from '../native/return-decision-cli.mjs';
const orderID='order_original',storeID='store_original',returnID='return_original';
const request=()=>({ID:orderID,StoreID:storeID,Status:'return_requested',Timeline:[{ID:returnID,Status:'return_requested'}]});
const decided=action=>({...request(),Status:action,Timeline:[...request().Timeline,{ID:'decision_original',Status:action}],Address:{Line1:'PUBLIC private address'},NativePayment:{PaidAtoms:'100',RefundedAtoms:'0'}});
function fixture(){const rows=new Map();let actor='PUBLIC-owner';const account=()=>actor;return {rows,setActor:v=>actor=v,runtime:api=>({orderID,storeID,account,current(){},api,intents:createMutationIntents(account,{storage:{getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)},withLock:async(_,work)=>work()})})};}
test('approved and rejected originals recover only their exact decision with no second write',async()=>{
 for(const command of ['approve','reject']){
  const f=fixture(),body=command==='approve'?{ReturnID:returnID}:{ReturnID:returnID,Explanation:'Actual original reason'};let original,writes=0;
  await assert.rejects(runReturnDecisionCLI({...f.runtime(async(path,r)=>{if(r.method==='GET')return request();r.beforeDispatch();original=JSON.parse(r.body);assert.equal(original.OriginalReturnID,returnID);writes++;throw Error('PUBLIC lost decision response');}),command,body}));
  const result=await runReturnDecisionCLI({...f.runtime(async(path,r)=>{assert.equal(path,'/seller/mutations/lookup');const q=JSON.parse(r.body);assert.deepEqual(JSON.parse(q.OriginalBody),original);return {Actor:'PUBLIC-owner',Method:'POST',Path:q.Path,IdempotencyKey:original.IdempotencyKey,Result:decided(command==='approve'?'return_approved':'return_rejected')};}),command:'recover-'+command,body});
  assert.equal(writes,1);assert.equal(result.result.ReturnID,returnID);assert.equal(result.fundsVerified,false);assert.equal(result.result.Address,undefined);assert.equal(result.result.NativePayment,undefined);assert.equal([...f.rows.keys()].filter(k=>!k.endsWith(':revision')).length,0);
 }
});
test('wrong original case cannot dispatch; replaced UNKNOWN inputs and foreign receipts remain unresolved',async()=>{
 const f=fixture();let posts=0;await assert.rejects(runReturnDecisionCLI({...f.runtime(async(_,r)=>{assert.equal(r.method,'GET');const v=request();v.Timeline[0].ID='other';return v;}),command:'approve',body:{ReturnID:returnID}}));assert.equal(posts,0);assert.equal(JSON.parse([...f.rows.values()][0]).phase,'prepared');
 const g=fixture();await assert.rejects(runReturnDecisionCLI({...g.runtime(async(_,r)=>{if(r.method==='GET')return request();r.beforeDispatch();throw Error('PUBLIC lost');}),command:'approve',body:{ReturnID:returnID}}));const saved=[...g.rows];
 await assert.rejects(runReturnDecisionCLI({...g.runtime(()=>assert.fail('replacement')),command:'approve',body:{ReturnID:'replacement'}}),{code:'SELLER_MUTATION_UNRESOLVED'});assert.deepEqual([...g.rows],saved);
 await assert.rejects(runReturnDecisionCLI({...g.runtime(async(_,r)=>{const q=JSON.parse(r.body);return {Actor:'foreign',Method:'POST',Path:q.Path,IdempotencyKey:JSON.parse(q.OriginalBody).IdempotencyKey,Result:decided('return_approved')};}),command:'recover-approve',body:{ReturnID:returnID}}));assert.deepEqual([...g.rows],saved);
});
test('decision for another historical case cannot confirm original and inspect reveals no contacts',async()=>{
 const f=fixture();const result=await runReturnDecisionCLI({...f.runtime(async()=>request()),command:'inspect'});assert.equal(result.result.ReturnID,returnID);assert.equal(f.rows.size,0);
 await assert.rejects(runReturnDecisionCLI({...f.runtime(async(_,r)=>{if(r.method==='GET')return request();r.beforeDispatch();return {...request(),Status:'return_approved',Timeline:[...request().Timeline,{ID:'later_case',Status:'return_requested'},{ID:'later_decision',Status:'return_approved'}]};}),command:'approve',body:{ReturnID:returnID}}));assert.equal(f.rows.size,1);
 for(const body of [{ReturnID:returnID,refund:true},{ReturnID:returnID,Explanation:''}])await assert.rejects(runReturnDecisionCLI({...fixture().runtime(()=>assert.fail('invalid input')),command:'reject',body}));
});

test('later caller form edits cannot replace the captured original return selector',async()=>{
 const f=fixture(),body={ReturnID:returnID};let sent;
 const result=await runReturnDecisionCLI({...f.runtime(async(path,r)=>{if(r.method==='GET'){body.ReturnID='later_form_edit';return request();}r.beforeDispatch();sent=JSON.parse(r.body);return decided('return_approved');}),command:'approve',body});
 assert.equal(sent.OriginalReturnID,returnID);assert.equal(result.result.ReturnID,returnID);assert.equal(result.result.Decision,'return_approved');
});
