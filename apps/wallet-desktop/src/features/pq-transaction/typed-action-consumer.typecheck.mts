import type {PQAuthorizationSnapshot} from '@ynx-chain/wallet-auth/pq-wallet-policy';
import type {PQWalletKeyHandle} from '@ynx-chain/wallet-auth/pq-wallet-key-backup';
import type {PQNativeActionKind} from '@ynx-chain/wallet-auth/pq-native-action';
import {preparePQTypedActionReview,recheckPQTypedActionReview,signPQReviewedTypedAction,pqTypedActionInvocationData,inspectPQTypedActionMember} from './typed-action-caller.mjs';
declare const snapshot:PQAuthorizationSnapshot,handle:PQWalletKeyHandle,archivedReview:unknown;
const selected={account:'0x'+'11'.repeat(20),networkId:'22'.repeat(32)};
const input={chainId:selected.networkId,nativeChainId:'6423',owner:selected.account,nonce:'9007199254740994',fee:'0',kind:'stake' as const,payload:{amount:'9007199254740993'}};
function compileOnly(){
 const metadata={...selected,operationId:'original-1',createdAt:'2026-10-19T00:00:00.000Z',expiresAt:'2026-10-19T00:01:00.000Z'};
 const review=preparePQTypedActionReview(snapshot,input,metadata);
 const plan=recheckPQTypedActionReview(review,snapshot,selected);
 const actionKind:PQNativeActionKind=plan.action.kind;
 const wire:Uint8Array=signPQReviewedTypedAction(review,snapshot,handle,selected);
 const result=inspectPQTypedActionMember(review,wire),finality:false=result.consensusFinality,retry:false=pqTypedActionInvocationData(review).canRetry;
 const original=inspectPQTypedActionMember(archivedReview,wire,{reviewSnapshot:snapshot,signingSnapshot:snapshot,selectedBinding:selected});
 const recoveredRetry:false=original.canRetry;
 // @ts-expect-error archived input requires both original snapshots
 inspectPQTypedActionMember(archivedReview,wire,{signingSnapshot:snapshot,selectedBinding:selected});
 // @ts-expect-error plain JSON cannot substitute an SDK-branded snapshot
 inspectPQTypedActionMember(archivedReview,wire,{reviewSnapshot:{},signingSnapshot:snapshot,selectedBinding:selected});
 // @ts-expect-error archived unknown DATA cannot call the live-only overload
 inspectPQTypedActionMember(archivedReview,wire);
 // @ts-expect-error a public plain object is not a protected key handle
 signPQReviewedTypedAction(review,snapshot,{},selected);
 // @ts-expect-error arbitrary messages are not a typed action
 preparePQTypedActionReview(snapshot,{...input,kind:'raw_sign'},metadata);
 return{actionKind,finality,retry,recoveredRetry};
}
void compileOnly;
