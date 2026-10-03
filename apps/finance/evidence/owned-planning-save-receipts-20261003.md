# Existing Finance planning saves: exact acknowledgements

The previous product UI discarded the API response, then cleared the draft and
claimed saved even for `{}`. All four existing saves now require actual service
receipt fields bound to the captured payload. This is not a new service/protocol.
Existing normalization is respected: trimmed names, uppercase category colors,
UTC-equivalent instants, omitted nullable reminder amounts. Missing IDs, source,
timestamps, mismatched financial values or privacy booleans remain unconfirmed.
Unsafe planning numbers and invalid request payloads are rejected before POST/PUT.

On an uncertain response, retain the draft and original intent. A deliberate
same-draft retry retains its original POST idempotency key and computed timestamp.
Do not automatically resend. Only a valid current-account receipt can reset a
still-unchanged form, notify saved and trigger ordinary workspace refresh.
Late retired-account responses remain ignored before receipt processing and
cannot release another account's pending button or expose old data.

21/21 controller, actual Chromium, owned report/export and 12-language regressions
pass; exact command/results and identities are in the accompanying JSON. The
existing Go HTTP committed-response-loss/retry/restart race test also passes.
Old browser fixtures previously returned `{}` or a lowercase raw input color;
these do not match the actual service receipt and were corrected to production
shape rather than weakening validation. New actual browser negative/retry flow
uses a controlled secure origin so `crypto.randomUUID` remains available; this
does not constitute an official-site request or Wallet authentication proof.

Delivery dependency: A's coherent final Finance bundle/cache/source pin must use
this current app.js and the preceding original-logo/text-sizing assets, including
ui-preferences.js. No independent release or shared authority change was made.
Public/install/real account/PS/ComputerControl and overall completion remain false.
All issues/delivery route only to 接续测试网生态审计工作.
