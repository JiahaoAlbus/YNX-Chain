import {openSync,closeSync,fstatSync,writeSync,constants} from 'node:fs';
import {types} from 'node:util';
import {describeWalletTransactionPolicyRefusal} from './original-policy-supplier/transaction-diagnostic.mjs';
const own=(v,k)=>{if(!v||(typeof v!=='object'&&typeof v!=='function')||types.isProxy(v))return undefined;const d=Object.getOwnPropertyDescriptor(v,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
// Main-only diagnostic, never an authorization, policy, result or retry record.
// The same original exception still follows normal IPC and custody handling.
export function recordWalletTransactionPolicyFailure(error,filePath){
 let fd;
 try{
  if(own(error,'code')!=='AUTH_WALLET_TRANSACTION_POLICY_NOT_SUPPLIED'||!own(error,'policySourceObservation'))return false;
  const observation=describeWalletTransactionPolicyRefusal(own(error,'cause'));
  const line=Buffer.from(JSON.stringify({version:1,at:new Date().toISOString(),observation})+'\n');
  if(line.length>1024||constants.O_NOFOLLOW===undefined||constants.O_NONBLOCK===undefined)return false;
  fd=openSync(filePath,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
  const s=fstatSync(fd);
  if(!s.isFile()||s.nlink!==1||(s.mode&0o777)!==0o600||typeof process.getuid==='function'&&s.uid!==process.getuid()||s.size+line.length>65536)return false;
  return writeSync(fd,line)===line.length;
 }catch{return false;}
 finally{if(fd!==undefined)try{closeSync(fd);}catch{}}
}
