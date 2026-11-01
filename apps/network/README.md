# YNX Network

Independent macOS QA application, responsive desktop/mobile client and local
helper. The native App owns its window and helper; it embeds the same local
client in WKWebView. Product source is confined to
`apps/network/**` and `cmd/ynx-network-helper/**`; Explorer, Monitor, Chain,
Auth, SDK, shared locks and release authority are unchanged.

## Independent client and normal local entry

The normal desktop QA entry is `YNX Network QA.app`, built with
`apps/network/qa/build.mjs` as described in `qa/README.md`. The current client
implements the user's seven-screen desktop and five-entry mobile designs in
light/dark themes. It labels the current deployment Testnet and uses only
observed helper/RPC data. Missing metrics, Wallet operations, production node
controls and public resource contribution remain explicitly unavailable.

The twelve client languages are English, Simplified/Traditional Chinese,
Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic and
Indonesian. Arabic uses RTL layout; transaction identifiers and original
reports retain their original content. Theme/language preferences carry no
permissions. Mobile responsive/browser validation does not prove an installed
Android/iOS node, local phone helper or physical-device acceptance.

Transaction receipts can be read back and exported as historical public JSON
with `authority:false`. The native App uses its normal Save panel and refuses
to replace existing files. Export preserves `reportText`; parsed JSON numbers
are not claimed to reproduce original wire bytes. A receipt file is never a
fresh trust anchor, transaction authorization or funds-state proof.

From this checkout:

```sh
go run ./cmd/ynx-network-helper
```

Open the printed loopback URL and enter the one-use code displayed by the
locally launched helper. The PWA can query the configured public REST source
or import a public proof file. The pairing grants only public receipt lookup
and proof verification for 15 minutes. Revoke it in the PWA. Restart the helper
to issue a new pairing code. No node, validator, signer or contribution job is
started by this entry.

The transaction input starts empty. A source REST response is always presented
as `RPC_ONLY` until independent proof actually validates.

The service now keeps a private product directory (default user config directory
`YNXNetwork`, or `--data-dir`). It contains local observation history, managed
ordinary-node metadata, the disabled resource journal and optional Wallet
handoff/outbox. `--native-status` connects to the running service over a Unix
socket, authenticating both processes using actual kernel peer credentials.
It is a separate native channel; HTTP receipt tickets never gain those rights.
Shutdown cancels owned requests and closes the native endpoint. Known kernel
locks recover after a process crash; unknown legacy owners and replaced socket
identities are retained and refused. History is explicitly historical local
data, never a current checkpoint or approval.

The native API supports structured node status/intents, participation
prepare/get/submit/reconcile/revoke and resource status/meter/stop. Original
publisher signatures and ordinary-node release mode are still required before
production install/start. A native request or JSON consent flag cannot create
the opaque approval produced by the trusted visible-consent entry. Resource
execution defaults disabled; status/stop do not enable it.
An explicit local QA CLI also executes the fixed no-import WASM public-byte
histogram through a pinned child, independent recount and deduplicated receipt.
Its fixture signatures remain `CONTROLLED_SANDBOX`, without production publisher
or human-consent authority; see [the QA procedure](qa/README.md#fixed-wasm-task-qa).
The helper uses a numeric loopback listener, checks Host and Origin, accepts no
arbitrary shell or request destination, and refuses upstream redirects.
This is local-user code pairing for public receipt operations. The helper's OS
UID identifies its own process; TCP, Origin and a code do not authenticate the
browser caller's OS identity. P09-03's privileged OS-identity gate remains open.
Future node/resource controls require actual controlled IPC peer credentials
or the original OS application identity channel and cannot reuse this ticket
as privileged authorization.

Each authenticated receipt request inherits the ticket's expiry and revocation
context. Revoking or expiring a pairing cancels in-flight HTTP lookups and
blocks late reports or proof results at the backend response boundary. The
offline consensus verifier has no cancellation API: an already running proof
calculation may finish, but its result cannot be returned under a revoked ticket.

## Proof levels and trust

| Level | Evidence actually checked |
| --- | --- |
| `RPC_ONLY` | A data-source report; no independently authenticated transaction conclusion. |
| `HEADER_VERIFIED` | An independently pinned checkpoint, valid trust period, genesis/chain binding, validator continuity/overlap and a genuine Comet Commit with strictly greater than 2/3 voting power. |
| `INCLUSION_VERIFIED` | The requested outer transaction bytes/hash and optional transaction index, plus Comet Merkle inclusion against the authenticated header's DataHash. |
| `STATE_VERIFIED` | Unavailable with the current canonical state-proof producer. No event, `code=0`, bare AppHash or caller-provided success field enables it. |

Inner batch member and execution status remain unverified at transaction
inclusion level. The UI clears old conclusions on transaction changes,
verification failure, new requests, pairing expiry and revocation; late
responses cannot restore them.

Checkpoint import is local configuration, never an HTTP/browser operation:

```sh
go run ./cmd/ynx-network-helper \
  --anchor /absolute/path/to/public-checkpoint.json \
  --anchor-pin INDEPENDENTLY_OBTAINED_SHA256_OF_EXACT_FILE \
  --anchor-source INDEPENDENT_TRUSTED_CHANNEL
```

Do not obtain the pin from the RPC being checked. A pin binds bytes to the
operator's independently trusted channel; a source label or self-signed
validator set alone establishes no authority. No live trusted checkpoint ships
with this product. `receipt.AnchorDocument` defines the public file format:
`version: "cometbft-v0.38"`, genesis digest and Comet chain ID, `trustUntil`,
and a complete Comet LightBlock. The local trust-window cap is 14 days, with
10 seconds maximum clock drift. The adapter reuses the repository-pinned
CometBFT v0.38.23 `light.Verify` and `types.TxProof.Validate`; it does not claim
compatibility with an unbound PQ consensus fork. The separate PQ adapter is
compiled on the exact original CORE-09 candidate and calls its original
`consensus.VerifyPQLightProof` / `VerifyPQTransactionProof`; it never routes PQ
keys through the classic adapter.

The canonical CORE owner must supply the activated member/event proof schema,
success semantics, complete path to the signed state commitment, execution H
to commitment-header height vectors, and the PQ historical-key light verifier.
P09 does not add a parallel consensus verifier or a new receipt-root format.

CORE-09's collector format is `YNX-PQ-RPC-TRANSACTION-PROOF/v1`. Its HTTP result
and `independentFinality`/`proofVerification` fields supply no trust. The helper
accepts imported collector data but currently has no independently configured
PQ host context, so that path remains `RPC_ONLY`. The code adapter accepts an
original snapshot/trusted block and exact independently pinned transaction
expectation only as separate trusted in-process inputs. It uses local time and
the original H inclusion / H+1 result commitment verifier. A proved ABCI result
is distinct from account balance, invoice event or funds-state membership;
the adapter does not promote those absent proofs to `STATE_VERIFIED`.

For the real offline command path, configure all four local startup flags:
`--pq-verifier`, `--pq-verifier-sha256`, `--pq-context`,
`--pq-context-sha256`. Use the original `ynx-consensus-proof-verify` executable
and its original `YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1` public context, with
digests obtained independently. The service captures immutable private copies;
the original CORE command independently loads and verifies its original source
files on each request using the current local clock. No HTTP field can select
an executable, trust file or target. `POST /api/lookup-proof` collects the
original `/txs/{hash}/pq-finality-proof` and calls that verifier. Exact Whole
member identities are derived with the existing codec from the pinned original
Whole and mapped back to its collector target. Rejected and partial outcomes
remain explicit; verified ABCI results still do not prove funds state.

For native staking/governance preparation, `--participation-config` and
`--participation-config-sha256` select a separately pinned local document with
version `YNX-NETWORK-PARTICIPATION-CONFIG/v1` and a `network` object containing
`genesis`, `networkId32`, `nativeChainId` and `cometChainId`. None is derived from
an RPC report. `--governance-rpc` optionally selects the fixed governance read
origin. The service reuses actual original native delegation/unbond payload
codecs and read APIs, persists blocked intents and reconciles original UNKNOWN
operations. It contains no guessed Wallet transport: production submission is
`UNSUPPORTED` until the original Wallet publisher is supplied. Registry voting
reports are not native PQ votes or independently proved funds state.

## Independent local QA client

The `0.3-qa` PWA pairs with this exact local helper. Its protected POST APIs
read the configured node (`/api/node-report`), collect a transaction report and
invoke the pinned original verifier (`/api/client-receipt`), and expose a
read-only native self-connection diagnostic (`/api/native-status`). The node
block report uses the original gateway's `/status.height` and numeric
`/blocks/{height}` route. Source data and collector availability remain
`RPC_ONLY`; independent proof validation determines a separate proof level.

`/api/receipts` lists local immutable receipt IDs; `/api/receipt` with `{id}`
returns the original saved view, RPC report and collection metadata with
`historical:true, authority:false`. Receipt IDs bind the complete compact
record, including observation time and the independent configuration digest.
The private receipt store uses an exclusive kernel lock and bounded,
integrity-protected atomic snapshots. Restart preserves records and requires a
fresh pairing code. Historical receipt views never become current proof,
funds state, consent, replay permission or application authority.

The HTTP native status shows the helper's actual kernel-authenticated native
self-connection. It explicitly reports browser identity as unverified and
does not expose management, Wallet signing or permission creation. A ticket
permits only receipt read/verify, node read and native status. Revocation and
expiry fence both response publication and durable receipt creation.

QA bundles and version-specific data directories are independent of installed
applications. Formal signing, installation and public release remain with the
original release owner. Browser acceptance is a separate gate for each exact
candidate, scheduled through the controller's shared GUI window.

## Focused verification and existing CI

```sh
GOMAXPROCS=2 go test -race -p 1 ./cmd/ynx-network-helper
```

Receipt regression tests live in the helper's test package so the existing
`make test` (`go test ./cmd/... ./internal/...`) discovers them. A fixed Node
test invocation in the same package runs the PWA's behavioral state-binding
tests; Node is already supplied by the existing CI. Fixtures use newly
generated temporary keys with genuine Comet signatures and Merkle proofs.
Fixture validation, local HTTP/browser operation, packaging, installation,
public deployment and real-chain execution remain separate evidence gates.

This product follows the YNX execution policy and the current P09 V5 scope.
Its current source identity, writer ownership, evidence and remaining external
contracts are recorded in the P09 coordination CURRENT and Handoff files.

The existing native self-status read now includes a bounded local activity
snapshot from the actual managed-node, participation journal and resource
runner instances. Node capacity is labeled as the managed directory, not
chain size; participation counts preserve UNKNOWN; resource totals are only
locally reverified tasks/bytes, never public contribution or rewards. Missing,
unsupported, revoked, unavailable and disabled states remain distinct. The
participation/resource refresh entries use the same paired read-only native
status request and busy state. No browser management, signing, submission or
worker-start route is added, and these observations never enable such actions.
