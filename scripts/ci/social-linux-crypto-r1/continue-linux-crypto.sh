#!/usr/bin/env bash
set -euo pipefail
umask 077
prior="${1:?retained original crypto-build directory required}"
input="${2:?frozen Main r3 input directory required}"
out="${3:?new isolated output directory required}"
[[ ! -e "$out" ]] || { printf '%s\n' 'existing output must be reconciled, not retried'; exit 2; }
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || exit 2
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]] || { printf '%s\n' 'retained inputs were validated only for Ubuntu24.04 x86_64'; exit 2; }
cc='/usr/bin/x86_64-linux-gnu-gcc-13'
[[ "$($cc -dumpmachine)" == x86_64-linux-gnu ]] || exit 2
printf '%s  %s\n' '1b99826121ae6682a634e5efe09bd3e3df58ce58e0b28f849114ab5b89139c26' "$cc" | sha256sum -c -
(cd "$input" && sha256sum -c INPUT_SHA256SUMS)
python3 - "$prior" "$input/RETAINED_UPSTREAM_INPUTS.json" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]).resolve(); config=json.loads(pathlib.Path(sys.argv[2]).read_text())
for expected in config['files']:
 path=(root/expected['relative']).resolve()
 if not path.is_relative_to(root) or not path.is_file(): raise SystemExit('missing/escaping retained input '+expected['relative'])
 data=path.read_bytes()
 if len(data)!=expected['bytes'] or hashlib.sha256(data).hexdigest()!=expected['sha256']: raise SystemExit('retained input mismatch '+expected['relative'])
print('PASS all126 same-run retained source/header/library inputs')
PY
mkdir -m700 "$out"
exec > >(tee "$out/CONTINUE.log") 2>&1
selected="$prior/vendor/liboqs-5a1a854b0dc9f2141bdc771c555ee60c37950183/src/sig/ml_dsa/mldsa-native_ml-dsa-87_ref"
flags=(-std=c11 -O2 -fPIC -fvisibility=hidden -pthread -Wall -Wextra -Werror -DMLD_CONFIG_PARAMETER_SET=87 '-DMLD_CONFIG_FILE="../../integration/liboqs/config_c.h"' -I"$prior/oqs-install/include" -I"$prior/sodium-install/include" -I"$selected/mldsa/src" -I"$selected" -I"$prior/vendor/liboqs-5a1a854b0dc9f2141bdc771c555ee60c37950183/src/common/pqclean_shims" -I"$input/source/native-ownkey-supplier-v4")
"$cc" "${flags[@]}" -c "$input/source/native-ownkey-supplier-v4/veil_pq_auth.c" -o "$out/veil_pq_auth.o"
"$cc" "${flags[@]}" -c "$input/source/native-ownkey-supplier-v4/custodian/veil_pq_custodian.c" -o "$out/veil_pq_custodian.o"
"$cc" "${flags[@]}" -c "$input/source/native-ownkey-supplier-v4/custodian/veil_classic_protection.c" -o "$out/veil_classic_protection.o"
ar rcs "$out/libynx_social_custodian_linux.a" "$out/veil_pq_auth.o" "$out/veil_pq_custodian.o" "$out/veil_classic_protection.o"
"$cc" "${flags[@]}" "$input/source/crypto-source-control.c" "$out/libynx_social_custodian_linux.a" "$prior/oqs-install/lib/liboqs.a" "$prior/sodium-install/lib/libsodium.a" -pthread -lm -ldl -o "$out/crypto-source-control"
"$out/crypto-source-control"
sha256sum "$out/libynx_social_custodian_linux.a" "$out/crypto-source-control" | tee "$out/OUTPUT_SHA256SUMS"
printf '%s\n' 'PASS isolated Ubuntu native crypto source control, not Debian service or Source/device grant'
