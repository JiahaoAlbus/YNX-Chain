#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "sign" && "${2:-}" == "--digest-file" && "${4:-}" == "--signature-output" && "$#" == "5" ]] ||
  { echo "unexpected secure signer fixture arguments" >&2; exit 1; }
digest_file="$3"
signature_output="$5"
[[ -r "$digest_file" && -n "${YNX_DATA_FABRIC_FIXTURE_SIGNING_KEY:-}" ]] || exit 1
if [[ "${YNX_DATA_FABRIC_FIXTURE_INVALID_SIGNATURE:-0}" == "1" ]]; then
  openssl rand -out "$signature_output" 64
else
  openssl pkeyutl -sign -inkey "$YNX_DATA_FABRIC_FIXTURE_SIGNING_KEY" -rawin -in "$digest_file" -out "$signature_output"
fi
