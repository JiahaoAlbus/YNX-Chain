# Explicit sensitivity windows

Reviewed predecessor: `6ebd5cb04a6d09476a29d472972353e1871a0adb`.

Actual Service.RunBacktest regression reproduced two faults with legitimate
adjacent windows (fast=2/9/24, slow=fast+1). The fast+1 sensitivity should have
identical averages and no trades. Instead, the simulation reset slow to eight
and traded; fast=24 also panicked on an out-of-range lookback slice. The original
failure is retained here, not relabelled as a green run.

Normalize/default the original user request as before. Inside sensitivity
calculations retain their explicit positive windows, including a one-period
fast-1 variant and equal windows. Wait for the larger lookback before reading
either average. Equal windows consequently produce no signal; no replacement
defaults, clamp, skipped sensitivity, new strategy or authority was introduced.
The original user request still requires fast>=2 and slow>fast.

The actual engine regression covers all three original parameter pairs and both
equal-window fast+1/slow-1 variants. It requires zero trades, noTrade=true and
zero return. Full Quant/server race, vet and diff checks are required before
freezing. This is local research correctness, not public or real-capital proof.

Final results: race PASS internal 2.977s / actual server 1.416s, vet PASS,
diff PASS. Optional QA database tests are not promoted from SKIP to proof.
No persisted historical experiment is retroactively overwritten; A must inherit
the source before formal publication. Normal reviewed source revert is the
rollback path; there has been no production mutation in this owner turn.
