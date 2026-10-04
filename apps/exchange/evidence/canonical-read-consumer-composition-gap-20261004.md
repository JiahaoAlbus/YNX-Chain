# Exchange canonical read consumer: exact composition boundary

Ordinary source-only consumer correction inherited from owner commit
`8a18ede1cb95331593295867dd6d8fa8c84a3395`. Central supplied and this owner
actually read the original-main successor at:

`/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/coordination-01a094cc/recovery-20261004/exchange-original-main-identity-logout-successor-source-20261004`

Its MANIFEST SHA256 was independently checked as
`382f9b8f9887afbbf203a82d89ca86b976ca07b62b5f554011432a6bb4030649`;
contentRoot `91d3ba7d8cd96714fd4bf2df34aa998581112418e65c7772a4d9b32e736ef33a`.
The capsule, protected source and binaries were not changed or executed here.

## Accepted server contract and executable consumer gap

The actual dispatcher accepts only GET `/v1/account`, `/v1/margin/account` and
`/v1/solvency/liability-proof` for `exchange:read`, requiring independent Session
and sealed Browser binding plus `X-YNX-Product-Session-Action-Proof-V2`.
It signs/verifies the original wire path including the outer `/api` prefix;
only internal routing drops that prefix. Body/query must be empty and the path
unencoded. It persists the original binding/nonce and revalidates combined
authorization after the original handler. SSO account/logout controls grant
identity only, not business access. Other private/write routes remain closed.

Current owned consumer obtains `adapter.createIntrospectionProof`, sends the
original same-origin `/api/v1/account` GET and the v2 Session proof. Its exact
frozen 9840 browser adapter exports introspection, but no accepted callable
factory for a separate request-bound action proof. Thus the new canonical main
can reject an otherwise approved session with ACTION_PROOF_REQUIRED. A user
re-approval cannot supply an absent consumer/SDK interface.

One executable dependency remains with the sole shared owner A: return the
accepted root factory/export and matching package/consumer graph for the
separate exact empty-body GET wire action, with original account/session/device,
scope/time/nonce/revocation binding. This owner will consume it; it will not
reuse the introspection proof as an action proof, hand-construct signatures,
expose a device key, widen scopes or enable a legacy fallback. This is not a
request for user credentials or a new financial API choice.

The capsule's copied controller also predates ordinary stream/deadline/strict
record-validation fixes present in this owner branch. Its existing matching
graph cannot silently stand in for this later source. A must compose exact
current ordinary hunks and regenerate/verify its formal generated bundle/pins.
No protected capsule or stale private-session.js was overwritten to make a
source test appear released.

## Actual ordinary correction

Inherited controller mapped every 401/403 to user authorization-required, and
discarded the exact service reason. New actual-controller regression against
inherited code failed: ACTION_PROOF_REQUIRED became authorization-required
instead of degraded (14.463583ms; batch 1 FAIL/1 PASS, 73.804792ms).

The real consumer now reads rejection bodies through its existing bounded byte,
UTF-8 and abort pipeline. Only exact canonical `{error,privateService}` responses
with string code, authorization_required classification and the contract's expected server
status are retained for these four composition gaps:

- ACTION_PROOF_REQUIRED: 401
- EXCHANGE_PROTECTED_PROFILE_UNAVAILABLE: 503
- EXPLICIT_ROUTE_SCOPE_UNAVAILABLE: 403
- HTTP_BINDING_MISMATCH: 403

They become private-service degraded, clear unverified private data and never
automatically Begin, disconnect a standard Wallet, sign, POST or retry. Unknown,
wrong-status, duplicate, malformed, array-code or extra-field responses keep the
original safe generic rejection and do not disclose arbitrary error content.
Explicit fresh read can recover a genuinely fixed service with a fresh proof.
Identity/market/standard Wallet state is not granted or revoked by this parser.

## Executed original tests

- Private-account + identity-response + market-data + owned-controls-browser:
  89 PASS, 0 FAIL, 1 SKIP, 14067.734125ms. The skip is the separate opt-in local
  Go/Chromium boundary, not silently counted as passed.
- That opt-in was then actually executed separately with
  YNX_EXCHANGE_CONTROLLER_HTTP_QA=1: 1 PASS, 0 SKIP, 4969.272667ms.
  Actual Chromium, original local Go API and HttpOnly SSO cookie cover own/foreign
  account, switch/reload and linked/global logout rejection. This is the original
  authority fixture, NOT the new canonical main with its missing action producer
  and NOT real public Wallet approval or Product Session completion.
- Stalled rejection-body tests now cover deadline, Guest, offline and close;
  the old caller settles, timers clear, late foreign bodies cannot repopulate
  private state and explicit retry obtains a fresh proof.
- Node syntax and diff checks PASS. No backend production source changed.

All tests are local controlled engineering gates; no SSH/deployment/native
installation/public approval/order/transfer occurred. Shared SDK/vendor bytes,
formal manifests and the Central capsule are unchanged. Full financial delivery
remains incomplete and source/public/installed/user gates remain separate.
