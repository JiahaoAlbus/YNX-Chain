# Owned controls language-refresh recovery

Inherited clean source: 7bb3dd82ed9998e7b9418daf95894b56f85e614d / tree 6c55cfc35607a5872c946299b96ca3a880240f0f. Ordinary Exchange product UI only; shared identity, authorization, runtime and release pins are unchanged.

## Actual reproduced journey

The existing product language selector rerendered private read expiry/source metadata, orders, balances and activity, but did not rerender existing security/support read controls. Their translated labels changed while their source timestamps retained the previous locale. The regression directly executed the product HTML, locale setup and control renderers in real local Chrome, using controlled account-owned read data with an existing support record and an unsubmitted draft. Before correction it failed `security observation time must follow the currently selected language` (1063.857958ms).

The existing language-change callback now rerenders owned controls when a verified snapshot is present. It formats the same source timestamps using the selected language without a new fetch, proof, session, permission, support submission or security write. Existing account loss and switch remain handled by the original private-account renderer. No business capability is removed or invented.

## Executed gates

The actual selector is exercised for all twelve supported locales: en, zh-Hans, zh-Hant, ja, ko, es, fr, de, pt, ru, ar, id. Expiry, snapshot source time, settings observation time and existing support-case detail time must use the same currently selected locale. The user's unsubmitted support draft remains unchanged; source input JSON is byte-unchanged; unknown/invalid private timestamps remain unknown; no request, page error or additional tab is allowed.

Focused correction: PASS 951.32525ms. Seven ordinary Exchange test groups (market data, order preview, owned-record integrity, account response streaming, owned controls browser, locale browser, candles browser): 90/90 PASS, 0 fail, 0 skip, 25116.068667ms. Both changed JavaScript files pass `node --check`; `git diff --check` passes.

This is controlled local Chrome display/recovery evidence, not Mac ComputerControl, current public-source acceptance, installation, real account approval, testnet trading or Product Session business-write evidence. The fresh public version mismatch recorded in `advanced-recovery-auth-boundaries-20261004.md` remains open; sole formal publisher A must consume the compatible owner graph and complete accepted write-producer/public/installer journeys. Report this checkpoint to `接续测试网生态审计工作`; retain prior red evidence and continue the complete existing Finance/Exchange/Quant goal.
