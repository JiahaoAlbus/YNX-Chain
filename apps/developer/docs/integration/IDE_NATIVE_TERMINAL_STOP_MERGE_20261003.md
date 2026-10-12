# Native terminal stop synchronization

Actual isolated macOS QA of source `9dc8cb3786f2704fca2a197b50874d0fe34c475f` completed a native UI C++ compile (`YNX_IDE_9DC_NATIVE_COMPILE`, clang++, exit 0) and interactive PTY write/read. Stopping the PTY and opening README produced `save conflict`; this journey was not accepted as passing. The original isolated support profile and terminal recovery remain preserved and are not copied into evidence.

The workbench previously refused all remote adoption when its workspace key differed from the last saved key. That key includes active/open tabs. A tab navigation during asynchronous terminal collection therefore retained the old remote revision, even without conflicting file edits; resumed autosave could submit that stale revision.

The terminal now has a separate synchronization callback. It merges file edits against the saved common base, preserves local tabs and nonconflicting local edits, and publishes the merged model with the actual remote revision before autosave resumes. Same-file or project-name conflicts retain both copies and block remote saving. The terminal waits for its WebSocket synchronization callback before releasing the active guard; the explicit Stop path also awaits synchronization. Other source-control/history/AI callbacks retain their existing behavior.

Validation: eight terminal admission tests pass, including the observed terminal-created-file/tab-navigation case, disjoint unsaved edits, and conflicting file/name protection. The frontend `.mjs` group passes 10/10. TypeScript check and production frontend/protocol build pass; the build retains its existing large-chunk warning. Actual fixed-package UI validation is recorded separately after rebuilding.

The preceding 9dc package also passed mounted-DMG self-test, cold launch, real C++ compile, C++ symbols, TypeScript/JavaScript/Python/Solidity completion, second-launch persistence and child cleanup. That receipt belongs to 9dc, not the subsequent fix.

These are guest desktop candidate checks. They do not establish the full OpenVSCode workbench, remote approved core, production Wallet/Relay/AI, account capacity, Windows execution, formal signing/publication or user acceptance.
