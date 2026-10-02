// Small callback-only closure: no chat SDK, storage, authority or network client.
import {handleMatrixLoginCallback} from './login.mjs';

export function runMatrixLoginCallbackPage({callbackHref,environment=globalThis}={}){
 const status=environment.document?.getElementById?.('callback-status');
 try{
  if(typeof callbackHref!=='string'||!handleMatrixLoginCallback({environment,callbackHref})){
   if(status)status.textContent='This sign-in callback is unavailable. Return to Social and retry.';
   return false;
  }
  return true;
 }catch{
  // Never include exception details, callback URLs or credentials in the UI/logs.
  if(status)status.textContent='Sign-in could not return to Social. Return to Social and retry.';
  return false;
 }
}
