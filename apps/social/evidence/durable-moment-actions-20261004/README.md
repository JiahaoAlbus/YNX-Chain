# Native moment action cold recovery

Source parent: 57d55f2c0a3e734a406036dc09a8e478581da9ef.

The native Moments UI now persists exact account-scoped follow, reaction and
delete operation data through its existing SecureStore adapter before calling
the existing authorization/cancellation guard. Unknown outcomes retain the
original nonce and payload across controller recreation. A different desired
action cannot overwrite an unresolved original. A completed explicit next
operation receives a fresh nonce. Invalid saved data is retained and rejected.
No background or automatic operation is started by reading storage.

This storage is original request data, not wallet authorization, device trust,
a server receipt, or cryptographic ratchet storage. The delete API still uses
its existing resource-delete semantics and does not accept the local nonce.
No new backend protocol or shared authority was introduced.

Six synthetic storage/controller tests and project typecheck outcomes are in
the adjacent logs. Initial test typing and isolated ESM compilation failures
are retained along with subsequent repairs. The Expo web attempt selected the
wrong entry point: this native UI targets Android/iOS, while package web:build
uses the separate web/build.mjs product. No web dependency was added to conceal
that failed attempt. The native bundle build result is in status.txt and
native-build.txt. A bundle is not an install or actual device test.

Actual SecureStore locking/restart, backend readback, account lifecycle, UI
error/recovery on installed platforms, public behavior and MONSTER ordinary-user
acceptance remain unverified. This checkpoint does not complete Social or lift
the deployment/device scheduling lease requirements. No account request,
signing, transaction, deployment or device activation occurred.
