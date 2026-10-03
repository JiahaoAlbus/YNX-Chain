# Full Developer workbench: fixed inputs and Host acceptance

This is the owned consumer handoff, not an admitted executor. The latest frozen handoff manifest records the complete apps/developer source inventory and archive digest, frontend/protocol build inventory, Tools extension bytes/version, and pinned core provenance. A owns shared authority and formal Host publication. Network/package-egress/LXD work remains stopped; historical recipes in codeoss-service/README.md are not current authorization to run them.

## Exact existing entries

Gateway: services/gateway/src/server.mjs. Native admission: services/codeoss-service/src/configuration.mjs, loadCoreAdmissionAdapter(YNX_CODE_CORE_ADAPTER_MODULE, {stateDir, workspaceStore, runtimeProfileService}). The sole configured module must be root-owned /etc/ynx-developer/adapters/<name>.mjs with protected non-symlink ancestry. No verified installed path, approved remote Linux command, PID or native PTY handle is available in this local consumer run. The read-only local receipt reports Darwin arm64, ready:false; no Linux host commands were executed.

Factory createDeveloperCoreAdmission returns driver.start/stop/connect, launchURL, sessionForHost and originForSession. The gateway mounts both HTTP/WS through services/codeoss-service/src/proxy.mjs, rechecking the canonical owner/project/session binding. Native sessions and writer leases use the existing workspace database. Native Stop must confirm runtime stop before checkpoint/releasing a writer; failures preserve recovery state. Existing rejected drivers are retained for recovery/source provenance and are not restarted by this contract.

Existing core pin: OpenVSCode 1.109.5, upstream commit 072586267e68ece9a47aa43f8c108e0dcbf44622, Linux x64 archive SHA256 b433bf4f0227321a7014d8460d10a8f958adc0f45aa79bd889e84e65e8f88363 (services/codeoss-service/src/upstream.mjs). Derived branding must have its own verified manifest/tree digest. Native extension: native/ynx-tools, version0.2.2, installed in its separate versioned directory; preserve old extensions and user changes. Only session/workspace locators enter the extension environment, never Wallet/SSO/model secrets. Native editor terminal belongs to the actual OpenVSCode runtime. The separate existing hosted terminal API is services/terminal-service/src/service.mjs with node-pty; testing that API alone does not prove the native workbench terminal.

## A-owned missing release inputs

Provide an approved exact executor/admission module path and source digest, immutable core/derived artifact paths and digests, independent execution origin and protected proxy mappings, existing verified project persistence/isolation boundary, and source-bound formal deployment identity. This document neither chooses a replacement executor nor grants new installation/network authority. Preserve existing projects, drafts, journals, volumes and uncertain terminal actions.

Canonical identity consumer is implemented in developer-sso.mjs and central-identity.mjs: ynx-developer-v1-sso-v1, audience ynx:developer:identity, identity:read, callback https://developer.ynxweb4.com/sso/callback. Shared registration/refresh/business approval are A-owned. Supply the exact IDE business-proof tuple/configuration before adding signing/deployment; identity admission or an account prompt does not grant it. Existing Native Tools deployment remains unavailable. Existing model-router configuration must identify the actual approved provider, not a fixture.

## One normal user acceptance journey

1. Enter the formally published Developer product via a real canonical Wallet sign-in. Read back current identity and the user's real project list; create a named empty Wallet project with explicit displayed-account review or explicitly copy a guest project with user review. Confirm a retried creation returns the same project. A second account must fail project/session access without deleting the first user's files.
2. Open the full branded OpenVSCode workbench on its independent execution origin. Open an existing project file, edit and save it. Use its actual terminal to read the saved bytes and create a separate reviewed test file with a bounded command. Record exact source/core/extension versions, project/session and process outcome without recording secrets.
3. Stop/close safely, retain recovery if Stop is uncertain, then reopen with the same user and project. Confirm both saved files and prior binary files persist. Confirm account switch/revocation disconnects old admission without exposing content to the new account.
4. In that same native workbench, run the no-overwrite Testnet starter and read the actual configured chain ID/block. Inspect a real contract; changing the function or reinspection clears previous calldata. Complete an actual Wallet-reviewed Testnet business operation only after A's exact business contract is installed, then verify chain/backend readback.
5. Review selected synthetic public context, approve once, receive actual configured AI output, preview the guarded editor diff, explicitly apply/save, and reopen. Cancel/stale session/context must not replay a model call or write a file.
6. Verify Android-appropriate Web and macOS/Web entry; measure multiuser isolation, admission limits, resource saturation and recovery on the approved executor. Numeric source limits are not capacity measurements.

Each step needs runtime receipts; mock HTTP/VSCode drivers, public HTTP200 and source checks do not fill it. These native/real-Wallet/capacity/public gates remain NOT_RUN or unverified pending actual execution.

## Current bounded repair and evidence

Contract inspector now clears old ABI calldata when selecting a different function or inspecting again, so a new displayed function cannot silently retain the previous call target. Actual React/Chromium controlled-route verification covers request bodies, cleared calldata/results, and rejected inspection. TypeScript and frontend production build passed; no whole service suite was rerun for this isolated frontend change. Prior102 service checks remain inherited evidence. See evidence/integration/ide-workbench-contract-20261003; the frozen delivery manifest has exact current build/source bytes.
