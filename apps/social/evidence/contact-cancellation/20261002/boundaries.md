# Native contact cancellation source checkpoint

The original regression run passed 72/73 tests. Its failure was:
`Native late preview after account change cannot become a review`:
`TypeError: resolve is not a function` at contactRequestFlow.test.ts:12:256.
The run also reported asynchronous timeout activity after that test ended.
This is a transcription of tool output, not an original saved log.

Cause: deferring transport startup to a microtask changed preview semantics.
Correction: synchronous startup inside try/finally, with bounded local wait.
The next run passed 76/76 tests; typecheck initially rejected two unchecked
test array accesses (TS2532). Explicit existence assertion corrected these.
Final tests.log and typecheck.log record the subsequent commands.

Cancellation releases local busy state and fences old UI callbacks. It does
not revoke a request received by the server. Unknown intents retain original
review, target, key and note in generation-scoped memory, not durable storage.
No automatic resend, shared permission changes or private-key access.
Underlying SocialAPI proof/fetch does not yet consume AbortSignal; timeout
and cancellation bound caller waiting only. Installed Native UI, real backend,
hardware, public deployment and full Social v2 acceptance remain unverified.
