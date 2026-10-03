# Moments and original combined-authority integration

Status: PROGRESS, not Social acceptance or permission to deploy.

Owner source: b08fb0040140adc11401be9da53298f9c9106613
Tree: 8c861094af866b5d3d544170bc478199b533fafc
Parent: fd7c5f1ddef6b5d46e4272fc743d9fca51e2feba
Branch: codex/social-wallet-chooser-20261001

## Original Moments business integration

- Original feed scope/current actor guards cover creation, deletion, comments,
  reactions, reports/appeals and typed detail/readback. No scope expansion.
- Product feed uses a typed reader: actual /social/v1/feed regression exposed
  HTTP200 posts=[] on authority failure; it now preserves HTTP503 rather than
  presenting an unavailable private feed as successful emptiness.
- Comments and their current visibility are read under one original mutex.
  Feed/comment DTO conversion additionally rechecks original actor and current
  visibility before returning the result. Old content and identifiers remain.
- Public creation persists an original device/body-bound prepared marker in
  the original idempotency table before Square dispatch. The in-process Square
  effect occurs only after another outside-lock read and local actor/media/
  intent checks. No remote await occurs under the store mutex.
- Cancellation after a real local Square effect leaves the original prepared
  Social intent. A different key cannot replace that same unknown intent;
  explicit same-key/body settlement does not repeat the Square effect.
- No new nonce database or alternate account/device authority is introduced.

## Exact newly admitted shared input

Shared commit: 6413198530fcc89abfcc44cf010ee96228475b8b
Shared tree: f70c782e828b81b5aea955c6481edd079176e88c
Full archive bytes: 2809532; members: 916.
Archive SHA256: 848e72b75837e7566a0392e85bfb570035f98113e295a4821ac1d733e01f596e.
Manifest SHA256: 7f978142e5f481936e513cf1ed2093fd2a312d888d9868f7ff471c50d19e0e3c.
All 949 manifest entries were actually checked for exact bytes/SHA256.
Root source-admission SHA256:
a364aead7588526f2e88a68767ed4bf9e90776e139a2904e0230fcdff266d344.
Root decision is EXACT_COMPLETE_SOURCE_ADMISSION_ONLY, not runtime acceptance.

The complete source was unpacked into /tmp/social-combined641.HJBz0K. Consumer
validation copied the earlier owned stage, then overlaid the complete matching
productsessionv2/accountaddress plus referenced go.mod/go.sum in the isolated
consumer directory. The actual owner shared files and dirty module files were
not overwritten. No Node/registry/Host/issuer/production files were changed.

## Owned combined adapter

ProductBrowserSessionRevalidator is compile-matched to the actual accepted
RegisteredClientSet.RevalidateBrowser contract: original caller context, full
original Session, original BrowserSSO and sealed binding, fixed route scopes.
The original registered authority can implement it; an explicit config port
also exists. A single endpoint or sequential private/browser reads cannot
substitute for this combined interface.

Actual owner Origin/CSRF/family checks happen before the combined decision.
Only local BrowserSSO.Binding/header/full-grant equality checks follow it; no
second remote browser read can rescue a later private revocation. Full session
and original expiry remain checked, and the local write lock verifies the exact
captured original product binding so a replacement family cannot rescue an old
request. Missing combined reader/BrowserSSO/sealed binding remains exact503
SOCIAL_JOINT_CURRENT_AUTHORITY_REQUIRED, not an invented successful grant.

The adapter is NOT an action proof or local nonce/effect implementation, and is
NOT a claim of distributed revocation/write locking. Optional-reader legacy
behavior remains compatibility only, never canonical current readiness.

## Actual validation

- Ten original-store Moment/report operations reject authority503 without a
  business-state mutation; reads occur outside the original mutex.
- Actual public Square effect -> original caller cancellation -> prepared
  Social intent -> explicit same-key retry: no duplicate Square bytes/effect.
- Mounted original /social/v1/feed retains authority503.
- Mounted original settings rejects a binding replacement after current read,
  with no settings mutation.
- Full final Social/daemon race run: 15.099s / 3.174s, PASS.
- Final ynx-sociald build: exit0, network disabled, readonly modules.
- Actual matching shared regression with the complete reviewed Central source:
  CombinedAuthorityRealHTTP, RevalidationRealNodeAfterAwait,
  RevalidationResponseFailClosed and RegisteredClientsRejectDuplicateOrMismatchedReaders
  PASS, 11.217s. Raw shared-matching.log is retained, not a reused receipt.
- Whitespace check: PASS.

These use original local stores/software test keys and isolated matching
protected Node HTTP fixtures. Shared AI/Mail combined success/revoke/cancel
cases are not Social public or installed success. Social's complete protected
web combined-family end-to-end still needs its real original registration and
runtime. No user private keys or credentials were collected.

## Full remaining goal

Protected production combined producer/configuration and actual service mount
remain unknown/HOLD. Generic original ActionProof/nonce atomic business effect
is still incomplete; preparation markers do not replace it. Real historical
Matrix HS/directory/observer, installed/public formal baseline and cross-node
device continuity remain unverified. Local AI filtering and remaining complete
product capabilities still need actual implementation/runtime evidence.
MONSTER/dot remains NOT_RUN. C01-C07/V01-V17 are not reduced to this source and
test checkpoint. No deploy, account request, real sign or transaction occurred.

Only coordinator: 01a094cc-0ba3-7901-bcd5-56fce8330c0d.
