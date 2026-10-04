#!/bin/sh
# Dormant local JNI codec QA, no account/device/activation/deployment effects.
set -eu
social=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
stage=$(mktemp -d /tmp/social-veil-backup-jni-20261004.XXXXXX)
java=/Library/Java/JavaVirtualMachines/zulu-24.jdk/Contents/Home
sodium=/private/tmp/social-sodium-1.0.22-20261004.uObpkK/sodium/src/libsodium/include
library="$social/evidence/sodium-1.0.22-exact-20261004/local-libsodium-1.0.22.a"
printf 'jni_stage=%s\n' "$stage"
shasum -a 256 "$social/crypto-engine/sodium/veil_backup.c" \
  "$social/crypto-engine/sodium/veil_backup.h" \
  "$social/crypto-engine/sodium/veil_backup_jni.c" "$library" \
  "$sodium/sodium.h" "$java/include/jni.h" > "$stage/inputs.sha256"
clang -std=c11 -Wall -Wextra -Werror -fPIC -dynamiclib \
  -I"$java/include" -I"$java/include/darwin" -I"$sodium" \
  "$social/crypto-engine/sodium/veil_backup.c" \
  "$social/crypto-engine/sodium/veil_backup_jni.c" "$library" \
  -o "$stage/libynx_veil_backup_qa.dylib" > "$stage/native-compile.txt" 2>&1
export VEIL_BACKUP_LIBRARY="$stage/libynx_veil_backup_qa.dylib"
shasum -a 256 "$VEIL_BACKUP_LIBRARY" > "$stage/library.sha256"
exec sh "$social/scripts/veil-libsignal-qa/backup-qa-env.sh"
