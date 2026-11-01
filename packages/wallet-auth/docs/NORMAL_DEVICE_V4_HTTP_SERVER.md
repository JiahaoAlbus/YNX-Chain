# Auth pending-original query + V4 management normal server closure

This is an independent Auth supplier. Intake **only CAS.json** replacements/adds
into the SDK owner's current matching base. Copied package files are compilation
provenance, not a package/tree overlay. No frozen F06/Social/Main/Rust leaf changes.

## Actual normal entry and purpose selection

The ORIGINAL `openOriginalProductPairSessionV4HTTPRoutes` and
`openOriginalProductPairSessionV4Daemon` discover the original three pair routes,
new pending-original query and the four already-fixed V4 management routes.
They acquire each role independently at startup and retain nonnull partials
before inspecting errors. An unavailable role produces 503 for its routes only.
`routeStatus` and private `routeFailures` preserve capability absence/first causes;
a configured handler is not a Root grant or deployed service.

Zero-input normal factories (only own `error:null` is success for NEW factories):

- `acquireOriginalPendingPairQueryServerV1()`
- `acquireOriginalRegisteredManagementServerV4()`
- `acquireOriginalCompletionQueryServerV4()`

Adopt `owner` before checking `error`. Use the corresponding private owner guard
before calling HTTP-handler creation. There is no callback/provider/root setter.
Direct kernel construction is a PUBLIC test seam; normal guards reject it.

The original Source resource factory is reused: protected Root-owned held
manifest, exact physical tuple/digest/current, release-selected RootCurrentV3
plan, independent global-device negative ledger and original pinned Native
committed account-policy producer, then existing issuer SQLite namespace.
No client single-device GET, HTTP21 alone, SSO or account DATA supplies Source.

Independent source-owned release tables remain EMPTY:

| Purpose | Allowed work | Store |
| --- | --- | --- |
| `product-device-pending-original-query-v1` | original PAIR query only | existing-only read-only |
| `product-session-registered-management-service-v4` | Root allowlisted `active`, `revoke-session`, `revoke-registration`, `cancel-challenge` | existing namespace writer + independent read connection |
| `product-session-completion-query-service-v4` | `completion-query-original` only | existing-only read-only |

No old issuer/pending/client-management role inherits these purposes. No real
row is created. Future independent release admission must supply the original
`manifest/registry/node/rootPlan/storage` tuple. Dedicated manifests retain the
old exact V4 shape plus `serviceOrigin` (fixed normal authority
`https://wallet-auth.ynxweb4.com`); each device adds the SHA256 of its **complete
canonical registration original**, not keys taken from a received member.
Management manifests additionally have a nonempty, unique sorted closed
`managementOperations` subset from the corresponding row above. Root/current
registration, full pair, network, owner, device/generation, exact application
identity, registry/node digests and all windows remain AND requirements.
These are reviewable registration inputs, NOT approved rows or a new Root model.

## Pending E13: actual readonly call sequence

`POST /v4/product-pairs/original-query`, canonical body is the original query3.
The sole header is `x-ynx-product-pair-original-query-proof-v1`, canonical
unpadded base64url raw N1. There is no outer JSON or invented session binding.

1. Sole SDK header decoder + claims extractor capture bounded PUBLIC bytes.
   Nonce/ISO times are untrusted claims from the SAME member, not a server-issued
   challenge. They never supply expected owner/network/pair/actor/service.
2. The dedicated protected Source checks full registration SHA/pair/generation,
   Root/global-device current and independent Native committed account current.
3. Sole SDK **registered E13 N1 stage** verifies both algorithms, exact query3,
   registration20, independent expected12, fixed origin/route and <=30s window.
4. Only now the original existing SQLite store captures the original seven
   operation columns, namespace/actor/kind/input digest and one committed audit.
5. If a row exists, sole SDK **full** inspector checks its exact original PAIR
   POST bytes (not a request digest), then snapshot-current rechecks precede
   projection. A missing row yields bounded NOT_FOUND DATA; it proves no future
   absence and never authorizes a re-POST.
6. Source/Root/current and snapshot are checked after projection. The original
   result is retained before late failures; failure HTTP responses never disclose
   that partial. No reserve, clock-floor write, challenge, registration, completion,
   key opening or signing occurs on the E13 route.

ENTERED → UNKNOWN; COMMITTED + exact audit → OBSERVED old original. Historical
challenge/session expiry does not rewrite a committed result. Output flags remain
authorized/registered/connected/newSession/retryAuthorized false. Query's current
window is independent of expired creation terms and cannot revive their authority.

The pure math adapter `inspectOriginalPendingPairQueryN1WithRegisteredSourceDATA`
uses the sole SDK stage/full callees. It does not establish Source provenance.
Core17 ABI/signing archive is not invoked by this verification-only server.
Existing Core public-golden + SDK interop evidence is reused; no second codec.

## Four original management routes (HTTP21/E5 unchanged)

`POST /v4/product-sessions/{active,recover,revoke}` and
`POST /v4/product-session-challenges/cancel`, proof header
`x-ynx-product-session-proof-v4`. Body/response DATA grammar is the unchanged
sole management V4 module (published BOM-fix successor, no Auth codec fork).

Every action first checks its independent Source purpose/allowlist, Root/global
device and Native account current, exact registered original and real full-AND
HTTP21 math over fixed method/path + SHA256 of the actual complete body. Received
member keys and session claims never choose an expected registered pair.

- `active`: actual `OriginalProductSessionDeviceV4ServerCurrentKernel` rereads
  stored PAIR + COMPLETE originals, invokes original six-input issue-history math,
  checks same session/account/application/registration and independent current.
  The existing HTTP21 replay-key callee and original nonce store are reused.
- `recover`: only original kind COMPLETE. It independently reads the held original
  input/audit, derives the intended binding from its exact approval/challenge with
  the sole SDK helper, checks query proof/body association, and returns old DATA.
  This is never an active-session lease. PAIR recovery uses E13 instead; no zero,
  operation hash or invented binding fallback exists.
- `revoke/cancel`: actual registered-session current and unexpired original target
  are required BEFORE effect. The pre-state reader is retired/joined/closed BEFORE
  mutation; an independent Source/Root/account-current lease remains through
  terminal observation. Original reserve ticket/input/op, HTTP replay key, target
  original bytes and ACTIVE/ISSUED CAS are enforced. Expired/changed/consumed
  targets refuse and preserve ENTERED/UNKNOWN without retrying the ticket.
- Post-effect checks inspect the actual same-op ledger/audit + target
  REVOKED/CANCELLED and unchanged target original, NOT the old active gate.
  A repeated SAME body/op can only observe its retained terminal/UNKNOWN result,
  without a new nonce consume or effect. It does not restore management rights.

No management code calls the old raw Kernel `revoke/cancel/active/recover` as an
HTTP authorization shortcut. Old private methods/versions remain unchanged.
No global-device revoke or Root update is claimed by a local store revocation.

## Custody, cancellation, close and UNKNOWN

All new normal owners support retire/join/close and explicit same-owner
`drainPartial`. Child join failure prevents its close and every parent close.
Completed phases are not repeated. Ambiguous close never retries a descriptor.
Falsy errors are remembered by presence. Original nonnull partials/results are
adopted before error handling. Source/session readers are real original producers;
their parent adapters are explicit borrows, not fake owners or nil producers.
Actual Source-owned parents close only after child leases/readers drain.

Both existing read and management existing-only store constructors retain a
nonnull cleanup partial on SQLite close failure. Their held FD is not closed
past that unresolved child, and original construction/cleanup causes survive.
Source resource startup adopts that partial before reporting failure. No new
account DB, namespace, schema or migration is created by a management factory.

HTTP request abort/timeout fences precede and follow awaits; actual bytes are
owned snapshots, with SAB/proxy/buffer-getter and fake AbortSignal rejection.
No UNKNOWN state creates a new op, nonce, signer, generation or automatic retry.

## Header budgets and normal transport boundary

| Exact path class | Proof header cap | Total receiver headers | Body cap |
| --- | ---: | ---: | ---: |
| Pending E13 query | 131072 characters | 147456 bytes | 1024 bytes |
| Four management paths above | 196608 bytes | 262144 bytes | 393216 bytes |
| Other paths | original budget | original budget | original budget |

Node's parser must be sized for the largest permitted path while the SDK's
closed per-route gate runs BEFORE admission/handlers. Duplicate proof headers,
encoding/transfer aliases, non-POST, noncanonical header/body, oversized totals
and incomplete streams refuse. This supplier exports exact required constants;
the sole SDK owns the actual daemon constructor/per-route-budget leaf. Its
management-budget successor is a dependency, not a claim of proxy/TLS deployment.
No listener, HTTP call, SSH, production key, Root signature or service activation
was performed here.

## Verification

`node intake-sdk.mjs` verifies the frozen sole SDK delta and copies dependency
leaves byte-for-byte. `node validate.mjs` runs only the new component controls,
real temporary SQLite tests, actual full-AND math with temporary **in-memory
PUBLIC-fixture** keys, new Core-golden server-pipeline composition, normal zero-
Root factory/daemon imports and strict API types. Fixture Source/custody is not
Root admission. Existing Core/SDK interop and prior19 DATA controls are not rerun.
Full logs and prior type/dependency failures are preserved in evidence.
