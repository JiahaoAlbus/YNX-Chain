import {
  canonicalJSON,
  createFinanceOrderApprovalRequest,
  encodeFinanceOrderApprovalWalletURL,
  parseFinanceOrderApprovalReturnURL,
} from '@ynx-chain/wallet-auth-finance-order';
import registry from './vendor/product-session-registry-a7dad7ec.json';

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
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!=='1'||!value.request)throw new Error('FINANCE_ORDER_PENDING_INVALID');
  return value.request;
}
function authorityDate(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value))throw new Error('FINANCE_ORDER_AUTHORITY_TIME_INVALID');
  const parsed=new Date(value);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value)throw new Error('FINANCE_ORDER_AUTHORITY_TIME_INVALID');
  return parsed;
}
function begin(unsigned,serverTime){
  const at=authorityDate(serverTime);
  const request=createFinanceOrderApprovalRequest(unsigned,at);
  const url=encodeFinanceOrderApprovalWalletURL(request,at);
  save({approvedProof:null,request,version:'1'});
  return Object.freeze({request,url});
}
function parseReturn(url,serverTime){
  const pending=load();
  if(!pending)throw new Error('FINANCE_ORDER_PENDING_NOT_FOUND');
  const request=pendingRequest(pending);
  const result=parseFinanceOrderApprovalReturnURL(registry,url,request,authorityDate(serverTime),pending.approvedProof);
  if(result.status==='approved')save({approvedProof:result.approval,request,version:'1'});
  return canonicalJSON(result);
}

window.YNXFinanceOrderWallet=Object.freeze({begin,parseReturn,pending:load,clear:()=>save(null)});
