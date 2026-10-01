# YNX native IDE first slice

This source connects the normal Developer project entry to OpenVSCode Server
1.109.5 and OpenVSX. It is not a public deployment or a capacity result. The old
Monaco workspace is retained as a separately labelled guest/text workspace.
Wallet projects are listed by freshly verified stable subject, including in a
new browser. Copying a guest project is an explicit, revision-checked action.
After native import, the persistent volume is primary; Stop checkpoints bytes
and does not convert images or other files to JSON strings.

## Validation

From `apps/developer`:

```sh
node --test services/codeoss-service/test/*.test.mjs
npm --workspace @ynx-code/frontend run check
npm run code:build
```

Tests use actual local HTTP handlers and temporary persistent SQLite/filesystems,
with injected central authority and container transport. They do not prove the
host container, Wallet callback, browser extensions, quota or public deployment.

Native session journal and writer leases use the same existing workspace SQLite
connection and transaction. External launch starts only after this commit.
Real child-process SIGKILL tests cover the insert window (both roll back) and
post-commit/pre-execution window (both survive and cold Stop recovers). Native
checkpoint/release/stopped state also commit atomically. Only one live broker
process may own a workspace database; a second process is rejected. A dead
owner may be taken over for recovery; uncertain/PID-reused ownership stays
blocked for review. The workspace store owns connection close after core drain.
This source has never deployed a separate legacy `codeoss.sqlite`; that filename
argument is retained for API compatibility, not a second admission journal.

## A's isolated host admission

Existing host is x86_64, LXD 5.21.8, cgroup v2, with systemd/Python/useradd.
Its existing `default` dir storage has no verified hard quota. Do not alter it,
existing projects, legacy runtimes or their recovery locks.

Historical provisional storage recipe (NOT admitted as hard project quota): LXD Btrfs pool `ynx-core-quota` (64 GiB initial
bounded backing device/file), isolated profile `ynx-core-isolated`, and a
separate Btrfs mount at `<gateway-state>/native-ide/projects` (32 GiB initial
bounded backing device/file). Enable Btrfs quota on that new project mount.
The existing source creates one subvolume per owner/project, sets and rechecks a 1 GiB
referenced-byte qgroup limit, and rejects inconsistent quota accounting. This is
insufficient for hostile executable projects: new nested subvolumes do not
inherit qgroups. Do not enable production admission with this provider until
an actual enforcement boundary closes that escape. Preserve existing recovery
compatibility; do not convert or delete any old directory/pool.
The backend service owner must own protected volume ancestry and have the
necessary Btrfs/LXD privileges. No such authority is passed into user containers.
Use an immutable approved x64 base-image fingerprint with systemd PID1,
Python3/useradd and available UID/GID 1000 for `ynx-core`.

Profile contains only `root` disk and `eth0` NIC. Driver adds exactly the readonly
core artifact and this project's volume. Per active runtime: 2 CPUs, 2 GiB RAM,
256 processes, 4 GiB root disk; broker admission: 8 global, 2 per Wallet owner.
These are first-slice bounds, not measured concurrent-user capacity. Cumulative
owner project quotas, cross-broker admission/fairness and load testing remain
follow-up acceptance items; the bounded mount still bounds aggregate disk use.

Create managed bridge `ynx-core-egress-approved` and ACL `ynx-core-packages` with
default ingress/egress reject. Allow only an approved package egress proxy and
necessary DNS. The proxy must deny host/private/link-local destinations,
arbitrary CONNECT and redirects to them; allow approved OpenVSX assets, npm and
PyPI package hosts. Record the reviewed ACL's SHA256 of `JSON.stringify` of the
actual `lxc network acl show --format json` response. Driver rereads both bridge
default-deny and that exact ACL. It injects only the credential-free proxy URL
into core/npm/pip environments. Do not use host network, published ports,
host sockets or wildcard internet access. Existing AI and Wallet browser
review remain product services, not credentials inside extension/terminal code.

Package the official x64 archive into a NEW derived directory using
`scripts/package-native-core.mjs`. Inputs are the pinned official archive,
exact MIT license/notices and verified existing YNX 192px logo. It changes
product names, favicon/icons and manifest, preserves attribution and emits a
separate derived tree/manifest SHA. Do not label the modified runtime with the
official archive digest. Root owns its parents and all executable content;
mount readonly. Driver verifies the reviewed derived manifest and full tree.

Install root-owned `/etc/ynx-developer/adapters/native-core.mjs` exposing
`createDeveloperCoreAdmission({stateDir})`. Import `createLxdCoreDriver` and
`createBtrfsProjectStorage` from this exact reviewed installed candidate; configure
the verified artifact paths/digests, image fingerprint, pool/profile and network
admission facts. Its storage uses `join(stateDir,'native-ide','projects')`.
Return `driver`, `launchURL({sessionId})`, `originForSession(sessionId)` and
`sessionForHost(host)` for exact UUID hosts under a dedicated unrelated-site
wildcard (for example `*.ynx-native.dev`, after A provisions DNS/TLS). Reject
unknown hostnames. Never use the Wallet/product parent origin for executable
workspace content. Set `YNX_CODE_CORE_ADAPTER_MODULE` to that protected module.
The built-in gateway owns HTTP and WS proxy mounting; both freshly reverify
owner/project/session/account generation. A host-only sealed session cookie is
admitted by a one-use POST body ticket, not a URL credential.

Core listens only inside its own unprivileged container at 127.0.0.1:3000 with
official `--without-connection-token`. No container ports are published. Actual
LXD expanded devices/configuration, UUID and listener are checked before stdio
relay. Root-controlled start-issued journal distinguishes never-started cancel
from execution whose transport response was lost. Stop confirms PID/processes
zero before checkpoint/releasing the writer. Failed Stop stays recoverable.

LXD init/start/stop use the official asynchronous API via `lxc query --raw`.
Before sending a mutation the backend fsyncs an issued record; its response ID,
exact instance resources/default project and terminal result are saved outside
the user volume. Stop first settles those operations, reads the current exact
instance's operations, and rechecks before every absence/Stopped success path.
Wait is bounded to five seconds per operation; pending/transport errors keep
the writer for retry. Completed failed operations still require actual instance
absence or stopped/child-empty proof. Foreign operations are never waited on,
cancelled or deleted. A lost response with no confirmed ID is an explicit
recovery requiring operator review, even when the current operation list is
empty; never clear that issued record or manufacture a no-start proof.
Terminal receipts allow cold recovery after LXD expires completed operations.
This follows the pinned [LXD 5.21.8 operation resource schema](https://github.com/canonical/lxd/blob/lxd-5.21.8/shared/api/operation.go)
and [numeric final-status contract](https://github.com/canonical/lxd/blob/lxd-5.21.8/shared/api/status_code.go).

## Identity and rollout

Consumer is implemented here: PKCE start/callback, backend-only token exchange,
AES-GCM sealed grants, server expiry, current central introspection, stable
subject binding and local logout. Client ID `ynx-developer-v1-sso-v1`, audience
`ynx:developer:identity`, callback `https://developer.ynxweb4.com/sso/callback`,
scope only `identity:read`. `developer:deploy` is a separate explicit approval.
Central registration 19b is held pending compatible Wallet client-list rollout.
Do not spoof Finance's registration. Gateway generates its own private sealing
key; no user-supplied secret or new AI account is required.

Before release A must prove a new QA container's inspect/quota/egress, normal
Wallet sign-in, explicit guest copy, real editor branding, OpenVSX install/load,
Node/C++ run and package installation, binary edit persistence, Stop/refresh and
reopen from another browser of the same account; account B must fail access.
Also verify revocation/expiry disconnect and the quota-full recovery message.
Current local reference Prettier install/load and host AI nonempty probe are
separate inherited evidence, not this formal UI's success.

Rollback: stop new admissions, safely drain only exact new core sessions; retain
all native volumes, snapshots, journals and sealed-state files. Restore the old
gateway entry while keeping migrated projects read-only there. Never delete a
native marker, release a protected writer or turn JSON into the primary source
to manufacture a successful rollback.

### YNX Tools consumer (source successor to 230359)

The pinned `native/ynx-tools` workspace extension adds a YNX activity bar and four commands. `YNX: Open Chain, Wallet and AI Tools` opens the trusted product's `/native-tools?sessionId=<opaque locator>` in a separate browser tab. The locator is not an authorization token. Only `YNX_CORE_SESSION_ID` and `YNX_CORE_WORKSPACE` are added to the isolated core environment; no Gateway, Wallet, model or SSO secret enters the extension host. Reopening installs/verifies exact Tools source bytes without overwriting a changed user extension.

The trusted page requires current `codeossService.authorizeConnection` admission. Its backend reuses the existing Chain/Wallet handlers with a private WeakMap owner, and the existing model router/fair queue. It never substitutes the guest owner. Read-only status/compiler/RPC use the established Chain6423 allowlist; transaction and signing RPC are rejected. The new Node starter calls actual `eth_chainId` and `eth_blockNumber`, verifies6423, creates a new file with `overwrite:false`, and performs no installation/signing/deployment.

AI has a two-step explicit user flow: paste/enter selected context and preview, then approve the exact server-retained prompt/context once. Nonces and proposals bind the freshly verified owner/project/runtime/session/account generation, expire within60seconds or current grant expiry, are bounded to8 per binding and128 total per map, and are discarded on restart. Host, Origin, content type, same-origin Fetch Metadata and exact schemas are checked. No postMessage handler accepts an extension approval. Only server-fixed `ynx-hosted/qwen3:4b` is used. Revocation/expiry abort/recheck suppresses the result; failed requests are not automatically retried. No server file apply endpoint is added.

The optional editor text-change command accepts a user-reviewed `ynx-reviewed-text/v1` bundle with `sessionId` and `changes:[{uri,version,fullTextDigest,text}]`. It previews changes and requires a second modal approval, then rechecks session, current document version/full SHA256 digest and real file containment inside the current workspace. VSCode's WorkspaceEdit also serializes current document version IDs (confirmed in official1.109.5 extension-host artifact). Model output is untrusted advice and is never executed, installed, signed or applied automatically. A pasted bundle is not a Wallet/backend permission and may be refused when files/session changed.

Wallet readiness reports the existing Gateway's real attestation. The explicit “Review YNX Wallet connection” button reuses the existing safe EIP6963/EIP1193 launcher on the trusted page, and does not grant deployment/signing access or change the backend owner. Contract deployment remains unavailable here; do not report a readiness response or account prompt as a transaction.

Validation: `node --test services/codeoss-service/test/*.test.mjs` (31 tests, including actual isolated HTTP approval/hostile-origin/cross-account/stale-generation/revoke and real symlink containment). `npm --workspace @ynx-code/frontend run check`; `npm run code:build`. `tools-extension.test.mjs` executes actual extension command code against an isolated VSCode API fixture; it is not a normal installed-core UI acceptance result. A direct Node execution of the exported starter queried public6423 and block `0x1b13cd` on2026-10-02; it is not core-terminal UI verification.

Installation/host acceptance remains A-owned: use the unchanged officialx64/derived-core pin and fresh LXD/quota/UID-shift/private-proxy runbook above, deploy this exact Developer candidate and frontend build, then use a normal Wallet sign-in/project/core session. Test the four commands in the actual core, no-overwrite creation, changing a document during preview, selected synthetic public context preview/cancel/approval, real qwen text and chain responses, and explicit Wallet readiness/account review. No private context or keys are needed. Test a hostile kernel-origin fetch/message and a second Wallet account. The product-host approval page must stay unframeable; the kernel must remain on its independent approved origin with no parent credentials. No new runtime/profile/service/port is created by these tools.

Current source status does not claim public Tools installation, normal kernel UI, long-edit renewal, different-site domain ownership, actual shifted UID checkpoint, enforced host quota/egress or multi-user capacity. Mac was locked during the UI attempt, so normal core UI was NOT_RUN. Central grants still strictly expire in5minutes: await the formal A-owned refresh-handle contract rather than extending local TTL. Existing chain/backend AI evidence is distinct from this new Tools consumer's public acceptance. Rollback is the prior230359 candidate; preserve native volumes and recovery journal. Tools do not change Stop, leases, migration or binary checkpoint semantics.

### Read-only host doctor

A may execute `node scripts/native-core-doctor.mjs` from this reviewed candidate.
It only reads Linux/x64, CPU/memory/free-root-space, filesystem/kernel presence,
fixed tool availability, LXD server metadata/storage pool overview and existing
ZFS pool size/health overview. It never installs packages, loads kernel modules,
creates pools, reads project contents, changes services or prints environment/
credentials. On non-Linux/x64 it performs no host queries. Its result is always
`ready:false`: tool/driver support is not quota/UID/egress/runtime admission.

The [official LXD5.21.8 Btrfs quota documentation](https://canonical.com/lxd/docs/default/reference/storage_btrfs/)
warns that nested subvolumes do not inherit qgroups. The previous Btrfs recipe
is provisional, not a proven hard project quota. Select one replacement or
verified containment boundary only after A's actual kernel/tools/pool receipt;
no automatic ZFS/LVM/kernel installation or legacy pool modification is allowed.
The doctor leaves `projectStorageAdmission`, `shiftedUidCheckpoint`,
`egressAdmission` NOT_VERIFIED and capacity unverified even on a capable host.

### New ZFS project quota helper (host preparation successor)

A's read-only receipt confirmed loaded ZFS/Btrfs modules and no existing ZFS
pools. PATH lacks ZFS tools; the existing LXD snap's fixed2.2 binaries with its
matching2.2 `lib` directory run successfully (userspace2.2.11, kernel2.2.2).
Ordinary invocation's missing-libzfs failure is preserved. This proves usable
installed tools, not pool creation, enforcement, shifted UID or runtime success.

Only the new project provider is ZFS: `createZfsProjectStorage`. Use one NEW
32GiB bounded project pool `ynx-core-projects`; dataset parent
`ynx-core-projects/projects` has mountpoint none. Each owner/project gets its
own `<ownerSHA>_<projectSHA>` dataset and exact native volume mountpoint, local
`quota=refquota=1073741824`, devices/setuid/sharing off. No `/dev/zfs`, host
namespace, quota helper or credentials enter the container. Refquota alone is
not an admission fact: the root helper rereads both local bounds and exact ZFS
findmnt SOURCE/TARGET, UID/protected ancestry and mount properties.

The Gateway remains ubuntu. Install this candidate's standalone
`scripts/native-zfs-quota-helper.mjs` as root-owned0644
`/etc/ynx-developer/helpers/native-zfs-quota.mjs` under root-owned0755 parents.
The helper uses only builtins; it is not imported from mutable workspace code.
Install root-owned0644 `/etc/ynx-developer/native-zfs.json` with EXACT keys:
`pool`, `projectsRoot`, `serviceUid`, `serviceGid`, `maxBytes`,
`zfsExecutable`, `libraryDirectory`. Resolve the actual snap revision FIRST;
never configure `current` symlinks. The tool must be
`/snap/lxd/<actual-numeric-revision>/zfs-2.2/bin/zfs` and matching `lib` directory.
Use actual numeric `id -u ubuntu`/`id -g ubuntu`, not an assumed guest UID.
`projectsRoot` is fixed `/var/lib/ynx-native/projects`, outside caller-owned state, and
`maxBytes` is1073741824. The new pool/helper/config must not reuse or relimit
old guest paths, the default dir pool, Btrfs recovery or any old runtime.

A may install a narrowly reviewed sudo rule for ubuntu allowing only
`/usr/bin/node /etc/ynx-developer/helpers/native-zfs-quota.mjs *`, with env_reset,
no SETENV, and deletion of NODE_OPTIONS/NODE_PATH/LD_PRELOAD/LD_LIBRARY_PATH.
The helper additionally requires root EUID, exact SUDO_UID, exact schema,
protected root-owned code/config/snap paths, only prepare/verify actions and
exact64hex/64hex native project paths. It never accepts ZFS CLI passthrough,
-p creation, destroy/rollback, quota alteration of an existing path, or arbitrary
pool/dataset names. Prepare failure leaves the exact new resource for review;
retry must verify/recover it, never delete or overwrite. This is no grant of
host privileges to workspace processes. Backend subprocesses have a fixed
clean environment; matching LD_LIBRARY_PATH is scoped only to the root tool.

A's new-only installation order (review each concrete path first):

1. Run the read-only doctor; confirm fixed tool/library version, root available
   space and actual ubuntu UID/GID. Reserve32GiB project backing plus64GiB new
   LXD root pool and an explicit host disk/RAM reserve; a sparse file or max=8
   is not proof. Do not proceed if these reserves cannot fit. Initial QA admits
   one active runtime; any later4-global/2-owner bound remains a configuration,
   not tested multi-user capacity.
2. On an unused root-owned `/var/lib/ynx-native` path create a NEW32GiB backing
   file with fallocate (refuse any existing file). Use the fixed snap zpool tool
   and matching library ONLY to create `ynx-core-projects`, with cachefile none,
   mountpoint none, devices/setuid off; then create its `projects` parent with
   mountpoint none. Never -f overwrite a pool or wipe a device. Record exact
   pool GUID/backing inode/file size/source candidate and successful commands.
   Partial failure keeps file/pool/journal unchanged for operator inspection.
3. Create the NEW LXD root pool `ynx-core-quota` using its supported ZFS driver
   with explicit64GiB bound. Existing default dir pool remains unchanged. Mount
   each project dataset at its exact Gateway path through the helper. Wire the
   existing protected operator adapter's `projectStorage` to this provider.
   Artifact verification remains the existing officialx64 and separate derived
   branding hash runbook; do not substitute an ARM archive or modify its SHA.
4. In a NEW synthetic QA project, verify helper prepare+quota/findmnt, repeat
   prepare refusal and readonly verify; actual quota-full write fails without
   data deletion; then A's exact isolated LXD UID1000 write0600 must be readable
   and fsyncable by Gateway ubuntu without777/unisolatedroot; Stop/checkpoint
   and reopen must preserve bytes. Keep receipts for all four boundaries and
   every partial failure. These are NOT_RUN on host by this source author.

Strict package/extension egress remains NOT_ADMITTED. The raw CONNECT prototype
was removed from product source and preserved only under
`/tmp/ynx-native-package-proxy-not-admitted-20261002`; public-DNS IP pinning does
not constrain TLS SNI/encrypted HTTP authority. Do not set network.allowlisted
true from it. Official OpenVSX YAML download302 targets exact
`openvsx.eclipsecontent.org`; a future reviewed mature proxy must prove normal
OpenVSX/npm/pip installation/redirect success plus negative paths. No CA/MITM,
new user account, gateway restart or host proxy service was introduced here.
Independent execution domain and formal5minute grant renewal remain separate
Root/A gates. Quota source/fixtures are not a claim of public native readiness.

### Protected ZFS namespace (required successor to5eae)
New ZFS projects use fixed /var/lib/ynx-native/projects, with every ancestor root-owned and no group/other write. Owner slots are root-owned0711; only mounted project roots become Gateway-owned0700. The service consumes projectStorage.projectsRoot through the LXD driver; previously journaled project paths remain unchanged for Stop/recovery. No caller-owned ancestor may be admitted to the privileged helper.
Operator installation: stage reviewed installer/helper in a root-owned directory, record actual ubuntu UID/GID and fixed numeric snap revision in /etc/ynx-developer/native-install.json. Run node scripts/native-zfs-install.mjs for a non-mutating plan; only A may run --apply after reviewing the plan. Fixed new resources: ynx-core-projects32GiB, ynx-core-quota64GiB, /var/lib/ynx-native/projects-vdev.bin,48GiB root reserve. Existing names, paths or install journal refuse reinstallation; failure preserves every resource and journal. sudo is not approved until independent TOCTOU review passes. Actual quota-full, shifted UID0600 Gateway checkpoint, strict package egress, unrelated execution origin and grant renewal remain NOT_VERIFIED. Raw CONNECT prototype is NOT_ADMITTED.
