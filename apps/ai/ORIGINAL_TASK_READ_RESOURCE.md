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
