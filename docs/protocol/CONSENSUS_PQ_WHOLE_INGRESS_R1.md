# Whole transfer ingress audit R1

Source-only audit of `/Users/huangjiahao/.codex/worktrees/ynx-pq-public-upgrade/YNX Chain`, with the Whole implementation frozen by `consensus-state-whole-manifest-r1.md` (`dbd88593ab7a642d4521657ed37f4517b59dd404801d86d6d555dec2678f1e91`). The ten listed source/docs plus their manifest were re-read and verified unchanged. Only this new document is written. No Go build/test, service, node, HTTP submission, deployment, or cap change was performed.

**The immediate blocker is gateway routing/readback, not a need to raise every Comet limit.** For N=1024 canonical native transfers, original Whole is 297,196 bytes, ABCI canonical hex JSON is 594,436 bytes, and a JSON-RPC POST is 792,658 bytes. Those fit the current source-default mempool and RPC-body caps. The current BFT gateway rejects even N=1 at its 16 KiB classic-only submission route; its GET-to-Comet transport overflows the default request-header budget at N=1024, and its transaction mapper cannot read any Whole-containing block.

## Exact byte accounting

Account policy requires canonical 42-byte `0x` addresses (`internal/accountaddress/address.go:107`, `ynxauth/policy.go:59`). Each valid `YNX-NATIVE-TRANSFER/v2` message has exactly 230 bytes (`ynxauth/message.go:64-106`): its 13-field E frame has 56 bytes of framing; domain is 22 bytes, version 4, original network 32, native chain ID two U32 fields (8), sender and recipient 42 each, and amount/fee/nonce two U32 fields each (24). Numeric magnitude does not change the width. Fee is exactly 1 in the admitted target transfer profile.

For a canonical account owner and `TX-BATCH`, context = 2,860 bytes, descriptor = 3,041, certificate = 57,540. Keys, roots, batch ID and both signatures have fixed lengths. `internal/ynxbatch/codec.go:14-27,157-169,181-221,316-328` is the authoritative framing source. E contains a four-byte field count and a four-byte length before every field. In particular BatchID is **16 bytes**, not 32.

For an all-transfer Whole:

```text
message = 230
messagesFrame(N) = 4 + N * (4 + 230)
whole(N) = 57580 + 234*N
ABCI JSON(N) = 2*whole(N) + 44
POST body(N) = 4*ceil(ABCI JSON(N)/3) + 74
GET request-target(N) = 2*ABCI JSON(N) + 26
```

The POST count uses exactly `{"jsonrpc":"2.0","id":1,"method":"broadcast_tx_commit","params":{"tx":"<base64 of ABCI JSON>"}}`, without whitespace/newline. Another request ID or whitespace adds its actual bytes. Comet decodes byte slices from base64 in JSON-RPC (`libs/json/decoder.go:107`, `rpc/jsonrpc/server/http_json_handler.go:148-160`). The existing URI-style client instead supplies `tx=0x<hex of ABCI JSON>`.

| N | Original Whole min=max | Canonical ABCI JSON min=max | JSON-RPC POST body | Existing GET request-target | Base64 tx field alone in a block response |
|---:|---:|---:|---:|---:|---:|
| 1 | 57,814 | 115,672 | 154,306 | 231,370 | 154,232 |
| 16 | 61,324 | 122,692 | 163,666 | 245,410 | 163,592 |
| 64 | 72,556 | 145,156 | 193,618 | 290,338 | 193,544 |
| 1024 | 297,196 | 594,436 | 792,658 | 1,188,898 | 792,584 |

These exact lower/upper equalities apply to **N valid native transfer messages under canonical account policy**, not arbitrary protocol messages or mixed rejected Action messages. Whole R1 permits authenticated unsupported messages to be rejected individually; those variable-length messages can make its raw wire larger. A transport may advertise a smaller bounded ingress profile without pretending the full engine's 8 MiB bound is reachable.

Method: a low-cost `/usr/local/bin/node` script constructed the exact E frames and canonical JSON using buffers of the protocol's fixed sizes, then counted bytes. Zero crypto fields were used only for length accounting; they are not valid signatures, keys, authorization, or testnet transactions. Independently the script parsed and round-tripped the existing public interoperability fixture's actual Whole bytes through E: `internal/ynxbatch/testdata/js-interop.json`, SHA256 `c8d72589dd36c961b50b1016f8d0a8ebf8bbae8fcf5890a22d71e14308410e6d`. That fixture has owner length 28, eight 21-byte research messages, certificate 57,526 and Whole 57,766; E reconstruction matched its bytes. Its different owner/messages are not used as native-business evidence. No new signature verification was performed here.

A compact reproducible length-only calculation is:

```javascript
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const E = (...xs) => Buffer.concat([u32(xs.length), ...xs.flatMap(x => {
  const b = typeof x === "string" ? Buffer.from(x) : x;
  return [u32(b.length), b];
})]);
const V = "YNX-BATCH/v0.1";
const S = "ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512";
const owner = "0x" + "1".repeat(40), recipient = "0x" + "2".repeat(40);
const network = Buffer.alloc(32);
const message = E("YNX-NATIVE-TRANSFER/v2", u32(2), network,
  u32(0), u32(6423), owner, recipient, u32(0), u32(1),
  u32(0), u32(1), u32(0), u32(1));
const context = E(V + "/CONTEXT", S, network, owner,
  Buffer.alloc(2592), Buffer.alloc(64), Buffer.alloc(16), "TX-BATCH");
for (const n of [1, 16, 64, 1024]) {
  const descriptor = E(V + "/DESCRIPTOR", context, u32(n), Buffer.alloc(64), Buffer.alloc(64));
  const certificate = E(descriptor, Buffer.alloc(4627), Buffer.alloc(49856));
  const whole = E(V + "/WHOLE", certificate, E(...Array(n).fill(message)));
  const tx = Buffer.from(JSON.stringify({version: 1, type: "pq_whole", wireHex: whole.toString("hex")}));
  const post = JSON.stringify({jsonrpc: "2.0", id: 1, method: "broadcast_tx_commit", params: {tx: tx.toString("base64")}});
  console.log(n, whole.length, tx.length, Buffer.byteLength(post));
}
```

## Real source transport and configuration chain

The module references below mean the locally inspected `github.com/cometbft/cometbft@v0.38.23` in `/Users/huangjiahao/go/pkg/mod`.

| Boundary | Observed source behavior | Consequence for Whole transfers |
|---|---|---|
| Production candidate generator | `internal/consensus/production.go:268-285` starts `DefaultConfig`; sets private RPC listen address and peer/validator paths, with no mempool/RPC byte overrides | Defaults below apply to newly generated source candidates, not a verified live config readback |
| Ephemeral network generator | `network.go:166-184` likewise uses defaults, modifying timeouts/listeners/peers | A direct unit test bypasses these real server limits |
| Genesis | `genesis.go:48-55` uses `DefaultConsensusParams`, only sets application version | Block max remains 22,020,096 bytes; max gas remains default -1 |
| Mempool CheckTx | module `config/config.go:787-801`, `mempool/clist_mempool.go:239` | Max one tx = 1,048,576; pool byte cap = 1 GiB, pool count = 5,000. N1024 outer 594,436 fits; raw Whole size is not the mempool quantity |
| P2P mempool channel | module `mempool/reactor.go:71-84` sizes receive message from a protobuf message containing MaxTxBytes | The configured tx cap includes an appropriately framed receive-message capacity; do not invent an independent 1 KiB P2P Whole cap |
| `max_batch_bytes` | Module config field exists, defaults zero; repository-wide source search found no consumer outside config/template | It is not this transaction batch protocol's N/aggregate admission knob; raising it does not wire Whole ingress |
| RPC POST | module `config/config.go:448`, `rpc/jsonrpc/server/http_server.go:292` | Body cap = 1,000,000 decimal bytes. N1024's 792,658-byte standard POST fits; still needs a real server test |
| RPC headers/URI | module `config/config.go:449`, node wires MaxHeaderBytes into HTTP server | 1,048,576-byte header cap. Local Go `net/http/server.go:3046` includes request line; read slop is +4,096 at `:940`. N1024 GET target alone is 1,188,898 and cannot pass this default |
| ABCI socket framing | module `abci/types/messages.go:12-25` uses max message size MaxInt32 | No new socket-size change is required for the bounded transfer profile. This does not imply unbounded safe CPU/memory |
| Proposal budget | module `state/execution.go:118-144`, `types/block.go:283-291`; target `application.go:524` | Real MaxTxBytes subtracts header, commit and actual evidence; target sums outer payload sizes. It is not the raw Whole size and not always the full 21 MiB block bound |
| Whole parser/executor | frozen `account_policy.go:44-77`, `action_transaction.go:390-409`, `account_batch.go:19-21,154` | Strict Whole type/canonical JSON can enter real ABCI router. Full raw engine cap remains 8 MiB; only source/direct-ABCI tests exist until Run11 |

For the existing four classical-validator candidate, MaxCommitBytes = 94 + 4*(109+2) = 538. Thus no-evidence transaction-data budget is 22,020,096 - 11 - 626 - 538 = 22,018,921 before per-transaction protobuf framing. This uses the current Comet signature format; it must not be projected unchanged onto a future validator-PQ fork.

The full 8 MiB raw engine bound is a separate case: canonical hex outer JSON is 16,777,260 bytes and the same base64 JSON-RPC POST is 22,369,754. That exceeds current mempool and RPC limits even though one raw outer payload is below the nominal block max. Valid N<=1024 transfer-only batches never approach that raw 8 MiB size. There is no basis for raising all caps merely to support this first transfer slice.

## Actual ingress blockers and readback risks

1. **BFT submit is classic-only.** `internal/bftgateway/gateway.go:282,620-638` exposes `/transactions/broadcast`, limits request body to `MaxSignedTransactionSize=16,384`, and calls DecodeSignedTransaction plus classic Verify. Even N1 canonical outer Whole is 115,672. No BFT `/transactions/pq/batches/broadcast` route exists in this source. Resource/IDE/Pay routes similarly accept classic SignedApplicationAction; they are not alternate Whole routes.
2. **Current Comet forwarding uses GET hex.** `gateway.go:352-367,642,865` hex-encodes the already-hex JSON into a query. N1024 fails the private RPC request-line cap, regardless of raising the gateway body limit. N1/16/64 fit Comet's local header source bound but this is not evidence that an external proxy accepts such long URLs. POST with base64 avoids this expansion and does not require a Comet cap change for the transfer profile.
3. **The response model discards per-member results.** `gateway.go:187-192` cometTxResult has Code, Log and GasUsed, with no Data. Whole's authentic ordered outcomes live in CheckTx/ExecTxResult.Data. A gateway cannot derive all members' acceptance from outer Code=0, since a partial batch is outer success. Decode and cross-check actual Data, not the input message list alone.
4. **Mapping is not Whole-aware.** `gateway.go:555-604` handles only classic transfer/Action. `block()` aborts the entire block on an unsupported envelope at `:521-525`. Transaction readback/search calls `transactionAtHeight()` through `mapCometTransaction()` (`:607-617,747-763`), so a Whole can also break lookups of otherwise valid transactions sharing its block. Existing target migration/revocation/PQ-member envelopes have the same mapping gap. Increasing a body cap alone would enable an execution whose success cannot be read back.
5. **4 MiB response truncation is a second boundary.** `gateway.go:367` reads only 4 MiB, without a separate max+1 overflow check. Six N1024 outer transactions already need 4,755,504 bytes for their base64 tx fields alone, before block JSON. Such a block is well within the default consensus block limit. The default `/txs` search asks for 25 rows (`:704-714`), which can also exceed that read budget. One bounded Whole's own `/tx` response fits much more comfortably. Do not make submit confirmation depend on reading its entire block. Block/search routes need explicit byte budgets, streaming or bounded pagination and errors that do not masquerade as “not committed”.
6. **Timeout is UNKNOWN, not rejection.** The gateway HTTP client is 8 seconds (`gateway.go:254-256`), while Comet's broadcast-commit wait defaults to 10 seconds (module `config/config.go:444`, `rpc/core/mempool.go:110-138`). A client timeout may occur after CheckTx/admission or commitment. Preserve original Whole, batch hash and outer hash; query that exact transaction/proof. Never automatically re-sign, retry a rejected member, or report a definitive failure because readback timed out.
7. **Public routing has not been switched by this work.** `cmd/ynx-bft-gatewayd/main.go:31-38` defaults to private gateway 127.0.0.1:27620 and private Comet 127.0.0.1:27757. `scripts/deploy/deploy-consensus-candidate.sh:95` explicitly leaves public ingress and authoritative ynx-chaind unchanged. The checked testnet proxy template sends RPC traffic to 6420 (`scripts/deploy/deploy-testnet.sh:791-799`) with nginx 2 MiB body cap; this is a source template, not live server readback. Existing public identity evidence is authoritative_producer ynx-chaind, not proof of this Comet candidate being live.

### Three gateways must not be conflated

- **Authoritative Core API**: `internal/api/server.go:130` already has POST `/transactions/pq/batches/broadcast`; `api/pq_authorization.go:16-38` accepts `application/octet-stream` up to raw 8 MiB and calls Devnet.SubmitPQBatch. It executes source-ledger batches, not ABCI or Comet broadcast.
- **BFT compatibility gateway**: the future whole path above must forward canonical ABCI JSON to private Comet, then validate actual commit/partial results. It presently cannot do so.
- **Product App Gateway**: `cmd/ynx-app-gatewayd/main.go:31-36` defaults to 128 KiB request and 1 MiB response; `internal/appgateway/gateway.go:260-275` permits chat/square/pay/social/wallet upstreams, not arbitrary Core/Comet RPC. Its route/session model is not a transaction ingress path. N64 outer JSON would also exceed its default request cap. Do not raise its caps or invent an app-session bypass to transport Whole. It is outside the required change set.

## Fee, gas and transaction projection

Whole R1 charges fee 1 per admitted member and zero for rejected members. Total batch fee is the count M of admitted transfers, not N and not one. Each real member has its native member hash and corresponding BFT fee event; the outer Comet hash is one container association. No duplicated certificate or fabricated N Comet transaction indices is valid.

Existing ABCI CheckTx/Finalize reports GasWanted/GasUsed=1 per outer envelope (`application.go:507,589`), while bandwidth increments per admitted member. This is a resource-accounting convention, not a fee proof. `internal/bftgateway/evm.go:122,149-150` projects gas/gasPrice/effectiveGasPrice as 1 for its current classic paths. Applying that projection blindly to Whole would imply fee 1 despite M actual fees. A Whole is not an Ethereum RLP transaction or N separately included EVM transactions. Keep unsupported EVM Whole methods explicitly rejected or provide a separately specified container projection; never fabricate Ethereum signing/hash/nonce/transactionIndex semantics.

The honest native response should expose outer Comet hash/index/height, original batch hash, ordered native member outcomes and derived member hashes, total charged fee M, and explicit admitted/rejected counts. Numeric business fields such as nonce/amount/heights should use safe decimal strings where the current PQ HTTP contract does. It should distinguish imported source proof from a new Comet commit and must not attach a made-up Comet hash to source history.

## Minimum proposed change set, after separate ownership allocation

No frozen Whole file or configuration is changed now. The following is the minimum candidate plan for Root to assign; it is not an authorization to deploy or a claim that gateway closure is already implemented.

| Path | Required change |
|---|---|
| New `internal/bftgateway/pq_whole.go` and `pq_whole_test.go` | Dedicated raw Whole octet-stream POST using the source-compatible path; bounded ingress profile sufficient for canonical N<=1024 transfers; encode the existing canonical ABCI envelope; use true JSON-RPC POST; return and verify actual partial outcomes; support original-hash reconciliation with UNKNOWN handling |
| `internal/bftgateway/gateway.go` | Register route/query; preserve `cometTxResult.Data`; add bounded POST client alongside existing GET; avoid full-block dependency for Whole submit confirmation; explicit error when response exceeds its operation's limit |
| New `internal/bftgateway/pq_projection.go` and `pq_projection_test.go` | Typed outer-container/member view, original source-vs-Comet provenance, hash/index/height/result binding, member native lookup and shared-proof query. Handle all four recognized PQ envelope kinds in block/history routing without forging classic envelopes |
| `internal/bftgateway/gateway.go` read models/mapping, plus existing gateway tests | Update block/search models to represent a Whole container while preserving ordinary transaction behavior; no member-count inflation of Comet transaction count. Resolve block/search response budgets independently of small requests |
| `internal/bftgateway/evm.go` and relevant tests only if needed for explicit boundary | Prevent the existing fee=gas=1 classic projection from being applied to Whole; retain honest unsupported responses until a specified EVM view exists |
| A future `scripts/verify/consensus-candidate-pq-whole-drill` and workflow hook | Genuine signed N1/16/64/1024 POST through actual private Comet and gateway, commit/readback/restart evidence, staged only after code/ownership and CI windows are agreed |

Suggested first profile: raw ingress at most **297,196 bytes**, canonical envelope at most **594,436 bytes**, documented as covering all canonical native-transfer Whole values up to N1024. It may still carry other messages within that byte budget; R1's per-member unsupported-message rejection remains authoritative. Reject larger inputs with a clear profile limit, before forwarding, rather than silently stripping/rebatching them. Keep the engine's raw 8 MiB limit and all classic endpoint caps unchanged. Existing Comet maxTx/maxBody/maxHeader/block limits can remain unchanged for this profile, subject to real tests. Deployment ingress only needs a separate route/readback check; the inspected 2 MiB template body cap would not itself block this bounded POST.

For confirmation, read `/tx?hash=<actualOuterHash>&prove=true` and the small `/header?height=...` if block identity is required (module `rpc/core/routes.go:30,34,44` exposes these). Bind the exact payload/hash, successful execution height and Data to the immutable shared-proof query. A returned proof is not a substitute for Comet inclusion. Batch hash/member hashes are not Comet `/tx` index keys. Avoid automatically treating a not-yet-indexed query as a definitive failed write.

For blocks/search, retain small default response limits and introduce an explicit operation-specific budget derived from a trusted consensus block bound or a streaming decoder. Search pagination must use a worst-case byte budget, not just “up to 100 rows”; one or a small number of large outer transactions per upstream page avoids accidental multi-megabyte overflow. Do not raise every endpoint to 32 MiB just because full-block base64 can exceed 4 MiB.

## Required tests and acceptance boundaries

1. **Codec-size assertions with real signatures**: N1/16/64/1024 fixed wire/JSON lengths above; min/max business numbers yield the same length. Cross-check the actual Go encoding in remote CI. The Node calculation is only source/encoding-size evidence.
2. **Gateway unit transport tests**: the exact POST body contains base64 of canonical ABCI JSON; zero GET broadcast; raw profile limit and limit+1; unchanged 16 KiB classic endpoint; unknown/uppercase/trailing envelopes rejected; wrong outer hash/height/Data/partial outcomes/proof mapping fail closed.
3. **Genuine private Comet integration**: use the candidate-generated config/genesis unchanged; confirm all four N values enter real mempool/P2P/ABCI, are committed, and are read back by actual outer hash. Count admitted logical transfers separately from outer tx count. A direct Application.CheckTx test does not meet this gate.
4. **Negative transport boundary**: show N1024 old GET rejected by actual HTTP request-line limit, while JSON POST fits; cap+1 is rejected deterministically. Keep test inputs bounded and genuine fixtures where execution is expected, not zero crypto length buffers.
5. **Partial failure and UNKNOWN**: authentic Whole with successful/rejected/successful indices; fees equal admissions, nonce/lot effects match results; all-rejected stores no proof; artificial upstream timeout after real acceptance returns unknown and later reconciles the same hash without member replay.
6. **Read model closure**: Whole-containing mixed blocks do not break classic transaction/block/search reads; six N1024 outer payloads exercise the old 4 MiB block boundary; default 25-row search cannot silently truncate. Members have native hashes and a parent Comet index, not fabricated unique Comet indices.
7. **Policy/history**: imported source Whole cannot be replayed; old original result is queryable with source provenance. Current tombstone rejects new Whole, original-height pre-revocation history survives restart, and no gateway preflight key supplied by the request establishes trust.
8. **Fee projection**: one outer tx with M admitted members reports M real native fees; EVM methods do not invent RLP/hash/nonce or imply gas=1 is the fee. Rejected members have no fee/native receipt.

Only passing those remote source/config/transport/runtime checks would establish this bounded candidate ingress. Public deployment/cutover, a genuine validator-PQ Comet fork, arbitrary 8 MiB messages, native nontransfer Action execution, and throughput remain independent gates.
