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

Provision new storage only: LXD Btrfs pool `ynx-core-quota` (64 GiB initial
bounded backing device/file), isolated profile `ynx-core-isolated`, and a
separate Btrfs mount at `<gateway-state>/native-ide/projects` (32 GiB initial
bounded backing device/file). Enable Btrfs quota on that new project mount.
The source creates one subvolume per owner/project, sets and rechecks a 1 GiB
referenced-byte qgroup limit, and rejects inconsistent quota accounting.
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
