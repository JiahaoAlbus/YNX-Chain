#!/bin/bash

set -euo pipefail

if test -n "${YNX_ORIGINAL_KEYCHAINS_PATH:-}" && test -f "$YNX_ORIGINAL_KEYCHAINS_PATH"; then
  original_keychains=()
  while IFS= read -r keychain; do
    keychain="${keychain#"${keychain%%[![:space:]]*}"}"
    keychain="${keychain%"${keychain##*[![:space:]]}"}"
    keychain="${keychain#\"}"
    keychain="${keychain%\"}"
    test -z "$keychain" || original_keychains+=("$keychain")
  done < "$YNX_ORIGINAL_KEYCHAINS_PATH"
  security list-keychains -d user -s "${original_keychains[@]}"
  cmp -s "$YNX_ORIGINAL_KEYCHAINS_PATH" <(security list-keychains -d user)
fi

if test -n "${YNX_SIGNING_KEYCHAIN:-}" && test -f "$YNX_SIGNING_KEYCHAIN"; then
  security delete-keychain "$YNX_SIGNING_KEYCHAIN"
fi

if test -n "${YNX_NOTARY_KEY_PATH:-}" && test -f "$YNX_NOTARY_KEY_PATH"; then
  rm -f "$YNX_NOTARY_KEY_PATH"
fi

if test -n "${YNX_DEVELOPER_ID_P12_PATH:-}" && test -f "$YNX_DEVELOPER_ID_P12_PATH"; then
  rm -f "$YNX_DEVELOPER_ID_P12_PATH"
fi

if test -n "${YNX_ORIGINAL_KEYCHAINS_PATH:-}"; then
  rm -f "$YNX_ORIGINAL_KEYCHAINS_PATH"
fi
