# Social historical Matrix and cross-store integration contract

Owned source: `0585c1177c3fa77cec8a662cf456e334fe9bb803`, tree `920d1c021ccc3731dc84ac4ffd5402691a5b792d`, parent `7b209a99299602bf4f1c96b716e94e1030eef2cc`.

This is an internal producer/consumer handoff, not a deployment lease or installed/public acceptance. Root A reports that live shared source is still abbreviated `7c14`; an exact live commit was not supplied. The actual complete `16195c6663525b0965725a922f46f38cf7b0a004` package is used only in the isolated validation stage. No live shared/module/Host/key changes were made.

## Public historical directory carrier

The existing constructor is `social.ParseMatrixDirectory(io.Reader) (*social.MatrixDirectory, error)`. The actual JSON schema is `ynx-social-matrix-directory/v1`, with `bindings` records containing exactly `account`, `homeserver`, `serverName`, `userId`. The directory must come from verified existing account-to-MXID provenance. It is immutable after parsing; HTTPS homeserver, original MXID suffix and uniqueness are validated. Do not construct an MXID from a chain address, register a replacement account, assume Wallet approval created a Matrix identity or supply a synthetic directory as production.

A must freeze the exact public directory bytes/SHA, source/provenance and real deployment inputs. It contains no access token, private key, OP/operator configuration or login credential. A missing binding remains unavailable; aliases and node migration must preserve the existing original identity rather than allocate another one.

## Existing bridge ports

`social.MatrixBridge.Directory` is now required. `Authorize func(*http.Request, []string) (string, error)` still delegates to the existing authority; its fixed required scopes are `social.contacts` and `social.messaging`. It is not an independent verification protocol. If an optional `Resolve func(context.Context, string) (social.MatrixServer, error)` is supplied, its HTTPS base URL and server name must match the immutable directory exactly. It cannot retarget a historical identity.

The existing protected `Issue func(context.Context, string, string, social.MatrixServer) (social.MatrixCredential, error)` must supply only the existing account/device's authorized credential. The callback must validate real enrolled device provenance; the JSON `deviceId` is not authority to enroll a new device. Existing `MatrixCredential` has `AccessToken string` and `ExpiresAt time.Time`; the bridge verifies the real `/account/whoami` response against the original directory MXID and original device before returning a binding. No admin token, wallet secret or E2EE private key belongs in this bridge. Root A owns protected configuration and exact issuer wiring; this change does not mount or enable this bridge in production.

## Actual audience observer input still required

The current `social.Config` has `MatrixDirectory *social.MatrixDirectory` and `MatrixAudienceAuthority social.MatrixAudienceAuthority`. The latter interface is exactly:

```go
type MatrixAudienceAuthority interface {
    ConfirmAudience(context.Context, MatrixAudienceMetadata, string) (MatrixAudienceObservation, error)
    ObserveEvent(context.Context, string, string) (MatrixAudienceEvent, error)
}
```

`MatrixAudienceObservation` contains `RoomID`, `Members`, `Algorithm`, `HistoryVisibility`. `Members` must reflect current real joined membership mapped through original directory identities, not a client boolean or supplied room list. `MatrixAudienceEvent` contains `RoomID`, `EventID`, `Sender`, `Type`, `TransactionID`. Sender is the original MXID; the actual event must be `m.room.encrypted` and its original transaction ID must match. A missing original encrypted audience room must not be disguised as a successful newly synthesized room.

Current `cmd/ynx-sociald/main.go` does not configure an audience observer. Its lack of actual producer wiring is an internal implementation/mount issue, not a demand for the human's account or credentials. A must supply the real fixed HS provenance and existing protected read-credential/observer port contract before a production observer is enabled. Observation must not read/store/log plaintext E2EE contents or private keys.

Original `MatrixAudienceSessionRevalidator.Revalidate(context.Context, productsessionv2.Session, []string)` remains a confidential same-session read outside the Social mutex. Keep the entire verified original Session and its expiry, original browser family/generation and account/device; unavailable authority is not revocation. Existing Matrix audience nonce/unknown-intent ledger remains the only owner of those action effects. Constructor/policy selection alone is not Native enrollment or a new grant.

## Profile cross-store recovery

The original Social `Idempotency` map now durably reserves `profile_contract_prepared`, then marks only known local no-effect errors `profile_contract_rejected` or successful completed Social/Square steps `profile_contract_completed`. The original body/account/device/key digest is frozen. Unknown IO or cancellation leaves the original prepared intent; a different key cannot replace it. Explicit same-key retry uses the original Square idempotency result, then commits only avatar/identity QR into current Social settings without overwriting newer privacy choices. No second nonce database or generic ActionProof validator was introduced.

Only the existing in-process Square durable domain call runs under the Social mutex to serialize local revoke/device changes with dispatch; no remote reader/Revalidate runs under it. Cold retry is tested to leave Square file bytes identical. Generic ActionProof/raw-body/full-session revalidation and actual nonce-plus-effect integration, other Chat/Square operations and cross-device uncertain-intent settlement are not declared complete by this batch.

## Remaining acceptance

Real public source binding, actual enrolled Native account/device, real HS original identity and E2EE/ABC journeys, real Wallet boundaries and MONSTER invocation remain unverified. No deployment, account request, signature or transaction occurred. A alone coordinates complete shared adoption, protected configuration, mount and release; installed/public checks must use the final actual artifact and cannot substitute these software fixtures.
