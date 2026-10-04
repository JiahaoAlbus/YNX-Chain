# Report evidence export isolation

Base: 7627a666610c7228836c3f4dbc1372cf116549bf.
Owner branch: codex/social-wallet-chooser-20261001.

The actual Export method appended SocialReport values whose EvidenceHashes
slice shared its backing storage with the saved report. Creation, replay,
read and appeal already used copyReportResult. Export now uses that same
existing function; it does not alter report fields or account filtering.

The controlled original business-fixture test creates a report and optionally
appeals it, exports it, then changes the exported evidence hash. Both created
and appealed cases failed on the original source because the persisted state
digest changed. Those failures remain in original-tests.txt with exit 1.

After isolation, the same test additionally checks original report readback,
original-key replay identity/evidence, a fresh export and foreign-account
exclusion. No assertion, field, test or feature was removed to obtain a pass.

The full Social race suite is recorded in full-social-race.txt; status.txt
records its actual terminal exit separately from the original failure.

```sh
go test -overlay /tmp/social-shared-revalidator-20261004.80Jdi2/overlay.json ./internal/social -count=1 -race
```

The overlay is the existing read-only shared declarations composition from
c5e4178bb548baa05f552e8e1bc0f566ddc6f72d, with its source carrier in adjacent
moment-delete-cold-recovery-20261004 evidence. It does not replace Social tests
or admit a shared runtime. Synthetic current authority is not real user consent.

This candidate proves only report evidence export isolation. It does not prove
all Export fields immutable, HTTP authorization, full privacy erasure, installed
UI, public source binding, real Wallet lifecycle or Social v2 / crypto649
completion. Existing source HOLD/failure evidence remains historical evidence.
No deployment, real account request, signing or transaction was performed.
