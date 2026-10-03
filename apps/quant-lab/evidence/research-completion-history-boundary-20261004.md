# Quant research completion boundary

Predecessor: 49393301536899483c7aebb73efba5cac62cda15. Scope: ordinary Quant result/history presentation and direct tests. No shared authority, endpoint, Host, build graph or formal pins changed.

Existing Go engine emits completed_oos for completed experiments (internal/quantlab/service.go). The new-submit consistency fence already requires this status, but the reusable numeric result/history guard did not. A saved or refreshed failed/running/unknown record carrying otherwise valid metrics could therefore be displayed as research returns.

The common result guard now requires that exact completed status. Unconfirmed rows stay visible as a localized invalid-result record, with no invented returns; valid neighboring history remains. renderResult rejects before replacing the prior verified chart, details or latest result. This is response consistency, not proof of data authenticity or permission.

Executed gates:

- Node app and real-browser test syntax; git diff --check: PASS.
- business-flow + ui-maturity: 90/90 PASS, 0 skipped, 560.027458 ms. Added saved-status and prior-chart preservation regressions.
- Real Go service + actual Chrome two-browser research-recovery fixture: 1/1 PASS, 10787.053916 ms. Includes actual CPU engine response, lost-return exact request replay, two independently generated local-preview browser tenants, persisted isolation, three clean SIGTERM service stops, Paper fill and kill-latch recovery, and added invalid-status local-readback presentation checks beside confirmed history.
- Retained fixture directory: /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-15EbmD.
- Local executable: 11467122 bytes, SHA256 46f3c56533cf6712cd0c8a2be23a5ba3dda26f58dc743d1edb047b1a13ccb7d8. This is a local test binary, not a released installer.

Controlled tape and preview simulation are expressly NOT public market, real-account approval, authorized private Product Session, real capital execution, native installation or formal multi-instance database acceptance. No public deployment was performed. Previously established public stateless CPU-only research evidence remains distinct and does not publish this new source.

Integration: apply ordinary guard and direct test hunks through the sole release owner, preserving its shared graph. Rollback is inverse of those hunks; no production state changed.
