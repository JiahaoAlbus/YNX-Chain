# Observed missing authenticated conversation binding

Base: 8c000a68cdc40915466d03546a0fb3d23890a046. Production crypto source is
unchanged from 06d10b29485d827b655f013522f3b3fc67892d4e. Only the existing QA
program, reproducible QA selection, and this failure evidence change here.

VeilOutboxCheck cross-room uses the actual sender VeilSignalOutbox transaction
helper to encrypt for conversation A / operation 111..., with official SDK
sessions and synthetic independently supplied identity pins. The actual receiver
VeilSignalInbox transaction helper then receives the identical SDK ciphertext
under conversation A-other / a fresh operation 555.... It decrypts the original
QA body and persists a receipt/message under the replacement context in controlled
atomic memory. No old receiver session or receipt is preinstalled for that send.

Actual Java compilation succeeds. The actual SDK negative probe fails with
VEIL_AUTHENTICATED_CONVERSATION_BINDING_MISSING, exit 1. The script preserving
the result returns successfully after writing evidence; that is NOT a passing
crypto acceptance assertion. cross-room-check.txt preserves the failing probe,
and binding.txt pins source, classes, native port, official JAR, and class origins.

## Why prior tests were insufficient

The prior tests reject changed context under the SAME local operation UUID.
They do not prove authenticated context when a relay supplies a FRESH operation.
The outbox/request and inbox/receipt SHA256 digests authenticate neither a
sender's conversation nor its message identity; they only protect local retry
consistency. SDK encryption authenticates the raw body and peer session, not
the separately supplied application routing metadata.

This is an actual SDK / source-consumer controlled-memory finding, not an
installed Android exploit, public service exploit, private-key leak, forged
device approval, or actual Keystore/SQLite atomicity result. QA keys and private
records remain process-local; none are printed/exported. No services, accounts,
history, stored keys, or deployment state change.

## Required repair, not an invented shared protocol

The sender and receiver need a versioned encrypted APPLICATION envelope that
binds authenticated conversation/protocol and device identities, stable sender
message identity, and applicable group/epoch/migration context. All cryptographic
encryption/ratchets remain official SDK operations; local SHA is not AAD or a
replacement authentication mechanism. The exact transport-event / receiver
operation / sender-message mapping and cross-owner protocol inputs require
controller coordination. A private application serialization is separate from
reimplementing the SDK cryptographic wire protocol.

This negative is routed to Root and the existing independent reviewer. There is
no self-issued source approval, protocol activation, deployment, downgrade,
auto-enrollment/reset, or narrowing of the full Social/crypto goal. The native
consumer stays dormant. Prior green local-retry tests and prior independent
failures remain preserved; they cannot negate this new negative.

The QA runner has an explicit cross-room selection, emits the check log for
nonzero runs, and returns its actual nonzero exit. Other selections keep their
existing assertions. No unrelated green suites are rerun for totals.
