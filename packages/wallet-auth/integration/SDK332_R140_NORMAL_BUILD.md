# SDK332 auth4 canonical deployment DATA and R140 Native source

The current package is `1.3.0-pq.3.32-auth.4`. It inherits aa9681f0 Auth3 cleanup unchanged and adds four pure deployment source/type files byte-identical to e4dc7eb6 SDK333. It uses one canonical package and runtime identity; do not mix an SDK333 package or old manifest into Auth4. Sealed Auth1/2/3 packages and installed apps remain unchanged.

`SDK332_R140_NATIVE_COMPATIBILITY.json` independently pins all 55 Native inputs, the unchanged normal build tool, four pure deployment inputs, and exact public exports. New checks cover this combined source selection and original Go transport bytes. Existing Auth3 cleanup, R140, SDK332 and SDK333 tests retain their original evidence rather than being rerun.

Original A uses the complete frozen source commit, exact Auth4 SDK archive and normal installed dependency/runtime manifest. Native55 bytes are identical to Auth3/Auth2. A genuine R140 module099699 and its executed receipt23e608 may be reused only after source/header/tool/argv/ABI/output verification. Preserve that historical receipt unchanged and record the Auth4 runtime pairing separately. No redundant8TU is requested. Old SDK330 modules are forbidden.

The source-only recipe remains:

```sh
node apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs /absolute/original-a/pinned-node-headers arm64
```

The command validates inputs and emits the existing normal build plan; it is not compilation proof. Only A executes an actual Native build when no matching verified component exists. App compilation, installation, Source admission, login, recovery and revocation remain separate acceptance gates.

Use `capturePQContractDeploymentMaterialData` before key access. The specialized portable encode/decode APIs and Node `preparePQContractDeploymentTransportData` take `{member,source,material:{artifactFile,buildInfoFile}}`, where files are exact raw Uint8Arrays. The generic deploy rejection remains intact. The signed payload binds name, sourceHash, deployedBytecodeHash, compilerConfigHash, constructorArgs and value. Both supported contract names require exactly one canonical uint64 decimal constructor argument and value0. Raw source bytes and transport source are separately preserved; no silent trimming or synthesized build-info is allowed.

The SDK supplies DATA only. The original Go compiler material validator must authenticate source/config/ABI/code, while genuine Source/current permissions and concrete approval remain mandatory. Actual IDE Counter/ERC20 files are independent supply gates; the frozen Counter Go fixture proves PUBLIC encoding interop only.

Authorization is the user's IDE ecosystem deploy/call development scope relayed by Root01a094cc. Cross R8 signing/CCTP authorization is unrelated. No actual constructor value, account, fee, signature or network deployment is approved by this package.
