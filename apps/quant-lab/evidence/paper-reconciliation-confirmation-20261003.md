# Paper reconciliation confirmation

Owner predecessor 1fb0d9f0629f2f054562be4ae52e6f49e71ee18d/tree 80b618db2a8cf5d2a9a104ab48d952e067ad0571. Ordinary Quant UI/tests only; shared authority, backend, deployment and formal builds unchanged.

Existing reconciliation immediately POSTed observed Cash/Position and could persist a kill switch on difference without confirmation. Added a twelve-language confirmation explicitly displaying exact observed integers, persistent kill-switch consequence, local simulation boundary and no Wallet signature/chain transaction/network fee. Cancellation makes no write. After approval, workspace availability, authorization, revision, pending risk lane and exact amounts must remain unchanged. The POST uses the confirmed copied values. Lane ownership prevents an unadmitted action from clearing another risk operation.

Executed gates:

- Business/UI: 82/82 PASS, 570.659333ms. Added twelve-language cancellation/amount preview and changed Cash/Position/revision/read/authority/risk-lane refusal cases; exact accepted request body. Existing malformed receipt, race/late read and risk-lane tests retained.
- Actual Chrome `--test-timeout=20000 --test-name-pattern='reconciliation|reconcile|kill'`: 5/5 PASS, 6674.344208ms. Twelve-language mobile previews dismissed with no POST, preserved observed cash and one tab; actual isolated Go service zero/difference reconciliation with explicit confirmation; confirmed kill persists through network loss, late reads and reload; malformed amounts never write.
- App/browser/business syntax and diff checks PASS.

Failed attempts retained as context: new browser fixture initially evaluated translation while the native dialog was open, causing test timeout; translation is now read before opening dialog. A retained kill test expected an old kill toast although the earlier stale-read checkpoint correctly prioritizes the workspace-unavailable warning. It now checks the exact localized stale warning plus independent KillSwitch=true, zero Paper writes, no pending intent and persistence through reload. No product logic was weakened to pass it.

This is controlled local execution, not public connected-account, signature, real order, capital, native installer or formal release evidence. No account/secret/signature/transaction was requested. The separate release owner must integrate ordinary hunks into the current coherent release graph; do not overwrite shared source with this owner checkout.
