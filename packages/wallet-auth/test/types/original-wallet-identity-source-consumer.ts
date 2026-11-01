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

// R114 exact Native transport, DATA only; receiveRequest already binds.
if(source){
 const launched:undefined=source.launch();
 const received:Promise<Readonly<{requestRaw:string;invocationRaw:null|string}>>=source.receiveRequest();
 const approved:Promise<void>=source.sendDecision('approve',new Uint8Array([1]));
 const rejected:Promise<void>=source.sendDecision('reject',undefined);
 const cancelled:Promise<void>=source.sendDecision('cancel',undefined);
 const busy:number=source.status().busy;
 const exit:number|null|undefined=source.status().transport?.childExitStatus;
 // @ts-expect-error No caller-selected path or FD.
 source.launch('/tmp/PUBLIC');
 // @ts-expect-error No injected request/provider; Native captures its own packet.
 source.receiveRequest({requestRaw:'PUBLIC'});
 // @ts-expect-error Approve requires signed member bytes.
 source.sendDecision('approve',undefined);
 // @ts-expect-error Reject must never take proof or borrow keys.
 source.sendDecision('reject',new Uint8Array([1]));
 // @ts-expect-error Cancel must never take proof.
 source.sendDecision('cancel',new Uint8Array([1]));
 // @ts-expect-error Exact second argument required.
 source.sendDecision('cancel');
 // @ts-expect-error No arbitrary decision/message method.
 source.sendDecision('sign',undefined);
 // @ts-expect-error No FD in status.
 source.status().transport?.descriptor;
 void [launched,received,approved,rejected,cancelled,busy,exit];
}
