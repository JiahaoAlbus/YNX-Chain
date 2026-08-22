# Finance 7824 production-deployment lease request

This is a request only. It grants no production authority and no command in this
document has been executed. P0-141 is permanently nonreusable.

## Frozen candidate and fresh public truth

- Owner checkpoint: `5e094147832dca7ad72344f473dd150c30ffa1da`.
- Candidate source: `7824af677dd052d20321431381523ab302614d98` / tree
  `3db34ee2397a49852bbdf15e3841e7c9cecf9444`.
- Archive: `/tmp/ynx-finance-7824af677dd0-linux-amd64-p0146.tar.gz`, 3,937,491
  bytes, SHA-256 `d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d`.
- Candidate Linux amd64 root executable SHA-256:
  `cccdae8ae5b5f694ca7db68540da30582564ff741978e616f7435d448a20fe3e`.
- Fresh public read at `2026-08-22T07:33:09Z`: `/version` and `/health` were
  HTTP 200, but identify old release `ynx-finance-3b2383f5c18a`; their response
  digests are respectively `39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226`
  and `d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1`.

The read-only SSH preflight to the bound host was denied by authentication.
Consequently, old binary, environment, unit and Caddy values below are historical
rollback expectations—not fresh host proof. A new lease must independently bind
them before allowing any write.

## Lease-required preflight

The issuer must provide an immutable on-host `$approved_archive` path. It must
not permit substitution of the archive hash, target paths, or expected rollback
digests.

```sh
set -euo pipefail
current=/opt/ynx/finance-current
previous=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a
release=/opt/ynx/releases/finance/ynx-finance-7824af677dd0
env_file=/etc/ynx/finance.env
env_dir=/etc/ynx
expected_archive=d8dcd45174dd50c93ef45af7d10d36dc078d6f4982da08dc92b9470e8290a59d
expected_old_binary=0cc43c8a77c12975a0fcbada65971f08f2bc3a52345d547ea194dd3ccd60d83f
expected_old_env=854e7f1077e8fa4d5a4741918e25d04b0c1a109f2eb9c716b72dae918aa5f252
expected_unit=2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b
expected_caddy=dcf75a7aed315c54632321b8bb80e44c0abc22f6700fadfbfa9a7da21b88a282
expected_binary=cccdae8ae5b5f694ca7db68540da30582564ff741978e616f7435d448a20fe3e

test "$(uname -m)" = x86_64
test "$(readlink -f "$current")" = "$previous"
test ! -e "$release" && test ! -L "$release"
test "$(sha256sum "$previous/ynx-finance" | awk '{print $1}')" = "$expected_old_binary"
test "$(sha256sum "$env_file" | awk '{print $1}')" = "$expected_old_env"
test "$(sha256sum /etc/systemd/system/ynx-finance.service | awk '{print $1}')" = "$expected_unit"
test "$(sha256sum /etc/caddy/Caddyfile | awk '{print $1}')" = "$expected_caddy"
test "$(systemctl is-active ynx-finance)" = active
test "$(systemctl show ynx-finance -p WorkingDirectory --value)" = /opt/ynx/finance-current
systemctl cat ynx-finance | grep -Fqx 'ExecStart=/opt/ynx/finance-current/ynx-finance'
grep -Fqx 'YNX_FINANCE_WEB_DIR=/opt/ynx/releases/finance/ynx-finance-3b2383f5c18a/web' "$env_file"
test "$(sha256sum "$approved_archive" | awk '{print $1}')" = "$expected_archive"
```

## Frozen deployment and rollback procedure

Only a future single-use production lease may execute this section. `sync_path`
forces both file and parent-directory persistence; no environment values are
printed or logged.

```sh
sync_path() { python3 - "$1" <<'PY'
import os, sys
p = sys.argv[1]
fd = os.open(p, os.O_RDONLY); os.fsync(fd); os.close(fd)
dfd = os.open(os.path.dirname(p), os.O_RDONLY | os.O_DIRECTORY); os.fsync(dfd); os.close(dfd)
PY
}
stage=$(mktemp -d /opt/ynx/releases/finance/.finance-7824.XXXXXX)
tar -xzf "$approved_archive" -C "$stage"
candidate="$stage/ynx-finance-7824af677dd0"
test -d "$candidate" && test ! -L "$candidate"
test -x "$candidate/ynx-finance"
test "$(sha256sum "$candidate/ynx-finance" | awk '{print $1}')" = "$expected_binary"
(cd "$candidate" && sha256sum -c SHA256SUMS)
mkdir "$release"
cp -a "$candidate/." "$release/"
(cd "$release" && sha256sum -c SHA256SUMS)

read -r env_uid env_gid env_mode < <(stat -c '%u %g %a' "$env_file")
backup_env="$env_dir/.finance.env.7824af677dd0.rollback"
test ! -e "$backup_env" && test ! -L "$backup_env"
sync_path "$env_file"
ln "$env_file" "$backup_env"
test "$(sha256sum "$backup_env" | awk '{print $1}')" = "$expected_old_env"
env_tmp=$(mktemp "$env_dir/.finance.env.7824af677dd0.XXXXXX")
awk '!/^YNX_FINANCE_WEB_DIR=/' "$env_file" > "$env_tmp"
printf 'YNX_FINANCE_WEB_DIR=/opt/ynx/finance-current/web\n' >> "$env_tmp"
test "$(grep -c '^YNX_FINANCE_WEB_DIR=' "$env_tmp")" = 1
chown "$env_uid:$env_gid" "$env_tmp"; chmod "$env_mode" "$env_tmp"; sync_path "$env_tmp"

rollback() {
  set +e
  test "$(sha256sum "$backup_env" | awk '{print $1}')" = "$expected_old_env" || return 1
  restore_tmp=$(mktemp "$env_dir/.finance.env.rollback.XXXXXX")
  cp -a "$backup_env" "$restore_tmp" && sync_path "$restore_tmp" && mv -Tf "$restore_tmp" "$env_file"
  rollback_link="$current.rollback"
  test ! -e "$rollback_link" && test ! -L "$rollback_link" && ln -s "$previous" "$rollback_link" && mv -Tf "$rollback_link" "$current"
  systemctl restart ynx-finance
}
trap rollback EXIT
mv -Tf "$env_tmp" "$env_file"
next="$current.next"
test ! -e "$next" && test ! -L "$next"
ln -s "$release" "$next" && mv -Tf "$next" "$current"
systemctl restart ynx-finance
```

## Post-switch verifier and disarm condition

```sh
expected_version=162c534cfbbd6be97e2f2ef233caab2ec568f0d6a2fffdad85f48425c641bf02
for origin in http://127.0.0.1:6483 https://finance.ynxweb4.com; do
  version_body=$(curl --fail --silent --show-error --max-time 10 "$origin/version")
  test "$(printf '%s\n' "$version_body" | sha256sum | awk '{print $1}')" = "$expected_version"
  health_body=$(curl --fail --silent --show-error --max-time 10 "$origin/health")
  VERSION="$version_body" HEALTH="$health_body" node -e '
const v=JSON.parse(process.env.VERSION), h=JSON.parse(process.env.HEALTH);
if(v.commit!=="7824af677dd052d20321431381523ab302614d98"||v.release!=="ynx-finance-7824af677dd0"||v.buildTime!=="2026-08-21T17:16:13Z"||!h.ok||h.service!=="ynx-finance"||h.custody!=="none"||h.portfolio!=="read-only"||h.build.commit!==v.commit||h.build.release!==v.release) process.exit(1);'
done
test "$(curl --fail --silent --show-error --max-time 10 https://finance.ynxweb4.com/index.html | sha256sum | awk '{print $1}')" = 5d95950e9bccbd1012265b3f96eef6ddf2111b0dbd16315583060871ed5328ca
test "$(curl --fail --silent --show-error --max-time 10 https://finance.ynxweb4.com/wallet-connect.js | sha256sum | awk '{print $1}')" = 44a2054a7f58bf0458ff466a3f9c4d1a391adab20c321fef74977e8fa2fd4690
trap - EXIT
```

Any first failure leaves the trap armed. Rollback restores old environment bytes
before the old pointer, restarts Finance once, then requires old public `/version`
and `/health` response hashes. No retry is permitted under the same lease.
