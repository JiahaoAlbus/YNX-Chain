#!/bin/sh
set -eu

directory=${1:?Pass the directory containing the original runner export}
expected_image=${2:?Pass the image ID from the reviewed runner evidence}
expected_archive=${3:?Pass the archive SHA-256 from the reviewed runner evidence}
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
cd -- "$directory"

printf '%s\n' "$expected_image" | grep -Eq '^sha256:[0-9a-f]{64}$'
printf '%s\n' "$expected_archive" | grep -Eq '^[0-9a-f]{64}$'
test "$(cat IMAGE-ID)" = "$expected_image"

# The input path can be replaced after a checksum. Copy first into a private
# directory, then hash and load that same snapshot. Operators may choose a
# different filesystem with enough free space for the temporary image copy.
umask 077
stage_root=${YNX_CLOUD_IMAGE_STAGE_DIR:-$(pwd -P)}
case "$stage_root" in
  /*) ;;
  *) echo "Image staging directory must be absolute" >&2; exit 1 ;;
esac
stage_dir=$(mktemp -d "${stage_root%/}/.ynx-cloud-image.XXXXXXXX")
snapshot="$stage_dir/cloud-native-image.tar"
cleanup() {
  rm -f -- "$snapshot"
  rmdir -- "$stage_dir" 2>/dev/null || :
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cp -- cloud-native-image.tar "$snapshot"
chmod 0400 "$snapshot"
actual_archive=$(sha256sum < "$snapshot")
actual_archive=${actual_archive%% *}
test "$actual_archive" = "$expected_archive"

docker image load --input "$snapshot"
test "$(docker image inspect --format '{{.Id}}' "$expected_image")" = "$expected_image"
sh "$script_dir/verify-protected-cloud-image.sh" "$expected_image"
