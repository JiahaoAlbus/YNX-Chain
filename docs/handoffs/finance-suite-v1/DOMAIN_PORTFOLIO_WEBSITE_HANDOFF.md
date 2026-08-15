# Finance domain portfolio website handoff v1

## Purpose

This versioned handoff lets the central Website/Integration owner expose the
authenticated Finance portfolio facts without copying or recomputing balances
in the website. Finance remains the source owner and remains non-custodial.

## Public product entry

- Canonical product URL: `https://finance.ynxweb4.com/`
- Health endpoint: `https://finance.ynxweb4.com/health`
- Product contract: `release/integration/finance-suite-domain-contract-v1.json`
- Finance domain endpoint: `GET /v1/domain/portfolio`
- Authentication: canonical Wallet product-session proof in
  `X-YNX-Product-Session-Proof`, scoped to `finance.portfolio.read`

The central site may link to the canonical product URL for signed-out browsing.
It must not proxy account data, request a seed phrase, manufacture a portfolio,
or treat the public landing page as an authenticated portfolio view.

## Endpoint response contract

`/v1/domain/portfolio` returns `ynx-finance-domain-v1` with:

- source provenance: owner, system, release version, observation time,
  classification and truthful source status;
- account-bound `Portfolio` identifier and YNXT valuation asset;
- available/staked/total YNXT values encoded as integer decimal strings;
- no custody capability, signing request, private key, seed phrase, or write
  operation.

Source status is deliberately truthful: `live`, `partial`, `stale`, or
`unavailable`. Consumers must preserve it and must not infer fiat valuation,
yield, completeness, or performance from an available balance.

## Central integration requirements

1. Register the product link only after `/health` and `/version` identify the
   deployed Finance release being promoted.
2. Use the canonical Wallet session flow before calling the endpoint; never
   persist the proof in Website storage or logs.
3. Present an unavailable/stale/partial state exactly as returned, with a
   reconnect action that returns the user to Finance Wallet authorization.
4. Keep all authenticated navigation at `finance.ynxweb4.com`; Website has no
   delegated Finance write capability.
5. Record the deployed commit, binary SHA-256, web-tree SHA-256 and public
   probe in the central release record before marking the product public.

## Rollback

Finance deployment is release-directory based. Restore the previous verified
`/opt/ynx/releases/finance/<release>` target using
`scripts/deploy/install-finance-testnet-remote.sh`, then verify `/health`,
`/version`, the signed-out Web entry and a Wallet-authenticated portfolio read.
Do not change the Website link until the replacement release passes those
checks.
