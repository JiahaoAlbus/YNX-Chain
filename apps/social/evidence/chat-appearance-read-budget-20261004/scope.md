# Original Social appearance/settings recovery continuation

Base source: 06d10b29485d827b655f013522f3b3fc67892d4e. Changes are confined
to existing Social-owned appearance helpers, native settings reader, and focused
tests. Existing Telegram-like settings/background behavior is retained.

Stored themes now require actual string primitives; JSON arrays such as ["dark"]
cannot impersonate a theme through String coercion. The native settings reader
checks File.size before textSync, using a 200,000-byte journal envelope budget.
The portable journal bounds envelope characters before JSON parsing and validates
the nested <=80,000-character preference before hashing. No image file or path,
account, message, key, or history is deleted or rewritten automatically.

A dedicated pre-read limit error marks that journal side present but invalid,
allowing the opposite original valid side to remain available. Both invalid
sides require recovery with zero writes. Generic I/O failures still propagate;
they are not mistaken for absence or silently hidden by an older journal side.
Explicit subsequent saves retain the existing inactive-slot/readback behavior.

## Actual evidence

- journal-tests.txt: nine focused tests pass, including the original three
  affected journal regressions and six new primitive/budget/error cases.
- typecheck.txt: full Social TypeScript typecheck exits 0.
- bundle-build.txt: Expo Android and iOS JavaScript/Hermes exports exit 0.
- local-js-bundles.tar.gz: durable owner-carried bytes of that local export.
  candidate.json pins archive bytes/SHA, both HBC outputs, source delta hashes,
  exact base commit, metadata, and gate separation. This archive is not a signed
  APK/IPA, installer, active deployment, or an authorized production release.

The pre-read File.size path is source/type/bundle checked. Its resource error
recovery is tested through the actual portable journal with controlled ports;
the real Expo filesystem and installed settings operation are NOT_RUN for this
successor. Root retains sole device/UI scheduling; no screen-lock bypass,
emulator restart, user-data reset, wallet request, or foreground takeover occurs.

No 24/15 crypto suites or unrelated product suites are repeated for totals.
The frozen 06d crypto consumer still awaits its own independent review; this
appearance checkpoint does not admit or activate it. Real device/public source
binding, full Social and crypto acceptance, real users, and dot/MONSTER remain
open. Deployment, protocol activation, and formal native release remain with
the authorized controller/release owner.
