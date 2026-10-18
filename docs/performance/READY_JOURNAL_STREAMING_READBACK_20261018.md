# Stream the existing signed-intent journal during read-only recovery

`ready_sender_readback.go` now decodes V1 journal records incrementally. The
existing `decodeReadySenderJournal` signature remains the compatibility wrapper
and uses the same scanner. It still refuses more than 2,048 planned inputs,
32 rounds or 8MiB and returns the existing indexed transaction array.

The incremental scanner accepts an `io.Reader`, explicit planned round/byte
bounds and a read-only per-record consumer. Decoder-owned memory is one <=64KiB
line, one decoded initial template per sender and one last nonce per sender.
There is no lifetime transaction array or whole-file line split in this path.
Initial templates are decoded once rather than once per record. Every actual
record still has its own complete native signature verification, including the
first round. Hash, index, sender, nonce succession, initial raw bytes, template,
manifest/migration/genesis binding and unknown JSON fields remain checked.

Complete duplicate or malformed records fail. A partial final line is never
passed to the consumer. A record/byte/line cap, reader error, cancellation or
consumer error stops decoding. Consumer callbacks already delivered before a
later error are only a validated prefix; they are not full-file acceptance,
proof of submission, execution or finality. Clean EOF likewise proves only that
the captured signed-intent prefix ends on a line boundary, not that the planned
workload finished. No recovered identity is resubmitted or used to advance a
live sender.

The new scanner can describe up to the existing terminal-stream 1,000,000-record
bound without allocating by that plan size, with an explicit <=1GiB read bound.
This is a read-only capability, not an increase in the running load client's
2,048-transaction/32-nonce limit. The writer's 8MiB bound is unchanged. Subsequent
work still needs segmented durable intent writing, streaming terminal/intents
joining, funding/nonce planning and a measured production storage path before
a ten-minute 600,000-business-transaction run can be admitted.

## Validation status

Go source formatted and `git diff --check` clean. **Go compilation and tests are
pending a fresh Root resource window.** No Go, node or pressure preflight was
started again for this change.

Existing actual-signature journal tests now exercise both the compatibility
wrapper and incremental scanner against original, wrong fixture, duplicate,
wrong hash, nonce gap, invalid signature, extra-field, canceled and partial-tail
inputs. New source controls cover one-byte reader chunks, an exact byte cap,
large planned count with only six actual records, byte and line overflow,
incomplete header, reader failure and consumer failure. The large-plan control
must produce six identities, not invent the remaining planned inputs; the legacy
wrapper must still reject that plan.

Next proposed focused Go selector adds these two tests to the already-pending
supply/final-count cases:

```text
TestReadySenderReadbackBindsFixtureAndRecoversOnlyCompleteIdentities
TestReadySenderStreamingReadbackBoundsAndConsumerErrors
```

Use the original package, `-p 1`, `GOMAXPROCS=1`, `-count=1`, `-timeout=30s`,
Root's fresh normal admission and bounded scratch/RSS. This file is a reproduction
plan, not authority to start a new window. No throughput improvement is claimed
until actual before/after decoder measurements and end-to-end runs exist.
