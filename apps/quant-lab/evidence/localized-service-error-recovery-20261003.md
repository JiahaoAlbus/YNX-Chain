# Localized service-error recovery

Owner predecessor: `dfa41fb387cefb0925e2d277d979a62fc630d587`.

The owned Quant API consumer previously displayed arbitrary server `error`
values or raw HTTP codes, without a locale key. Unknown 4xx responses also
cleared research/Paper pending intent as if a recognized definitive refusal had
been received, allowing a later request to get a new key.

Implemented five twelve-language error classes: invalid inputs, denied/expired
access, saved-state conflict, unavailable/busy/timeout service, and unknown
failure. Changing language updates the existing toast without HTTP or Wallet
activity. Server-supplied arbitrary strings/objects are not used as UI text.

Recognized error codes must match their HTTP status. Research parameter rejection
requires the research route and 400; Paper daily loss requires Paper orders and
403. Unknown/status-mismatched failures receive `QUANT_API_REJECTED`; they retain
the exact pending intent rather than assuming definitive refusal. Existing known
definitive rejection cleanup and explicit same-key retry remain unchanged. No
automatic order/research retry or daily-risk refresh is induced by an unknown
or falsely typed failure.

## Verification

- Full VM/UI: `node --test apps/quant-lab/tests/business-flow.test.mjs apps/quant-lab/tests/ui.test.mjs`
  88/88 PASS, 634.578167ms. All five error classes across 12 languages; malicious
  string/object payloads; research and Paper exact-body/key retention; wrong-status
  daily-loss response; existing recognized typed rejection behavior.
- Actual Chrome: `node --test --test-name-pattern='actual Chrome localizes service errors' apps/quant-lab/tests/browser.test.mjs`
  1/1 PASS, 6590.348667ms. Controlled 503 followed by explicit 409 retry; original
  body and pending record byte-identical; 12 language switches produce no extra
  submission; arbitrary server payload absent from body text; one tab, zero page errors.
- Node syntax checks and `git diff --check`: PASS.

The browser uses the real owned page on an isolated Go service, with declared
controlled response fixtures. This is not public source-bound approval,
installed-wallet acceptance or real capital execution. No shared SDK/authority,
engine, Host, permission registry or formal deployment changed. Unique release
owner must integrate the ordinary product delta. Full Financial goal remains
incomplete; local proof does not resolve public runtime/source mismatch.
