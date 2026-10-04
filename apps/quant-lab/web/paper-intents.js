// Owned consumer only. The original server chooses workspace, market price,
// volume/risk and commits the idempotent receipt; this is not another engine.
export function createPaperIntentController({session,snapshot,request,storage,uuid}){
  let draft=null,flight=null,revision=0;
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  const key=account=>'ynx.quant.native-paper.intent.v1:'+account;
  function owner(){const current=session();if(current.status!=='connected'||typeof current.account!=='string'||!current.account||!current.ready)fail('PRIVATE_SIGN_IN_REQUIRED');return current;}
  function valid(value){return value&&Object.keys(value).sort().join(',')==='amount,idempotencyKey,side,strategyHash'&&/^[0-9a-f]{64}$/.test(value.strategyHash)&&['buy','sell'].includes(value.side)&&Number.isSafeInteger(value.amount)&&value.amount>0&&/^quant-native-paper-[0-9a-f-]{36}$/.test(value.idempotencyKey);}
  function pending(account){const raw=storage.getItem(key(account));if(raw===null)return null;if(raw.length>1024)fail('PAPER_PENDING_INVALID');let value;try{value=JSON.parse(raw);}catch{fail('PAPER_PENDING_INVALID');}if(!valid(value))fail('PAPER_PENDING_INVALID');return value;}
  const same=(a,b)=>a.strategyHash===b.strategyHash&&a.side===b.side&&a.amount===b.amount;
  function preview(input){
    if(flight)fail('PAPER_OPERATION_PENDING');
    const current=owner(),source=snapshot();
    if(!source||source.account!==current.account||source.paper.KillSwitch===true)fail('PAPER_WORKSPACE_UNAVAILABLE');
    if(!Object.values(source.strategies).some(value=>value.StrategyHash===input.strategyHash)||!Number.isSafeInteger(input.amount)||input.amount<=0||!['buy','sell'].includes(input.side))fail('PAPER_DRAFT_INVALID');
    const saved=pending(current.account);if(saved&&!same(saved,input))fail('PAPER_PENDING_MISMATCH');
    const body=saved||{strategyHash:input.strategyHash,side:input.side,amount:input.amount,idempotencyKey:'quant-native-paper-'+uuid()};
    if(!valid(body))fail('PAPER_DRAFT_INVALID');
    draft=Object.freeze({account:current.account,epoch:current.epoch,body:Object.freeze({...body}),revision:++revision,retry:!!saved});return draft;
  }
  function invalidate(){revision++;draft=null;}
  function confirm(expected){
    if(flight)return flight;
    const current=owner();if(!draft||expected!==draft||expected.revision!==revision||expected.account!==current.account||expected.epoch!==current.epoch)fail('PAPER_PREVIEW_REQUIRED');
    const source=snapshot();if(source?.account!==current.account||source.paper.KillSwitch===true||!Object.values(source.strategies).some(value=>value.StrategyHash===expected.body.strategyHash))fail('PAPER_DRAFT_INVALID');
    const saved=pending(current.account);if(saved&&(!same(saved,expected.body)||saved.idempotencyKey!==expected.body.idempotencyKey))fail('PAPER_PENDING_MISMATCH');
    // Storage must succeed before write. Unknown outcomes survive reload, revoke
    // and account switching under the original native owner, never an EVM alias.
    storage.setItem(key(current.account),JSON.stringify(expected.body));
    const submitted=expected.body,body=JSON.stringify(submitted);
    const own=Promise.resolve().then(()=>{const before=session();if(before.account!==expected.account||before.epoch!==expected.epoch||before.status!=='connected')fail('PRIVATE_OPERATION_SUPERSEDED');return request('/v1/wallet/paper/orders',{method:'POST',body});}).then(result=>{
      const after=session();if(after.account!==expected.account||after.epoch!==expected.epoch)fail('PRIVATE_OPERATION_SUPERSEDED');
      if(!/^paper-[0-9]+$/.test(result.ID)||result.IdempotencyKey!==submitted.idempotencyKey||result.StrategyHash!==submitted.strategyHash||result.Side!==submitted.side||result.Amount!==submitted.amount)fail('PAPER_RECEIPT_MISMATCH');
      const retained=pending(expected.account);if(retained?.idempotencyKey===submitted.idempotencyKey)storage.removeItem(key(expected.account));
      invalidate();return result;
    }).finally(()=>{if(flight===own)flight=null;});flight=own;return own;
  }
  return Object.freeze({preview,confirm,invalidate,pending:()=>{const current=session();return current.account?pending(current.account):null;},busy:()=>!!flight});
}
