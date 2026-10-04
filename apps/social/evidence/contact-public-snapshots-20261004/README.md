# Public contact request result isolation

Base source: 093d90dcff15b81ea96a4ed76bcdb9025303730a.
Owner branch: codex/social-wallet-chooser-20261001.

This successor addresses the independently reported mutable timestamp aliases
across public ContactRequest result paths. A neutral copy function owns separate
ExpiresAt and ClosedAt values. Creation, pending pair coalescing, terminal
transition/replay and export now use it. Existing exact-key and list views use
the same function through contactRequestAt. Expiry/status, consent, authority,
idempotency, persistence, rollback and notification rules are unchanged.

## Controlled regression evidence

The new test uses the existing Go business fixtures and actual Service methods.
It mutates returned timestamp pointers and checks that the stored state digest
does not change. Six pending request paths and nine terminal action/path pairs
are exercised. Before the repair, 13 of these 15 cases failed; exact-key replay
and list paths were already isolated. Original failure output is retained in
original-tests.txt, and actual exits are retained in status.txt.

The full internal/social suite with race detection passed after the repair:
exit 0, package duration 17.794s, captured in full-social-race.txt.

Command:

```sh
go test -overlay /tmp/social-shared-revalidator-20261004.80Jdi2/overlay.json ./internal/social -count=1 -race
```

The read-only overlay supplies inherited productsessions declarations from
shared source c5e4178bb548baa05f552e8e1bc0f566ddc6f72d. Its durable source carrier
and reconstruction inputs remain in the adjacent
moment-delete-cold-recovery-20261004 evidence directory. No Social tests were
replaced or excluded. This is a source composition for QA, not shared runtime
admission or a deployment.

## Boundaries

The previous whole-source HOLD and original failures remain historical evidence.
This candidate requires the controller's independent review. It proves only
ContactRequest timestamp result isolation, not immutability of every other
Export field, HTTP attack resistance, installed UI, real user consent, Wallet
lifecycle, public source binding or completion of Social v2 / crypto649.
No deployment, real account request, signing or transaction was performed.
Unrelated inherited untracked caches, staging paths and APKs remain untouched.
