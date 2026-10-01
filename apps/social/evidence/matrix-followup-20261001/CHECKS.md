# Social Matrix follow-up

Parent: 57d1125970248db622dfac8d16bb39cba6b65811.

- Connection startup now fences the captured generation/client/binding after startClient, in each sync wait check and before returning success. Replacement client is not stopped by stale startup cleanup.
- Unknown verification cancellation throws MATRIX_VERIFICATION_MISSING rather than returning success.
- Matrix policy tests: 9/9 PASS, including replacement sync race and changed-device session discard/unverified rejection.
- Social typecheck PASS; internal/social and internal/chat Go tests PASS.
- Actual isolated two-Synapse browser run: initial unverified send blocked; fresh verification request rejected by receiver and both sides reached Cancelled with m.user.
- Run then FAILED: subsequent SAS QA selected first request in Map, which was the previously cancelled transaction. New transaction was present at Requested on both clients; accepting old transaction correctly threw phase 5 error.
- This newly exposed QA request-selection defect requires explicit repair approval before modification. Receipt is retained, not a full federation success.
- Cold-restored repeat verification and actual device-add/revoke remain NOT_VERIFIED in this run. Previous seven-pass partial receipt is not replaced.
- QA event/state diagnostics contain synthetic aliases/device IDs, no tokens, private keys or attachment secrets. Own containers/network were stopped; private local profiles retained.
- Production bridge, normal user UI, public deployment, Native and Wallet product return remain NOT_VERIFIED. No deployment or user account/sign/transaction action.
