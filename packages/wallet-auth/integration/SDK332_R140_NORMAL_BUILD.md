# SDK332 auth2 and R140 normal Native build

This successor contains SDK332's existing public APIs and the exact two R140
Native cleanup fixes. It is `1.3.0-pq.3.32-auth.2`; neither sealed auth1 nor
SDK330/IDE27ad is replaced. SDK333 deployment transport is a separate branch.

The source input contract is `SDK332_R140_NATIVE_COMPATIBILITY.json`. It pins all
55 Native inputs and the unchanged normal build tool. The existing 13 R140 and
7 SDK332 controls remain their original evidence; new checks cover composition,
mixed-source refusal and selection of the normal eight-TU recipe.

Original A uses a fresh output directory and the frozen complete source commit,
the auth2 SDK archive, its exact installed dependency closure/runtime manifest,
and the original pinned Node headers. No old prebuilt module is an input.

From the complete frozen source root, generate the executable normal recipe:

```sh
node apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs /absolute/original-a/pinned-node-headers arm64
```

This command validates source and emits a plan without compiling. The emitted
`normalBuildCommand` invokes the existing
`build-original-auth-identity-native.mjs` entry. Only original A executes it,
under its existing resource guard and normal compile/link/output receipt flow.
Its module and receipt must name these new 55 input hashes and the auth2
runtime, followed by the original complete Main App recipe. The old SDK330
module/receipt cannot be relabeled R140. The SDK and Native roots may be separate
materializations of the SAME frozen source/payload tuple; their overlapping
source files must match this contract, and the packaged runtime manifest must
be the auth2 manifest. Do not copy the 330 manifest into an auth2 installation.

The plan checks do not establish compilation, installation, Source admission or
actual login/session recovery. Legitimate Auth qualification and user approvals
remain independent activation gates. No new wallet, parent adapter or issuer is
introduced by this composition.
