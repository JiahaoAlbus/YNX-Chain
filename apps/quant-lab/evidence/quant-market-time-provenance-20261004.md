# Original Exchange fill time provenance

Continued from clean 1b3fd7b98b05c02e59f12ecb5e7a8f93a511bcf5. Only Quant-owned market adapter and regression tests changed; no Exchange, Wallet, registry or Host mutation.

The adapter previously replaced equal-time fills with successive fabricated nanosecond timestamps. This made the backtest see independent temporal observations that were not present in the original tape and could supply 20 samples from one timestamp.

History now stable-sorts by the reported timestamp, preserves original relative tape order within a timestamp, and aggregates that timestamp into exact OHLC plus sum of original amounts. Open/close follow the actual supplied fill order, high/low extrema and volume remain derived from those fills. No interval/time/price interpolation, synthetic padding or fake candle source is added. Signed integer volume overflow fails unavailable. Minimum twenty distinct reported timestamps remains enforced; the requested maximum now limits aggregated observations, not arbitrary intermediate fills. Latest tick uses the same final-fill tie policy as bar close and retains the original timestamp and that fill's volume (not aggregate volume).

Actual local HTTP adapter regressions cover out-of-order tape grouping, exact timestamps/OHLC/volume, post-aggregation limit, same-time insufficient history, overflow and latest/bar-close consistency. This is controlled source regression, not new public fills, account authorization, strategy or transaction execution.

Focused market-source/cancellation/history race PASS 2.039s. Full Go race (history aggregation source before the final latest tie-policy edit) PASS internal 46.865s/server 1.418s. Final focused history/latest race after that edit PASS 1.559s; the earlier full run is not relabeled as testing the later edit. Gofmt/diff PASS. Immutable successor candidate identities are recorded separately. Existing historical experiments/state/archives are preserved; this only corrects future ingestion and does not rewrite old stored results or silently relabel them. Formal public runtime and installer/Wallet/business completion remain unproven.
