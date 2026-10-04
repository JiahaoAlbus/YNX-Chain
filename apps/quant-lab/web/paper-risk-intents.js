// Durable native-owner consumer intents; all risk decisions remain server-side.
export function createPaperRiskController({session,request,storage,uuid}){
 let draft=null,flight=null;
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 const key=account=>'ynx.quant.native-paper.risk.v1:'+account;
 const valid=value=>value&&['kill','reconcile'].includes(value.action)&&value.body&&Object.keys(value).sort().join(',')==='action,body'&&/^quant-native-risk-[0-9a-f-]{36}$/.test(value.body.idempotencyKey)&&
  (value.action==='kill'?Object.keys(value.body).sort().join(',')==='idempotencyKey,reason'&&typeof value.body.reason==='string'&&value.body.reason.trim().length>=3&&value.body.reason.length<=500:Object.keys(value.body).sort().join(',')==='cash,idempotencyKey,position'&&Number.isSafeInteger(value.body.cash)&&Number.isSafeInteger(value.body.position));
 function pending(account){const raw=storage.getItem(key(account));if(raw===null)return null;if(raw.length>2048)fail('PAPER_PENDING_INVALID');let value;try{value=JSON.parse(raw)}catch{fail('PAPER_PENDING_INVALID')}if(!valid(value))fail('PAPER_PENDING_INVALID');return value;}
 function owner(){const current=session();if(current.status!=='connected'||!current.ready||!current.account)fail('PRIVATE_SIGN_IN_REQUIRED');return current;}
 function preview(action,input){
  if(flight)fail('PAPER_OPERATION_PENDING');const current=owner(),saved=pending(current.account);
  const value={action,body:{...input,idempotencyKey:saved?.body.idempotencyKey||'quant-native-risk-'+uuid()}};
  if(!valid(value))fail('PAPER_DRAFT_INVALID');if(saved&&JSON.stringify(saved)!==JSON.stringify(value))fail('PAPER_PENDING_MISMATCH');
  draft=Object.freeze({account:current.account,epoch:current.epoch,action,body:Object.freeze({...value.body})});return draft;
 }
 function invalidate(){draft=null;}
 function confirm(expected){
  if(flight)return flight;const current=owner();if(!draft||draft!==expected||current.account!==expected.account||current.epoch!==expected.epoch)fail('PAPER_PREVIEW_REQUIRED');
  const value={action:expected.action,body:expected.body},raw=JSON.stringify(value),saved=pending(current.account);
  if(saved&&JSON.stringify(saved)!==raw)fail('PAPER_PENDING_MISMATCH');storage.setItem(key(current.account),raw);if(storage.getItem(key(current.account))!==raw)fail('PAPER_PENDING_INVALID');
  const own=Promise.resolve().then(()=>{const before=owner();if(before.account!==expected.account||before.epoch!==expected.epoch)fail('PRIVATE_OPERATION_SUPERSEDED');return request('/v1/wallet/paper/risk/'+expected.action,{method:'POST',body:JSON.stringify(expected.body)});}).then(result=>{
   const after=session();if(after.account!==expected.account||after.epoch!==expected.epoch)fail('PRIVATE_OPERATION_SUPERSEDED');
   if(result.action!==expected.action||result.idempotencyKey!==expected.body.idempotencyKey||!/^[0-9a-f]{64}$/.test(result.requestDigest||'')||!result.paper||typeof result.paper.KillSwitch!=='boolean'||(expected.action==='kill'&&!result.paper.KillSwitch)||!Number.isSafeInteger(result.paper.ReconciliationDelta))fail('PAPER_RECEIPT_MISMATCH');
   if(storage.getItem(key(expected.account))===raw){storage.removeItem(key(expected.account));if(storage.getItem(key(expected.account))!==null)fail('PAPER_PENDING_INVALID');}
   invalidate();return result;
  }).finally(()=>{if(flight===own)flight=null;});flight=own;return own;
 }
 return Object.freeze({preview,confirm,invalidate,pending:()=>session().account?pending(session().account):null});
}
