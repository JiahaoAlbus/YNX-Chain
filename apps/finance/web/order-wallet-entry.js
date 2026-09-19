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
function begin(unsigned,serverTime){
  const request=createFinanceOrderApprovalRequest(unsigned,serverTime);
  const url=encodeFinanceOrderApprovalWalletURL(request,serverTime);
  save(request);
  return Object.freeze({request,url});
}
function parseReturn(url,serverTime){
  const request=load();
  if(!request)throw new Error('FINANCE_ORDER_PENDING_NOT_FOUND');
  const result=parseFinanceOrderApprovalReturnURL(registry,url,request,serverTime);
  return canonicalJSON(result);
}

window.YNXFinanceOrderWallet=Object.freeze({begin,parseReturn,pending:load,clear:()=>save(null)});
