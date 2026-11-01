import type {OriginalAuthIDENativeBinding,OriginalAuthNativePhase} from '@ynx-chain/wallet-auth/auth-native-contract';
declare const native:OriginalAuthIDENativeBinding;
const entry='file:///original/server.mjs';
const receive=native.receiveOriginalIDEIdentity(entry); // Retain before readiness.
const ready:undefined=receive.assertReady();
const request:string=receive.copyRequestOriginal();
const complete:undefined=receive.completeProof(new Uint8Array());
const code:string|null=receive.status().firstCauseCode;
const phase:OriginalAuthNativePhase=receive.status().phase;
const closed:undefined=receive.close();
const recovered=native.recoverOriginalIDEIdentity(entry);
const keyCall=native.acquireOriginalIDEProtectedKeyCall(entry,'canonical invocation DATA');
const publicResult:unknown=keyCall.invoke();
// @ts-expect-error A renderer cannot supply expected request/clock/root at construction.
native.receiveOriginalIDEIdentity(entry,{expectedRaw:'override',at:0,root:'caller'});
// @ts-expect-error The proof call accepts only the Member bytes.
receive.completeProof(new Uint8Array(),{expectedRaw:'override',at:0});
// @ts-expect-error Receipt shape is not an assumed successful DTO or private key.
keyCall.result().privateKey;
// @ts-expect-error Receive/recovery owners cannot invoke protected keys.
receive.invoke();
// @ts-expect-error A captured protected call accepts no selector or callback.
keyCall.invoke('new operation');
// @ts-expect-error Immutable lifecycle DATA cannot clear UNKNOWN.
receive.status().unknown=false;
// @ts-expect-error Phase is closed, not an arbitrary success string.
const invented:OriginalAuthNativePhase='success';
// @ts-expect-error The SDK exports no runtime Native constructor wrapper.
import {receiveOriginalIDEIdentity} from '@ynx-chain/wallet-auth/auth-native-contract';
void [ready,request,complete,code,phase,closed,recovered,publicResult];
