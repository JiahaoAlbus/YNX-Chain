# YNX Card Open Questions

These questions do not block autonomous local engineering unless explicitly
stated.

1. Which official issuer sandbox best satisfies the frozen capability contract,
   permitted jurisdictions, secure display, webhook integrity, lifecycle and
   dispute requirements? Owner: `06-card`; next step is provider bake-off before
   requesting credentials.
2. Will `02-wallet-auth` accept the exact Card registry tuple, ordered scopes and
   Gateway assertion domain without a compatibility variant? Owner:
   `02-wallet-auth`; Card remains fail closed meanwhile.
3. What canonical Card event names and envelope will `26-data-fabric` freeze?
   Owner: `26-data-fabric`; no settlement or revenue facts are emitted meanwhile.
4. What opaque evidence fields and status mapping will `15-trust-center` accept
   for Card disputes? Owner: `15-trust-center`; sensitive card data is forbidden.
5. Which secure runner and signing identities will `30-security-sre` authorize
   after unsigned builds, install evidence and security gates pass? Owner:
   Founder/Security-SRE; no keys are requested in chat.
6. Which staging/public host and `/card` route will be assigned after shared
   Testnet acceptance? Owners: `28-website` and `29-integration`; deployment flags
   remain false.
7. Which jurisdictions and issuer program determine the final PCI, KYC/AML,
   sanctions, consumer-disclosure and retention review scope? Owners:
   Founder/18-docs-compliance; no legal approval is claimed.
