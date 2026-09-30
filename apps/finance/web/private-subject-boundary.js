import {toEVMAddress} from '../../../sdk/js/index.js';

// Private Product Session is independently authorized. A simultaneously
// selected Standard Wallet must never send proof for a different subject.
export function privateSubjectMatchesSelectedWallet(session,standard){
  if(['explicit-local','permission-revoked','account-changed','chain-changed'].includes(standard?.disconnectReason))return false;
  if(standard?.status==='connecting')return false;
  if(standard?.status==='wrong-chain')return false;
  if(standard?.status==='transport-unavailable'){
    try{return standard.chainId==='0x1917'&&toEVMAddress(session?.account)===standard.account;}catch{return false;}
  }
  if(standard?.status!=='connected')return true;
  if(standard.chainId!=='0x1917'||!/^0x[0-9a-f]{40}$/.test(standard.account??''))return false;
  try{return toEVMAddress(session?.account)===standard.account;}
  catch{return false;}
}
