import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import type {PQNativeActionInput} from '@ynx-chain/wallet-auth/pq-native-action';
import type {PQTypedActionMetadata,PQInvoiceOriginals,PQTypedActionReview,PQTypedActionOriginalRead} from './typed-action-caller.mjs';
import {preparePQTypedActionReview,readPQTypedActionInvoiceReviewData,cancelPQTypedActionReview} from './typed-action-caller.mjs';
import {projectPQInvoiceReviewData} from './invoice-review-data.mjs';
declare const snapshot:PQAuthorizationSnapshot,action:PQNativeActionInput,metadata:PQTypedActionMetadata;
declare const raw:Uint8Array,original:PQTypedActionOriginalRead,archived:unknown,review:PQTypedActionReview;
function compileOnly(){
 const references:PQInvoiceOriginals={termsMessage:raw,settlement:{review:archived,member:raw,original}};
 preparePQTypedActionReview(snapshot,action,metadata,references);
 const view=readPQTypedActionInvoiceReviewData(review);
 if(view){const granted:false=view.permissionGranted,kind:'invoice_terms'|'invoice_settle'|'invoice_refund'=view.kind;
  const atoms:string=view.amount.atoms,fee:'raw-atoms'=view.fee.notation,scope:true=view.broadcastRequiresSeparateApproval;
  const digest:string=view.requestDigest,refundable:false=view.refundRecipientEditable;
  // @ts-expect-error immutable original recipient cannot be retargeted
  view.recipient='other';
  // @ts-expect-error a projection cannot be an approval token
  const approval:true=view.permissionGranted;
  void [granted,kind,atoms,fee,scope,digest,refundable,approval];
 }
 const cancelled=cancelPQTypedActionReview(review),retry:false=cancelled.canRetry;
 // @ts-expect-error original settlement requires both retained snapshots
 const incomplete:PQInvoiceOriginals={termsMessage:raw,settlement:{review:archived,member:raw,original:{selectedBinding:metadata}}};
 // @ts-expect-error a serialized unknown review is not a live Main review
 cancelPQTypedActionReview(archived);
 const data=projectPQInvoiceReviewData({},{}),native:false=data.nativeAdmission,finality:false=data.consensusFinality;
 return [retry,incomplete,native,finality];
}
void compileOnly;
