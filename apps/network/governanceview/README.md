# Public governance reports

This module consumes the existing `internal/governance/server.go` public GET
routes and `writeSource` envelope. It does not initialize governance, save a
registry, call authentication, select a Wallet, vote, sign or submit anything.
The source's label `ynx-governance-authoritative-state` is retained as reported
metadata. It is not Network's admission of a native chain authority.

The trusted host constructs `governanceview.New(configuredSource, nil)`. The
helper uses its existing `--governance-rpc` flag, defaulting to its fixed chain
RPC source. Canonical fixed base paths and a single trailing slash are accepted;
credentials, query/fragment, dot paths, encoded separators and discovery are
rejected. HTTPS is required except explicit numeric loopback HTTP fixtures.
There are no redirects, proxies, cookies or browser-selected URLs. The default
source need not implement the governance service: unsupported public routes
remain `UNSUPPORTED` rather than an invented empty proposal list.
If this optional source configuration is invalid, normal helper assembly logs a
fixed diagnostic and disables only governance reads (`NOT_CONFIGURED`). It does
not stop existing receipt/node service or silently fall back to another source.

`Reader.ListProposals(ctx)` reads only `GET /governance/proposals`;
`Reader.Proposal(ctx, originalID)` reads only the corresponding fixed detail
route. IDs retain the original lower-case 64-hex `Service.Create` identity.
The normal helper exposes these reads under the existing origin/loopback/ticket
gate:

* `POST /api/governance-proposals` with exactly `{}`.
* `POST /api/governance-proposal` with exactly `{"id":"<original ID>"}`.

Pairing adds the descriptive `governance.read` scope alongside existing read
scopes; it grants no Wallet/native or registry write privilege. Both responses
use `sendAuthorizedJSON`, so revoke/expiry/cancellation fences a late response
even if a controlled test transport ignores cancellation. No new native IPC,
generic upstream route or effect operation is exposed.

Common fields are `projectionVersion:YNX-NETWORK-GOVERNANCE-READ/v1`,
`classification:RPC_ONLY`, `reportKind:governance-registry`,
`authority:false`, `walletApproval:false`, `nativeEligibility:false`,
`chainFinality:false`, `numericEncoding:decimal-strings`, and `code`.
`source/version/asOf` retain the original envelope, `observedAt` is the local
observation time, `endpoint` is the fixed actual URL, and `responseSHA256` hashes
the original response bytes. That digest is neither an independent pin nor a
signature/finality verification. Original metadata is null when unavailable.

List results contain `proposals`, `reportedCount`, `returnedCount`, `limit:"50"`
and `truncated`; detail results contain `proposal`. Each proposal retains all
original `governance.Proposal` fields, with every JSON integer token represented
as a decimal string. The reader never routes unsafe integers through float64 or
JavaScript Number. Public legacy registry votes/signatures inside the original
record remain reported data; this module does not reclassify them as native PQ
votes or grant an approval capability. Render source strings as inert text.

`REPORTED` requires valid nonempty data. `EMPTY` means an actual original empty
array, counts `0`, and `truncated:false`. `UNSUPPORTED`, `UNAVAILABLE`,
`INVALID_RESPONSE`, `NOT_FOUND` and `NOT_CONFIGURED` remain distinct. A detail
404 becomes `NOT_FOUND` only with the original typed registry error envelope;
an unknown upstream route stays `UNSUPPORTED`. Invalid members or duplicate IDs
invalidate the report rather than being filtered into a misleading success.

Bounds apply before public projection: two concurrent complete reads including
projection, an eight-second context, 8 KiB response headers, 4 MiB source body,
32 JSON levels, and 150,000 parsed values. Duplicate keys, noncanonical integer
tokens, unknown/missing original schema fields and uint/int overflow fail
closed. The original `Proposal` Go schema and `ProposalStatuses()` are reused.
Per-proposal projection is at most 128 KiB and the entire response at most
512 KiB. Lists retain original order and may return fewer than 50 complete
records under the byte budget, explicitly `truncated:true`. There is no invented
snapshot, cursor or claim that a truncated list is complete.

The new `cmd/ynx-network-helper/governance_read_test.go` is discovered by the
existing `./cmd/...` CI path. It exercises the actual original Server handler
and normal paired helper routes, private in-memory public fixtures, large
integers, original order/byte truncation, invalid reports, fixed configuration,
and late-response revoke/expiry. Controlled registry fixtures and a successful
read are separate from package/install, public service support, Wallet
authorization, native participation and consensus finality.
