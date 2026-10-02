# Original indexed comment recovery: unmounted source successor

The original pending protected intent now binds the Matrix sender returned by
the caller's guarded original identity adapter, not a DOM-provided author.
Legacy pending comment records without that author remain retained and cannot
be confirmed by this helper. No identity or key is created to repair them.

Explicit recovery scans confirmed metadata indexes with bounded pagination and
requires exactly one original transaction, sender, parent event and audience.
It then uses the existing guarded consumer to read/decrypt the exact indexed
event and requires original text, comment type and no attachment substitution.
Revocation, missing events, duplicates, changed audience/parent/sender, cyclic
or over-limit pagination fail closed. The helper exposes no send/upload API.

The UI clears only the original protected transaction after this confirmation
and current binding/epoch guards. Missing confirmation retains the protected
record and original text; no replacement or automatic resend is performed.

Evidence: ten controlled index/consumer helper cases pass in
`restricted-feed/20261002/readonly-recovery.json`; ten real Chromium DOM,
WebCrypto and IndexedDB cases pass in `real-dom-recovery.json`, including vault
close/reopen, absent confirmation retention, and confirmed original clearing
without increasing publication count. These are controlled Matrix dependencies,
not actual homeserver or public/installed acceptance.

This view is still not mounted in the normal session. Real canonical
consumer/HTTP/Matrix adapters and actual settlement are outstanding. Recovery
requires an existing confirmed index; a dispatched event without an index
remains unknown and retained. Attachment upload settlement is not implemented
here. No deployment, shared-source or Host changes are included.
