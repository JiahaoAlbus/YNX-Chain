import {setWalletCopy} from './wallet-locale.mjs';
import {TRANSFER_ERROR_KEYS,POLICY_UNAVAILABLE_KEY,POLICY_FAILURE_KEYS} from './wallet-locale-transfer-errors.mjs';
const ownedNotices=new Set(TRANSFER_ERROR_KEYS);
// Only the preparation refusal is translated. Unknown signing/submission
// results and arbitrary remote messages retain their original error rendering.
export function renderTransferPreparationError(node,error){
 if(error?.displayOrigin==='LOCAL_PQ_POLICY_PREPARATION' && !error?.outcomeUnknown && error?.transactionHash==null &&
    error?.code==='AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED' && error?.message==='AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED'){
  const reason={AUTHORIZATION_HTTP_405:1,CONNECTION_FAILED:2,TLS_IDENTITY_FAILED:3};
  const index=Object.hasOwn(reason,error.policyFailure)?reason[error.policyFailure]:null;
  setWalletCopy(node,index===null?POLICY_UNAVAILABLE_KEY:POLICY_FAILURE_KEYS[index]);return true;
 }
 if(error?.displayOrigin!=='LOCAL_TRANSFER_PREPARATION'||error?.outcomeUnknown||error?.transactionHash!=null||error?.code!=='INSUFFICIENT_FUNDS'||!ownedNotices.has(error?.message))return false;
 setWalletCopy(node,error.message);return true;
}
