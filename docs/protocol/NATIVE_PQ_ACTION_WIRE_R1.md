# Native PQ action wire R1

Status: source specification and codec candidate, with a separate native Devnet
admission adapter in `internal/chain/pq_action*.go`. A successful decode alone
establishes syntax only. These new Go tests have not been compiled or executed
locally. Independent Node
vector generation and `gofmt` are separate evidence; the next authorized CI run
must execute the Go tests before claiming Go interoperability.

## Scope and integration boundary

The independent message domain is `YNX-NATIVE-ACTION/v1`, version `1`. It is a
complete message suitable for the existing `TX-BATCH` purpose. It does not alter
YNX-BATCH/v0.1, its certificate, trees, proof format, empty signature context,
or the requirement that both real signature algorithms verify the complete
message. It is distinct from `YNX-NATIVE-TRANSFER/v2` and account registration.

The codec admits exactly stake, resource delegation, resource rental and the
eight DEX kinds in the table below. Contract deployment/calls, resource-pool
create/fund/policy/status, sponsorship, native transfer and all other kind strings
are unsupported. No generic action name, JSON object or callback can bypass that
switch. Existing PQ-only gates must continue to reject unsupported paths until
their actual execution adapters exist.

Every execution adapter must check the trusted 32-byte network, native chain ID,
owner, purpose and effective account policy; verify the batch; decode this exact
message; dispatch only its supported kind; and apply the existing state machine.
Syntax success does not establish nonce validity, sufficient balance, fee policy,
asset issuance authority, resource delegation authority, asset/pool existence,
slippage, deadline, resource quote validity or durable execution. Never accept a
public `verified` boolean or a caller-supplied signature callback in place of that
authorization path. A batch authenticates messages together; each business
operation still has its own execution result.

The codec covers the fuller existing consensus resource payloads, including
policy hash, quote, expiry, max price, idempotency key and request hash. The
adapter must retain and validate all of these constraints rather than dropping
them when calling a narrower native helper. `RequestHash` is a strict lowercase
64-hex string here; the original resource state machine must also recompute its
existing `YNX_RESOURCE_REQUEST_V1` JSON-derived hash and compare it. That legacy
hash is an included field, never a replacement for the full payload. These
syntax vectors deliberately use fictitious hashes and are not executable quotes.

The native and ABCI entrypoints have different current fee policies (for example,
native delegation/rental versus signed application actions). The codec therefore
binds the complete fee value and checks its numeric range; the execution adapter
must enforce its own exact fee and overflow-safe combined debits. The codec does
not infer a fee or normalize an old business request.

## Canonical primitive and envelope

`U32(x)` is exactly four unsigned big-endian bytes. `E(f0, ..., fk-1)` is
`U32(k) || U32(len(f0)) || f0 || ... || U32(len(fk-1)) || fk-1`. All lengths count
bytes. Integers never use decimal text, JSON numbers, varints, signed encodings
or eight-byte fields. `Q(x)` denotes **two separate fields**,
`U32(x >> 32), U32(x & 0xffffffff)`. JavaScript callers must use `BigInt` or exact
decimal-to-BigInt conversion before constructing these words, never `Number` for
64-bit values. Strings are exact UTF-8 bytes; no BOM is added.

The outer frame has exactly **12 fields**, in this order:

| Index | Field | Constraint |
| --- | --- | --- |
| 0 | `YNX-NATIVE-ACTION/v1` | Exact ASCII domain |
| 1 | `U32(1)` | Exact version and width |
| 2 | `ChainID` | Exactly 32 network identity bytes |
| 3–4 | `Q(NativeChainID)` | 1 through 2^63−1 |
| 5 | `Owner` | Canonical lowercase `0x` + 40 hex account address |
| 6–7 | `Q(Nonce)` | 1 through 2^64−1, without truncation |
| 8–9 | `Q(Fee)` | 0 through 2^63−1 |
| 10 | `Kind` | Exact supported ASCII kind from the table |
| 11 | `Payload` | Complete nested E frame, never a payload digest |

Maximum outer wire length is **8192 bytes**; maximum nested payload is **4096
bytes**. The decoder checks the total bound and fixed field count before field
allocation. Malicious declared lengths cannot cause allocation beyond the actual
bounded input. There is no unbounded field list, unknown-field extension bag or
cache. Supported schema strings and numeric widths are checked before encoder
wire allocation. The larger limits leave room around these small fixed schemas;
they do not authorize future kinds or extra fields. The existing complete batch
limit remains 8 MiB and its legal member-count rules remain unchanged.

Missing, extra or duplicate positions, incorrect integer widths, invalid values,
trailing bytes and unsupported versions fail closed. Every accepted decode must
re-encode to the exact original bytes. JSON is not an alternate wire format, so
duplicate JSON keys cannot carry unsigned execution fields.

## Complete typed payloads

Each row defines the exact nested E field sequence. Each `Q(...)` expands to two
framed fields. Values denoted by `U32(...)` occupy one framed field. All other
entries are UTF-8 string fields. The Go type names are in `internal/ynxauth` and
do not import the chain or consensus package.

| Kind | Go value type | Nested E field sequence | Count |
| --- | --- | --- | --- |
| `stake` | `StakePayload` | `Q(Amount)` | 2 |
| `resource_delegation_create` | `ResourceDelegationPayload` | `Provider, Beneficiary, Q(AmountYNXT), PolicyHash, IdempotencyKey, RequestHash` | 7 |
| `resource_rental_create` | `ResourceRentalPayload` | `Address, Provider, Q(Bandwidth), Q(Compute), Q(AICredits), Q(TrustCredits), QuoteID, QuoteExpiresAt, PolicyHash, Q(MaxPriceYNXT), IdempotencyKey, RequestHash` | 17 |
| `dex_asset_create` | `DexAssetCreatePayload` | `AssetID, Symbol, Name, U32(Decimals), Q(MaxSupply), Q(InitialSupply)` | 8 |
| `dex_asset_mint` | `DexAssetAmountPayload` | `AssetID, Q(Amount)` | 3 |
| `dex_asset_transfer` | `DexAssetTransferPayload` | `AssetID, Recipient, Q(Amount)` | 4 |
| `dex_pool_create` | `DexPoolCreatePayload` | `PoolID, Asset0, Asset1, U32(FeeBps)` | 4 |
| `dex_liquidity_add` | `DexLiquidityPayload` | `PoolID, Q(Amount0), Q(Amount1), Q(MinShares), Q(DeadlineUnix)` | 9 |
| `dex_liquidity_remove` | `DexLiquidityRemovePayload` | `PoolID, Q(Shares), Q(MinAmount0), Q(MinAmount1), Q(DeadlineUnix)` | 9 |
| `dex_swap_exact_input` | `DexSwapExactInputPayload` | `PoolID, AssetIn, Q(AmountIn), Q(MinAmountOut), Q(DeadlineUnix)` | 8 |
| `dex_swap_exact_output` | `DexSwapExactOutputPayload` | `PoolID, AssetOut, Q(AmountOut), Q(MaxAmountIn), Q(DeadlineUnix)` | 8 |

All Go business numeric fields are `uint64` except `Decimals` and `FeeBps`, which
are `uint32`. Range checks occur before any adapter narrows them to existing
`int64`, `uint8` or `uint16` business fields. Unless a zero exception below says
otherwise, business numbers are 1 through 2^63−1. DeadlineUnix is positive Unix
seconds bounded by 2^63−1; whether it has expired is a state-machine decision.

Per-field rules:

- Stake Amount and delegation AmountYNXT are positive. Delegation Provider is a
  canonical lowercase account address and must equal the outer Owner.
- Rental Address is a canonical lowercase account address and must equal the
  outer Owner. Bandwidth, Compute, AICredits and TrustCredits may be zero, must
  each be at most 2^63−1, and cannot all be zero. MaxPriceYNXT is positive.
- Delegation Beneficiary and rental Provider follow existing opaque resource
  account identifiers: 1–128 UTF-8 bytes, no Unicode White_Space or category Cc
  control characters. Thus the explicit `ynx_protocol_resource_pool` identifier
  and merchant identifiers are representable. Empty/default-provider spelling
  is rejected; resource-account existence/eligibility remains a business check.
- PolicyHash and RequestHash are exactly 64 lowercase hexadecimal ASCII bytes.
  Rental QuoteID is exactly 24 lowercase hexadecimal ASCII bytes.
- Rental QuoteExpiresAt is a string with the exact UTC RFC3339Nano spelling:
  `YYYY-MM-DDTHH:MM:SS[.fraction]Z`, valid calendar date, years 0001–9999, at most
  nine fractional digits, no trailing fractional zeroes, and no fraction if zero.
  The zero time `0001-01-01T00:00:00Z` is rejected. Equivalent timezone offsets,
  lowercase letters, comma fractions, redundant zero fractions and excess
  precision are rejected. The exact string is signed; the adapter parses it as
  UTC and applies the original quote/expiry rules.
- IdempotencyKey is 3–128 valid UTF-8 bytes, with no leading/trailing Unicode
  White_Space and no category Cc characters. Internal spaces are preserved.
- Custom AssetID matches `[a-z][a-z0-9-]{2,31}`. Asset create, mint and asset
  transfer require a custom ID. Pool and swap asset fields also permit the exact
  native ID `YNXT`; they do not convert `ynxt` into `YNXT`.
- Symbol matches `[A-Z][A-Z0-9]{1,11}`. Name is 1–80 valid UTF-8 bytes, with no
  leading/trailing Unicode White_Space and no category Cc characters. Unicode
  text is preserved byte-for-byte; no normalization or case folding is applied.
  Decimals is 0–18; InitialSupply is positive and no greater than MaxSupply.
- Recipient is a canonical lowercase account address. Any additional recipient
  policy belongs to the existing business logic.
- PoolID matches `dex_[a-z0-9][a-z0-9_-]{2,59}`. Pool Asset0 is strictly less than
  Asset1 by ASCII byte order. FeeBps is 1–1000.
- Add-liquidity Amount0, Amount1 and MinShares are positive. Remove-liquidity
  Shares is positive, while MinAmount0 and MinAmount1 may be zero. Swap exact
  input AmountIn/MinAmountOut and exact output AmountOut/MaxAmountIn are positive.

White_Space here is the Unicode property (including U+0085 and excluding U+FEFF),
not an implementation's broader or narrower trim function. Category Cc is
U+0000–001F and U+007F–009F. No invalid UTF-8 sequence may be replaced silently.

## Go API

```go
type Action struct {
    ChainID       []byte
    NativeChainID uint64
    Owner         string
    Nonce         uint64
    Fee           uint64
    Kind          string
    Payload       []byte
}

func EncodeActionPayload(kind string, payload any) ([]byte, error)
func DecodeActionPayload(kind string, wire []byte) (any, error)
func (a Action) Validate() error
func (a Action) SigningBytes() ([]byte, error)
func DecodeAction(wire []byte) (Action, error)
```

EncodeActionPayload accepts only the exact declared **value** type for its kind,
not pointers, maps or JSON. All malformed/unsupported input returns `ErrAction`.
Decoded strings and byte slices do not alias the caller's wire. The ordinary Go
Action object is mutable and is not a verified handle: callers must consume the
exact message returned by the cryptographic verifier, never a separately mutable
or separately supplied replacement object. These functions do not sign, verify
signatures, mutate state, check a local wall clock or return a success receipt.

## Native admission and retained execution proof

`Devnet.SubmitPQAction(memberWire) (Transaction, bool, error)` takes an original
MemberWire of any legal protocol batch size, bounded to 128 KiB for this action
message family. Under one ledger lock it binds the trusted network/native chain,
calls `State.VerifyMember` with `TX-BATCH` and the complete message, enforces the
exact next nonce, then invokes the existing private business mutation. Native
stake/delegate/rent charge fee 0; native DEX charges fee 1 with its existing
traceable-lot fee accounting. The classic entrypoints retain their legacy gate.
This does not yet add mixed-action Whole admission or ABCI action execution.

The transaction hash is `0x || lowercaseHex(SHA256(originalMemberWire))`.
The authoritative memo is `ynx-pq-action-v1:` followed by lowercase hex of
`E(originalMemberWire, originalResourcePolicyJSON)`. The second field is empty
for stake/DEX and is the complete typed execution-time ResourceMarketPolicy JSON
for delegation/rental, bounded to 8192 bytes. Parsing requires exact typed JSON
re-encoding, rejecting unknown/duplicate keys and trailing bytes. Its computed
policy hash must equal the policy hash inside the signed full action payload.
The policy is auxiliary execution evidence; it never replaces the complete
signed action or its complete MemberWire. Historic quotes are checked against
this original policy and the original transaction timestamp, never today's
policy or wall clock.

Delegation/rental/income records add only an optional `pqTransactionHash` reverse
reference. Old records omit it and keep their old JSON encoding. Each successful
PQ action must have exactly the full expected business records; every PQ reverse
reference must resolve to its original transaction; and every PQ DEX action must
have one matching execution event. Legacy rentals without proof are not assigned
fabricated quotes, signatures, nonces or reverse references.

PQ resource object IDs retain 24 lowercase hex characters:
`hex(SHA256(E("YNX-PQ-RESOURCE-OBJECT/v1", network32, owner, kind,
idempotencyKey))[0:12])`. Different signed bodies cannot reuse an existing ID.
The complete original member identifies retries: a duplicate only reconciles
its original durable result and never recreates a receipt using a new policy.
Income IDs are `hex(SHA256(E("YNX-PQ-RESOURCE-INCOME/v1", transactionHashASCII,
source))[0:12])`, with source `resource-rental` or `protocol-resource-fee`.

Business state, nonce and retained proof use the existing single mutation
checkpoint. A pre-rename failure rolls them all back; a post-rename uncertain
durability acknowledgement retains them all, returns UNKNOWN and reconciles the
same wire/hash on retry. The new tests cover restart and both failure boundaries;
their execution is still pending authorized CI at this source freeze.

## Reproducible public vectors

The following dependency-free Node script generates the fixed vectors checked
by `TestActionIndependentVectorsAndCompleteRoundtrip`. It uses complete payloads
and BigInt integers above JavaScript's exact-number boundary. Network is bytes
00 through 1f, native chain ID is 9007199254740993, nonce is 18446744073709551615,
fee is 7, and owner is the explicit public fixture address in the script.

```js
const { createHash } = require('node:crypto');
const U32 = n => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(Number(n)); // n is already one bounded 32-bit word
  return b;
};
const Q = n => {
  n = BigInt(n);
  return [U32(n >> 32n), U32(n & 0xffffffffn)];
};
const E = f => Buffer.concat([U32(f.length), ...f.flatMap(v => {
  const b = Buffer.isBuffer(v) ? v : Buffer.from(v, 'utf8');
  return [U32(b.length), b];
})]);
const owner = '0x1234567890abcdef1234567890abcdef12345678';
const to = '0xabcdef1234567890abcdef1234567890abcdef12';
const big = 9007199254740995n;
const policy = 'ab'.repeat(32), request = 'cd'.repeat(32);
const vectors = [
  ['stake', Q(big)],
  ['resource_delegation_create', [owner, to, ...Q(big), policy, 'delegate-key', request]],
  ['resource_rental_create', [owner, 'ynx_protocol_resource_pool', ...Q(big),
    ...Q(2), ...Q(3), ...Q(4), '0123456789abcdef01234567',
    '2030-01-02T03:04:05.123456789Z', policy, ...Q(9007199254740997n), 'rental-key', request]],
  ['dex_asset_create', ['asset-test', 'TEST', 'Test 资产', U32(18),
    ...Q(9223372036854775807n), ...Q(big)]],
  ['dex_asset_mint', ['asset-test', ...Q(big)]],
  ['dex_asset_transfer', ['asset-test', to, ...Q(big)]],
  ['dex_pool_create', ['dex_test', 'YNXT', 'asset-test', U32(1000)]],
  ['dex_liquidity_add', ['dex_test', ...Q(big), ...Q(2), ...Q(3), ...Q(1893456000)]],
  ['dex_liquidity_remove', ['dex_test', ...Q(big), ...Q(2), ...Q(3), ...Q(1893456000)]],
  ['dex_swap_exact_input', ['dex_test', 'YNXT', ...Q(big), ...Q(2), ...Q(1893456000)]],
  ['dex_swap_exact_output', ['dex_test', 'asset-test', ...Q(big), ...Q(2), ...Q(1893456000)]]
];
for (const [kind, payload] of vectors) {
  const wire = E(['YNX-NATIVE-ACTION/v1', U32(1),
    Buffer.from(Array.from({ length: 32 }, (_, i) => i)), ...Q(9007199254740993n),
    owner, ...Q(18446744073709551615n), ...Q(7), kind, E(payload)]);
  console.log(kind, wire.length, createHash('sha256').update(wire).digest('hex'));
  if (kind === 'stake') console.log(wire.toString('hex'));
}
```

| Kind | Wire bytes | SHA-256 of full message |
| --- | ---: | --- |
| stake | 199 | `1ebf8a43af751d8a487f0db90887a572bde7a62596a4181ca72d63d147e29d99` |
| resource_delegation_create | 464 | `c6774dcac539acbc6293b6c0e33c7c3ccc84f7daaf2e2d48132851f62c119c38` |
| resource_rental_create | 568 | `98b520353982b5df558f76ac30b2c74b310a07506f3e5348aec57e0e50362b7e` |
| dex_asset_create | 271 | `48967ee1cd2233fd2d78892f7f47bc7310fc6b57392513a72eb0a8762d5d0e46` |
| dex_asset_mint | 222 | `0492725896cef63f2ebbf3f246b23a922a21029e5c973069f2e91d23ca1202c9` |
| dex_asset_transfer | 272 | `c13fe6896c6e466e019b271b621ee3126717c9ef1e58c5e6248e3cf2ac5ed58f` |
| dex_pool_create | 235 | `33cc4e44cf28ce118f20f788fae056b7a5c1f3897f1b17bc03ddd8ab7c5020df` |
| dex_liquidity_add | 271 | `fdccb08fd6ea1879136633e96b209206cb6f82dc583dbbfea6e26e443f93201b` |
| dex_liquidity_remove | 274 | `594a92566ae77230d7fffd747a631c70b37f68e8c2c58f2d468ac572f0926441` |
| dex_swap_exact_input | 266 | `054d53ae2a5e6d6cc5bebeefc0dc559b3d5c6e690b0e7951f97390fee1fa381e` |
| dex_swap_exact_output | 273 | `0993d58d7431485b678915a552952ed0a472506af04859d9d123a2277fea037e` |

Next authorized CI check, without a local build in this source phase:

```sh
go test -p 1 ./internal/ynxauth -run '^(TestAction|FuzzActionCanonicalDecode)' -count=1 -timeout=90s
```

This runs the normal fuzz seeds, not a continuous fuzz workload. The tests cover
all 11 fixed vectors; full typed/envelope roundtrips; every integer width;
owner-to-resource binding; unsupported actions/type confusion; malformed frames;
JSON/duplicate/unknown-field rejection; numeric overflows; canonical Unicode,
IDs and timestamps; independent kind binding; and the explicit business boundary.
