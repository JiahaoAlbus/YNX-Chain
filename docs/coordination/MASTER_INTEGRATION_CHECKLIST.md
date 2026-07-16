# Master Integration Checklist

The main Codex task is the only integration authority for parallel ecosystem
branches. A pushed branch or attractive screenshot is not acceptance.

## Intake

- Confirm the branch starts from the declared baseline or document every rebase.
- Read the unique `docs/handoffs/<product>.md` and inspect the actual diff.
- Reject edits to the long-term goal, central acceptance state, unrelated
  products, root Makefile, or central Gateway policy unless explicitly requested
  by the main task.
- Confirm generated files, credentials, local state, real `.env`, signing stores,
  PEM files, recovery keys, and test secrets are absent from Git.

## Product acceptance

- Independent package, bundle ID, routing, icon treatment, permissions, and
  least-privilege client identity.
- Complete primary workflow with loading, empty, failure, retry, authorization,
  privacy, recovery, audit, and destructive-action confirmation states.
- Product-specific AI workflow is complete from bounded context consent through
  provider status, streaming/cancel, result review, apply/reject, audit, retry and
  failure. A generic assistant panel alone does not satisfy this gate.
- Real persistence and deterministic restart behavior.
- Strict request/response parsing, input bounds, authorization, idempotency,
  replay rejection, rate/abuse controls, and tamper tests.
- No wallet-address friend discovery, recovery-key sharing, arbitrary callback,
  broad cross-product session, synthetic chain/market/user claims, nonfunctional
  feature shells, or silent unsupported state.
- Klein blue and white are the shared foundation, but navigation and interaction
  fit the product and platform rather than copying the website or another App.
- Accessibility labels, dynamic text, keyboard/focus behavior, reduced motion,
  contrast, safe areas, and mobile/desktop responsive constraints are verified.

## Chain integration

- Chain identity is exactly `ynx_6423-1` / `6423` / `YNXT`.
- Native addresses default to `ynx1...`; `0x...` appears only in an explicit EVM
  compatibility context.
- Sign in with YNX Wallet exposes no account secret to the product and binds the
  account signature to exact product device, client, callback, scopes and expiry.
- Cross-product actions are signed intents with explicit user review, never hidden
  navigation or a shared unrestricted token.
- AI Gateway scopes are product-specific; provider secrets remain server-side;
  selected context is visible; AI cannot bypass Wallet signatures, human review,
  Trust evidence, transaction confirmation or product authorization.
- Paid/committed/final states derive from authoritative chain evidence.
- Explorer and public metrics derive from live RPC/Indexer sources.

## Verification

- Run product unit, integration, parser, persistence, restart, replay, tamper,
  authorization, accessibility and smoke checks.
- Run `go test ./...` for any Go change and the applicable repository checks.
- Build exact platform artifacts where a product claim requires them.
- Install and cold-launch mobile/desktop artifacts when feasible; inspect logs,
  accessibility state, deep links and recovery behavior.
- Use Playwright and screenshots for Web products at desktop and mobile widths.
- Run `make test`, `make no-placeholder-check`, `make secret-scan`,
  `make env-check`, `GOMAXPROCS=2 make preflight`, and
  `make objective-state-check` before an integrated release.

## Deployment and claims

- Deploy only exact committed source with checksum, backup, rollback and health
  evidence. Do not disturb the authoritative chain during product deployment.
- Verify public TLS separately from loopback/SSH checks. Operator-controlled
  evidence is not independent proof.
- Keep mainnet, production signing, store acceptance, listing, wallet-default,
  stablecoin issuer, partnership and independent-proof fields false without
  external evidence.
- Update API docs only after real handlers exist. Update acceptance state only
  after matching tests and deployment/package evidence exists.

## Merge record

For every accepted branch record:

- source branch and commit;
- reviewed diff and rejected portions;
- integrated commit;
- test commands and results;
- package/deployment release and hashes;
- remote/public/independent proof classification;
- remaining blockers and next real gap.

## Candidate intake queue

Intake review is not acceptance, merge, deployment, or public proof. Dependency
order still applies, and no candidate below has been merged into `main`.

| Product | Source | Intake result | Integration gate |
| --- | --- | --- | --- |
| AI | `codex/ecosystem-ai` at `5d8ff21f6b7999a441754e0c30b4b2ae9ef0b0bf` | Owned-path and handoff review passed; branch is queued | Wait for Wallet; replace prompt-bearing GET streaming with reviewed POST-body Gateway transport before public use |
| Music | `codex/ecosystem-music` at `74f315e368658aa0db3528b737f8c8b53fee75f7` | Owned-path and handoff review passed; branch is queued | Wait for Wallet, AI, Pay, Trust, and product-scoped Gateway contracts |
| Cloud / Docs | `codex/ecosystem-cloud-docs` at `82e095e4c545c38df74c6bf2a7cfa8aae719d111` | Owned-path and handoff review passed; branch is queued | Wait for Wallet, AI, Trust, storage/deployment review, and product-scoped Gateway contracts |
| Browser / Search | `codex/ecosystem-browser-search` at `7878c79557b30195a2deab87a72ccfa314442875` | Owned-path and handoff review passed; branch is queued | Wait for Wallet, AI, Trust, privacy review, and real search/provider contracts |
| Shop | `codex/ecosystem-shop` at `a3aa37007a55736496f811faccae8fae7e5bfdf2` | Isolated Go race, buyer/seller UI test/build, no-placeholder, secret, env, and diff checks pass; branch is queued from older baseline `271197feb48fd362292fb2210887edf3109ce4f7` | Replace plaintext-persisted temporary bearer sessions with the reviewed central Wallet/Gateway protocol; integrate real Pay, AI, Trust and deployment contracts before merge or public use |
| Wallet Auth / Wallet | `codex/ecosystem-wallet-auth` at `51cf0da1fb30ee1c1a093a1ec8f43d544e54d061` | Corrected candidate passed owned-path review, protocol 17/17, App 13/13, type, product, dependency audit, artifact-hash, and secret checks. P-256 algorithm/key, exact scope/expiry/schema binding, Wallet approval verification, Android Keystore Gateway proof, and persistent replay rejection are now accepted for integration queueing | Replay onto current main, implement the exact central registry/Gateway verifier, and migrate Social plus dependent products to the canonical envelope. Production signing, native iOS build, physical-device proof, external audit, deployment, and public proof remain later gates |
| Social | `codex/ecosystem-social` at `7f034342be9ed5eab3765c42238b22fb66673205` | Owned-path review, isolated Social Go race, App type, 8/8 client tests, and secret scan pass; branch is queued from baseline `b281376eac6fe3cf1ffa8c4b5a44e3546302791f` | Replace `com.ynx.social` plus legacy query-field Wallet authorization with the accepted Wallet Auth registry identity and canonical envelope; then integrate central Chat/Square/AI, resolve dependency findings, package and deploy |
| Pay | `codex/ecosystem-pay` at `fd5016b6e0a2aee8eed1201a726366806abf2503` | Owned-path review, isolated Pay Go race, merchant test/build, consumer type/2 tests, and secret scan pass; branch is queued from older baseline `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` | Replace the temporary Wallet adapter with central Wallet Auth; integrate exact central Pay/AI/Trust contracts, resolve dependency findings, deploy, and prove one real committed testnet payment/refund lifecycle |
| Exchange | `codex/ecosystem-exchange` at `ee1c3f41656be403633d01468ec79af702deb7bf` | Owned-path review, isolated Exchange Go race, UI 5/5, smoke, and secret checks pass; branch is queued from older baseline `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` | Integrate central Wallet Auth and audited custody/indexer controls; keep `YUSD_TEST` non-token and withdrawal broadcast/cross-chain unavailable until real adapters, approvals, deployment, and proof exist |
| Trust Center / Resource Market | `codex/ecosystem-trust-resource` at `ae210bffbcd6d8c80de2615b46f4edcc8d5b3974` | Owned-path review, isolated race tests for both services and both UI contracts, plus secret scan pass; branch is queued from older baseline `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` | Integrate central Wallet/Gateway and authoritative Trust/Resource APIs; replace prompt-bearing AI GET queries with reviewed POST transport, add HA storage/deployment, and preserve no-native-YNXT-control/no-settlement claims |
| Explorer / Monitor | `codex/ecosystem-explorer-monitor` at `2e5ef561c5ae782b9e5dfaff0ca5a013df390423` | Owned-path review, isolated Explorer 5/5 and Monitor 6/6 tests, both builds, and secret scan pass; branch is queued from older baseline `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` | Upgrade and re-audit the Vite dependency with current high-severity advisories; then integrate exact live RPC/Indexer/Explorer sources, protected Monitor auth/logging, deployment, SSE and public/operator proof |
| Developer | `codex/ecosystem-developer` at `5dddb2ac827da01051e83424e660335002ba9f6c` | Owned-path review, isolated client 13/13, Web 5/5, desktop sandbox 2/2, static and secret checks pass; branch is queued from older baseline `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` | Integrate real Wallet-only provider and POST-body AI Gateway, deploy Web/source verification, then produce owner-signed macOS/Windows packages; local ad-hoc macOS output is not a release |
| Mail / Calendar | `codex/ecosystem-mail-calendar` at `1288cae4999bcf82799c43c820b8974ed469e4ca` | Owned-path review, isolated Mail/Calendar Go race, 3/3 UI tests and smoke for each, plus secret scan pass; branch is queued from older baseline `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` | Integrate separate Wallet/Gateway identities, AI and delivery/provider contracts; complete Mail E2EE/storage review, package/deploy, and preserve no internet-mail/no production-scheduling claims |
| Finance | `codex/ecosystem-finance` at `06868310ed4f03abe2e84d4f3a69c0a65101cb10` | Owned-path review, isolated Finance Go race, UI 3/3, smoke, and secret checks pass; branch is queued from older baseline `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` | Integrate central Wallet/Pay/AI and exact live sources, deploy, and preserve the non-bank/non-custody/no-yield boundary |
| Video / Creator Studio | `codex/ecosystem-video` at `8dc10dcbc047299c8d322be7d9431fc5325b9416` | Owned-path review, isolated Video Go race, viewer/studio checks and smoke, plus secret scan pass; branch is queued from older baseline `51bed843c5aa8dc53b2dc32b29cb8ca349ff0e95` | Integrate Wallet/AI/Trust/Pay, production scanner/transcoder/object storage and deployment; do not claim licensed catalog, monetization, public durability or creator payouts |
