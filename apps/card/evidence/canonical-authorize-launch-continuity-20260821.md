# Canonical YNX Wallet authorization launch continuity

## Direct browser observation on the deployed source lineage

Before the language-only follow-up, a real browser click on **Connect YNX
Wallet** from the deployed Card source lineage opened:

```text
ynxwallet://authorize?request=<nonempty canonical payload>
```

The complete payload value is intentionally not retained in this record. Its
decoded non-sensitive contract fields were observed as:

- `version: 1`
- requesting product `ynx-card`
- client ID `ynx-card-v1`
- chain ID `ynx_6423-1`
- origin `https://card.ynxweb4.com`
- callback `ynxcard://wallet-auth/callback`
- nonempty nonce and product-device public key
- Card account/control scopes and bounded issued/expiry times

This was emitted through the accepted root canonical authorization builder, not
through a bare `ynxwallet://authorize` route or a Card-composed URI.

## Relationship to the current production source

The current deployed source is
`52550bebf202062b7bd6fc4dc7f5e7659f00a352`. Its only product-code change from
its parent is the first-run guest locale default in `apps/card/App.tsx`; it does
not modify the authorization builder, deep-link policy, or wallet runtime.
The clean verification for this exact source passed the authorization launch and
bare-route policy tests as part of the `28/28` Card test run.

## Boundaries

The current production-browser click showed the complete-authorization notice,
but this browser did not expose the external scheme target URL a second time.
This continuity observation is therefore not a claim of a new installed-wallet
approval. Approval, rejection, callback handling, cold start, and callback
recovery remain unverified and false until an installed YNX Wallet/device flow
provides those separate proofs.
