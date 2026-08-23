#!/usr/bin/env bash
set -euo pipefail

declare -A ID_PATH ID_KIND ID_DEV ID_INO ID_UID ID_GID ID_MODE ID_NLINK ID_ACTIVE TERM_BYTES TERM_SHA

stat_identity() {
  local path="$1"
  if stat --version >/dev/null 2>&1; then
    stat -Lc '%d %i %u %g %a %h' "$path"
  else
    stat -f '%d %i %u %g %Lp %l' "$path"
  fi
}

stat_bytes() {
  local path="$1"
  if stat --version >/dev/null 2>&1; then stat -Lc '%s' "$path"; else stat -f '%z' "$path"; fi
}

sha256_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$path" | awk '{print $1}'; else shasum -a 256 "$path" | awk '{print $1}'; fi
}

capture_identity() {
  local label="$1" path="$2" kind="$3" dev ino uid gid mode nlink
  test ! -L "$path" || return 1
  if [[ "$kind" == file ]]; then test -f "$path" || return 1; else test -d "$path" || return 1; fi
  read -r dev ino uid gid mode nlink < <(stat_identity "$path") || return 1
  ID_PATH[$label]="$path"; ID_KIND[$label]="$kind"; ID_DEV[$label]="$dev"; ID_INO[$label]="$ino"
  ID_UID[$label]="$uid"; ID_GID[$label]="$gid"; ID_MODE[$label]="$mode"; ID_NLINK[$label]="$nlink"; ID_ACTIVE[$label]=1
}

refresh_identity() {
  local label="$1"
  capture_identity "$label" "${ID_PATH[$label]}" "${ID_KIND[$label]}"
}

bind_hardlink_alias() {
  local label="$1" path="$2" source="$3"
  ID_PATH[$label]="$path"; ID_KIND[$label]=file; ID_DEV[$label]="${ID_DEV[$source]}"; ID_INO[$label]="${ID_INO[$source]}"
  ID_UID[$label]="${ID_UID[$source]}"; ID_GID[$label]="${ID_GID[$source]}"; ID_MODE[$label]="${ID_MODE[$source]}"
  ID_NLINK[$label]="${ID_NLINK[$source]}"; ID_ACTIVE[$label]=1
}

assert_identity() {
  local label="$1" path actual expected
  path="${ID_PATH[$label]}"
  test "${ID_ACTIVE[$label]:-0}" = 1 || return 1
  test ! -L "$path" || return 1
  if [[ "${ID_KIND[$label]}" == file ]]; then test -f "$path" || return 1; else test -d "$path" || return 1; fi
  actual="$(stat_identity "$path")" || return 1
  expected="${ID_DEV[$label]} ${ID_INO[$label]} ${ID_UID[$label]} ${ID_GID[$label]} ${ID_MODE[$label]} ${ID_NLINK[$label]}"
  test "$actual" = "$expected" || return 1
}

freeze_terminal_file() {
  local label="$1" path bytes sha
  assert_identity "$label" || return 1
  path="${ID_PATH[$label]}"; bytes="$(stat_bytes "$path")" || return 1; sha="$(sha256_file "$path")" || return 1
  assert_identity "$label" || return 1
  test "$(stat_bytes "$path")" = "$bytes" || return 1
  test "$(sha256_file "$path")" = "$sha" || return 1
  TERM_BYTES[$label]="$bytes"; TERM_SHA[$label]="$sha"
}

unlink_frozen_file() {
  local label="$1" path
  path="${ID_PATH[$label]}"
  freeze_terminal_file "$label" || return 1
  assert_identity "$label" || return 1
  test "$(stat_bytes "$path")" = "${TERM_BYTES[$label]}" || return 1
  test "$(sha256_file "$path")" = "${TERM_SHA[$label]}" || return 1
  unlink "$path" || return 1
  test ! -e "$path" && test ! -L "$path" || return 1
  ID_ACTIVE[$label]=0
}

rmdir_frozen() {
  local label="$1" path
  path="${ID_PATH[$label]}"
  assert_identity "$label" || return 1
  test -z "$(find "$path" -mindepth 1 -maxdepth 1 -print -quit)" || return 1
  rmdir "$path" || return 1
  test ! -e "$path" && test ! -L "$path" || return 1
  ID_ACTIVE[$label]=0
}

self_test() {
  local root original_inode
  root="$(mktemp -d)"
  trap 'chmod -R u+rwx "$root" 2>/dev/null || true; rm -rf "$root"' RETURN

  mkdir "$root/stage"; chmod 700 "$root/stage"; capture_identity stage "$root/stage" dir
  (umask 077; set -C; : > "$root/stage/partial")
  capture_identity partial "$root/stage/partial" file
  printf 'partial-upload' >> "$root/stage/partial"
  freeze_terminal_file partial
  test "${TERM_BYTES[partial]}" = 14
  unlink_frozen_file partial
  rmdir_frozen stage

  mkdir "$root/symlink-case"; printf 'owned' > "$root/symlink-case/file"; capture_identity symlink_file "$root/symlink-case/file" file
  mv "$root/symlink-case/file" "$root/symlink-case/original"
  ln -s "$root/symlink-case/original" "$root/symlink-case/file"
  if freeze_terminal_file symlink_file 2>/dev/null; then return 81; fi
  test -L "$root/symlink-case/file" && test -f "$root/symlink-case/original"

  mkdir "$root/inode-case"; printf 'same' > "$root/inode-case/file"; capture_identity inode_file "$root/inode-case/file" file
  original_inode="${ID_INO[inode_file]}"
  printf 'same' > "$root/inode-case/replacement"; mv -f "$root/inode-case/replacement" "$root/inode-case/file"
  test "$(stat_identity "$root/inode-case/file" | awk '{print $2}')" != "$original_inode"
  if freeze_terminal_file inode_file 2>/dev/null; then return 82; fi
  test -f "$root/inode-case/file"

  mkdir "$root/success"; capture_identity success_stage "$root/success" dir
  printf 'receipt' > "$root/success/receipt"; chmod 400 "$root/success/receipt"; capture_identity success_receipt "$root/success/receipt" file
  printf 'backup' > "$root/success/backup"; chmod 644 "$root/success/backup"; capture_identity success_backup "$root/success/backup" file
  unlink_frozen_file success_backup; unlink_frozen_file success_receipt; rmdir_frozen success_stage

  mkdir "$root/rollback-stage"; capture_identity rollback_stage "$root/rollback-stage" dir
  printf 'candidate' > "$root/rollback-live"; chmod 644 "$root/rollback-live"
  printf 'base' > "$root/rollback-backup"; chmod 644 "$root/rollback-backup"; capture_identity rollback_backup "$root/rollback-backup" file
  printf 'artifact' > "$root/rollback-target"; chmod 644 "$root/rollback-target"; capture_identity rollback_target "$root/rollback-target" file
  printf 'receipt' > "$root/rollback-stage/receipt"; chmod 400 "$root/rollback-stage/receipt"; capture_identity rollback_receipt "$root/rollback-stage/receipt" file
  unlink_frozen_file rollback_target
  ln "$root/rollback-backup" "$root/rollback-restore"
  mv -f "$root/rollback-restore" "$root/rollback-live"
  test "$(sha256_file "$root/rollback-live")" = "$(sha256_file "$root/rollback-backup")"
  refresh_identity rollback_backup
  unlink_frozen_file rollback_backup; unlink_frozen_file rollback_receipt; rmdir_frozen rollback_stage

  printf 'terminal_finalizer_self_test=pass scenarios=prepare-empty,upload-partial,publish-success,rollback,symlink-preserved,inode-substitution-preserved\n'
}

if [[ "${1:-}" == --self-test ]]; then
  self_test
  exit 0
fi

request_id='P0-WALLET-CHROME-ZIP-PUBLICATION-20260823-02'
: "${YNX_CENTRAL_SINGLE_USE_LEASE_ID:?Central lease ID is required}"
test "${YNX_DOWNLOADS_PUBLICATION_EXECUTION_ACK:-}" = "${request_id}:EXECUTE"
test "$(id -u)" = 0
test "$(uname -s)" = Linux

entry='/etc/caddy/Caddyfile'
live='/etc/caddy/conf.d/downloads.ynxweb4.com.caddy'
downloads='/opt/ynx/public-downloads'
wallet="$downloads/wallet"
stage="$downloads/.${request_id}.stage"
receipt="$stage/early-identity.receipt"
uploaded_zip="$stage/ynx-wallet-chrome-edge-0.1.0.zip.upload"
uploaded_caddy="$stage/downloads.ynxweb4.com.candidate.caddy.upload"
headers="$stage/public-get.headers"
public_get="$stage/public-get.zip"
target_dir="$wallet/sha256-2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d"
target="$target_dir/ynx-wallet-chrome-edge-0.1.0.zip"
backup="${live}.rollback-${request_id}"
next="${live}.next-${request_id}"
restore="${live}.restore-${request_id}"
sentinel="$wallet/sha256-69b4fa5db7b8a9ab105af6633de44f5a5a4a9fceeaa0925a306f77b22381b044/ynx-wallet-macos-0.1.2-universal.dmg"
official_url='https://downloads.ynxweb4.com/wallet/sha256-2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d/ynx-wallet-chrome-edge-0.1.0.zip'

stage_created=0; target_dir_created=0; target_created=0; next_created=0; config_swapped=0; backup_created=0; publication_success=0; finalizer_running=0

assert_exact_stat() {
  local path="$1" expected="$2" actual
  test ! -L "$path"; actual="$(stat_identity "$path") $(stat_bytes "$path")"; test "$actual" = "$expected"
}

assert_stage_known() {
  local child known label
  while IFS= read -r child; do
    known=0
    for label in receipt uploaded_zip uploaded_caddy headers public_get; do
      if [[ "${ID_ACTIVE[$label]:-0}" == 1 && "${ID_PATH[$label]}" == "$child" ]]; then known=1; break; fi
    done
    test "$known" = 1 || return 1
  done < <(find "$stage" -mindepth 1 -maxdepth 1 -print)
}

verify_all_active_stage_files() {
  local label
  assert_identity stage || return 1
  assert_stage_known || return 1
  for label in receipt uploaded_zip uploaded_caddy headers public_get; do
    if [[ "${ID_ACTIVE[$label]:-0}" == 1 ]]; then freeze_terminal_file "$label" || return 1; fi
  done
}

restore_prior_config() {
  test "$config_swapped" = 1 && test "$backup_created" = 1 || return 1
  assert_identity backup || return 1
  test "$(sha256_file "$backup")" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f' || return 1
  freeze_terminal_file live_candidate || return 1
  test "${TERM_BYTES[live_candidate]}" = 1749 || return 1
  test "${TERM_SHA[live_candidate]}" = '9a3869d606e318540ec773e97c92f4f7b610852a3560a7aea7b256f0b3a77770' || return 1
  test ! -e "$restore" && test ! -L "$restore" || return 1
  ln "$backup" "$restore" || return 1
  capture_identity restore "$restore" file || return 1
  if ! mv -T "$restore" "$live"; then unlink_frozen_file restore || true; return 1; fi
  ID_ACTIVE[restore]=0; ID_ACTIVE[live_candidate]=0
  /usr/bin/caddy validate --config "$entry" --adapter caddyfile || return 1
  /usr/bin/systemctl reload caddy || return 1
  /usr/bin/systemctl is-active --quiet caddy || return 1
  test "$(sha256_file "$live")" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f' || return 1
  config_swapped=0
  refresh_identity backup
}

receipt_append() {
  assert_identity receipt || return 1
  chmod 0600 "$receipt" || return 1; refresh_identity receipt || return 1
  printf '%s %s\n' "$1" "$2" >> "$receipt" || return 1
  chmod 0400 "$receipt" || return 1; refresh_identity receipt || return 1
}

terminal_finalize() {
  local original_rc="$1" label cleanup_rc=0
  test "$finalizer_running" = 0 || return 99
  finalizer_running=1
  set +e

  if [[ "$stage_created" == 1 ]]; then verify_all_active_stage_files || cleanup_rc=1; fi
  if [[ "$target_created" == 1 ]]; then freeze_terminal_file target || cleanup_rc=1; assert_identity target_dir || cleanup_rc=1; fi
  if [[ "$target_dir_created" == 1 && "$target_created" != 1 ]]; then assert_identity target_dir || cleanup_rc=1; fi
  if [[ "$next_created" == 1 ]]; then freeze_terminal_file next || cleanup_rc=1; fi
  if [[ "$config_swapped" == 1 ]]; then freeze_terminal_file live_candidate || cleanup_rc=1; fi
  if [[ "$backup_created" == 1 ]]; then freeze_terminal_file backup || cleanup_rc=1; fi
  if [[ "$cleanup_rc" != 0 ]]; then
    printf 'FINALIZER_FOREIGN_IDENTITY_PRESERVED request=%s original_rc=%s\n' "$request_id" "$original_rc" >&2
    return 90
  fi

  if [[ "$original_rc" != 0 || "$publication_success" != 1 ]]; then
    if [[ "$next_created" == 1 ]]; then
      unlink_frozen_file next || return 90
      next_created=0
      if [[ "${ID_ACTIVE[uploaded_caddy]:-0}" == 1 ]]; then refresh_identity uploaded_caddy || return 90; fi
    fi
    if [[ "$target_created" == 1 ]]; then
      test "${TERM_BYTES[target]}" = 471181 || return 90
      test "${TERM_SHA[target]}" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d' || return 90
      test "$(find "$target_dir" -mindepth 1 -maxdepth 1 -print | wc -l | tr -d ' ')" = 1 || return 90
      unlink_frozen_file target || return 90
      target_created=0
    fi
    if [[ "$target_dir_created" == 1 ]]; then rmdir_frozen target_dir || return 90; target_dir_created=0; fi
    if [[ "$config_swapped" == 1 ]]; then restore_prior_config || return 90; fi
  fi

  if [[ "$backup_created" == 1 ]]; then
    refresh_identity backup || return 90
    freeze_terminal_file backup || return 90
    test "${TERM_BYTES[backup]}" = 1441 || return 90
    test "${TERM_SHA[backup]}" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f' || return 90
    unlink_frozen_file backup || return 90
    backup_created=0
  fi

  if [[ "$stage_created" == 1 ]]; then
    verify_all_active_stage_files || return 90
    for label in public_get headers uploaded_caddy uploaded_zip receipt; do
      if [[ "${ID_ACTIVE[$label]:-0}" == 1 ]]; then unlink_frozen_file "$label" || return 90; fi
    done
    rmdir_frozen stage || return 90
    stage_created=0
  fi
  printf 'TERMINAL_RESIDUE_CLEAN request=%s original_rc=%s publication_success=%s\n' "$request_id" "$original_rc" "$publication_success"
  return 0
}

on_exit() {
  local rc=$? final_rc
  trap - EXIT HUP INT TERM
  terminal_finalize "$rc"; final_rc=$?
  if [[ "$final_rc" != 0 ]]; then exit "$final_rc"; fi
  exit "$rc"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

assert_exact_stat / '64770 2 0 0 755 24 4096'
assert_exact_stat /opt '64770 131076 0 0 755 16 4096'
assert_exact_stat /opt/ynx '64770 1312502 0 0 755 49 4096'
assert_exact_stat "$downloads" '64770 2528711 0 0 755 3 4096'
assert_exact_stat "$wallet" '64770 2528712 0 0 755 6 4096'
assert_exact_stat /etc/caddy '64770 1051238 0 0 755 3 4096'
assert_exact_stat /etc/caddy/conf.d '64770 1051258 0 0 755 2 4096'
assert_exact_stat "$entry" '64770 1051746 0 0 644 1 928'
assert_exact_stat "$live" '64770 1055513 0 0 644 1 1441'
test "$(sha256_file "$entry")" = '077fe80ea9aab24a32d64ba1fab3584e8aab10304e200e58d976d2c33edfb39f'
test "$(sha256_file "$live")" = '5149252cde4b3cba5b2e89c5d5d0f3e94506fa69beb7b10526e41dcee3cb1f1f'
assert_exact_stat "$sentinel" '64770 2528715 0 0 644 1 237777236'
test "$(sha256_file "$sentinel")" = '69b4fa5db7b8a9ab105af6633de44f5a5a4a9fceeaa0925a306f77b22381b044'
for absent in "$stage" "$target_dir" "$target" "$backup" "$next" "$restore"; do test ! -e "$absent" && test ! -L "$absent"; done

mkdir -m 0700 "$stage"
capture_identity stage "$stage" dir; stage_created=1

(umask 077; set -C; : > "$receipt")
capture_identity receipt "$receipt" file
printf 'STAGE %s\n' "$(stat_identity "$stage")" >> "$receipt"

(umask 077; set -C; : > "$uploaded_zip")
capture_identity uploaded_zip "$uploaded_zip" file
printf 'UPLOAD_ZIP %s\n' "$(stat_identity "$uploaded_zip")" >> "$receipt"

(umask 077; set -C; : > "$uploaded_caddy")
capture_identity uploaded_caddy "$uploaded_caddy" file
printf 'UPLOAD_CADDY %s\n' "$(stat_identity "$uploaded_caddy")" >> "$receipt"
chmod 0400 "$receipt"; refresh_identity receipt

dd iflag=fullblock bs=471181 count=1 of="$uploaded_zip" status=none
dd iflag=fullblock bs=1749 count=1 of="$uploaded_caddy" status=none
if IFS= read -r -n 1 _extra; then printf 'TRANSPORT_EXTRA_BYTES\n' >&2; exit 75; fi
test "$(stat_bytes "$uploaded_zip")" = 471181
test "$(sha256_file "$uploaded_zip")" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'
test "$(stat_bytes "$uploaded_caddy")" = 1749
test "$(sha256_file "$uploaded_caddy")" = '9a3869d606e318540ec773e97c92f4f7b610852a3560a7aea7b256f0b3a77770'
/usr/bin/caddy validate --config "$uploaded_caddy" --adapter caddyfile

mkdir -m 0755 "$target_dir"; capture_identity target_dir "$target_dir" dir; target_dir_created=1
ln "$uploaded_zip" "$target"; capture_identity target "$target" file; target_created=1
unlink "$uploaded_zip"; ID_ACTIVE[uploaded_zip]=0; refresh_identity target
receipt_append TARGET "$(stat_identity "$target") $(stat_bytes "$target") $(sha256_file "$target")"
test "$(stat_bytes "$target")" = 471181
test "$(sha256_file "$target")" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'

ln "$live" "$backup"; capture_identity backup "$backup" file; backup_created=1
ln "$uploaded_caddy" "$next"; capture_identity next "$next" file; next_created=1
bind_hardlink_alias live_candidate "$live" next
mv -T "$next" "$live"
ID_ACTIVE[next]=0; next_created=0; config_swapped=1; refresh_identity backup
unlink "$uploaded_caddy"; ID_ACTIVE[uploaded_caddy]=0
refresh_identity live_candidate
receipt_append BACKUP "$(stat_identity "$backup") $(stat_bytes "$backup") $(sha256_file "$backup")"
receipt_append LIVE_CONFIG "$(stat_identity "$live") $(stat_bytes "$live") $(sha256_file "$live")"
test "$(stat_bytes "$live")" = 1749
test "$(sha256_file "$live")" = '9a3869d606e318540ec773e97c92f4f7b610852a3560a7aea7b256f0b3a77770'
/usr/bin/caddy validate --config "$entry" --adapter caddyfile
/usr/bin/systemctl reload caddy
/usr/bin/systemctl is-active --quiet caddy

(umask 077; set -C; : > "$headers"); capture_identity headers "$headers" file
(umask 077; set -C; : > "$public_get"); capture_identity public_get "$public_get" file
curl --fail --silent --show-error --connect-timeout 15 --max-time 180 -D "$headers" -o "$public_get" "$official_url"
assert_identity headers; assert_identity public_get
awk 'NR==1 {exit ($2 == 200 ? 0 : 1)}' "$headers"
tr -d '\r' < "$headers" | grep -Eiq '^content-type: application/zip$'
tr -d '\r' < "$headers" | grep -Eiq '^content-disposition: attachment; filename="ynx-wallet-chrome-edge-0.1.0.zip"$'
tr -d '\r' < "$headers" | grep -Eiq '^content-length: 471181$'
tr -d '\r' < "$headers" | grep -Eiq '^cache-control: public, max-age=31536000, immutable$'
tr -d '\r' < "$headers" | grep -Eiq '^x-content-type-options: nosniff$'
test "$(stat_bytes "$public_get")" = 471181
test "$(sha256_file "$public_get")" = '2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d'
assert_exact_stat "$sentinel" '64770 2528715 0 0 644 1 237777236'
test "$(sha256_file "$sentinel")" = '69b4fa5db7b8a9ab105af6633de44f5a5a4a9fceeaa0925a306f77b22381b044'

publication_success=1
printf 'PUBLICATION_GATE_PASS request=%s lease=%s bytes=471181 sha256=2491b66e46ed52a5fa450d2e808f05c5a8e22f1ebedd2daac87e767de636920d\n' "$request_id" "$YNX_CENTRAL_SINGLE_USE_LEASE_ID"
