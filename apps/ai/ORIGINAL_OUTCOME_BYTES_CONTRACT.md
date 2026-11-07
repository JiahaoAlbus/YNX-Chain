# Original durable outcome bytes for the existing response path

The actual P08 callees are:

```go
(*TaskActionOutcomeReceipt).ReadOriginalOutcomeDATA() (TaskActionOutcomeOriginalDATA, error)
(*TaskStoreActionOutcome).ReadOriginalOutcomeDATA() (TaskActionOutcomeOriginalDATA, error)
```

`TaskActionOutcomeOriginalDATA` contains `View TaskActionOutcomeView`,
`BusinessReceiptOriginal []byte`, and `BodyOriginal []byte`. These are product
DATA read through an original opaque resource owner, not an authorization,
wire envelope, signed declaration, or Native receipt constructor.

The receipt bytes are the exact `view` JSON member inside the original
AEAD-authenticated durable outcome payload. The body is the exact body in that
SAME payload. Neither is remarshaled from a caller DTO. The reader validates
the authenticated view against the original durable index, validates the body
binding, and checks Current before and after copying. Old persisted JSON
formatting survives cold reads. The storage format is unchanged.

Execution and cold original-op lookup return the same committed originals.
`View` retains the original operation ID, RequestRef, RequestDigest, OriginalRef,
principal, business action, method/path, before/after task versions, status,
commit time and original business-body binding. RequestRef comes from the
same original Auth request; OriginalRef is a separate product storage locator.
Neither a task ID nor a product OriginalRef can substitute for an AuthRef,
nonce, role, current proof, Agent identity, or actual execution authority.

A durable PENDING reservation has UNKNOWN query metadata and no committed
receipt/body. Missing, mismatched, cancelled, closed, retired or tampered
owners cannot supply the committed original bytes. Reading does not create a
claim, nonce, operation, task or dispatch. The immutable original receipt is
historical local-product evidence; new scheduling authority needs its separate
current task/session/Grant checks.

The P08 downstream consumer
`internal/authaitaskv6/task_outcome.go::HeldOriginalBusinessOutcome.ReadOriginalOutcomeDATA`
now calls these actual getters. Its existing private exchange reply fields
`bodyOriginal` and `receiptOriginal` carry the copied originals. Both original
execution and original lookup retain RequestRef, local completion scope, exact
body digest/length and HTTP status. UNKNOWN carries no synthetic receipt JSON.
No private LINK operation, public Client7 field, signature domain, endpoint or
header was added. The upstream Auth-owned frozen source tree is untouched;
this is the P08 downstream consumer of the product getter.

The original Auth response builder must consume this held result and the sole
SDK's actual response-body carrier encoder. The whole carrier must be covered
by the existing signed response bodyDigest/bodyBytes. The inner business-body
binding remains the original product binding; it is different from the outer
carrier's bodyDigest. Keep both original receipt and body byte sequences.
Account for the existing signed-body limit before choosing a response; this
callee does not expand that limit or authorize response signing.

The sole SDK owns the encoder/decoder and the compatible public observation
projection. The current P08 mobile consumer reads
`Observation.responseOriginal.bodyOriginal` as product DATA; the final codec
must specify its actual business-body extraction/projection without changing
Client7 or silently treating an unverified envelope as a business response.
P08 does not invent that codec or infer an outcome from HTTP16/HTTP200.

Client Auth must independently verify the signed carrier, registered server
Source, original request/op/digest/nonce/once, Peer, C17 and same Context before
creating its actual receipt loan. Native borrows that verified owner and keeps
all packet/child cleanup debt. No server Go pointer crosses the private Unix or
HTTP boundary. No JSON DTO/provider setter may manufacture a Source or loan.

Component verification runs the actual encrypted product writer, cold reopen,
original getters, and production private-exchange consumer under an explicit
PUBLIC request-lifetime seam. It does not prove genuine LINK Source/Root rows,
signed carrier validation, a Native strong loan, installed lifecycle, signing,
real tool execution or finality. Those matching owning implementations and
actual Source qualification remain independent acceptance work.
