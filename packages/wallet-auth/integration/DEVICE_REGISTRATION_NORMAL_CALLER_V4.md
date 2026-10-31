# Normal original device registration caller

The existing Main account permission, selected-account current Source, protected
outbox and `vault.withPQKeys` path remain mandatory. Device creation approval
cannot approve the account, register a device or create a session.

1. Call zero-input `openOriginalProductDeviceV4RegistrationClient()` from
   `@ynx-chain/wallet-auth/original-product-device-v4-registration-client`.
   Capture an acquisition exception's same Native partial before interpretation.
2. Call `readOriginalRegistrationReviewDATA({identityBinding,generation,publicPair})`
   with Main's independent exact twelve-field identity, original generation and
   actual creation child's public pair. The original fixed Native pending Source
   supplies request/registration originals. The SDK compares selected identity,
   application and public pair; it does not self-fill an expected16 authority.
3. Present a separate account review. Reserve the original account signing entry
   durably before key access, using Main's existing protected store. Under its
   original permission/current guards, call `preparePQProductSessionApprovalV4`
   in `product-session-pq-v4-codec` with registry, requestV4, `{account,expiresAt}`,
   original account policy reference, registration original bytes and current
   instant. Pass the resulting opaque v4 plan and existing account handle to
   `signPQWalletProductSessionApprovalV4` in `pq-wallet-key-backup`. Retain the
   original signed outcome before late guards. The plan accepts one signing
   entry and cannot enter the old v3 signer. It is not user consent or a Source.
4. Call `prepareOriginalPairSubmission({approvalOriginal,policyRef,abortContext})`
   with original canonical approval JSON and one frozen `{signal}` context.
   The SDK verifies the account's full AND proof, asks the fixed Native pending
   Source for the original registration PoP, retains its original member before
   late checks, verifies that proof and drains child before parent. No account
   or device private key crosses this interface.
5. `readOriginalPairRequestDATA(packet)` exposes the exact complete canonical
   HTTP body and original Source-selected pendingId as operationId. **Main must
   persist this whole body and its entry marker in its existing protected
   durable outbox before `submitPreparedPair(packet,sameContext)`.** Reading this
   DATA does not attest the caller's disk durability. The SDK supplies no
   journal-success setter, path selector or cross-process replay authorization.
6. Submit once to the original fixed HTTPS authority's `/v4/product-pairs` using
   the existing gateway transport and original codec. Preserve response before
   late account-current/abort checks. Strict returned registration/challenge
   binding remains DATA: registered, connected, newSession and operationVerified
   remain false. HTTP durability is not Source admission or Native completion.
7. Main may continue its original independently authenticated registration flow
   and zero-DTO `creationChild.complete()`; Native must independently read the
   registered Source/current and exact pair/terms. It never trusts this reply as
   `registered:true` and never accepts caller registration-success JSON.

The current formal server publishes only pair/challenge/complete routes. Its
internal kernel `recover` is not a public URL. An uncertain original pair remains
query-only; this client never changes pendingId, regenerates keys, signs again,
resubmits or guesses a recovery route. Dedicated local device-outcome query is a
different purpose and is not server-pair recovery. Keep first causes, partials,
original results and cleanup debt across failure.

Tests exercise real account/device mathematical proofs while Native, account
Source and HTTP responses are explicit PUBLIC fixtures. They are not actual
user approval, Root enrollment, installed App or real registration evidence.
