# IDE terminal stop repair candidate

Status: source candidate; public Stop/library acceptance is NOT_VERIFIED. Only deployment owner A integrates/releases and runs new host QA. Do not clear legacy recovery rows or stop a whole container to manufacture an installation result.

## Source behavior

New LXD terminal sessions use a cryptographic identity binding owner hash, exact lease/container, project and terminal session. The isolated container must run systemd PID 1 with cgroup v2, Python 3, useradd and systemd-run. Preflight is read-only and occurs before terminal snapshot preparation. A system service contains the non-root shell and descendants, including children that call setsid. Root-owned receipts outside the workspace store boot identity, observed unit start time/process start time and stop state. Stop addresses exactly this unit and checks its cgroup is empty. No container stop, cwd scan, journal deletion, or forced CAS is part of the fix.

A prepared session can be cancelled before launch under a root-owned lock. A launched session without sufficient proof remains protected. The service journal persists the bound context and original snapshot, so a restarted gateway exposes new protected sessions in ordinary terminal inventory and retries them through the normal owner-bound DELETE Stop API. Legacy sessions with no bound context remain protected and retain the previous read-only recovery-copy workflow.

Stop retries rerun failed verification/collection, keep every immutable recovery receipt, and clear only a resolved terminal's cleanup failure. Successful order is verified stop -> collect -> revision CAS -> acknowledge -> release. A stale revision retains the full remote snapshot privately and returns conflict; it never force overwrites the newer workspace.

The workbench admits terminals only after successful persistence/hydration. Installation unmounts the terminal UI, enumerates the selected runtime's sessions, awaits their actual successful Stop, reloads the committed workspace and merges edits from the original common base. Autosave is paused while an admitted terminal can write. Overlapping edits, edits during the save request and edited install metadata are retained. Each returned package receipt is saved under a distinct browser recovery key; a metadata conflict is explicitly shown in output. The generated dependency store stays under /opt/ynx-code-dependencies and the terminal reconnects its npm/Python links.

## Local checks

Run inside apps/developer, using Node >=22 for services and a current runtime capable of loading frontend TypeScript test modules:

```sh
npm --workspace @ynx-code/frontend run check
npm --workspace @ynx-code/runtime-profile-service test
npm --workspace @ynx-code/terminal-service test
node --test frontend/test/terminal-admission.test.mjs
npm run code:build
npm run code:check
```

The source worktree's retained node_modules is a symlink into 20260906-developer-usability. Do not npm ci/rebuild into that shared path. The broad check there observed root TypeScript 7.0.2 without tsserver; the lock specifies TypeScript 5.9.3 nested in services/language-service/node_modules. Use an independent clean archive/extraction, overlay only the candidate files, then install from the exact lock:

```sh
npm ci --ignore-scripts
npm rebuild node-pty
```

The existing scripts/install-reviewed-dependencies.sh documents the separately digest-pinned debugpy and standalone JavaScript DAP prerequisites. Full checks may skip absent language/debug tooling; report the actual skip list. Never change the lock, the shared symlink, or claim absent tooling passed.

## A: new isolated host QA

1. Preserve old project e76474cc-6bc5-4c9d-a9e3-a5605c0871d9 / runtime 2ef6f96fe8775ef86f30fa9e and its null-payload recovery guard. It has no trustworthy recorded session identity. Do not migrate it by scanning cwd or killing its container.
2. In a newly approved isolated QA container, run the read-only capability check below. Record the exact image fingerprint, PID1, cgroup version, command availability, service version and container isolation profile. Passing this is only a prerequisite, not a PTY or product acceptance result.

```sh
bash scripts/verify-lxd-terminal-capabilities.sh EXPLICIT_NEW_QA_CONTAINER
```

3. Through normal HTTPS UI in an independent QA browser context, create/save a project, select its new LXD runtime, edit and save, open a terminal and run printf/ls. Record shell id showing a non-root UID. Do not inject cookies/tokens or use APIs to replace broken buttons.
4. In the terminal launch a bounded child which calls setsid and would write a late marker; ordinary Stop must contain it without affecting a separate bounded QA control process outside that terminal's unit. Record exact unit identity/start time/cgroup emptiness. Retry a transient unavailable verifier through ordinary Stop and confirm old recovery receipt bytes are retained.
5. Stop must return successful synchronization and inventory must remove that session. Approve is-number@7.0.0 through the ordinary package dialog. Open a new terminal, run a real require/import of the installed module and demonstrate success. Verify shell exit, Stop, refresh and reopen retain source and reviewed metadata.
6. Advance the workspace revision from another legitimate same-owner QA view before Stop. Confirm revision_conflict retains the full private snapshot and newer server content. Verify different-owner Stop/inventory cannot see or stop the session. Do not force CAS to turn this negative case green.
7. Restart only the candidate gateway with a newly bound active QA terminal. Its journal must retain the bound original snapshot; normal terminal inventory/Stop must recover that exact session. No-context legacy entries must remain protected. Verify an unavailable image preflight fails before any source preparation.
8. Capture source commit/tree, image fingerprint, normal UI screenshots, typed Stop response, persisted revisions, process/cgroup proof, installed-package execution and restart readback. Until all are observed, keep publicRuntimeVerified=false and packageInstallPassed=false.

## Remaining boundary

Production systemd/PTY/cgroup behavior is not proven by fake-run adapter tests, local Python syntax or build output. Existing nonterminal task/debug/language execution isolation is inherited; this patch does not establish that arbitrary legacy root processes cannot affect a future runtime. New isolated acceptance must be scoped honestly. The current workbench is React/Monaco/xterm with declared extension contributions, not a running Code OSS extension host.
