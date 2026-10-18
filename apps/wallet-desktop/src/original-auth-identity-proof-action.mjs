import {inspectOriginalAuthIdentityRequest} from '@ynx-chain/wallet-auth/auth-identity-contract';
import {signPQWalletAuthIdentityRequest} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import {pqRegisteredPublicBinding} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {assertPQRegisteredRecoveryBindingData} from '@ynx-chain/wallet-auth/pq-registered-member';

const purposes=new Set(['AUTH-IDENTITY-RECEIVE','AUTH-IDENTITY-RECOVER','AUTH-PROTECTED-KEY-CALL']);
const fail=code=>{throw Object.assign(Error(code),{code});};

/** Original Wallet main-local operation BODY only, not request admission,
 * native Source factory, approval issuer, recovery effect or IPC transport.
 * Original main must supply its admitted exact request, independent policy
 * current fence and fresh request-specific user-approval permission. Never
 * expose this constructor or its callbacks via preload/renderer/JS vtables.
 * It intentionally cannot use an ordinary login/transaction permission lease.
 */
export function createOriginalAuthIdentityProofAction({vault,requestOriginal,expectedOriginal,purpose,snapshot,permission,assertCurrent,now=Date.now}) {
 if(!purposes.has(purpose))fail('AUTH_IDENTITY_PURPOSE_REFUSED');
 if(typeof assertCurrent!=='function'||typeof permission?.assertOriginalAuthIdentity!=='function'||typeof vault?.withPQKeys!=='function')fail('AUTH_IDENTITY_PRIVATE_APPROVAL_REQUIRED');
 let entered=false,retired=false,wire=null,firstCause,failed=false,finished=false;
 let keyActionEntered=false,keyActionFinished=false,borrowSettled=false;
 const retain=cause=>{if(!failed){failed=true;firstCause=cause;}};
 const at=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)fail('AUTH_IDENTITY_CLOCK_INVALID');return String(value);};
 const inspect=()=>inspectOriginalAuthIdentityRequest(requestOriginal,expectedOriginal,purpose,at());
 // Reject changed/expired/login/raw inputs and unbranded snapshots before
 // acquiring a key. A parsed snapshot remains DATA, not Source admission.
 const body=inspect().body,binding=pqRegisteredPublicBinding(snapshot,body.keyVersion);
 if(binding.owner!==body.owner||binding.chainId!==body.networkId)fail('AUTH_IDENTITY_POLICY_BINDING_CHANGED');
 assertPQRegisteredRecoveryBindingData(snapshot,binding,{chainId:body.networkId,owner:body.owner,keyVersion:body.keyVersion,executionHeight:body.executionHeight});
 const current=()=>{
   if(retired)fail('AUTH_IDENTITY_ACTION_RETIRED');
   if(assertCurrent()!==undefined)fail('AUTH_IDENTITY_CURRENT_INVALID');
   if(retired)fail('AUTH_IDENTITY_ACTION_RETIRED');
   inspect();
   if(permission.assertOriginalAuthIdentity(requestOriginal,purpose)!==undefined)fail('AUTH_IDENTITY_APPROVAL_INVALID');
   if(retired)fail('AUTH_IDENTITY_ACTION_RETIRED');
 };
 const borrowPermission=Object.freeze({assert:current});
 return Object.freeze({
   async sign(){
     if(entered)fail('AUTH_IDENTITY_PROOF_ALREADY_ENTERED');
     entered=true; // Select before foreign current/approval/vault entry.
     try{
       current();
       try{await vault.withPQKeys(binding,async(handle,_actualBinding,guard)=>{
         try{
           if(borrowSettled||keyActionEntered)fail('AUTH_IDENTITY_VAULT_CALLBACK_REPLAY');
           keyActionEntered=true;
           current();guard.assert();
           const signed=signPQWalletAuthIdentityRequest(handle,requestOriginal,snapshot,at());
           // Capture synchronously BEFORE a late guard/lock or caller return can
           // fail. The sole SDK validates N1/purpose/exact E and complete pair.
           wire=new Uint8Array(signed);
           guard.assert();current();keyActionFinished=true;
         }catch(cause){retain(cause);throw cause;}
       },borrowPermission);}finally{borrowSettled=true;}
       if(failed)throw firstCause;
       if(!keyActionFinished||wire===null)fail('AUTH_IDENTITY_VAULT_ACTION_INCOMPLETE');
       current();finished=true;
       return new Uint8Array(wire);
     }catch(cause){retain(cause);throw firstCause;}
   },
   retire(){retired=true;},
   // Original main custody read only. Retaining public signed DATA is not a
   // fresh approval, a Native handoff, permission to resend, or an effect.
   readOriginalResult(){return Object.freeze({requestOriginal,purpose,wire:wire?new Uint8Array(wire):null,handoffAuthorized:false,dataOnly:true});},
   status(){return Object.freeze({entered,retired,finished,failed,hasSignedResult:wire!==null,phase:wire?(finished?'signed-unhanded':'signed-late-failure'):entered?(failed?'failed-no-result':'signing'):retired?'cancelled-before-sign':'pending',retryAuthorized:false});},
   firstFailure(){return Object.freeze({present:failed,cause:firstCause});}
 });
}
