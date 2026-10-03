# Card Hosted application consumer: source and local QA, not product completion

Source: `a392d7cc8ccea0f678fb77c5b3c181c2340c807c`
Tree: `7af9cdb03b9c6eb5edaf1e27ab2b4b3f0dca4ce5`
Branch: `codex/card-test-service-recovery-20261002`
Owner worktree: `/Users/huangjiahao/.codex/worktrees/f41f/YNX Chain`
Starting head: `83a9e8b62514be80fbcc2328bd35dae3983a61b3`
Manifest: `apps/card/evidence/20261003-hosted-card-consumer/manifest.json`, 10543 bytes, SHA256 `60e750ad7e183961a3225df41311be1fff2b83700dd7bd5c556ee4365f7ca09f`.

## Actual owned implementation

- Exact Wallet-owned SDK mirror26269B/d42e9cea and matching types1276B/1caf6e97, immutable9555 overlay/sourceRoot d7073a63; B review16a488fb is source admission only. Four canonical modules in the retained root package are byte-identical to the candidate package. No npm-public, signer implementation, SDK/registry/Gateway or Host mutation.
- App passes its actual connected Hosted controller through Guest to both private TEST application surfaces. A normal standard connection or stored hint is not a Card private permission.
- Negotiated capability required; synchronous user-gesture reserve precedes journal/backend awaits. The selected approved EVM account must map exactly to the current native/private owner. Selection epoch and current private/device-session binding are fenced around awaits.
- Backend-prepared full request, exact canonical URL, owner/context/account/operation IDs and original record binding are durable before RPC. HTTP proofs still come from the existing fixed-origin, exact-source Card clients; no e95 authority relaxation or new scopes.
- SDK RPC carrier kind/version and accepted root callback verifier must match the exact pending request. Approved and unsigned USER_REJECTED are recorded before backend acceptance. Timeout/closed/context loss cannot produce approval, card or balance.
- Cold recovery verifies stored terminal results and rereads the original backend record; it does not launch Wallet, sign, or automatically submit card creation. Historical private-session records are retained, never treated as a current grant. A new session needs explicit fresh review.
- Provider V2 explicitly accepts the verified return then offers separate Submit. Core V1 explicitly creates a private draft, prepares a challenge, reviews the exact application and separately submits its verified proof. Submit rereads original fields/challenge/status and uses the original operation key. Only backend receipt/state can indicate ACTIVE.
- Core create stores original body/key before POST. Unknown results remain unknown on reload or similar read-only records. Exact retry is a separate user action with fresh readback and the immutable original key/body; edited/new intent is separate and keeps the previous unknown request. No automatic POST on cold start.
- Bounded machine failure codes replace arbitrary developer text in failure journals. Card/private errors do not clear the standard connection.
- Text-size controls have named/described radiogroup, explicit checked values, one tab stop, arrow/Home/End selection and focus. Native checked semantics and OS text scaling remain. Three focused a11y tests and actual IAB desktop/mobile keyboard evidence are present.

## Executed evidence

- `npm test`:335/335, zero failure/skip; source273, existing UI39, Guest/Core/a11y12, native patch11. Final focused consumer/controller19 overlap these totals, not nineteen additional cases.
- `npm run test:backend`:107/107, zero failure/skip. Backend source was unchanged; this is contract/QA regression, not a deployed receipt.
- Client and server typechecks passed. Canonical V1/V2 approve/reject fixtures use a documented deterministic public QA scalar and fixed fixture time only. No real user key/account/password/signature or transaction was requested.
- Real IAB local1440/390: English visible text without CJK at first load, named radio semantics and keyboard focus, Guest service and application entry, no-account denial, separate YNX/MetaMask branding/options, chooser tab delta0, URL stable, console errors0.
- Local screenshots witness589a368c; six UI blobs are identical in the final source. Callback/account hardening is source-tested, not falsely presented as a real private browser flow. No fake account/session/backend receipt was injected into a browser.
- React VM fixtures normalize cross-realm plain input objects only. Existing read-only Guest tests isolate the new Core component; separate tests render and exercise the actual Core component and timeout/retry flow.
- Own temporary preview processes and tabs stopped; browser viewport restored. No dist-web, original ignore file, account data, unknown receipt or other-owner path was cleaned or overwritten.

## Executable A/Root intake

A remains the sole formal build/Host/release executor. Adopt this exact Card source, the source-admitted9555 Hosted Wallet, and the matching TEST backend under current authority. Do not reuse August single-use leases. Use the existing Card project/canonical domain, not a second Card or Website redesign. Formal build/version/asset/HTTP hashes must be bound to the actual published source.

First verify real negotiated support at the canonical Card origin and the matching exact backend source/health; old deployed Wallet/hint-only must fail before Card review mutation. Then prepare a test-account flow to the user-confirmation boundary: standard connection, distinct provider,0x1917, separate private/session permission, exact application/terms/limit review. Obtain immediate confirmation before account exposure/approval/signing or transaction. Do not collect a private key or type a Wallet password. Verify approved/rejected return, current backend record, explicit Submit, original-key unknown retry, cold recovery, account/device/context changes and standard/private independence on the actual published runtime.

## Remaining truth

No formal build or deployment was run here. Public/installed runtime, real approval/private grant/signature, real backend application acceptance/ACTIVE, real YNXT transaction/top-up, provider funding, Product Session migration, ComputerControl and product completion remain false. Native/Pair/installed lifecycle is not promoted by Hosted Web source; the Core Native approval path intentionally remains unavailable. Historical revocation is not inferred from transport closure; current backend session/device/challenge authority remains mandatory.

Real bank card/PAN/CVV/fiat/card-network settlement/merchant payments remain false. Public Guest facts from prior releases are preserved, not replaced with this candidate's source-only facts.

GitHub remote reports285 default-branch dependency advisories (1critical/212high/66moderate/6low). This is not a Card-scoped dependency audit or a license/security-release clearance; pass that warning to the relevant release/security owner rather than claiming this source resolves it.
