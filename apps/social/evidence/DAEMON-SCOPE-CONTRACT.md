# Daemon scope and carrier successor

Exact approved source: shared 45de8d4f11737ccf5ee2a349be6717cb3ce77bbd,
`packages/wallet-auth/product-session-registry.json`, Social registration.

The daemon now permits exactly account:read, profile:link, social.ai,
social.contacts, social.feed, social.messaging and social.profile. Each policy
receives a fresh slice. This is the allowed maximum, not new automatic consent.
Publishing, media and follows use social.feed; social.publishing is not invented.
Daemon scoped race tests pass, including the original package tests and a
regression proving one caller cannot mutate future allowed-scope policies.

The web builder now verifies the immutable input registry tuple and exact
seven-scope registration before deleting output or building. It neither edits
source vendor nor fabricates a shared registry. The current owner snapshot has
only five Social scopes, so it is not a valid new-release carrier. Integration
owner A must supply the approved registry carrier before using this build.
The release build was not executed by the Social source owner.

This is only a finite-scope correction. The daemon still needs A's approved
shared Action verifier and confidential Revalidator, using its existing
protected backend key-file configuration and exact key-id/client tuple.
Those are not injected by this slice. No credential is created/read/exposed.
Missing authority continues to fail closed; source tests are not runtime proof.
Actual HS/RP/existing-MXID provenance and consumer-to-real-authority acceptance
remain unverified. No shared, Host, deployment or vendor-source changes.
