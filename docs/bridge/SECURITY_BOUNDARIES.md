# Bridge Security Boundaries

- Wallet owns account keys, quote review, user approval, and source signature.
- App Gateway must own product registration, device challenge, scoped session, expiry, revocation, and introspection before consumer mutations are integrated.
- Bridge coordinator owns source-event uniqueness, attestation quorum, lifecycle, limits, pause state, audit, and reconciliation records.
- Relayers may attest source evidence only; they do not receive user keys or unrestricted destination authority from this service.
- Destination contract/provider owns any future mint or release execution. No such authority is configured now.
- Explorer and Monitor consume read-only evidence. Trust consumes evidence references for dispute/appeal without asset authority.
- Browser, Pay, DEX, Exchange UI, Finance, AI, and other consumers never receive Bridge service or provider secrets.

The current Bridge API key is an operator-service boundary, not a substitute for canonical Wallet/Auth/Gateway. Public deployment remains prohibited until exact Gateway scopes and product/device/session vectors are centrally accepted.
