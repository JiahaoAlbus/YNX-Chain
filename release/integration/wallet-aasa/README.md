# Wallet AASA Website handoff

This package refuses to generate or approve an Apple App Site Association file until all of the following are direct inputs:

- a real ten-character `APPLE_TEAM_ID` (never `FAKETEAMID`);
- `WALLET_BUNDLE_ID=com.ynxweb4.wallet`, matching the signed application;
- `YNX_ASSOCIATED_DOMAIN_FROZEN=true`;
- `YNX_AASA_COMPONENTS_JSON`, supplied by the frozen Core protocol owner.

The Website owner should generate the file during a protected release job, place the exact stdout at `/.well-known/apple-app-site-association`, and serve it without redirects as `application/json`. The verifier rejects the current HTML SPA fallback, a substituted app ID or components, redirects, invalid JSON, and oversized bodies.

```sh
node release/integration/wallet-aasa/generate-aasa.mjs > public/.well-known/apple-app-site-association
node release/integration/wallet-aasa/verify-public-aasa.mjs https://ynxweb4.com/.well-known/apple-app-site-association
```

Do not run the redirect until the Website worktree owns the target path and the protected environment contains all four production inputs. iOS associated-domain entitlements and `InboundLinkPolicy.associatedDomainFrozen` must remain disabled until the generated public file is deployed and independently verified. This handoff does not authorize a new Auth route or claim public authorization success.
