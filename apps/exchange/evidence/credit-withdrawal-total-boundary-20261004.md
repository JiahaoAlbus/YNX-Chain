# Test quote credit and withdrawal ledger boundaries

Actual pre-fix regressions failed: CreditTestQuote accepted AvailableMicro=MaxInt64 plus one; ReviewWithdrawal accepted AvailableMicro=2000000 and ReservedMicro=MaxInt64. Both returned nil and could overflow a ledger bucket. These are controlled isolated Go fixtures, not issued public capital or real user signatures.

Minimal fixes: test quote credit uses the existing bounded positive-credit check including available+reserved total. Withdrawal reservation rejects negative buckets or total beyond signed-int64 before any sequence, reservation, fee, ledger, audit or persistence mutation. Historical corrupted balances are refused, not silently repaired. Valid exact MaxInt64 total remains supported.

Tests include negative-balance/overflow rejection with exact state digest and durable bytes unchanged, valid exact-total credit/reservation, and sixteen simultaneous exact-key credits producing one effect. Public execution/custody gates are unchanged and remain closed without their required evidence.

Full Go Exchange/service tests PASS (9.301s / 0.448s). Focused race repetitions run separately; no network, production, live wallet, withdrawal broadcast or key collection occurred.
