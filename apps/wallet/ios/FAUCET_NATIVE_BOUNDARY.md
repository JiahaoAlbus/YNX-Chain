# iOS Faucet native boundary

Build 16 compiles the local `YnxFaucetTransport` Expo module with its immutable
iOS production gate enabled. The module owns the only Faucet HTTP client. It
accepts no caller URL, headers, credentials, session, retry policy or enable
flag.

The native bridge starts paused and admits work only while UIKit reports the
application active. It creates at most one bounded engine, permits at most eight
one-use reservations, and retires reservations on cancellation, timeout,
backgrounding or destruction. The compiled endpoints are the YNX Testnet
Faucet request path and Testnet RPC origin. Redirects, cookies, credentials,
caching, compressed responses, oversized bodies and replacement upload streams
are rejected.

Admission sends the exact persisted canonical request body once per native
reservation. URLSession is never allowed to obtain a replacement body stream,
and the bridge has no admission retry loop. Cancellation cannot prove that a
server did not already process uploaded bytes, so recovery remains bound to the
same persisted Faucet request ID in the JavaScript coordinator. Only idempotent
RPC reads may perform the coordinator's single bounded recovery attempt with a
fresh native reservation.

The native implementation emits no request URL, request/response body, account,
key or token logs. It returns only generic stable error codes across the Expo
boundary. Strict Faucet model, durability and receipt interpretation remains in
the shared JavaScript coordinator and is covered by its contract tests.

The macOS Foundation harnesses use loopback HTTP under a network sandbox. They
exercise the real engine and bridge core without public Faucet traffic. They do
not establish compilation against UIKit/ExpoModulesCore, Simulator installation,
physical-device behavior, production signing, TestFlight or App Store release.
Those remain separate Xcode-runner and distribution gates.
