# Original normal publication caller and read-only recovery

Version `1.3.0-pq.3.3` succeeds the frozen R3b package. No R3b archive or Auth R25/R27 handoff is overwritten.

## Exact original service adoption

The seven production leaves of Auth R28 are copied byte-for-byte: the daemon successor goes to the existing `scripts/ynx-wallet-gatewayd.mjs`; six policy/publisher/resource leaves go to `native/publication-readonly-source-r28-20261018/source/` preserving relative imports. The original v2 constructor selects required current Source and retains `authIdentitySourceCurrent`. The v3 constructor retains its explicit existing-state/capacity prerequisites and does not mount the v2 publisher. The same server and atomic snapshot remain authoritative. Pre-listen binding failure follows original shutdown. Publisher retire/join/close precedes parent cleanup; no second listener, Host, store or issuer is created.

Auth R28 handoff SHA256 is `bc56ca967ac89f8052e0ef4f126bd8fb0135b297575887444d8ca5e53844ce68`. Its four reviewed SDK runtime leaves remain exact. The full seven-leaf supplier closure must be present in the actual tarball; importing a Source script from an ambient checkout is insufficient.

## Wallet Main caller

`createProductWalletReturnPublisher({gatewayTimeoutMs})` from the existing `product-wallet-connection` subpath returns only `currentTime`, `publishReturn` and `publicationOutcome`. It composes the existing Gateway fetch adapter at the fixed canonical `https://wallet-auth.ynxweb4.com` and platform HTTPS transport. It accepts no endpoint, fetch, provider, key, Root or Native borrow option. It does not attest installation, grant transport permission, sign anything or automatically retry a write. The original App journal/controller still owns explicit approval, signed originals, once-only publish, lock/current fencing and UNKNOWN retention.

`publishReturn({requestId,request,approval})` returns exactly `{reference,nonce,state,expiresAt}` after normal envelope and business binding checks. The response must match the original request's nonce/state and cannot extend its lifetime.

`publicationOutcome({requestId,publicationRequestId,request,approval})` posts to the SAME `/v2/product-sessions/returns/outcome` path with exactly:

```
{selector:'YNX-PRODUCT-SESSION-PUBLICATION/v1',publicationRequestId,request,approval}
```

`requestId` identifies this read; `publicationRequestId` identifies the original publish. Complete original canonical request and approval are mandatory. The normal nine-field Source operation carries the original snapshot row projection or null, and its actual stored session or null. Source performs full N1 dual-signature verification against fresh current policy at NOW and signed shape/math at the original approval time. `verifyPQProductSessionPublicationApproval` reuses the unique verifier and returns public data only; it registers or returns NO live approval/completion capability. Historical revision inference and future signed timestamps are refused.

Found results are exactly `{state:'pending'|'completed',reference,expiresAt,requestDigest,account,approvalDigest,retryAuthorized:false}`. Missing results are exactly `{state:'not_found',retryAuthorized:false}` after proof and current Source validation. The normal adapter checks the original account, request digest, complete approval digest, reference and unchanged expiry. The read performs no audit, nonce, challenge, cache, session, publication or expiry mutation. It never grants re-publish/re-sign/re-reserve permission. The old P256 completion/outcome body remains distinct and unchanged.

Recovered reference encoding uses nonce/state from the exact saved request. Old request expiry is not bypassed with a historical callback clock. Expired metadata is readable without becoming a callback URL or grant. App must retain and classify it through its original journal; no large approval-URL fallback is allowed.

## Recovery and isolation repairs

Starting a new account selection checks protected completion and already-entered signing before any old request is erased. UNKNOWN signed bodies and signing markers survive cold begin; cancellation during an entered signer also preserves the original. Confirmed cleanup still permits a new explicit request.

Completed reference outcome may return `state:'expired'` and the exact historical stored session only after original P256, current Source, revocation and control checks. The client verifies fresh authority expiry, never connects from it, and uses the original target for normal sign-out/expiry completion. It does not sign or submit again.

Cold restore verifies every product/platform/application/origin/callback/device binding and exact configured scopes before requesting a device proof. A misbound protected store cannot show another DApp's valid session as connected; foreign records are retained for the original bridge owner to repair.

## Remaining actual-platform gates

These changes do not prove real Source admission, a protected full-daemon startup, registered service deployment, matching installed App, actual OS callback or user acceptance. Producer replies, keys and openers in isolated controls are explicitly QA fixtures. Real accounts, money and signatures need their own immediate human authorization.

Native R16 still has four original private operations. Reference methods remain explicitly unsupported on that private adapter. A DApp whose normal factory selects the protected private bridge needs the original provider's formal purpose/version or qualified transport extension with same-Host/authority/state/current semantics. There is no silent HTTPS fallback and no new Native operation or Root. IDE SDK20/r6a qualification originals remain separately required.

The reference store's bounded 64 rows and retention policy still require the original release owner's public multi-user decision. UNKNOWN records are not discarded to make space.
