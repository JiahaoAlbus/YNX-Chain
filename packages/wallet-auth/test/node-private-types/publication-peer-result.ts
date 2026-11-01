import type {OriginalIDEIdentityPeerOwner,OriginalIDEIdentityPeerReturn,OriginalIDEPublicationPeerReturnData} from '@ynx-chain/wallet-auth/auth-native-contract';
async function originalPublicationDATA(peer:OriginalIDEIdentityPeerOwner){
 const result=await peer.receiveOriginalArtifactReturn();
 if(result.decision==='reject'){const proof:null=result.proof;void proof;return;}
 const original:Uint8Array<ArrayBuffer>=result.resultOriginal;
 const purpose:'ARTIFACT-RELEASE'=result.purpose;
 const requestPurpose:'AUTH-PROTECTED-KEY-CALL'=result.requestPurpose;
 const dataOnly:true=result.dataOnly;
 const verified:false=result.signatureVerified,authorized:false=result.publicationAuthorized,admitted:false=result.nativeAdmission,current:false=result.approvalCurrent;
 void original;void purpose;void requestPurpose;void dataOnly;void verified;void authorized;void admitted;void current;
 // @ts-expect-error publication DATA does not have a proof2 field
 result.proof;
 // @ts-expect-error publication result is not an ordinary identity approval
 const identity:OriginalIDEIdentityPeerReturn=result;
 // @ts-expect-error correlated DATA never promotes approval current
 const approval:true=result.approvalCurrent;
 // @ts-expect-error readonly Native DATA flags cannot be changed
 result.signatureVerified=true;
 const ordinary=await peer.receiveReturn();
 // @ts-expect-error identity return never becomes publication DATA
 const publication:OriginalIDEPublicationPeerReturnData=ordinary;
}
void originalPublicationDATA;
