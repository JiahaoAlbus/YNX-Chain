import {acquireOriginalIDENativeAuthBinding} from '@ynx-chain/wallet-auth/original-ide-admission';
import type {OriginalAuthIDENativeBinding,OriginalIDEIdentityReceiveOwner} from '@ynx-chain/wallet-auth/auth-native-contract';
const binding:OriginalAuthIDENativeBinding|null=acquireOriginalIDENativeAuthBinding('file:///original/Resources/server.mjs');
if(binding){
 const partial:OriginalIDEIdentityReceiveOwner=binding.receiveOriginalIDEIdentity('file:///original/Resources/server.mjs');
 const ready:undefined=partial.assertReady();
 // @ts-expect-error Discovery returns the callback table, not a ready owner.
 binding.assertReady();
 // @ts-expect-error Receive owner has no protected key invocation.
 partial.invoke();
 void ready;
}
// @ts-expect-error Fixed discovery has only one actual-entry argument.
acquireOriginalIDENativeAuthBinding('file:///original/server.mjs',{provider:'replacement'});
// @ts-expect-error Synchronous discovery has no Promise continuation.
acquireOriginalIDENativeAuthBinding('file:///original/server.mjs')?.then(()=>{});
void binding;
