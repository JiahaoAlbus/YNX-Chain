# Social original combined-authority mounted HTTP checkpoint

Status: LOCAL_SOURCE_REGRESSION_PASS_ONLY; not public, installed, release, or user acceptance.

Owned source: ad82b288e9e579d814426a55f7215a43016ea690
Tree: 537479e7cef90dbc6a9e01ad57b71fea2156fcdd
Parent: 4cb8637d307ce7f11695edcd9fadf3d0ff1b7e79
Branch: codex/social-wallet-chooser-20261001
Shared authority input: admitted complete source 6413198530fcc89abfcc44cf010ee96228475b8b, tree f70c782e828b81b5aea955c6481edd079176e88c.
Complete carrier SHA256: 848e72b75837e7566a0392e85bfb570035f98113e295a4821ac1d733e01f596e.

## Product fix

Original BrowserSSO.Binding reseals an unchanged authenticated grant with a fresh random AEAD nonce. Comparing sealed ciphertext strings wrongly rejected the successful combined decision. The owner adapter now compares the full authenticated grant and immutable request headers, retaining the complete original Session, original grant/family checks, fixed scopes, caller cancellation, expiry and final original local ProductBinding fence. No shared source or module locks changed.

## Direct local software-fixture checks

Actual mounted PUT /social/v1/settings invokes the original reviewed private-session and browser-family engines, RegisteredClientSet and BrowserSSO, then the Social transaction. Five cases ran (not skipped): success (200 and persisted setting), private revoke during browser read (401/no mutation), browser revoke before combined decision (401/no mutation), cancellation after decision (408/no mutation), local binding replacement after decision (401/no mutation). Each verifies one original introspection and one combined HTTP read, without proof replay.

The owner Node fixture is copied from the original reviewed driver; only fixed Social messaging/profile scopes and one profile introspection proof are added. Original driver SHA256 f8a897c559e9b8f87181245f7e96381e06edfeaffb9fdab76c99b88b797388bb; owner driver SHA256 6633d109cd695a487097cf9dfd72969492e8a4464caa2d925ab23c3b04d97b66. Accounts, consent, keys and role are isolated test fixtures. No real wallet grant, signature or transaction requested. Secrets are not retained in evidence.

Full Social race passed in 16.809 seconds. Daemon build exited zero, readonly modules and network disabled. Commands run in isolated complete-source consumer, not in the shared owner checkout:

```sh
YNX_QA_CENTRAL_SOURCE=/tmp/social-combined641.HJBz0K/source GOTOOLCHAIN=go1.25.13 GOPROXY=off GOWORK=off /opt/homebrew/bin/go test -mod=readonly -race -count=1 -v ./internal/social
GOTOOLCHAIN=go1.25.13 GOPROXY=off GOWORK=off /opt/homebrew/bin/go build -mod=readonly -o /tmp/social-combined641.HJBz0K/consumer/ynx-sociald ./cmd/ynx-sociald
```

## Remaining gates

No deployment performed or authorized by this checkpoint. Real original HS/historical MXID directory, protected runtime producer inputs, generic original nonce/effect integration, licensed optional local AI, official installed/public exact baseline, independent ABC users, and actual MONSTER invocation are not accepted. MONSTER: NOT_RUN. Backend mounted local HTTP is not a frontend installed/public journey. Coordinator: 接续测试网生态审计工作 (01a094cc-0ba3-7901-bcd5-56fce8330c0d).
