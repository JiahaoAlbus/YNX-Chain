# Contract project current consumer

The original Node-only export is `@ynx-chain/wallet-auth/original-ide-contract-relay-guard`.
Auth13 adds `assertOriginalIDEContractRelayGuardCurrent(guard)` to the existing
`acquireOriginalIDEContractRelayGuard` factory. Load both this export and
`@ynx-chain/wallet-auth/walletconnect-dapp-connection` through the same fixed SDK
self-reference. Their original guard registration is private to that instance.

Auth14 consumes the frozen R166 Native supplier. The factory requires
`localContext:{workspace,profile,id}`: absolute normalized non-root paths
(at most 4096 UTF-8 bytes each), and an ASCII local locator matching
`[A-Za-z0-9_-]{1,128}`. These must be exactly three own DATA properties.
Native checks the actual directories, held descriptors, process and signed
launch binding. JavaScript validation does not establish that binding.
The locator is not a canonical project ID. `expectedScope` is optional and
only constrains the independently supplied actual nine-field scope; omitting
it never creates a local project identity or bypasses Native current.

R166 requires the exact final installed Auth/WalletConnect runtime union,
independently approved Source release rows and platform qualification. The
normal inventory contains 71 Native and five helper inputs, with unchanged
13/11 translation units. Empty release rows and the Native initiator-role
activation fence remain in place. The union generator inventories DATA and
cannot qualify the installation. R167 artifact DATA is a separate supplier
successor and is not part of Auth14.

The assertion is synchronous. It only accepts an original factory owner whose
initial acquisition succeeded. It checks actual Native current between two
reads of the same original nine-field scope, including the original expiry.
It rejects partial cleanup owners, forged copies, reentry, expiry, scope drift,
revocation and closed owners. It does not initialize a connection or renew a
lease. A Native activation refusal is an error, never a DATA-only success.

The result is a frozen `OriginalIDEContractRelayScopeData` copy. Its existing
`dataOnly:true`, `authorized:false` and `nativeAdmission:false` fields remain:
the successful current check is not an Auth principal, account credential,
Wallet request approval, signing permission or deployment result. Calling
`guard.readScopeData()` separately still reads retained DATA without a Native
current check.

## IDE local material and reference journals

Use the original assertion before and after asynchronous material capture or
journal access. Compare actual `projectId` and `projectGeneration` against the
original trusted current-project binding. The IDE owns the real workspace,
profile and filesystem boundary; the SDK does not fabricate those fields.
A local profile UUID or journal filename is a storage locator, not authority
and not automatically the canonical Source project ID.

A contract-specific, versioned local query namespace may bind these actual
Source values:

```
version: ide-contract-query-namespace-v1
kind, origin, chainId, projectId, projectGeneration, callerIdentity
```

The original `expiresMS` is the fixed deadline for the held owner and must be
checked on every use. It is not a renewed principal or a stable journal key.
The network connection independently rechecks the complete original scope.
The namespace itself grants no local or remote query permission.

Do not rename callerIdentity to Auth owner/account/identityReference. Actual
Wallet account and chain still come from the original connected Wallet and
must match each request and saved reference row. Keep the old nine-field Auth
journals, writer locks, pending rows and UNKNOWN records unchanged. A new
namespace must not silently migrate them, make an uncertain request resendable,
or conceal an unavailable previous record. Explicit migration/recovery belongs
to the original journal owner and cannot infer authority from this DATA.

The contract guard owns its independent Source lease. It must not borrow the
AI Tools admittedProject facade. Keep an acquisition error's `cleanupOwner`
for original cleanup and retain the original cause; it cannot be promoted using
the public current assertion. Cleanup/cancellation uncertainty remains UNKNOWN
and does not authorize a new acquisition or replay of an uncertain effect.

## Delivery boundary

The fixed addon path is relative to SDK `src`:
`../../../apps/wallet-desktop/native/original-auth-identity.node`.
The normal matching Source bundle retains `packages/wallet-auth/src` and
`apps/wallet-desktop/native` under the same root. A hoisted npm installation
alone does not prove this addon is available. No module/provider/path override
is accepted. Native activation, actual Source registration, matching App
installation and real login/recovery/revocation remain separate acceptance
conditions; this API does not remove them.
