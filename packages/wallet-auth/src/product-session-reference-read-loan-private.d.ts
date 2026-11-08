import type{ProductSession,ProductSessionGatewayFetchAdapter}from'./index.js';
/** Internal transport observation only: no Root/Source/account-policy capability.
 * Actual implementation is borrowRetainedProductSessionReferenceReadTarget in
 * product-session-gateway-client.js, intentionally absent from public exports. */
export interface RetainedProductSessionReferenceReadLoan {readonly read:(at:Date)=>ProductSession;readonly close:()=>void}
export type BorrowRetainedProductSessionReferenceReadTarget=(adapter:ProductSessionGatewayFetchAdapter,registry:unknown,sameSignedCompletionRaw:string,at:Date)=>RetainedProductSessionReferenceReadLoan;
