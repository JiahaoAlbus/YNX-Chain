# SDK 1.3.0-pq.3.6 / R33 original terminal custody DATA

The fixed R33 client now exposes readTerminalCustody(operation, phase, requestId) over the existing original Native readOriginalNativePrivateServiceTerminalResult. It accepts only the same retained unresolved v4 complete request. Original Source/current and Native registration remain mandatory. One read is selected before entering Native; no retry after a partial read or late failure.

The complete original response and all existing R30a binding fields are retained before validation/current. The JS adapter checks exact DATA shape, raw response/request/association hashes, record version and success consistency, and refuses conflicts with any response already held. Native alone verifies the actual Source-selected journal, entered record and original Host state. The result is DATA only: it does not perform a terminal ACK, adopt a session, replace the original result, clear row/global UNKNOWN or permit another business write.

Auth explicitly confirmed cold recovery remains missing: a new process cannot recreate requestOriginals/admittedPrivateRequests from a caller DTO or terminal DATA. Original Source authority must recognize persistent entered custody with session/current/floor/once and the original HostState relation. No such new callee has been supplied; this source does not invent it.

The original IDE R94 caller 1b74b7aa30b466c0f169b74a039dcf4f160fc9c2 fixes readiness rejection racing immediate cleanup, preserving the SDK's original error. Its supplied same-copy controls are consumed as evidence, not rerun. Normal caller recovery DATA routing remains IDE-owned and may read only before the same client is retired/current is lost. Frozen SDK3.5 and Native R33 are unchanged.

Positive Native grant, genuine same-Host terminal recovery, cold restart, full installation, publication and real user journey remain unverified.
