# Fixed Main-only registration contract

The SDK-owned Node entry is based on SDK19 22a30ce4, with the independent CLI
source delta 62a2840e in its parent branch. Frozen SDK19 packages/components are
unchanged. This source fragment is not a new complete SDK package or build.

The normal Main-owned user-addon compiler command must explicitly select
`-DYNX_ORIGINAL_WALLET_ARTIFACT_PUBLISHER_BINDING=1`. An undefined flag excludes
the include and registration; a defined value other than one fails compilation.
The root helper command must never select this flag. Merely placing the Main
include beside the SDK source does not enable it.

Main owns `apps/wallet-desktop/native/original-artifact-publisher-binding.inc.mm`.
The original SDK entry includes it after the original Wallet opaque helper and
other original includes. It must define:

```cpp
static bool RegisterOriginalArtifactPublisherBinding(napi_env env, napi_value exports);
```

The original registration first enforces the R172 main-thread fence and registers
its baseline callbacks. It then invokes this fixed function exactly once before
returning the original Auth binding. False returns nullptr, preserving any
original pending exception; there is no runtime provider, registration fallback,
second module or caller-selected include. Main uses distinct export names and
must not acquire a Source or touch a key merely while registering callbacks.

Within the same translation unit the Main include can use the existing static
`IDEWalletOriginal(env, value)` and `IDEWalletCurrent(owner, true)` functions.
These recognize the actual same-env/thread tagged owner, not a structural JS
object. Main must require an actual bound transport, no busy operation, no
retired/closing/closed owner or retained first cause, and current Source/transport.
Retain the original JS object via napi_ref before later use; never keep only a
raw owner pointer across asynchronous work/finalization. Retain actual Source
and transport strongly before reading partial results.

`transport.copyCapturedRequest` supplies actual requestRaw/invocationRaw. Compare
request bytes to `source.copyRequest`, perform the original current checks before
and after capture, retain immutable originals and independently recheck at review
and effect. Caller-supplied request/approval/provider/descriptor/Source fields do
not substitute these originals. Close, partial UNKNOWN and first causes remain
under their original owners. A Native pointer is not an authorization grant.

Main owns its binding, private current/review/once/signature/result implementation
and all of those build inputs. Auth owns Source/current/registration semantics and
the original peer payload contract; the old kind-2 Auth identity proof is not an
ARTIFACT-RELEASE grant. KEY7 remains Native-only and must not be exposed through
NAPI/IPC/helper. This SDK source fragment neither changes the peer protocol nor
creates approval or a Linux Source.

Validation here extracts the actual new guarded include/registration source into
an explicitly PUBLIC C++ contract fixture. It checks conditional inclusion,
helper visibility, registration success/failure and missing/bad role refusals.
It is not the full ObjC Native compilation, NAPI loading, Source or Main effect.
Original A must consume complete frozen successor SDK and Main source/inventory,
then execute the matching product profile under Root's normal scheduling.
