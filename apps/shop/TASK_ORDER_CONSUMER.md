# Normal Shop task-order consumer

`OpenOriginalShopTaskOrderConsumer(ctx, originalStore, runtimeDirectory)` opens
the actual zero-input Auth effect runtime, independently admitted query runtime,
formal task authority client and original typed broker. It adopts partial owners
before inspecting errors. A nonnil result must be closed even on startup error.
The existing Store, order data, prices, inventory and payment/return state are
preserved. No extra authority DB, once ledger or result-receipt store is created.

The runtime directory is only deployment filesystem placement. It must be a
short absolute directory on the external disk during migration. Auth's current
registered local service, routes, byte budgets, actual process UID and PID are
checked before the private Unix socket is created. No caller-supplied Source,
role, Principal, HTTP body or boolean can choose that registration. Closing
retires admission, cancels actual product calls, drains LINK handlers and the
original broker, then releases Source owners. Operator socket identity is kept.

`Read(ctx, originalRequest, input)` resolves the genuine native Grant/binding and
proofs, checks the original Store's current buyer/seller permission and selected
order snapshot, and captures the original Auth call from an ordinary context.
The exact original body travels through LINK's actual Unix caller to the actual
broker handler context. Only the original opaque call lease's `Wait` supplies
the typed result after the formal Auth client verifies the whole response with
the sole SDK and original Core dual-PQ AND. HTTP204 is only acknowledgement.
The original Node same-SQL authority alone reserves, assigns the operation and
settles once/budget; Shop never assigns an operation, nonce or approval.

After that verification the consumer checks the same operation, selected
Source/ref/revision/fields, both exact byte bindings, original SDK result JSON,
current Store membership and Source. It returns detached original
`TaskResourceResult.ResponseOriginal` and `SourceBytes`. It never parses opaque
`Original`, reconstructs result bytes from today's order, or interprets SDK DATA
flags as proof. Error/UNKNOWN/FAILED returns only bounded original state/op/ref;
no body, Source, scope or binding is exposed as a usable result. There is no
automatic resend or added anonymous HTTP route.

`Recover(ctx, originalRequest, input, observedOperation)` obtains historical
material only from the independent query Source and calls the original query
route through the same real IPC broker. It never calls NEW ResolveTaskGrant or
OpenCheck and never uses saved consumer proofs. The current query Grant ref may
reflect revocation; original signed bytes and Node op remain unchanged. An
observed op, if supplied, must exactly match the actual query Source. If the
original response was lost before the op reached the product, only that Source
may resolve it. Current order ownership is checked, but an updated order
snapshot does not replace or invalidate the original retained result bytes.
Original task/reference persistence remains with the original caller/task
owner and Auth's once/history stores; a reference itself grants no query right.

Formal normal package:
`auth-task-authority-formal-normal-intake-20261031/AUTH_FORMAL_NORMAL_SOURCE.tar.gz`,
2429173 bytes, SHA256
`c404098f31c292d57c59a09ea9b4a14ed32de723cdc2264778e35867b3e088b1`.
Auth H18067 SHA256
`b6c8594a988e0dd89bb8d1c92ce83fea9eea114b4bcaa81863b6df1fa332c00e`,
broker H11020 SHA256
`e329cbdb673c321c09b193bade53847faabc21074891eadda9b37277ce9039f1`.
The Shop-specific CAS installed 51 new/updated leaves and skipped 43 identical
leaves, preserving the original module graph. Root go.mod adds only the formal
client require and relative replacement; go.sum is unchanged. Full LINK eb59,
formal OPEN, original runtime/query, policy/Core and license closure are pinned
in `normal-task-runtime-suppliers.json`. The old candidate decoder is absent.
The supplied complete upstream Node authority layout remains owned by Auth/SDK;
Shop does not launch a replacement authority daemon.

New actual Unix consumer and shutdown/recovery tests pass, including race mode.
The original producer/read combination and static checks pass with external
build/module/temp caches. PUBLIC Source/typed-broker fixture boundaries are
explicit; original Auth signer/CoreAND/Node evidence is retained and reused.
The normal production constructor executes the actual factories and safely
drains the missing-registration partial. No real Root registration, issuer
custody, admitted tool effect, native TLS whole-response business, funds
movement, installed V5 client or public release is claimed by these tests.
