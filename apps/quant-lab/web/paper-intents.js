// Owned consumer only. The original server chooses workspace, market price,
// volume/risk and commits the idempotent receipt; this is not another engine.
import {nativePaperHistory} from './paper-history-model.js';
export function createPaperIntentController({session,snapshot,request,storage,uuid}){
  let draft=null,flight=null,revision=0;
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  const key=account=>'ynx.quant.native-paper.intent.v1:'+account;
  function owner(){const current=session();if(current.status!=='connected'||typeof current.account!=='string'||!current.account||!current.ready)fail('PRIVATE_SIGN_IN_REQUIRED');return current;}
  const validCosts=value=>value&&Object.keys(value).sort().join(',')==='feeBPS,policy,slippageBPS'&&value.policy==='adverse_price_ceil_fee_micro_v1'&&Number.isSafeInteger(value.feeBPS)&&value.feeBPS>=0&&value.feeBPS<=10000&&Number.isSafeInteger(value.slippageBPS)&&value.slippageBPS>=0&&value.slippageBPS<10000;
  function valid(value){return value&&['amount,idempotencyKey,side,strategyHash','amount,executionCosts,idempotencyKey,side,strategyHash'].includes(Object.keys(value).sort().join(','))&&(!Object.hasOwn(value,'executionCosts')||validCosts(value.executionCosts))&&/^[0-9a-f]{64}$/.test(value.strategyHash)&&['buy','sell'].includes(value.side)&&Number.isSafeInteger(value.amount)&&value.amount>0&&/^quant-native-paper-[0-9a-f-]{36}$/.test(value.idempotencyKey);}
  function pending(account){const raw=storage.getItem(key(account));if(raw===null)return null;if(raw.length>1024)fail('PAPER_PENDING_INVALID');let value;try{value=JSON.parse(raw);}catch{fail('PAPER_PENDING_INVALID');}if(!valid(value))fail('PAPER_PENDING_INVALID');return value;}
  const same=(a,b)=>a.strategyHash===b.strategyHash&&a.side===b.side&&a.amount===b.amount&&JSON.stringify(a.executionCosts)===JSON.stringify(b.executionCosts);
  function preview(input){
    if(flight)fail('PAPER_OPERATION_PENDING');
    const current=owner(),source=snapshot();
    if(!source||source.account!==current.account||source.paper.KillSwitch===true)fail('PAPER_WORKSPACE_UNAVAILABLE');
    if(!Object.values(source.strategies).some(value=>value.StrategyHash===input.strategyHash)||!Number.isSafeInteger(input.amount)||input.amount<=0||!['buy','sell'].includes(input.side))fail('PAPER_DRAFT_INVALID');
    const saved=pending(current.account);if(saved&&!same(saved,input))fail('PAPER_PENDING_MISMATCH');
    if(!saved&&!validCosts(input.executionCosts))fail('PAPER_DRAFT_INVALID');
    const body=saved||{strategyHash:input.strategyHash,side:input.side,amount:input.amount,executionCosts:{...input.executionCosts},idempotencyKey:'quant-native-paper-'+uuid()};
    if(!valid(body))fail('PAPER_DRAFT_INVALID');
    draft=Object.freeze({account:current.account,epoch:current.epoch,body:Object.freeze({...body,...(body.executionCosts?{executionCosts:Object.freeze({...body.executionCosts})}:{})}),revision:++revision,retry:!!saved});return draft;
  }
  function invalidate(){revision++;draft=null;}
  function verifyReceipt(result,submitted){
    if(!/^paper-[0-9]+$/.test(result.ID)||result.IdempotencyKey!==submitted.idempotencyKey||result.StrategyHash!==submitted.strategyHash||result.Side!==submitted.side||result.Amount!==submitted.amount)fail('PAPER_RECEIPT_MISMATCH');
    if(submitted.executionCosts){const costs=submitted.executionCosts;if(result.CostPolicy!==costs.policy||(result.FeeBPS??0)!==costs.feeBPS||(result.SlippageBPS??0)!==costs.slippageBPS||!Number.isSafeInteger(result.ExecutionPriceMicro)||result.ExecutionPriceMicro<=0||!Number.isSafeInteger(result.ExecutedNotionalMicro??0)||(result.ExecutedNotionalMicro??0)<0||!Number.isSafeInteger(result.FeeMicro??0)||(result.FeeMicro??0)<0)fail('PAPER_RECEIPT_MISMATCH');}
  }
  function retireReceipt(account,submitted){
    const retained=pending(account);if(!retained||retained.idempotencyKey!==submitted.idempotencyKey||!same(retained,submitted))fail('PAPER_PENDING_MISMATCH');
    storage.removeItem(key(account));if(storage.getItem(key(account))!==null)fail('PAPER_PENDING_INVALID');invalidate();
  }
  function resolve(){
    if(flight)return flight;
    const current=owner(),submitted=pending(current.account);if(!submitted)fail('PAPER_PENDING_REQUIRED');
    if(snapshot()?.account!==current.account)fail('PAPER_WORKSPACE_UNAVAILABLE');
    const raw=JSON.stringify(submitted);invalidate();
    const own=Promise.resolve().then(()=>{
      const before=owner();if(before.account!==current.account||before.epoch!==current.epoch||storage.getItem(key(current.account))!==raw)fail('PRIVATE_OPERATION_SUPERSEDED');
      return request('/v1/wallet/paper/order-receipt?key='+encodeURIComponent(submitted.idempotencyKey));
    }).then(result=>{
      const after=owner();if(after.account!==current.account||after.epoch!==current.epoch)fail('PRIVATE_OPERATION_SUPERSEDED');
      if(result.account!==current.account)fail('PAPER_RECEIPT_MISMATCH');verifyReceipt(result,submitted);
      // Readback must be a coherent saved order, not a fabricated key-only ack.
      const observation=nativePaperHistory(after,{account:current.account,paper:{Orders:[result]},experiments:{},audit:[]});
      if(observation.status!=='ready'||observation.invalid||observation.orders.length!==1||(!submitted.executionCosts&&result.CostPolicy))fail('PAPER_RECEIPT_MISMATCH');
      if(storage.getItem(key(current.account))!==raw)fail('PAPER_PENDING_MISMATCH');retireReceipt(current.account,submitted);return result;
    }).finally(()=>{if(flight===own)flight=null;});flight=own;return own;
  }
  function confirm(expected){
    if(flight)return flight;
    const current=owner();if(!draft||expected!==draft||expected.revision!==revision||expected.account!==current.account||expected.epoch!==current.epoch)fail('PAPER_PREVIEW_REQUIRED');
    const source=snapshot();if(source?.account!==current.account||source.paper.KillSwitch===true||!Object.values(source.strategies).some(value=>value.StrategyHash===expected.body.strategyHash))fail('PAPER_DRAFT_INVALID');
    const saved=pending(current.account);if(saved&&(!same(saved,expected.body)||saved.idempotencyKey!==expected.body.idempotencyKey))fail('PAPER_PENDING_MISMATCH');
    // Storage must succeed before write. Unknown outcomes survive reload, revoke
    // and account switching under the original native owner, never an EVM alias.
    storage.setItem(key(current.account),JSON.stringify(expected.body));
    const submitted=expected.body,body=JSON.stringify(submitted);
    if(storage.getItem(key(current.account))!==body)fail('PAPER_PENDING_INVALID');
    const own=Promise.resolve().then(()=>{const before=session();if(before.account!==expected.account||before.epoch!==expected.epoch||before.status!=='connected')fail('PRIVATE_OPERATION_SUPERSEDED');return request('/v1/wallet/paper/orders',{method:'POST',body});}).then(result=>{
      const after=session();if(after.account!==expected.account||after.epoch!==expected.epoch)fail('PRIVATE_OPERATION_SUPERSEDED');
      verifyReceipt(result,submitted);retireReceipt(expected.account,submitted);return result;
    }).finally(()=>{if(flight===own)flight=null;});flight=own;return own;
  }
  return Object.freeze({preview,confirm,resolve,invalidate,pending:()=>{const current=session();return current.account?pending(current.account):null;},busy:()=>!!flight});
}
