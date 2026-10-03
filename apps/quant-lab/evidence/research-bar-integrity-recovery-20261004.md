# Research tape integrity and saved intent recovery

Base 1278295fe97c247b47b357025118c41b2584abee. Existing Quant research input validation only; no changed strategy arithmetic, fee policy, scheduler, authority, SDK, state schema or release artifact.

Seven controlled red cases each produced and saved `experiment-000001` with nil error before correction (0.421s package run): zero first timestamp, zero open/low, open above/below the high/low range, and close above/below that range. Such bars cannot substantiate a published OHLC research tape even where the current signal uses close prices only.

New backtests now require a nonzero timestamp, positive open/low/close, ordered high/low and both open/close contained in that range, in addition to existing monotonic observations/nonnegative volume. Stored historical receipt decoding and exact idempotent replay are unchanged; no prior experiment is recalculated or relabeled. Zero-volume flat OHLC and observation gaps remain valid, explicitly without invented fills or volume.

Executed regression:

- Seven invalid bar forms return `ErrInvalid`, zero returned experiment ID and unchanged full state digest.
- Seed a real valid persisted experiment. A configured market adapter then returns an impossible OOS close. The actual guest research HTTP handler returns 400 with error ID; a saved same-key submission also returns invalid. Exact existing state file bytes remain unchanged.
- Correct the same market tape, reuse the original saved intent key: completed/reconciled result, exactly three adapter calls including the guest/rejected/successful requests. Close/New without a market adapter and replay the saved receipt byte-equivalently by full receipt hash; state file bytes are unchanged on replay.
- Flat positive OHLC, all-zero volume and a last-observation gap remain accepted; no-trade/trades-zero and disclosed data gap retained, attribution reconciled.
- Initial full Quant race regression PASS, 4.299s; HTTP/recovery focused three repeats PASS, 1.676s. Full Quant race regression with real isolated PostgreSQL enabled PASS, 16.635s before final positive zero-volume/gap regression. Final focused race regression including that positive case, three repetitions PASS, 1.588s; final full Quant race package with real isolated PostgreSQL PASS, 15.415s. Diff checks PASS, isolated test schema count zero, retained loopback QA database stopped after completion.

Test data and configured adapter are isolated research fixtures, not public price/feed lineage or real strategy execution. No account, signature, order, capital, Host or production mutation occurred. Real public/native source binding, accepted shared lifecycle and user-flow verification remain separate unverified release gates. This owned delta must join the compatible existing Quant/backend release graph through A, not an old-runtime UI overlay.
