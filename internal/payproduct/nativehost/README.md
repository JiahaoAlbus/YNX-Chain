# Original Auth/Cloud/Pay engine host

Build tags: `pay_pq pay_cloud pay_auth_source pay_securelink securelink_openssl`. The host consumes the complete frozen Auth nine-file engine/committed-port successor and the original P04 Cloud host. Supplier tests and PUBLIC fixture controls stay outside production source archives.

`OpenProducts` calls the actual `cloud.OpenOriginalPrivateHost` and `payproduct.OpenNormalProduct` constructors once. It owns their original Cloud reader, Pay service/Store and retry workers. Without a supplied engine, `NativeSourceStatus()` reports `PAY_HOST_ORIGINAL_ENGINE_RESOURCES_NOT_SUPPLIED`; the original closed Pay server returns unavailable while independent Cloud routes remain usable. Keep every nonnull partial before inspecting errors.

The owning normal process calls `BindNative(originalDevnet, apiConfig)` or `BindBFT(originalApplication, originalNode, endpointConfig, build)`, then `OpenProductsWithEngine`. These are in-process boot dependencies, never incoming request or JSON authority. Resources are engine-specific: Native borrows the actual Devnet; BFT borrows the actual Application and Node-owned stores through `ProofSourceView`. No additional ledger, Application, BlockStore, callback HTTP client or replacement handler can be supplied. The service's own Store pointer is used, and a lookalike Store is rejected.

Native constructs the original API handler. Its current accepted-transaction response and invoice capability cannot satisfy the original BFT invoice transport/proof contract. Normal invoice composition retains its nonnull partial and returns `PAY_NATIVE_ENGINE_INVOICE_TRANSPORT_NOT_SUPPORTED`, before Source activation. Native account-read support does not imply invoice submission or finality.

BFT first checks the actual Node checkpoint against the Application's original authority. It calls the original `Node.ConfigureRPC` and `bftgateway.New`, with an explicit loopback listener and actual LINK server/client. Its origin is fixed; Auth additionally requires the concrete transport's immutable `Engine()=="bft"` and `OriginData()` to match the admitted release's node origin. The original Node/Application remain borrowed and consensus is never started by this module.

The finite LINK policies must contain the original GET RPC read paths, the exact original invoice broadcast path and typed POST `/rpc/`. That POST accepts only the original gateway's canonical single JSON-RPC `broadcast_tx_commit` invoice envelope, with its exact raw transaction bytes. Batches, duplicate/unknown fields, generic RPC methods, queries and oversized frames are rejected before the original RPC handler. Read queries remain DATA interpreted by the original Core RPC implementation. No generic POST `/` tunnel is exposed.

`NewPrivateBFTPayHTTP` retains the actual LINK gates and full policies. After the existing Source/member/merchant checks, private policy control derives only the original native-hash readback/proof and merchant/invoice GET paths. It uses full `ReplacePolicy`, advances every retained edge epoch, closes idle client references after revocation, and retains the first replacement failure. Registration never adds POST authority or retries a submission. Persisted uncertain operations remain query-only through the same original grant and Store.

`OpenProductsWithEngine` uses the original Auth `NewOriginalPrivateNativePayServer`. Genuine Root release rows, issuer/current checks, merchant fencing, independent trusted proof anchors and submit approval remain separate required gates. A constructed engine or healthy RPC does not supply any of them. Missing commissioning retains the original Source partial and keeps protected Pay routes unavailable.

`OpenPrivate(products, PrivateConfig)` mounts the genuine Pay/Cloud handlers through original LINK `ListenPrivate` and `NewLocalCallerServer`, preserving the same request and fixed UID/PID/routes. It retains the listener even before Serve, never unlinks an existing endpoint, and uses the original retire/drain/SIGTERM path. The standalone `ynx-pay-private-host` cannot borrow another process's Go resources and has no engine/Root activation flag. An owning integrated process calls the typed boot functions above with its already-open original objects.

Shutdown order is: retire original admission; join the LINK handler/body boundary and Serve goroutine; retire/join product requests, Pay retry and Cloud workers; close the Auth Source; close Cloud; close Pay's captured normal central transport; finally `EngineBinding.ShutdownEndpoint(ctx)`. Only the engine endpoint's listener/server/client are owned by that last call. Core closes its own original Node/Application afterward. Undrained or unconfirmed child cleanup retains dependent parents and the first cause. No uncertain operation is replayed on recovery.

The original Auth `Owner.Closed()` fact is required for Source release. The
runtime delegates this fact to the retained concrete owner. A nonzero `Close`
result remains the first cleanup cause; when that same owner confirms physical
closure, Products may finish closing its parents while returning that error.
Retirement, an empty active-request count, and `Close` returning are not such
confirmation. Pending or UNKNOWN Source child cleanup keeps the parents held.
The older Auth source without this predicate cannot compile this successor;
its actual owner must supply the complete matching source, including request
and commissioning cleanup. It does not affect the existing selected runtimes.
`PAY_NATIVE_WORKFLOW_SUITE=native-source-close` runs the narrow real Root0
partial cleanup check with explicit `PAY_NATIVE_HOST_MODFILE` pointing to the
original complete normal-host dependency closure. No fake Source replaces the
missing supplier method, and Root0 cleanup is not merchant admission.

`PAY_NATIVE_WORKFLOW_SUITE=engine` selects the engine, RPC and private exact-route delta checks in `../testsupport/run_native_workflow.sh`. `engine-node` additionally requires a new `PAY_ENGINE_FIXTURE_REPORT` and a prepared composition containing the pinned Core26b production graph. It extracts only the original PUBLIC fixture helpers, commits the first block with the original BlockExecutor, and cold-recovers the same Node directory before exercising the actual S3 RPC/gateway/normal products Source boundary. These test-only controls never enter production or assert Source admission, merchant business success, activated PQ consensus, or funds movement.

For production distribution, run exact-tag `go list -deps -json`, then `../testsupport/production_source_closure.mjs SOURCE GO_DEPS_JSONSTREAM NEW_OUTPUT REPORT`. The collector rejects tests, fixture/control directories, symlinks and incomplete inputs; it includes selected Go/Cgo/header/assembly/embed files and local module metadata only. Keep toolchain/module-cache/OpenSSL inputs, test evidence, archive/install readback, Main installation and real business acceptance as separate records.

The fixed contract for the original Core callsite is the single `OpenBFTPrivateProducts` attachment, retaining its nonnull partial. Its `Retire`, `Shutdown` and `CoreReleased` contract is specified in [CORE_ATTACH_CONTRACT.md](CORE_ATTACH_CONTRACT.md). Core must gate its original parent-close defers on actual completed release, independently of a retained first error. This is fixed compile-time normal composition, not a runtime plugin or Source authority callback.
