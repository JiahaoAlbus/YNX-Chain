import {createWalletConnectRequestReview,WalletConnectRequestReplayStore,type WalletConnectRequestReview,type WalletConnectSessionApproval} from "@ynx-chain/wallet-auth";
import type {WalletConnectRequest} from "./runtime";

/** Public review drafts only; no secret or approval survives a lock. */
export class WalletConnectReviewRecovery {
  private drafts=new WeakMap<WalletConnectRequest,{review:WalletConnectRequestReview;reviewedAt:Date}>();
  review(event:WalletConnectRequest,session:WalletConnectSessionApproval,replayStore:WalletConnectRequestReplayStore,now=new Date(),initialAt=now):WalletConnectRequestReview {
    const previous=this.drafts.get(event);
    if(!previous){const draft=createWalletConnectRequestReview(event,{session,replayStore,now:initialAt});if(draft.expiresAt<=now.toISOString()||session.expiresAt<=now.toISOString())throw new Error("The original request expired. Return to the app for a new request.");return draft;}
    const reserved=replayStore.snapshot().find(record=>record.key===`${previous.review.topic}:${previous.review.requestId}`);
    if(previous.review.expiresAt<=now.toISOString()||!reserved||reserved.status!=="reserved"||reserved.requestDigest!==previous.review.requestDigest||reserved.expiresAt!==previous.review.expiresAt)throw new Error("The original request expired or was already decided. Return to the app for a new request.");
    // Run the original parser again against today's approved session. Keeping
    // the initial timestamp preserves bounded-default expiry and sign bytes.
    const refreshed=createWalletConnectRequestReview(event,{session,replayStore:new WalletConnectRequestReplayStore(),now:previous.reviewedAt});
    if(refreshed.requestDigest!==previous.review.requestDigest||session.account!==previous.review.account||session.sessionBinding!==previous.review.sessionBinding||session.expiresAt<=now.toISOString())throw new Error("Wallet request authorization changed while locked. Return to the app for a new request.");
    return refreshed;
  }
  remember(event:WalletConnectRequest,review:WalletConnectRequestReview,reviewedAt:Date):void {
    if(!this.drafts.has(event))this.drafts.set(event,{review,reviewedAt:new Date(reviewedAt)});
  }
}
