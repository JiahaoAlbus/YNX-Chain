import {createMutationIntents} from '../seller-console/mutation-intents.js';
import {validateBuyerOrder} from './invoice-recovery.js';
const actions=new Set(['cancelled','delivered','reviewed','return_requested','refund_requested','disputed']);
export function buyerActionAllowed(status,action){return action==='cancelled'?status==='payment_pending':action==='delivered'?status==='shipped':action==='reviewed'?status==='delivered':action==='return_requested'?['delivered','reviewed'].includes(status):action==='refund_requested'?['paid','return_requested','return_approved'].includes(status):action==='disputed'?['paid','shipped','delivered','reviewed','return_requested','return_approved','refund_requested'].includes(status):false;}
export function buyerActionInput(status,action,{rating=0,reason='',explanation='',body=''}={}, {readOnly=false}={}){
 reason=String(reason).trim();explanation=String(explanation).trim();body=String(body).trim();const review=action==='reviewed',resolution=['return_requested','refund_requested','disputed'].includes(action),bytes=text=>new TextEncoder().encode(text).length;
 if(!(readOnly?actions.has(action):buyerActionAllowed(status,action))||!Number.isInteger(rating)||(review?(rating<1||rating>5):rating!==0)||bytes(reason)>1000||bytes(explanation)>5000||bytes(body)>5000||(resolution&&!reason)||(!resolution&&(reason||explanation))||(!review&&body))throw Error('Choose a rating from 1 to 5, or enter a reason. Reason: up to 1000 UTF-8 bytes; details: up to 5000.');
 return {Action:action,Reason:reason,Explanation:explanation,Rating:rating,Body:body};
}
export function buyerTransitionReceipt(value,{account,orderId,body,lookup=false}){
 const order=lookup?value?.Order:value;if(lookup&&(value?.Actor!==account||value?.OrderID!==orderId||value?.Action!==body.Action||value?.IdempotencyKey!==body.IdempotencyKey))throw Error('Original order request readback did not match. Preserve it and check again.');
 validateBuyerOrder(order,account);if(order.ID!==orderId)throw Error('Original order target changed. Preserve the request.');return order;
}
export function createBuyerActionRecovery(account,options={}){
 const journal=createMutationIntents(account,{...options,prefix:'ynx-shop-order-action-v1',label:'Buyer'});
 return Object.freeze({hasPending:orderId=>journal.hasPending('POST','/orders/'+orderId+'/transition'),discardPrepared:(path,current)=>journal.discardPrepared('POST',path,current),execute(orderId,input,current,send,lookup,recoverOnly=false){if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(orderId)||!actions.has(input.Action))throw Error('Exact Buyer order action required.');const actor=account(),path='/orders/'+orderId+'/transition';return journal.execute('POST',path,input,current,async(body,beforeDispatch)=>{const result=await send(path,body,beforeDispatch);current();return buyerTransitionReceipt(result,{account:actor,orderId,body});},async body=>{const result=await lookup('/orders/'+orderId+'/transition-intent-lookup',body);current();return buyerTransitionReceipt(result,{account:actor,orderId,body,lookup:true});},recoverOnly)}});
}
