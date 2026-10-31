# YNX Network

Independent Network PWA and local helper. Product source is confined to
`apps/network/**` and `cmd/ynx-network-helper/**`; Explorer, Monitor, Chain,
Auth, SDK, shared locks and release authority are unchanged.

## Run the normal local entry

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

The prefilled transaction is a historical test transaction, not a freshly sent
payment. Its source REST response is always presented as `RPC_ONLY`.
The helper uses a numeric loopback listener, checks Host and Origin, accepts no
arbitrary shell or request destination, and refuses upstream redirects.
This is local-user code pairing for public receipt operations. The helper's OS
UID identifies its own process; TCP, Origin and a code do not authenticate the
browser caller's OS identity. P09-03's privileged OS-identity gate remains open.
Future node/resource controls require actual controlled IPC peer credentials
or the original OS application identity channel and cannot reuse this ticket
as privileged authorization.

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
