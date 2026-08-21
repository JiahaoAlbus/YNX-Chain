# P0-143 Finance environment migration plan — source-only

P0-141 is released and nonreusable. P0-142's archive is unchanged. P0-143 corrects one verified fact: `/etc/ynx/finance.env` pins `YNX_FINANCE_WEB_DIR` to the old release, so a symlink-only cutover would serve old Web assets.

This is a precomputed plan, not a lease. It does not authorize SSH, upload, extraction, service restart, configuration mutation, or public deployment.

## Exact target and invariant

The next lease must change only this environment line:

```text
YNX_FINANCE_WEB_DIR=/opt/ynx/finance-current/web
```

The tracked unit starts `/opt/ynx/finance-current/ynx-finance`, so binary and Web assets follow the same atomic pointer. The plan does not print env contents or credentials, and preserves all non-WebDir lines in order.

## Future lease-only preflight

The future lease must bind the old hashes in [P0-143 evidence](evidence/p0-143-finance-env-migration-plan-20260821.json), provide `approved_archive`, and run as root.

```sh
set -euo pipefail
umask 077
current=/opt/ynx/finance-current
previous=$(readlink -f "$current")
release=/opt/ynx/releases/finance/ynx-finance-50892538dc23
expected_previous=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a
env_file=/etc/ynx/finance.env
env_dir=/etc/ynx
expected_old_env_sha=854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252
expected_archive_sha=a3df3d90c344bdfd4b49d89ad3e1d08f838f4d277b01c96aada18997e0ad0593
approved_archive=/approved/ynx-finance-50892538dc23-p0142-layout-candidate.tar.gz
test "$(uname -m)" = x86_64
test "$previous" = "$expected_previous"
test -d "$previous" && test ! -L "$previous"
test -r "$previous/ynx-finance" && test -x "$previous/ynx-finance"
test "$(sha256sum "$previous/ynx-finance" | awk '{print $1}')" = 0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f
test "$(sha256sum "$env_file" | awk '{print $1}')" = "$expected_old_env_sha"
read -r env_uid env_gid env_mode < <(stat -c '%u %g %a' "$env_file")
test "$(systemctl show ynx-finance -p WorkingDirectory --value)" = /opt/ynx/finance-current
systemctl cat ynx-finance | grep -Fqx 'ExecStart=/opt/ynx/finance-current/ynx-finance'
grep -Fqx 'YNX_FINANCE_WEB_DIR=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a/web' "$env_file"
test "$(sha256sum "$approved_archive" | awk '{print $1}')" = "$expected_archive_sha"
```

Extract and validate without replacing an existing release directory:

```sh
stage=$(mktemp -d /opt/ynx/releases/finance/.finance-p0143.XXXXXX)
tar -xzf "$approved_archive" -C "$stage"
candidate_dir="$stage/$(basename "$release")"
test -d "$candidate_dir" && test ! -L "$candidate_dir"
test -r "$candidate_dir/ynx-finance" && test -x "$candidate_dir/ynx-finance"
(cd "$candidate_dir" && sha256sum -c SHA256SUMS)
mkdir "$release"                         # atomic no-replace reservation
cp -a "$candidate_dir/." "$release/"
test -r "$release/ynx-finance" && test -x "$release/ynx-finance"
(cd "$release" && sha256sum -c SHA256SUMS)
```

## Same-directory env migration and rollback backup

The hard-link backup is atomic/no-replace and preserves exact old bytes, ownership and mode. `sync_path` fsyncs a file and its directory without logging credential values.

```sh
sync_path() { python3 - "$1" <<'PY'
import os, sys
p=sys.argv[1]
fd=os.open(p, os.O_RDONLY); os.fsync(fd); os.close(fd)
dfd=os.open(os.path.dirname(p), os.O_RDONLY | os.O_DIRECTORY); os.fsync(dfd); os.close(dfd)
PY
}
backup_env="$env_dir/.finance.env.p0143.$(basename "$release").rollback"
test ! -e "$backup_env"
sync_path "$env_file"
ln "$env_file" "$backup_env"            # atomic no-replace backup in same filesystem
sync_path "$backup_env"
test "$(sha256sum "$backup_env" | awk '{print $1}')" = "$expected_old_env_sha"
env_tmp=$(mktemp "$env_dir/.finance.env.p0143.$(basename "$release").XXXXXX")
chown root:root "$env_tmp"; chmod 0600 "$env_tmp"
awk '!/^YNX_FINANCE_WEB_DIR=/' "$env_file" >"$env_tmp"
printf 'YNX_FINANCE_WEB_DIR=/opt/ynx/finance-current/web\n' >>"$env_tmp"
test "$(grep -c '^YNX_FINANCE_WEB_DIR=' "$env_tmp")" = 1
test "$(awk '!/^YNX_FINANCE_WEB_DIR=/' "$env_file" | sha256sum | awk '{print $1}')" = "$(awk '!/^YNX_FINANCE_WEB_DIR=/' "$env_tmp" | sha256sum | awk '{print $1}')"
chown "$env_uid:$env_gid" "$env_tmp"; chmod "$env_mode" "$env_tmp"
sync_path "$env_tmp"
test "$(sha256sum "$env_file" | awk '{print $1}')" = "$expected_old_env_sha"
```

Only then may a new lease atomically replace the env and pointer. The rollback trap stays armed until all post-switch checks pass:

```sh
rollback() {
  test "$(sha256sum "$backup_env" | awk '{print $1}')" = "$expected_old_env_sha"
  restore_tmp=$(mktemp "$env_dir/.finance.env.rollback.XXXXXX")
  cp -a "$backup_env" "$restore_tmp"; sync_path "$restore_tmp"
  mv -Tf "$restore_tmp" "$env_file"
  ln -sfn "$previous" "$current.rollback"; mv -Tf "$current.rollback" "$current"
  systemctl daemon-reload; systemctl restart ynx-finance || true
}
trap rollback EXIT
mv -Tf "$env_tmp" "$env_file"
ln -sfn "$release" "$current.next"; mv -Tf "$current.next" "$current"
systemctl daemon-reload; systemctl restart ynx-finance
```

Before disarming the trap, require exact local and public version identity, semantic health, and new served asset hashes:

```sh
expected_version_sha=ebac56021442d176579c841215a27805b874b8238b8173b99e9ec4e388eb16c8
for origin in http://127.0.0.1:6483 https://finance.ynxweb4.com; do
  test "$(curl --fail --silent --show-error --max-time 10 "$origin/version" | sha256sum | awk '{print $1}')" = "$expected_version_sha"
  version_body=$(curl --fail --silent --show-error --max-time 10 "$origin/version")
  health_body=$(curl --fail --silent --show-error --max-time 10 "$origin/health")
  VERSION="$version_body" HEALTH="$health_body" node -e '
const v=JSON.parse(process.env.VERSION),h=JSON.parse(process.env.HEALTH);
if(v.commit!=="50892538dc237ef519d95c491f4b918a125a6c8e"||v.release!=="ynx-finance-50892538dc23"||!h.ok||h.service!=="ynx-finance"||h.custody!=="none"||h.portfolio!=="read-only"||h.build.commit!==v.commit||h.build.release!==v.release)process.exit(1);'
done
test "$(curl --fail --silent --show-error --max-time 10 https://finance.ynxweb4.com/index.html | sha256sum | awk '{print $1}')" = 5d95950e9bccbd1012265b3f96eef6ddf2111b0dbd16315583060871ed5328ca
test "$(curl --fail --silent --show-error --max-time 10 https://finance.ynxweb4.com/wallet-connect.js | sha256sum | awk '{print $1}')" = 44a2054a7f58bf0458ff466a3f9c4d1a391adab20c321fef74977e8fa2fd4690
trap - EXIT
```

Any failure invokes the exact environment-and-symlink rollback above, then requires the old public `/version` and `/health` hashes from P0-141.

No Wallet approval, Product Session, signature, transaction, installation or ComputerControl claim follows from this source-only plan.
