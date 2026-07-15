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
