# Normal Nym qualification consumer

Normal `NymModeRouteFactory.make` and `NymProtectedRouteProvider.performStart`
validate identity operands, then call the real retained
`BrowserRouteProtection.requireBackendStartupQualification(mode: .nym)`.
The provider adopts a newly constructed normal owner before checking it; the
same owner remains responsible for subsequent preparation and cleanup. These
checks precede supply/profile reads, Root preparation and child creation.

`preflight(team:identifier:helperSHA256:)` remains only the existing unqualified
diagnostic fixture. No actual normal factory/start call uses it. Passing
`validateIdentityInputs` supplies neither an owner nor admission. The synthetic
epoch/canary branch is unchanged and cannot satisfy the normal method.

Qualification failures retain their original typed first cause and stage.
Missing issuer becomes `qualificationNotSupplied`; expired, revoked, closed or
changed-installation qualification becomes `qualificationLost`. Signing, mode,
signature and helper failures keep their specific identity diagnostics. They
are not backend, control-plane DNS or search-site failures. Search/CAPTCHA does
not participate in this intake.

The actual original issuer boundary remains blocked:

* `RoutedProductionQualification.acquireCurrent` has actual installation intake,
  but no authenticated original release-owner issuer/current/revocation callee.
  A signed app, RootDeny or JSON does not supply it.

The successor `NORMAL_PROOF_CHILD_CONTRACT.md` documents the now implemented
normal parent/child scope consumer. The legacy no-scope entry still refuses,
while the new entry requires the separate real signed-Provider child authority.
This does not implement or replace the original production release issuer.

New local regression (13 exact source-extracted DATA callee checks, no full
Core/Native rebuild, keys, sockets, vendor or qualified positive):

```sh
/usr/bin/python3 apps/browser/privacy-routing/nym/tests/test_qualification_consumer_delta.py \
  --output /absolute/dedicated/external/evidence
```

It verifies three malformed identity operands, one syntactically valid operand
set that grants no capability, and all nine qualification-error mappings.
Separate source readback confirms normal caller wiring and retained ownership;
that readback is not runtime qualification. The driver preserves logs, exact
source/excerpt hashes and drift results in a fresh output directory.

The existing CI `test-synthetic-nym.sh` copies this new check file and its default
probe invokes the 13 checks once. `--qualification-delta` selects only this group
when full current-source compilation is independently permitted. The existing
31 journal/capture, startup, cleanup, Mixnet HTTPS and CAPTCHA tests were not
repeated for this change. Integration21 remains proof for its frozen prior
source; it is not transferred to this successor.
