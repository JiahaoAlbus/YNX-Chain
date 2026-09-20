import {
  canonicalJSON,
  createFinanceOrderApprovalRequest,
  encodeFinanceOrderApprovalWalletURL,
  parseFinanceOrderApprovalReturnURL,
} from '@ynx-chain/wallet-auth-finance-order';
import registry from './vendor/product-session-registry-a7dad7ec.json';
import {assertFinancePrivateAuthority} from './endpoint-authority-entry.js';

const PENDING_KEY='ynx.finance.order-approval.v1.pending';

function save(value){
  if(value===null)localStorage.removeItem(PENDING_KEY);
  else localStorage.setItem(PENDING_KEY,canonicalJSON(value));
}
function load(){
  const raw=localStorage.getItem(PENDING_KEY);
  if(!raw)return null;
  const parsed=JSON.parse(raw);
  if(canonicalJSON(parsed)!==raw)throw new Error('FINANCE_ORDER_PENDING_INVALID');
  return parsed;
}
function pendingRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='approvedProof,request,version'||value.version!=='1'||!value.request)throw new Error('FINANCE_ORDER_PENDING_INVALID');
  return value.request;
}
function authorityDate(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value))throw new Error('FINANCE_ORDER_AUTHORITY_TIME_INVALID');
  const parsed=new Date(value);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value)throw new Error('FINANCE_ORDER_AUTHORITY_TIME_INVALID');
  return parsed;
}
async function assertAuthority(nowMs=Date.now()){
  return assertFinancePrivateAuthority(nowMs);
}
function resumeStored(at){
  const pending=load();
  if(!pending)return null;
  const request=pendingRequest(pending),expiresAt=authorityDate(request?.unsigned?.expiresAt);
  if(at.getTime()>=expiresAt.getTime()){
    save(null);
    return Object.freeze({expired:true,request});
  }
  return Object.freeze({approved:pending.approvedProof!==null,expired:false,request,url:encodeFinanceOrderApprovalWalletURL(request,at)});
}
async function resume(serverTime){
  await assertAuthority();
  return resumeStored(authorityDate(serverTime));
}
async function begin(unsigned,serverTime){
  await assertAuthority();
  const at=authorityDate(serverTime);
  const existing=resumeStored(at);
  if(existing&&!existing.expired)throw new Error('FINANCE_ORDER_PENDING_EXISTS');
  const request=createFinanceOrderApprovalRequest(unsigned,at);
  const url=encodeFinanceOrderApprovalWalletURL(request,at);
  save({approvedProof:null,request,version:'1'});
  return Object.freeze({request,url});
}
async function parseReturn(url,serverTime){
  await assertAuthority();
  const pending=load();
  if(!pending)throw new Error('FINANCE_ORDER_PENDING_NOT_FOUND');
  const request=pendingRequest(pending);
  const result=parseFinanceOrderApprovalReturnURL(registry,url,request,authorityDate(serverTime),pending.approvedProof);
  if(result.status==='approved')save({approvedProof:result.approval,request,version:'1'});
  return canonicalJSON(result);
}

window.YNXFinanceOrderWallet=Object.freeze({assertAuthority,begin,parseReturn,resume,pending:load,clear:()=>save(null)});
