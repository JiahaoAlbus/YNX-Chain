#!/bin/bash

set -euo pipefail

if test -n "${YNX_IOS_ORIGINAL_KEYCHAINS_PATH:-}" && test -f "$YNX_IOS_ORIGINAL_KEYCHAINS_PATH"; then
  original_keychains=()
  while IFS= read -r keychain; do
    keychain="${keychain#"${keychain%%[![:space:]]*}"}"
    keychain="${keychain%"${keychain##*[![:space:]]}"}"
    keychain="${keychain#\"}"
    keychain="${keychain%\"}"
    test -z "$keychain" || original_keychains+=("$keychain")
  done < "$YNX_IOS_ORIGINAL_KEYCHAINS_PATH"
  security list-keychains -d user -s "${original_keychains[@]}"
  cmp -s "$YNX_IOS_ORIGINAL_KEYCHAINS_PATH" <(security list-keychains -d user)
fi

if test -n "${YNX_IOS_SIGNING_KEYCHAIN:-}" && test -f "$YNX_IOS_SIGNING_KEYCHAIN"; then
  security delete-keychain "$YNX_IOS_SIGNING_KEYCHAIN"
fi

for material in \
  "${YNX_IOS_DISTRIBUTION_P12_PATH:-}" \
  "${YNX_IOS_PROFILE_SOURCE_PATH:-}" \
  "${YNX_IOS_PROFILE_PLIST_PATH:-}" \
  "${YNX_IOS_PROFILE_INSTALLED_PATH:-}" \
  "${YNX_ASC_PRIVATE_KEY_PATH:-}" \
  "${YNX_ASC_PRIVATE_KEY_UPLOAD_COPY_PATH:-}" \
  "${YNX_IOS_ORIGINAL_KEYCHAINS_PATH:-}"; do
  test -z "$material" || rm -f "$material"
done
