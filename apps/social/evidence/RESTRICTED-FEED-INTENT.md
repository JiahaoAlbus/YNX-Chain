# Restricted encrypted feed view: unmounted source slice

This slice adds a guarded DOM view. It is not mounted in the normal Social
session, is not deployed, and is not actual Matrix or public acceptance.

Index loading and each consumer read are guarded by the original captured
binding and view epoch. Content uses textContent, not HTML. Lock clears visible
content. No plaintext feed fallback or Wallet grant request is introduced.

Comments require an adapter to the original protected draft vault. The exact
indexed parent is reread before publication. The original comment intent and
transaction ID are saved before dispatch; the callback receives that ID. A
pending record prevents replacement publication through refresh/remount.
The callback must resolve only after original encrypted readback/index
confirmation; clearConfirmed runs afterward with that original transaction.
No automatic retry, new account, key reset or alternate transaction occurs.

The isolated Chromium probe uses real DOM, WebCrypto, IndexedDB and the original
protected vault implementation, including close/reopen. Matrix reads, authority
and publication are controlled test dependencies, not a homeserver connection.
All eight checks pass in `restricted-feed/20261002/real-dom-protected-intent.json`.
The first real-storage probe exposed a test timing assumption (one event-loop
tick did not guarantee reaching delayed read); it was changed to wait for the
actual transition, not to bypass a guard.

Still required: normal-session guarded adapters, actual consumer/HTTP/Matrix
integration, fresh actor/current-membership checks, real encrypted attachment
read, and recovery/settlement of the original unknown comment intent. Blocking
replacement is not settlement. Only current-session confirmation clears the
record; cold unknown recovery is not implemented by this view. Do not publish
or treat this isolated source slice as the full Social v2 goal.
