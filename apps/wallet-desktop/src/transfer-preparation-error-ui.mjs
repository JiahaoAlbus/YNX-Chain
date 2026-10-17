import {setWalletCopy} from './wallet-locale.mjs';
import {TRANSFER_ERROR_KEYS} from './wallet-locale-transfer-errors.mjs';
const ownedNotices=new Set(TRANSFER_ERROR_KEYS);
// Only the preparation refusal is translated. Unknown signing/submission
// results and arbitrary remote messages retain their original error rendering.
export function renderTransferPreparationError(node,error){
 if(error?.displayOrigin!=='LOCAL_TRANSFER_PREPARATION'||error?.outcomeUnknown||error?.transactionHash!=null||error?.code!=='INSUFFICIENT_FUNDS'||!ownedNotices.has(error?.message))return false;
 setWalletCopy(node,error.message);return true;
}
