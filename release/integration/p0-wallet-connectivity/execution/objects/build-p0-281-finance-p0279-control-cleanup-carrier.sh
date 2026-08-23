#!/bin/bash
set -euo pipefail
[[ $# = 1 ]] || exit 64
out=$1
root=/private/tmp/ynx-calendar-control-plane.y8FFQt/repo/release/integration/p0-wallet-connectivity/execution/objects
executor=$root/p0-281-finance-p0279-control-cleanup.sh
lease=$root/p0-281-finance-p0279-control-cleanup-signed-lease.json
test "$(wc -c < "$executor" | tr -d ' ')" = 2441
test "$(shasum -a 256 "$executor" | awk '{print $1}')" = b33ebfe0b4a4da027f7db3d64672d8b73b6e7e714bcb0def304f4fed9fa5403b
test "$(wc -c < "$lease" | tr -d ' ')" = 2172
test "$(shasum -a 256 "$lease" | awk '{print $1}')" = 11c0ec664f5601919d016555a57cb815dac09ba69f8d67a54ef8727ca949f93f
test ! -e "$out" && test ! -L "$out"
executor_b64=$(base64 < "$executor" | tr -d '\n')
lease_b64=$(base64 < "$lease" | tr -d '\n')
printf 'executor\t2441\tb33ebfe0b4a4da027f7db3d64672d8b73b6e7e714bcb0def304f4fed9fa5403b\t700\t%s\n' "$executor_b64" > "$out"
printf 'signedLease\t2172\t11c0ec664f5601919d016555a57cb815dac09ba69f8d67a54ef8727ca949f93f\t600\t%s\nEND\n' "$lease_b64" >> "$out"
