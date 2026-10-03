import {setWalletCopy} from "./wallet-locale.mjs";
import {PERMISSION_STORE_NOTICE} from "./wallet-locale-permissions.mjs";
// Translate only this owned storage refusal, not arbitrary remote diagnostics.
export function renderPermissionError(node,error){
  if(error?.code!=="PERMISSION_STORE_INVALID"||error?.message!==PERMISSION_STORE_NOTICE)return false;
  setWalletCopy(node,PERMISSION_STORE_NOTICE);return true;
}
