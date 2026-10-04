# Owned Card TEST composition and actual QA build

Development autonomy instructions and exact product/shared lock JSON were fully read. Product-specific main/startup/storage/backend/frontend development no longer waits for A approval. Shared authority/registry/current trust and formal Host remain single-writer; this is a real input boundary, not an ordinary-development permission gate.

## Actual existing product composition retained

Current source includes original pinned main -> prepareOriginalCardRuntime before key/Store -> wrapped existing Wallet authenticate/approve before+after await -> captured Store fence at read/transaction/claim/pre-COMMIT -> rollback and cold encrypted records. Constructor/startup/close key copies have lifetime cleanup. Existing registration/TEST top-up/simulated merchant/control/statement APIs and original-key recovery UI/journal remain, as do latest04d Testnet/local-demo labels and18ff typography. No old210a package overwrote current source.

## New concentrated full-source consumer regressions

server/protectedBusinessComposition.test.ts:3/3 passed. Uses actual CardService, original CardStore/SQLite/schema/encryption, prepareOriginalCardRuntime and wrapped Wallet methods. Covers TEST application/approval/card zero-balance -> exact funding intent -> explicit software Core receipt -> simulated authorization -> controls -> source refusal -> cold same-owner statement and different-owner isolation. Two additional cases refuse ledger credit/intent consumption when source becomes unavailable after asynchronous Core verification, and refuse card creation after asynchronous Wallet approval.

Only disposable fixture keys, dedicated temp SQLite and explicitly software approval/Core data are used. The positive fixture fence is not assigned to production originalCardRuntimeInputs.current or claimed as a genuine source producer. No user keys, grants, account/sign/transaction or upstream funding. These tests are product-composition evidence, not real Wallet/chain evidence. Frontend/server compiler-only typecheck passed after adding this batch. Old green suites not rerun.

## Actually built and personally opened

Isolated mode0700 build root: /private/tmp/ynx-card-owned-composition-20261004.uPs8Ms. Sparse shared Git clone checked out exact04d449cfadff75d1f629fb410201e2b75ce7b11c/treef1d0acbc85bf973b23f404c084ff37a81a4b0524, with existing Card dependencies linked. No dependency install or source rewrite. Initial build refused the untracked dependency symlink; failure retained. Local Git exclusion of that dependency link (not tracked product source) fixed staging. Original npm run build:web succeeded offline with releaseChannel=qa. Original worktree .gitignore/dist-web preserved.

13 Web artifacts and exact hashes in owned-qa-build-manifest-20261004.json. Build retains existing7f9/e95 compatibility mapping; this is not an admitted new backend/frontend tuple. QA title/badge visibly says not the formal release.

Owned backend main static bundle also built with20 product inputs and15 external imports, packages external:281855 bytes/SHAce95f4fd6dccb60fe349c4ca69b5e9bb951a2170eb65d8455c0ca4ac30adc98f. Receipt owned-backend-qa-build-20261004.json records imports. SDK and backend main were not executed; external dependencies and the original pinned adapter/source-current remain required. No claim the bundle is a standalone deployed protected runtime.

Real Chrome opened temporary127.0.0.1:43871 QA only: English first-render for this fresh QA origin, YNX TESTNET versus LOCAL DEMO, six navigation entries and no fabricated account/balance. Try demo recorded one local demo event; reload then Activity preserved1/1. Private Service Degraded was visible while Guest remained usable. Screenshot125828 bytes/SHA67c69f07e997850d3c93bfd832c2ad465f2ac3c660ad12283d0cc02b229efb8f, owned-qa-guest-cold-recovery-20261004.png. No real Standard Wallet connected; cannot prove its degradation independence from this Guest observation. No sensitive buttons clicked. Temporary static server stopped and QA tab closed; original public Card tab retained. No formal public mutation.

## Exact minimal shared input, not whole-product waiting

1. apps/card/server/protectedStartup.ts: originalCardRuntimeInputs.current: (() => void) | null. A's genuine source/custody/role-current producer must supply a captured synchronous local fence; absent/revoked must throw typed503. Current production remainsnull. No ENV bool, public marker, provider connection, fixture callback or permissive no-op can replace authority. Owner implements consumer/lifecycle, not a new trust issuer.
2. apps/card/server/sharedWalletAuth.ts: original pinned WalletAuthority authenticate/approve input and canonical private actor/session contract; shared SDK/root and packages/wallet-auth/product-session-registry.json authority remain single-writer. Preserve original ynx-card-v1/com.ynxweb4.card, callback,180s and original scopes; no new grant from account:read.
3. apps/card/card-source-compatibility.json plus build/runtime identity: actual admitted frontend/backend source pair bound to the built artifacts and deployed backend /version. Owner can prepare builds; don't relabel existing7f9/e95 or fabricate backend source readback. Formal Host publisher consumes that exact supplied tuple under its existing authority.

No larger Card directory/main approval request. Full goal remains direct public/installed TEST registration/activation, real YNX/MetaMask user approval, actual YNXT tx accepted by Card API, simulation lifecycle/statements/recovery. Real producer, role/actor, public source pair, Host, genuine Wallet/chain evidence remain unproven. Live/real card/PAN/CVV/fiat/real merchant clearing/AICardAPI/migratedV2 false. Source composition, tests, build, local visible QA and actual user/public completion are separate gates.
