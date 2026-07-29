# Chain Core Website Handoff

Status: source-complete handoff; ynxweb4.com publication is externally blocked.

This package gives the Website owner an evidence-bound information architecture for
YNX Chain Core. It does not claim that the target routes are deployed. Public copy
must preserve the Testnet, source-candidate and StreamBFT shadow boundaries in
`release/public-product-metadata.json`.

## Route and source map

| Target route | Purpose | Authoritative product sources |
| --- | --- | --- |
| `/chain` | Product overview and network identity | `README.md`, `release/public-product-metadata.json`, `FEATURE_COMPLETION_EVIDENCE.md` |
| `/chain/manual` | Node, recovery and Testnet operations | `docs/deployment/TESTNET_DEPLOYMENT_GUIDE.md`, `docs/operations/OPERATIONS_RUNBOOK.md`, `docs/testnet/TESTNET_STATUS.md` |
| `/chain/developers` | Developer quickstarts and SDK entry points | `docs/developers/GETTING_STARTED.md`, `docs/developers/QUICKSTART_HARDHAT.md`, `docs/developers/SDK_JS.md`, `docs/developers/SDK_PYTHON.md` |
| `/chain/api` | RPC and application API reference | `docs/api/API_REFERENCE.md`, `docs/developers/RPC_REFERENCE.md`, `release/integration/chain-core-contract.json` |
| `/chain/faq` | Product identity, limits and promotion status | `release/public-product-metadata.json`, `docs/architecture/STREAMBFT_CANDIDATE.md` |
| `/chain/security` | Threat boundaries, signing and reporting | `docs/security/SECURITY_MANUAL.md`, `docs/mainnet-readiness/SECURITY_AUDIT_PREP.md` |
| `/chain/status` | Current release and public-runtime distinction | `release/product-release.json`, `release/recovery-evidence.json`, `docs/testnet/TESTNET_STATUS.md` |
| `/chain/support` | Operator and developer escalation paths | `docs/operations/OPERATIONS_RUNBOOK.md`, repository Issues |

## Required experience

The Website implementation must provide global search and a command palette across
the eight routes. Every network-backed surface must define loading, empty, error and
recovery states. Navigation, tables, code blocks and status panels must remain usable
on mobile, in dark mode, in RTL locales and with keyboard/screen-reader navigation.
WCAG 2.2 AA is the acceptance floor.

## Claim and evidence rules

- Display `YNX Testnet`, Chain ID `6423` / `0x1917` and native asset `YNXT`
  exactly as recorded.
- Describe StreamBFT as a local, tested shadow candidate. Never describe it as the
  authoritative public consensus or as Mainnet.
- Keep local implementation, central integration, staging, public deployment,
  production signing and independent proof as separate visible states.
- Link source evidence to immutable GitHub commit `72e7890b79e3`; a later Website
  integration may update that identity only after rerunning the Chain Core release
  gate.
- Do not expose node keys, API credentials, signer material, private endpoints or
  unredacted operational evidence.

## Acceptance and external handoff

Product acceptance is complete when `make chain-core-release-check`, `make
streambft-candidate-check`, static checks and the Chain Core GitHub Actions workflow
pass for the handoff commit. Website acceptance remains external until the Website
owner imports the metadata, implements the routes, passes responsive/dark/RTL/a11y
checks, deploys through Vercel and returns the production deployment URL, deployment
SHA and anonymous public probes for ynxweb4.com.
