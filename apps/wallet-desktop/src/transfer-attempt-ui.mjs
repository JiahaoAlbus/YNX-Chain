// Display-only public metadata. This never authorizes or retries a transaction.
import {setWalletCopy} from './wallet-locale.mjs';
const stages=new Set(['approval-gate','review-check','verifying-network','key-access','submitting']);
const states=new Set(['in-progress','submitted','rejected-before-key-access','rejected-before-submission','result-unconfirmed']);
const codes=new Set(['WALLET_LOCKED','WALLET_OPERATION_CANCELLED','WALLET_OPERATION_BUSY','REQUEST_EXPIRED','UNKNOWN_OR_EXPIRED_REQUEST','ACCOUNT_CHANGED','RPC_CHAIN_MISMATCH','TRANSACTION_RESOLUTION_REQUIRED','EXTERNAL_OUTCOME_UNKNOWN','RPC_TRANSACTION_REJECTED','TRANSFER_FAILED']);
export function createTransferAttemptUI({node,getAccount,request}) {
  let revision=0,last=null;
  const valid=value=>value&&value.account===getAccount()&&/^0x[0-9a-f]{40}$/.test(value.account)&&Number.isSafeInteger(value.attempt)&&value.attempt>0&&stages.has(value.stage)&&states.has(value.state)&&Number.isSafeInteger(value.updatedAt)&&value.updatedAt>=0&&(value.code===null||codes.has(value.code));
  function paint(){if(!node)return;node.hidden=!last||last.account!==getAccount();if(node.hidden){node.textContent='';return}setWalletCopy(node,'Last transfer attempt: {stage} · {state} · {code} · {time}. Check its original result before sending again.',{stage:last.stage,state:last.state,code:last.code??'—',time:new Date(last.updatedAt).toLocaleTimeString()});}
  function receive(value){if(!valid(value))return;if(last?.account===value.account&&(value.attempt<last.attempt||value.attempt===last.attempt&&value.updatedAt<last.updatedAt))return;revision++;last={account:value.account,attempt:value.attempt,stage:value.stage,state:value.state,code:value.code,updatedAt:value.updatedAt};paint()}
  async function refresh(){const current=++revision,account=getAccount();if(last?.account!==account)last=null;paint();if(!account||typeof request!=='function')return;try{const result=await request(account);if(current!==revision||getAccount()!==account)return;if(result?.ok&&Array.isArray(result.value)){const latest=result.value.filter(valid).sort((a,b)=>b.attempt-a.attempt||b.updatedAt-a.updatedAt)[0];if(latest)receive(latest)}}catch{}}
  return {refresh,receive};
}
