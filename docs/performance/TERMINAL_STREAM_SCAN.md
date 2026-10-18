# Bounded completed-terminal scanning

`scanCompletedTerminalResults` is the shared read-only completed-evidence scanner.
It retains one 64-row sealed segment, one 64-entry directory chunk and one round
counter per sender. The consumer controls any additional retention. Callbacks
receive exact reported rows; they are only a prefix until the function returns a
nil error and `Complete: true`. Captured bytes and fully validated segment bytes
are separate, including on later corruption or a consumer error.

The original `readCompletedTerminalResults` calls this scanner and still retains
its original complete array for compatibility. Its 2048-record/16MiB entry limits
are unchanged. The scanner explicitly accepts a budget up to 1GiB and the existing
terminal format limit of 1,000,000 records, independently of the legacy entry.
This is not permission to raise a live run's limits or resource budget.

Acceptance requires exact fixture binding, canonical full segment inventory,
regular files/directories, complete seals, sequence/hash chain, per-sender round
progression, exact signed bytes/hash and reported complete-final observation flags,
final count/bytes/chain and complete sender coverage. Directory identity and mtime
must remain unchanged. Cancellation, malformed/extra/missing/partial files,
consumer/close errors and uncertain observations cannot produce complete success.
The reader never signs, submits, retries, repairs or removes evidence.

A complete observation stream is not independent proof of business execution,
signature validity, BFT finality or durable state convergence. Those require the
original signed-intent binding and independent consensus/state verification.

CI 39103922279 actually passed the legacy readback controls and four new streaming
controls. One fixture contains 2112 real signatures in 33 files and 2699621 bytes;
its final-observation flags are synthetic. The scanner preserved its exact signed
identities and order while the legacy entry still rejected the larger total.
Corrupting the second segment returned only the first 64 rows and Complete=false;
corrupt bytes remained untouched. No business TPS or network latency was measured.

Ten-minute live qualification remains separate: the sender still has its original
2048 transaction, 32 nonce-cycle and 30-second limits. Scoped sustained issuance,
funding checks, large-history readback, evidence/disk budgets and fresh Root
scheduling are required before a sustained run can be attempted.
