# Native selected text to reviewed editor changes

Status: SOURCE_ONLY. Parent a55512040620299b96d0ec4a31fc38cf70c743b4.

The existing Native Tools and editor review command now connect through an explicit Selected text replacement mode. The user copies a unique selection with the existing editor capture command, previews the exact request, and approves one model call. Server validation binds capture to the active admitted session. The model returns only summary/replacement; URI, document version, full-text digest and original selection come from the reviewed capture. No project file is implicitly read, no model metadata chooses a target, and pasted context remains an ordinary user-reviewed prompt under the existing 8000-byte Gateway limit.

Tools can copy/download an exact ynx-reviewed-text/v1 bundle. The native guard materializes one unique exact replacement against the current open document and preserves all surrounding text. Version, digest, active session, workspace realpath and explicit diff/modal approval remain required. Missing/duplicate selection, oversized final document or changed source refuses the write. Existing whole-document bundles remain supported. No edit is applied on model return or download.

The encrypted project AI record stores reviewed capture and answer. Reopening produces its review bundle without model replay only for the same runtime session. Older session/opaque answers remain readable but cannot silently rebind an edit; the UI requests fresh capture/review. Invalid structured model output saves failure and never produces a bundle or reusable approval.

Bundled YNX Tools advances to 0.2.0 in a separate versioned extension directory. Old 0.1.0 files are retained, including user changes; current 0.2.0 tampering/symlinks still refuse overwrite. Selection of the new extension by a real Linux OpenVSCode runtime remains an acceptance gate.

Verification: 98 relevant service checks, six controlled React/Chromium suites, TypeScript, Vite build and static check passed. Tests cover actual Tools HTTP/SQLite/encrypted readback, native guard materialization, extension command preview/modal behavior in a controlled VM, real versioned extension file copy and JSON download bytes. Clipboard API is controlled in browser QA. All 71 build inputs match QA. Original accessible-label failure and asynchronous fixture correction are preserved. No package install/fetch/lifecycle scripts executed.

This does not prove a configured live model, real native editor apply/save/reopen, Wallet signature/deployment, capacity, installed/public acceptance or MONSTER. A owns shared proof/configuration and formal Host release. Network/package-egress/LXD remain stopped.
