# YNX Card Testnet YNXT Funding - Chain Integration Blocker

Status: `BLOCKED_EXTERNAL_INTEGRATION` as of 2026-08-20.

## What the Card app now requires

The Card app will not credit or unlock the Testnet merchant simulation from a
wallet callback, a pasted hash, or an unconfirmed transaction. Its flow is:

1. An authenticated central Card service creates a short-lived funding intent
   containing an opaque intent ID, `0x1917`, the Card funding recipient, exact
   YNXT amount in wei, and a minimum confirmation count.
2. The connected EIP-1193 wallet is asked to approve exactly that recipient and
   amount through `eth_sendTransaction` on YNX Testnet.
3. The app verifies sender, recipient, exact value, successful receipt, receipt
   hash/block consistency, and the requested confirmation count before it can
   submit the proof to the Card service.
4. The Card service must independently re-verify the same facts and atomically
   credit the Card ledger once per intent/transaction pair.

## External blocker evidence

The P0 Card path is intentionally limited to `apps/card/**`. This branch has
no assigned implementation or accepted evidence for the locked central Gateway
route `POST /app/card/v1/testnet/topup-intents`, a Card funding recipient, a
public YNX Testnet RPC proof source, or a funded live EIP-1193 wallet. The
current product metadata therefore remains `integratedCentral=false` and
`testnetVerified=false`.

No real YNXT transaction hash, receipt, block, confirmation count, Card-ledger
credit, or Explorer URL is claimed by this repository checkpoint.

## Required integration response

The central owner must provide the intent endpoint and a server-side verifier
that rejects wrong chain, sender, recipient, amount, failed receipt, too few
confirmations, replayed hash, and replayed intent. The first release evidence
must include a real `6423 / 0x1917` YNXT transaction hash, receipt/block,
confirmation count, independently verified Card-ledger credit, and the
idempotency result for a duplicate submission.

Until those inputs exist, this product is strictly `YNX TESTNET CARD PAYMENT
SIMULATION`; `productionRealPayments=false`, `deployedPublic=false`, and no
real payment, fiat, card-network, PAN, CVV, or merchant-acceptance claim is
permitted.
