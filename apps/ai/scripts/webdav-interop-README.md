# P08 S1 official WebDAV interoperability (no payment)

Scope: isolated synthetic local files only; original model/no-fast, core-first,
old Web/UI freeze, data/UNKNOWN and owner boundaries remain in force. These
scripts do not modify the parent Store/runtime, transport adapter, SDK/Auth,
normal CLI or release entry. No Nextcloud installation, production tenant,
real account or model execution is claimed.

## Fixed official upstreams and findings

* rclone v1.70.3 osx-arm64, MIT. Official archive and SHA256SUMS:
  https://downloads.rclone.org/v1.70.3/rclone-v1.70.3-osx-arm64.zip
  https://downloads.rclone.org/v1.70.3/SHA256SUMS
  Archive SHA256: `14a9c5eb9f699a749470c898974412092eee204d74d3395486e3307c255021f7`.
  https://github.com/rclone/rclone/releases/tag/v1.70.3
  https://raw.githubusercontent.com/rclone/rclone/v1.70.3/COPYING
  https://rclone.org/commands/rclone_serve_webdav/
  Actual probe: 8 checks passed, 1 failed. Duplicate `PUT If-None-Match:*`
  returned 201, overwriting existing bytes. Do not qualify it as create-only.
  The original failing evidence is retained; no upstream code was patched.

* WsgiDAV 4.3.3 (MIT) with cheroot 10.0.1 (BSD; its wheel contains
  `LICENSE.md`). Dependency licenses are retained individually rather than
  being described collectively as MIT. Official package sources:
  https://pypi.org/project/WsgiDAV/4.3.3/
  https://github.com/mar10/wsgidav/tree/v4.3.3
  https://raw.githubusercontent.com/mar10/wsgidav/v4.3.3/LICENSE
  Official WsgiDAV wheel SHA256:
  `8d96b0f05ad7f280572e99d1c605962a853d715f8e934298555d0c47ef275e88`.
  Nine fixed wheels total 722849 bytes. All hashes match the corresponding
  official PyPI release metadata, retained with the original license/source documents.
  Only the filesystem provider is enabled; no MySQL sample provider.
  Actual sequential probe: 9/9. Recovery/edge checks: 5/5. Two content ambiguity
  checks passed. A separate concurrent same-object observation returned
  **201 + 201**, so it does not provide atomic create-only or strong fencing.
  The official wheel request_server.py has CRLF, GitHub tag has LF; normalized
  source matches, raw bytes differ. Installed files have an exact hash manifest.

Nextcloud primary API reference (compatibility target, not actual deployment):
https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html
Nextcloud normally uses `/remote.php/dav/files/{user}/...`. The isolated
WsgiDAV server uses `/`; do not invent Nextcloud-specific behavior or call it
an accepted Nextcloud integration.

## Existing source/SDK reuse audit

No WebDAV/Nextcloud/rclone egress implementation was found in current
`apps/ai`, `internal/aiproduct`, `internal/aitaskclient` or `packages` before
this work. Reuse the parent's existing task, Grant, egress, dispatch and
immutable original-operation persistence. A separate transport owner supplies
`TaskWebDAVConfig` / `PrepareTaskWebDAVTransport`; these scripts do not create
a second Auth or SDK codec. Do not copy the probe into product transport.

## Isolation and resources

Evidence root:
`/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/owners/P08/webdav-interop-20261101`

Initial system free space ~1.7 GiB, external ~1.5 TiB. Docker CLI 27.4.0 exists
but daemon is unavailable, so `docker system df` could not measure its cache.
Docker.raw has 1 TiB apparent / ~23 GiB allocated; it was not changed or pruned.
No Docker image was downloaded and Docker Desktop was not launched. Official
archives, installed packages, cache, synthetic data and evidence live on the
external volume. Keep any later pip temp/cache on that volume as well.

## Parent handoff: live endpoints and secrets

Read external `HANDOFF.json` first; live process IDs are in
`wsgidav/evidence/upstream-live.json` and `fault-proxy-live.json`.

Direct endpoint at handoff: `http://127.0.0.1:54690/`.
Fault endpoint at handoff: `http://127.0.0.1:54752/`.
Only numeric loopback HTTP is allowed for this PUBLIC synthetic exercise.
Credentials are synthetic and stored only in 0600 private files:
`wsgidav/connection.private.json`, `wsgidav/fault-connection.private.json` and
`wsgidav/config.private.json`. Do not echo/cat them into logs or put credentials
in URLs, command arguments, public evidence, tickets or model inputs.

The parent's trusted local transport configuration should bind:

```
ProfileID = p08-official-wsgidav-synthetic
Origin = http://127.0.0.1:54690
User = p08-synthetic
Password = read privately from connection.private.json
Root = /
Object = one fixed unique synthetic filename, persisted BEFORE dispatch
MaxBytes = 1048576
PublicLoopback = true
```

For lost ACK, change only the immutable chosen test profile's Origin to the
fault endpoint **before** original dispatch. The proxy forwards PUT to the
real official server, waits for/drains the actual response, then drops it.
GET/HEAD pass through. It never implements DAV or synthesizes upload success.
The proxy's append-only log records method, original path, actual status,
request hash and dropped ACK, never Authorization or credential values.

The parent must durably reserve the original profile/object/operation/input
before PUT. After UNKNOWN or process restart, GET only the same original object;
never repeat PUT or choose a new object to manufacture success. Bytes/ETag
can establish CONTENT_PRESENT, not who authored it. A preexisting equal object
is not this caller's execution receipt. Different bytes are a mismatch; absent
is an observation at read time, not authorization to blindly replay UNKNOWN.
No target grant-generation fence, remote rollback, exclusive authorship or
exactly-once guarantee is supplied by ordinary DAV.

## Reproduce without old green suites

Run from `/Users/huangjiahao/Desktop/YNX Final Worktrees/14-ai`.
The external variable below is an isolation path, never HOME/CODEX_HOME.
Each probe creates a new synthetic collection and preserves its evidence.
Do not rerun old green groups just to repeat evidence.

```sh
P08_DAV_ROOT='/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/owners/P08/webdav-interop-20261101'

# First setup only: download the nine pinned official wheels (external temp).
/usr/bin/python3 apps/ai/scripts/webdav-interop-provision.py "$P08_DAV_ROOT" --download

# Check existing pinned wheels against primary PyPI metadata, without reinstall.
/usr/bin/python3 apps/ai/scripts/webdav-interop-provision.py "$P08_DAV_ROOT"

# Reinstall only if restoring the isolated dependency directory:
TMPDIR="$P08_DAV_ROOT/wsgidav/cache" /usr/bin/python3 -m pip install \
  --disable-pip-version-check --no-cache-dir --no-compile --no-deps \
  --no-index --find-links "$P08_DAV_ROOT/upstream/wheels" --require-hashes \
  --target "$P08_DAV_ROOT/upstream/wsgidav-site" \
  -r "$P08_DAV_ROOT/upstream/requirements.lock"

# Foreground official server, preserves original endpoint/auth/data on resume.
# Stop only the prior owned upstream before starting this command.
/usr/bin/python3 apps/ai/scripts/webdav-interop-wsgidav.py \
  "$P08_DAV_ROOT/wsgidav" --resume

# In a separate process, foreground ACK-drop forwarder (if not already live).
node apps/ai/scripts/webdav-interop-fault-proxy.mjs "$P08_DAV_ROOT/wsgidav"

# New/affected upstream behavior only, when the evidence requires it:
node apps/ai/scripts/webdav-interop-probe.mjs "$P08_DAV_ROOT/wsgidav"
node apps/ai/scripts/webdav-interop-recovery.mjs "$P08_DAV_ROOT/wsgidav"
node apps/ai/scripts/webdav-interop-observation.mjs "$P08_DAV_ROOT/wsgidav"
node apps/ai/scripts/webdav-interop-interrupted-put.mjs "$P08_DAV_ROOT/wsgidav"
```

The fresh-process recovery checker passes auth via its environment, not argv
or URL, and queries the exact stored object. Its small file journal is test
harness evidence **not parent Store/persistence acceptance**. The official
upstream was actually stopped and restarted at the same endpoint/credentials;
independent GET matched original SHA256 with zero recovery PUTs. Parent normal
CLI, Store transaction/restart, Current revocation checks, model result and
service/release validation remain separately owned and unclaimed.

To stop the two remaining isolated processes after parent integration, signal
only the recorded live upstream and proxy PIDs. Keep data/evidence/private
connection files for reconciliation; do not wipe or rebuild UNKNOWN objects.

A real interrupted request declared 65536 bytes but sent only 4096 before
disconnect. The official server retained a 4096-byte object and GET returned
200. The checker correctly classified CONTENT_MISMATCH, never completion;
zero recovery PUTs. HTTP 200 alone cannot qualify the upload.

## Exact original-object read command after restart (no PUT)

This reads the retained recovery binding and private credentials locally,
performs one GET of the exact stored original object, and prints only public
status/hash/ETag. It creates no replacement ID and does not dispatch a write.
The parent's own CLI/Store check must independently exercise its implementation.

```sh
node --input-type=module - <<'JS'
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = '/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/owners/P08/webdav-interop-20261101/wsgidav';
const c = JSON.parse(await readFile(root + '/connection.private.json', 'utf8'));
const original = JSON.parse(await readFile(root + '/evidence/latest-recovery.json', 'utf8')).restartReadback;
const response = await fetch(new URL(original.path, c.url), {
  headers: { Authorization: 'Basic ' + Buffer.from(c.username + ':' + c.password).toString('base64') },
  redirect: 'error', signal: AbortSignal.timeout(10000),
});
const bytes = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({
  originalObject: original.path,
  status: response.status,
  sha256: digest,
  exactContentMatch: response.status === 200 && digest === original.expectedSha256,
  etag: response.headers.get('etag'),
  recoveryPutAttempts: 0,
  authorProven: false,
}));
if (response.status !== 200 || digest !== original.expectedSha256) process.exitCode = 1;
JS
```

## CI delta: bounded RUNNER_TEMP, offline fixed-site installation

The Python provisioner and WsgiDAV launcher retain local `/Volumes/...`
operation. CI additionally requires `CI == "true"`, an absolute, existing,
non-root `RUNNER_TEMP`, and an isolation root whose resolved path is a strict
child of that resolved runner directory. Empty/relative/missing runner paths,
the runner root itself, sibling-prefix paths, traversal and escaping symlinks
are rejected. This is a synthetic runner environment, not a production tenant.
The Node historical probe scripts remain external-volume-only; they are not
required for the parent's Ubuntu Go E2E against the Python-launched upstream.

`webdav-interop-provision.py` does **not install** the site. It downloads only
with `--download`, verifies exactly the nine pinned wheels, and produces the
platform-specific `requirements.lock` with SHA256 hashes. Run this on the CI
runner so Linux wheels are selected; do not copy the macOS wheel set to Ubuntu.

Exact Ubuntu runner preparation and installation:

```sh
P08_DAV_ROOT="${RUNNER_TEMP:?}/p08-webdav-interop"
CI=true python3 apps/ai/scripts/webdav-interop-provision.py \
  "$P08_DAV_ROOT" --download
mkdir -p "$P08_DAV_ROOT/wsgidav/cache"
TMPDIR="$P08_DAV_ROOT/wsgidav/cache" python3 -m pip --isolated install \
  --disable-pip-version-check --no-cache-dir --no-compile --no-deps \
  --no-index --find-links "$P08_DAV_ROOT/upstream/wheels" --require-hashes \
  --target "$P08_DAV_ROOT/upstream/wsgidav-site" \
  -r "$P08_DAV_ROOT/upstream/requirements.lock"
CI=true python3 apps/ai/scripts/webdav-interop-wsgidav.py \
  "$P08_DAV_ROOT/wsgidav"
```

The launcher sets `PYTHONPATH` to exactly
`$P08_DAV_ROOT/upstream/wsgidav-site`, not an inherited PYTHONPATH. The lock
contains only WsgiDAV4.3.3, cheroot10.0.1, defusedxml0.7.1, Jinja2 3.1.6,
json5 0.9.28, PyYAML6.0.2, MarkupSafe2.1.5, jaraco.functools4.1.0 and
more-itertools10.5.0. `--no-index --no-deps --require-hashes` makes installation
use only those local verified wheels. Installation is a separate explicit step.

After normally stopping only that owned launcher/upstream, restart with:

```sh
CI=true python3 apps/ai/scripts/webdav-interop-wsgidav.py \
  "$P08_DAV_ROOT/wsgidav" --resume
```

Resume reads the existing config and connection binding, retains the exact
port/username/password and original data root, and does not rewrite config.
The parent can then run its new official-upstream Go integration tests against
the same endpoint, using its own normal CLI/Store reopening assertions.
No parent Go tests or old probes were run for this CI path delta.

Focused, offline delta check:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 apps/ai/scripts/webdav-interop-ci-guard.test.py
```

Result: 4 tests pass, including 32 guard boundary cases across both scripts,
help/rejected CLI side effects, exact nine pins/no install, and a mock child
process resume check. This mock is only a launcher control-flow check, not
replacement evidence for the earlier real upstream restart or parent E2E.
Existing 9+5 upstream evidence and synthetic data remain unchanged. The parent
owns normal Ctrl-C cleanup of sessions90243/67818; this delta does not restart,
stop, probe or rotate credentials on either retained live process.
