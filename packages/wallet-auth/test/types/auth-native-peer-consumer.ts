import {acquireOriginalIDEIdentityPeerBinding} from '@ynx-chain/wallet-auth/original-ide-admission';
import type {OriginalIDEIdentityReceiveOwner,OriginalIDEIdentityPeerReturn} from '@ynx-chain/wallet-auth/auth-native-contract';
declare const parent:OriginalIDEIdentityReceiveOwner;
const binding=acquireOriginalIDEIdentityPeerBinding('file:///fixed/Resources/server.mjs');
if(binding){
 const peer=binding.acquireOriginalIDEIdentityPeerChannel('file:///fixed/Resources/server.mjs',parent);
 const sending:Promise<undefined>=peer.sendRequest('receive','retained-original',undefined);
 const result:Promise<OriginalIDEIdentityPeerReturn>=peer.receiveReturn();
 const noGrant:false=peer.status().nativeAdmission;
 // @ts-expect-error Same Native opaque request owner is required; never a JS selector.
 binding.acquireOriginalIDEIdentityPeerChannel('file:///fixed/Resources/server.mjs',{});
 // @ts-expect-error No descriptor option or extra factory argument.
 binding.acquireOriginalIDEIdentityPeerChannel('file:///fixed/Resources/server.mjs',parent,5);
 // @ts-expect-error sendRequest must carry exactly three arguments.
 peer.sendRequest('receive','retained-original');
 // @ts-expect-error Login is not an identity-peer purpose.
 peer.sendRequest('login','retained-original',undefined);
 // @ts-expect-error Peer exposes no descriptor.
 peer.descriptor;
 // @ts-expect-error No peer result is a Native grant.
 const grant:true=peer.status().nativeAdmission;
 void [sending,result,noGrant];
}
