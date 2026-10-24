import {createHash} from 'node:crypto';
import {canonicalJSON} from '@ynx-chain/wallet-auth';
const fail=()=>{throw Object.assign(Error('PQ_FINALITY_HISTORY_PROTECTION_UNAVAILABLE'),{code:'PQ_FINALITY_HISTORY_PROTECTION_UNAVAILABLE'});};
// The existing OS storage service protects a digest of the complete archive,
// including original signed bytes, progress and evidence. No account key,
// mnemonic, new key file, server, permission or signing operation is involved.
export function createPQFinalityHistoryProtection(safeStorage){
 const available=()=>{if(typeof safeStorage?.isEncryptionAvailable!=='function'||!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text'||typeof safeStorage.encryptString!=='function'||typeof safeStorage.decryptString!=='function')fail();};
 const message=value=>'YNX-PQ-FINALITY-HISTORY/v1:'+createHash('sha256').update(canonicalJSON(value)).digest('hex');
 return Object.freeze({
  seal(value){available();const bytes=safeStorage.encryptString(message(value));if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8192)fail();return bytes.toString('base64');},
  verify(value,sealed){available();if(typeof sealed!=='string'||!sealed.length||sealed.length>12000)fail();const bytes=Buffer.from(sealed,'base64');if(bytes.toString('base64')!==sealed||safeStorage.decryptString(bytes)!==message(value))fail();}
 });
}
