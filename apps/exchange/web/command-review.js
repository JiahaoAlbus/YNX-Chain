import {parseMicro} from './order-preview.js?v=76f29706a7bb6e799f0fef6c9c63e8bf26c228a0c546b1b0136f85ea2fb8f2cb';

// Product-local preparation only. These are existing Go handler contracts,
// not browser grants. No proof, signature, idempotency key or dispatch is made.
const bytes=value=>new TextEncoder().encode(value).length;
const fail=code=>{throw Object.assign(new Error(code),{code})};
const bounded=(value,min,max)=>{if(typeof value!=='string')fail('COMMAND_INPUT_INVALID');const text=value.trim();if(bytes(text)<min||bytes(text)>max)fail('COMMAND_INPUT_INVALID');return text};
export function buildCommandReview(kind,input={},context={}){
  const account=typeof context.account==='string'&&context.account?context.account:null;
  let method,path,body,resourceId=null,signatureRequired=false;
  switch(kind){
    case 'cancel':{
      const order=input.order;
      if(!account||!order||order.account!==account||!['open','partially_filled'].includes(order.status)||typeof order.id!=='string'||!order.id)fail('COMMAND_OWNER_INVALID');
      method='POST';path=`/v1/orders/${encodeURIComponent(order.id)}/cancel`;body={};resourceId=order.id;signatureRequired=true;break;
    }
    case 'deposit':{
      const txHash=bounded(input.txHash,16,128),intentId=bounded(input.intentId,1,128);
      if(!/^[0-9a-fA-Fx]+$/.test(txHash))fail('COMMAND_INPUT_INVALID');
      method='POST';path='/v1/deposits';body={intentId,txHash};break;
    }
    case 'withdrawal':{
      const destination=bounded(input.destination,8,128);
      // Syntax screening is not native address/checksum verification.
      if(!/^ynx1[0-9a-z]+$/.test(destination))fail('COMMAND_INPUT_INVALID');
      const amount=parseMicro(input.amount);
      if(amount<=0n||amount>BigInt(Number.MAX_SAFE_INTEGER))fail('COMMAND_INPUT_INVALID');
      const fee=context.withdrawalFeeMicro;
      if(fee!==undefined&&(!Number.isSafeInteger(fee)||fee<0||amount<=BigInt(fee)))fail('COMMAND_FEE_INVALID');
      method='POST';path='/v1/withdrawals/review';body={asset:'YNXT',network:'YNX Testnet',destination,amountMicro:Number(amount)};signatureRequired=true;break;
    }
    case 'security':{
      if(typeof input.withdrawalLock!=='boolean'||typeof input.orderConfirmation!=='boolean'||!Number.isInteger(input.sessionTtlMinutes)||input.sessionTtlMinutes<15||input.sessionTtlMinutes>480)fail('COMMAND_INPUT_INVALID');
      method='PUT';path='/v1/security';body={withdrawalLock:input.withdrawalLock,orderConfirmation:input.orderConfirmation,sessionTtlMinutes:input.sessionTtlMinutes};break;
    }
    case 'support':
      method='POST';path='/v1/support';body={category:bounded(input.category,2,40),message:bounded(input.message,10,2000)};break;
    case 'ai':{
      if(!['market_explanation','owned_trade_summary','risk_explanation','order_draft'].includes(input.kind)||!['public_market_rules','owned_orders','owned_trades','owned_balances'].includes(input.contextClass)||typeof input.permission!=='boolean')fail('COMMAND_INPUT_INVALID');
      method='POST';path='/v1/ai/drafts';body={kind:input.kind,prompt:bounded(input.prompt,3,2000),contextClasses:Object.freeze([input.contextClass]),permission:input.permission};break;
    }
    default:fail('COMMAND_INPUT_INVALID');
  }
  return Object.freeze({kind,account,method,path,resourceId,body:Object.freeze(body),signatureRequired,submitted:false,executionAuthorized:false,
    // Current canonical v2 reader deliberately does not admit any write route.
    boundary:'EXPLICIT_ROUTE_SCOPE_UNAVAILABLE',nativeAddressVerified:false});
}
