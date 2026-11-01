# Original Native Pay producer

`pay_native_capture.cpp` implements the normal private Native symbol
`ynx_wallet_capture_original_pay_channel_v1`. It first adopts an Auth SourceLease
retain, extracts that lease's actual registered runtime under the same original
Binding/query constraint, and adopts the LINK channel partial before checking
errors. It accepts no destination, configuration installer, Root boolean, JS
callback or ordinary Core transport.

`pay_native_link_channel.cpp` owns the original in-process LINK C holder. The
actual Go normal startup owner must construct/register its real LocalCallerClient
in that same embedded Go runtime. The Auth lease retains the original registration
borrow. A pointer from a Pay daemon process cannot provide this registration.

`pay_native_requests.cpp` handles only the five original operations:

| Operation | Method | Original target |
| --- | --- | --- |
| post_terms | POST | invoice-intents/{original intentId}/merchant-member |
| post_settlement | POST | invoices/{original merchant}/{original invoiceId}/settlements |
| post_refund | POST | invoices/{original merchant}/{original invoiceId}/refunds |
| get_intent | GET | invoice-intents/{original intentId} |
| get_invoice | GET | invoices/{original merchant}/{original invoiceId} |

Routes have the `/v5/pay/` prefix. `original_route_constraints` returns only the
selected kind's POST and GET, or only GET for a query borrow. These are constraints
to AND with the real Root-owned transport profile; they grant no network access.
Settlement/refund do not invent an intentId. Disabled registration slots must
remain unavailable. POST uses the retained Member hash and exact JSON base64;
GET carries no Member/body. There is no automatic retry or replacement operation.

The channel returns the actual method/path/status/contentType/cacheControl/body
without JSON parsing, MIME normalization or relabeling. It can return a raw packet
and a late transport error together. The original Native owner/Main must retain
that packet before exposing the late error, preserving durable UNKNOWN.

Normal cleanup retires, joins on the Native worker, then explicitly closes/frees
the original holder. A finalizer only retires. LINK retains the real Source fence
while work or cleanup debt remains; neither dropping a wrapper nor an error is
permission to release the original borrow or start a new attempt.

The normal matching build must compile all three producer `.cpp` files alongside
the complete matching Auth Native kernel/stage/SourceLease and actual Main child,
and link the original LINK c-archive/private header from one frozen input set.
Do not mix an old library with a new header or use the PUBLIC fixture library in
a normal package. Root/Source qualification, normal installation, and actual
merchant business acceptance remain separate from compile/control evidence.

The original Pay workflow runner's `native-producer` suite compiles all three
production objects with Werror and runs request framing/route constraints against
the complete hash-checked frozen Auth/LINK input. It rejects incomplete inputs.
The direct script's explicit `--request-only` mode accepts the older request-only
boundary. Controls remain PUBLIC DATA, without Source admission/network dispatch.
