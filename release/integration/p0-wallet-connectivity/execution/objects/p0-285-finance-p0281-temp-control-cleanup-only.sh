#!/bin/bash
set -euo pipefail
umask 077

expected_lease_id='P0-WALLET-CONNECTIVITY-2026-08-finance-p0281-temp-control-cleanup-only-20260823T173600Z'
test "$#" -eq 1
test "$1" = "$expected_lease_id"

executor='/tmp/ynx-finance-p0281-finance-p0279-control-cleanup-20260823T170900Z.executor.sh'
lease='/tmp/ynx-finance-p0281-finance-p0279-control-cleanup-20260823T170900Z.json'

verify_exact() {
  local path=$1 expected_tuple=$2 expected_sha=$3
  test -f "$path"
  test ! -L "$path"
  test "$(stat -c '%d:%i:%u:%g:%a:%h:%s:%F' -- "$path")" = "$expected_tuple"
  test "$(sha256sum -- "$path" | awk '{print $1}')" = "$expected_sha"
}

verify_both() {
  verify_exact "$executor" '64770:159:0:0:700:1:2441:regular file' 'b33ebfe0b4a4da027f7db3d64672d8b73b6e7e714bcb0def304f4fed9fa5403b'
  verify_exact "$lease" '64770:12255:0:0:600:1:2172:regular file' '11c0ec664f5601919d016555a57cb815dac09ba69f8d67a54ef8727ca949f93f'
}

verify_both
verify_both
rm -- "$executor" "$lease"
test ! -e "$executor"
test ! -L "$executor"
test ! -e "$lease"
test ! -L "$lease"

printf '%s\n' \
  'cleanup=P0281_TEMP_CONTROLS_REMOVED' \
  'executorFinal=absent' \
  'leaseFinal=absent' \
  'cleanupInvocationCount=1' \
  'remoteExitStatus=0'
