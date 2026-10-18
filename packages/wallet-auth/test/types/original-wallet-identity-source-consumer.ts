import {acquireOriginalIDEWalletIdentitySource,isOriginalIDEWalletIdentitySource} from '@ynx-chain/wallet-auth/original-ide-admission';
import {signPQWalletAuthIdentityRequest} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
declare const input:unknown;declare const snapshot:PQAuthorizationSnapshot;
const source=acquireOriginalIDEWalletIdentitySource();
if(source){
 source.assertReady();source.bindRequest('original-request',undefined);source.current();
 const original:string=source.copyRequestOriginal();const data:Readonly<Record<string,unknown>>=source.copyRegistration();
 const notConsent:false=source.status().userApproved;
 // @ts-expect-error No provider or Source selector argument.
 acquireOriginalIDEWalletIdentitySource({provider:'PUBLIC'});
 // @ts-expect-error Always exact two bind arguments.
 source.bindRequest('request');
 // @ts-expect-error No descriptor/path/Source option after bind.
 source.bindRequest('request',undefined,5);
 // @ts-expect-error Native Source identity is not protected key custody.
 signPQWalletAuthIdentityRequest(source,'request',snapshot,'100');
 // @ts-expect-error This Source exposes no generic signing method.
 source.sign('anything');
 // @ts-expect-error No descriptor is public.
 source.descriptor;
 // @ts-expect-error Identity recognition cannot approve the user action.
 const approved:true=source.status().userApproved;
 void [original,data,notConsent];
}
if(isOriginalIDEWalletIdentitySource(input)){input.bindRequest('request',undefined);input.retire();input.join();input.close();}
// @ts-expect-error Recognizer has exactly one original object input.
isOriginalIDEWalletIdentitySource(input,5);
