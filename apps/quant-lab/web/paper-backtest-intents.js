// Native owner journal; reuse the original server research idempotency protocol.
export function createPaperBacktestController({session,request,storage,uuid}) {
 let draft=null,flight=null;
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 const key=account=>'ynx.quant.native-paper.backtest.v1:'+account;
 const valid=body=>body&&Object.keys(body).sort().join(',')==='assumptions,idempotencyKey,strategy'&&body.strategy&&body.assumptions&&/^quant-research-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.idempotencyKey);
 function owner(){const value=session();if(!value.ready||value.status!=='connected'||!value.account)fail('PRIVATE_SIGN_IN_REQUIRED');return value;}
 function pending(account){const raw=storage.getItem(key(account));if(raw===null)return null;if(raw.length>65536)fail('PAPER_PENDING_INVALID');let value;try{value=JSON.parse(raw)}catch{fail('PAPER_PENDING_INVALID')}if(!valid(value))fail('PAPER_PENDING_INVALID');return value;}
 function preview(input){
  if(flight)fail('PAPER_OPERATION_PENDING');const current=owner(),saved=pending(current.account);
  // Unknown result recovery is explicit and uses the exact original body, not a new strategy.
  const body=saved||{...JSON.parse(JSON.stringify(input)),idempotencyKey:'quant-research-'+uuid()};if(!valid(body))fail('PAPER_DRAFT_INVALID');
  const raw=JSON.stringify(body);draft=Object.freeze({account:current.account,epoch:current.epoch,raw,body:JSON.parse(raw)});return draft;
 }
 function invalidate(){draft=null;}
 function confirm(expected){
  if(flight)return flight;const current=owner();if(expected!==draft||current.account!==expected.account||current.epoch!==expected.epoch||JSON.stringify(expected.body)!==expected.raw)fail('PAPER_PREVIEW_REQUIRED');
  const saved=pending(current.account);if(saved&&JSON.stringify(saved)!==expected.raw)fail('PAPER_PENDING_MISMATCH');storage.setItem(key(current.account),expected.raw);if(storage.getItem(key(current.account))!==expected.raw)fail('PAPER_PENDING_INVALID');
  const own=Promise.resolve().then(()=>{const before=owner();if(before.account!==expected.account||before.epoch!==expected.epoch)fail('PRIVATE_OPERATION_SUPERSEDED');return request('/v1/wallet/paper/backtests/from-market',{method:'POST',body:expected.raw});}).then(result=>{
   const after=session();if(after.account!==expected.account||after.epoch!==expected.epoch)fail('PRIVATE_OPERATION_SUPERSEDED');
   if(result.researchRequestKey!==expected.body.idempotencyKey||result.status!=='completed_oos'||typeof result.id!=='string'||!result.id)fail('PAPER_RECEIPT_MISMATCH');
   if(storage.getItem(key(expected.account))!==expected.raw)fail('PAPER_PENDING_MISMATCH');storage.removeItem(key(expected.account));if(storage.getItem(key(expected.account))!==null)fail('PAPER_PENDING_INVALID');invalidate();return result;
  }).finally(()=>{if(flight===own)flight=null;});flight=own;return own;
 }
 return Object.freeze({preview,confirm,invalidate,pending:()=>session().account?pending(session().account):null});
}
