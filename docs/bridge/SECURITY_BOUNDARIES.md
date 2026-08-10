# Bridge Security Boundaries

- Wallet owns account keys, quote review, user approval, and source signature.
- App Gateway must own product registration, device challenge, scoped session, expiry, revocation, and introspection before consumer mutations are integrated.
- Bridge coordinator owns source-event uniqueness, attestation quorum, lifecycle, limits, pause state, audit, and reconciliation records.
- Relayers may attest source evidence only; they do not receive user keys or unrestricted destination authority from this service.
- Relayer public keys are startup trust roots. Every persisted signature is reverified against the currently configured key and its audit record; silently replacing a key invalidates startup rather than rewriting historical trust.
- Destination contract/provider owns any future mint or release execution. No such authority is configured now.
- Explorer and Monitor consume read-only evidence. Trust consumes evidence references for dispute/appeal without asset authority.
- Browser, Pay, DEX, Exchange UI, Finance, AI, and other consumers never receive Bridge service or provider secrets.

The Bridge operator API key, App Gateway upstream key, and Quote HMAC seal key are distinct server-side credentials. The seal key authenticates the complete expiring quote envelope across Provider fee changes and restarts; it never signs a user transaction and must remain stable across a deployment while issued quotes are valid. None is a substitute for canonical Wallet/Auth/Gateway, and none may reach a browser or consumer. Public deployment remains prohibited until exact Gateway scopes and product/device/session vectors are centrally accepted.

The coordinator stores no relayer private key. HSM/MPC-backed signing can therefore remain outside the process, but no production device, ceremony, guardian set, key-version registry, rotation, or recovery evidence exists. Follow `RELAYER_KEY_LIFECYCLE.md`; ordinary config replacement is not a safe rotation mechanism.
