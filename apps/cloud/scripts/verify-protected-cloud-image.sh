#!/bin/sh
set -eu

image=${1:?Pass the built Cloud image ID}
case "$image" in
  sha256:*) ;;
  *) echo "Pass an immutable image ID" >&2; exit 2 ;;
esac

test "$(docker image inspect --format '{{.Os}} {{.Config.User}} {{json .Config.Entrypoint}}' "$image")" = \
  'linux 10001:10001 ["/usr/local/bin/ynx-cloudd","-require-ide-deployment"]'

docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --entrypoint /bin/sh "$image" -ec '
    deps=$(ldd /usr/local/bin/ynx-cloudd)
    printf "%s\n" "$deps"
    ! printf "%s\n" "$deps" | grep -F "not found"
    printf "%s\n" "$deps" | grep -F "libssl.so.3 => /opt/ynx/openssl/lib/libssl.so.3"
    printf "%s\n" "$deps" | grep -F "libcrypto.so.3 => /opt/ynx/openssl/lib/libcrypto.so.3"
    test -f /opt/ynx/cloud-web/index.html
    test -f /opt/ynx/docs-web/index.html
    target=/var/lib/ynx-cloud/missing-config-check
    status=0
    output=$(/usr/local/bin/ynx-cloudd -require-ide-deployment -data "$target" 2>&1) || status=$?
    printf "%s\n" "$output"
    test "$status" -eq 1
    printf "%s\n" "$output" | grep -F "protected Cloud deployment requires the original Auth, runtime and V2 DATA configuration"
    test ! -e "$target"
  '
