import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import {inspectPQReviewedTypedTransportOriginal} from './typed-action-reviewed-transport.mjs';
declare const review:unknown,raw:Uint8Array,snapshot:PQAuthorizationSnapshot;
const original={reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding:{account:'0x'+'11'.repeat(20),networkId:'22'.repeat(32)},memberHash:'0x'+'33'.repeat(32),transportHash:'0x'+'44'.repeat(32)};
function compileOnly(){
 const result=inspectPQReviewedTypedTransportOriginal(review,raw,original);
 const id:string=result.operationId,n:1=result.memberCount,index:0=result.memberIndex;
 const retry:false=result.canRetry,permission:false=result.permissionGranted,rawMember:Uint8Array=result.member;
 // @ts-expect-error original review snapshot is mandatory
 inspectPQReviewedTypedTransportOriginal(review,raw,{signingSnapshot:snapshot,selectedBinding:original.selectedBinding,memberHash:original.memberHash,transportHash:original.transportHash});
 // @ts-expect-error raw DTOs cannot substitute branded original snapshots
 inspectPQReviewedTypedTransportOriginal(review,raw,{...original,signingSnapshot:{}});
 // @ts-expect-error exact options cannot include a permission field
 inspectPQReviewedTypedTransportOriginal(review,raw,{...original,approved:true});
 // @ts-expect-error readonly recovery DATA never grants permission
 const grant:true=result.permissionGranted;
 return{id,n,index,retry,permission,rawMember,grant};
}
void compileOnly;
