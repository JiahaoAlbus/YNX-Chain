# Fixed original Core attachment

This P06 contract is consumed only by the original Core owning startup. Core owns its `cmd/ynx-comet` compile-time callsite and outer Node/App/custody/store/lease lifecycle; P06 owns this package's fixed product factories. Auth independently owns Source qualification. A build tag or operator service configuration does not grant Source authority.

The exact typed constructor is:

```go
func OpenBFTPrivateProducts(
    ctx context.Context,
    app *consensus.Application,
    original *node.Node,
    cfg BFTPrivateProductsConfig,
    build buildinfo.Info,
    logger *slog.Logger,
) (*BFTPrivateProducts, error)

type BFTPrivateProductsConfig struct {
    Endpoint BFTEndpointConfig
    Products ProductsConfig
    Private PrivateConfig
}
```

The constructor calls the existing `BindBFT`, `OpenProductsWithEngine`, and `OpenPrivate`, exactly once with the same original objects. It never starts/stops consensus, opens another engine database, creates identities or substitutes a Root/merchant grant. `ProductsConfig` is the existing original Pay/Cloud normal configuration; `Endpoint` is the explicit original LINK TLS/finite policy/loopback service configuration; `Private` registers the original fixed UID/PID/routes and owned Unix socket. Use the original strict operator reader/field whitelist, not incoming requests or generic JSON-to-authority conversion. There is no Source activation field, callback factory, plugin registry, replacement handler or second RPC target.

Every call returns a nonnull host, including early configuration/resource/constructor failure. Store it before inspecting the error. No automatic rollback destroys a partially constructed child or clears its first cause. `NativeSourceStatus() error` independently reports actual Auth refusal: successful hosting may still have Root0 Source and protected Pay503. `Err()` reports the retained construction/cleanup first cause. `Done()` is only the private Serve outcome; it is nil before that boundary exists and does not imply a consensus failure.

The owning normal startup attaches at its existing actual App+Node holding point before `Node.Start`, without a second constructor. Pure-chain builds/default-disabled configuration continue independently with an accurate product-unavailable status. A fresh bootstrap whose actual App/Node checkpoints do not yet agree is correctly refused; never rewrite a height, bypass the checkpoint fence or manufacture a second ledger to force attachment. Preserve the partial and actual cause, clean it up as below, and keep ordinary Core startup separate from product readiness.

Outer shutdown must follow this order:

1. Call `Retire()` to stop the original product entry, cancel Pay retry and retire Cloud workers. This claims no drain.
2. Call `Shutdown(drainContext)`. It joins the original Unix registered handlers/body capture and Serve completion; joins product requests/retry/Cloud workers; closes Auth Source, Cloud and captured Pay transport; then drains/closes the owned same-engine HTTP server/listener/client.
3. Inspect `CoreReleased()`. Only true means all P06-owned borrowers have actually released the original Core parents. Then Core may follow its original custody unblock, Node.Stop/Quit, proxy/store and writer-lease sequence. P06 never performs that outer sequence itself.
4. If false, retain this same host and all original Core parents/leases; do not return through unconditional parent-close defers. Continue the original owning cleanup/reconciliation path when the held child actually ends. Cleanup may be retried; no business operation is resent.

`Shutdown` keeps the first error. A later successful drain can therefore return the earlier error while `CoreReleased()==true`; report that failure while allowing the now-safe original Core close. Conversely, no timeout or incomplete child close can set CoreReleased true. Constructor rollback follows precisely the same rule. CoreReleased is local lifecycle DATA and cannot authorize Source, signatures, invoices, payment, refunds or finality.

The new `TestPayCoreAttachmentRetainsBorrowedEngineUntilDrained` uses the original Core PUBLIC constructor, original first BlockExecutor commit and same-directory cold recovery. It enters this exact fixed factory, traverses actual original S3 RPC/gateway and Unix Cloud200/Root0 Pay503, holds a real original Cloud session request, observes drain timeout while the same Node/App/RPC remain alive, releases it, verifies endpoint close with first cause retained, then reopens the same original product files at a fresh explicit Unix generation. The partial-constructor regression verifies that first-cause reporting and actual completed cleanup stay distinct. Neither case supplies genuine commissioning or claims merchant acceptance.

Production source/binary qualification must name the same frozen P06 source and actual Core callsite successor. The predecessor 6ca57423a backend install and PUBLIC boundary evidence remain valid predecessor evidence; they are not a claim that `runPQNode` already mounted this attachment or that a matching Main whole app is installed. Root/merchant/current/independent anchor/approval and real funds remain separate gates.
