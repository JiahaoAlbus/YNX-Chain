# Original AI conversation-read resource

P08 implements a finite Go resource callee in `internal/aiproduct`. This is
private transport DATA, not another OPEN codec, Source registration, approval,
Shop executor or public API. It borrows the SAME original Server/Store.

`OpenOriginalTaskReadResource(ctx, server)` requires that Server's concrete native
authority and existing local owner. There is no verifier/provider/URL/Root setter.
Adopt a nonnil owner even when acquisition reports an error.

## Original composition

Auth/Native must compose `resource.Handler()` behind the existing genuine LINK
LocalCallerServer with independently selected peer UID/PID and exact routes:

- Service `ynx-ai-original-task-read-v1`
- POST `/internal/ai/original-task-read/input`
- POST `/internal/ai/original-task-read/execute`
- POST `/internal/ai/original-task-read/query`

No listener or registration is created here. Ordinary HTTP and cloned requests
carrying genuine contexts are rejected. DATA comes from LINK's retained original
request body: application/json, no query string, max 1 MiB. Duplicate keys,
unknown fields, invalid UTF-8 and trailing JSON fail closed. Private request field
names are the exported Go names; byte slices use JSON base64. Grant/holder proof
bytes remain opaque. Neither JSON nor peer credentials grant business authority.

Input: OriginalTaskResourceReadRequest Version `1`, empty AuthorityOperationID
and RawInput, actual Binding/Grant/Holder and exact ExpectedGrantRevision.
ReadInput holds the genuine Source guard across the original encrypted input
read, checks both hashes and actual approved active task/step/resource/tool/schema
under Store.mu. Response is `{input: <base64 original bytes>}`; nothing reserved.

Execute: same DATA with RawInput and Auth's original ledger AuthorityOperationID.
The independently verified Source must itself report that exact OriginalOp and
semantic slot. Caller-supplied operation IDs are not reservation evidence.
**The sole policy currently requires NEW.** If the genuine post-reservation Source
reports RESERVED/UNKNOWN/another state, this callee refuses. The owning adapter
must resolve that normal contract without relabelling states, excluding real
debt, or weakening policy. A live matching adapter is not claimed here.

Dual input/source hashes, task revision/generation, holder, fields, GrantRef and
selected conversation are checked. Final Source check, resource read, encrypted
result and original operation association use the existing Store.mu/save
transaction. There is no new database/schema. The receipt's
same-resource-transaction scope means that local transaction only; AuthScope is
egress-only-read-fence, with no atomic Auth-SQL/resource revocation claim.

Result: `{operationId,state,original,authScope}`. `original` base64-encodes this
resource's own UTF-8 JSON receipt, not a Root signature. The native adapter must
preserve/decode those real bytes for Auth's opaque original result. An ACK/status
cannot become a receipt. Partial results can coexist with late errors: preserve
the SAME operation and query. Handler suppresses private bytes on any late
Source/peer/cleanup error, returning 409 UNKNOWN with the original operation.

Query: AuthorizationRef, original operation, exact original Binding/Grant/Holder.
Independent original native history must verify the operation/proofs. The
original encrypted result is read without opening a new-effect guard, reserving,
signing or re-executing. Cold recovery keeps the stored association/result.
UNKNOWN never means permission to replace an operation.

## Lifetime and checks

Direct ReadInput/Execute return a held call owner, including partial errors;
Current-check and Close the SAME owner. Parent Retire cancels live calls and
history queries. Close refuses while children remain. Uncertain Source close
retains debt and is not blindly retried. Borrowed Store/native authority are not
closed. Handler gates egress on call cleanup and original LINK current.

Concentrated tests use the real encrypted Store, shared policy, finite handler,
Unix LINK sockets and OS peer registration. Verifier/history are PUBLIC doubles,
not real signatures/Source admission. Cases cover cold original recovery/no
replay, forged IDs/proofs, input changes, invalidated steps, partial/uncertain
close, retirement during history, HTTP denial and copied-request denial.
Existing runtime CI runs them through `go test -race ./internal/aiproduct`.

No installed lifecycle, genuine approval, signing, Shop order, public deployment
or business acceptance is claimed. The next actual dependency is the original
Auth/Native registered resource adapter and compatible genuine Source slot.

## Serialized response bound and large-original recovery

The Handler limits the **final serialized response body to 1 MiB**, including
JSON/base64 expansion and the final newline. LINK's response header budget is
separate. No larger MaxResponseBytes is silently selected. Success is serialized
and size-checked before writing any body bytes; Content-Length is exact.

An already committed receipt that cannot fit is never truncated or deleted.
The response is 409 with bounded metadata, retaining `State: "UNKNOWN"`,
`OriginalOperationID`, `code: "RESPONSE_LIMIT"`, `recoverOnly: true`,
`queryPath` and `chunkBytes: 262144`. This means the caller has not obtained a
complete receipt. It does not undo the original resource commit. Preserve the
original Auth operation/UNKNOWN and do not call execute again.

Use the SAME query route, original operation, AuthorizationRef and exact
original Binding/Grant/Holder, adding private request DATA:

- `OriginalOffset`: byte offset, initially 0.
- `OriginalChunkBytes`: positive, at most 262144.

These selectors are query-only; input/execute refuse them. Each query independently
checks original history/proofs/current. The returned `state: "ORIGINAL_CHUNK"`
is **not a COMMITTED effect receipt**. `original` is null; `chunk` contains
`offset`, `nextOffset`, `totalBytes`, `binding` (full original byte count and both
SHA3-512/SHA-512 hashes), and `bytes` (base64 of precisely that byte range).
Follow nextOffset until totalBytes, demanding contiguous non-empty ranges,
identical operation/total/binding on every page, and checking the reassembled
byte count and BOTH full hashes. Only then decode/validate the exact resource
receipt and settle the SAME original Auth operation. Neither a chunk nor its
public hashes are independent authorization or a settlement proof.

Offset/length errors and changed proofs refuse disclosure. Reassembly failure,
EOF, missing page, late Source/peer/cleanup failure or lost ACK retains UNKNOWN;
recover by querying the SAME original, never reserving/executing anew. The
original encrypted Store result/operation association survives cold restart;
pagination creates no operation, database, cursor row or receipt rewrite.
A default whole-receipt query still respects the same 1 MiB serialized bound
and returns the bounded recovery hint if it cannot fit. The original Auth
bridge must explicitly consume this private query extension; until it does,
its existing strict bound/UNKNOWN behavior is correct.
