#!/usr/bin/env bash
set -euo pipefail
umask 077
out="${1:?new isolated Linux build directory required}"
input="${2:?frozen Main Linux crypto input directory required}"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { printf '%s\n' 'requires Linux x86_64; no Darwin archive'; exit 2; }
for tool in curl tar python3 sha256sum cmake make cc ar autoconf automake libtoolize; do command -v "$tool" >/dev/null || { printf 'missing build tool: %s\n' "$tool"; exit 2; }; done
[[ ! -e "$out" ]] || { printf '%s\n' 'build path already exists; reconcile prior run instead of repeating'; exit 3; }
[[ "$(df -Pk "$(dirname "$out")" | awk 'NR==2 {print $4}')" -ge 2097152 ]] || { printf '%s\n' 'requires 2GiB free on actual build filesystem'; exit 4; }
(cd "$input" && sha256sum -c INPUT_SHA256SUMS)
mkdir -m 700 "$out"
exec > >(tee "$out/BUILD.log") 2>&1
printf '%s\n' 'Linux source successor, not inherited-binary compatibility or device authority'
cc --version | head -n 1
cmake --version | head -n 1
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 120 'https://codeload.github.com/open-quantum-safe/liboqs/tar.gz/5a1a854b0dc9f2141bdc771c555ee60c37950183' -o "$out/oqs.tar.gz"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 120 'https://codeload.github.com/jedisct1/libsodium/tar.gz/77e1ce5d6dee871c49ef211222ba18ef0c486bda' -o "$out/sodium.tar.gz"
printf '%s  %s\n' '83c6e6cff490638312e1e20ed5de593fb5d7bfab162235f6238f519d6a1feafb' "$out/oqs.tar.gz" '58cb82cc07e45e296cd9c02446452d82dd2a5c5ecba9ff10a23ed8ee183d55b0' "$out/sodium.tar.gz" | sha256sum -c -
python3 - "$out" <<'PY'
import pathlib,sys,tarfile
out=pathlib.Path(sys.argv[1]); (out/'vendor').mkdir(mode=0o700)
for name,root in [('oqs','liboqs-5a1a854b0dc9f2141bdc771c555ee60c37950183'),('sodium','libsodium-77e1ce5d6dee871c49ef211222ba18ef0c486bda')]:
 with tarfile.open(out/(name+'.tar.gz'),'r:gz') as archive:
  if any(not (member.name==root or member.name.startswith(root+'/')) for member in archive.getmembers()): raise SystemExit('unexpected official archive root')
  archive.extractall(out/'vendor',filter='data')
PY
oqs="$out/vendor/liboqs-5a1a854b0dc9f2141bdc771c555ee60c37950183"
sodium="$out/vendor/libsodium-77e1ce5d6dee871c49ef211222ba18ef0c486bda"
(cd "$sodium" && ./autogen.sh && CFLAGS='-O2 -fPIC' ./configure --prefix="$out/sodium-install" --disable-shared --enable-static --with-pic && make -j2 && make install)
cmake -S "$oqs" -B "$out/oqs-build" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$out/oqs-install" -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DOQS_BUILD_ONLY_LIB=ON -DOQS_MINIMAL_BUILD=SIG_ml_dsa_87 -DOQS_DIST_BUILD=ON -DOQS_OPT_TARGET=generic -DOQS_USE_OPENSSL=OFF -DOQS_ENABLE_SIG_ml_dsa_87_x86_64=OFF -DOQS_ENABLE_SIG_ml_dsa_87_aarch64=OFF
cmake --build "$out/oqs-build" --parallel 2
cmake --install "$out/oqs-build"
selected="$oqs/src/sig/ml_dsa/mldsa-native_ml-dsa-87_ref"
flags=(-std=c11 -O2 -fPIC -fvisibility=hidden -pthread -Wall -Wextra -Werror -DMLD_CONFIG_PARAMETER_SET=87 '-DMLD_CONFIG_FILE="../../integration/liboqs/config_c.h"' -I"$out/oqs-install/include" -I"$out/sodium-install/include" -I"$selected/mldsa/src" -I"$selected" -I"$oqs/src/common/pqclean_shims" -I"$input/source/native-ownkey-supplier-v4")
cc "${flags[@]}" -c "$input/source/native-ownkey-supplier-v4/veil_pq_auth.c" -o "$out/veil_pq_auth.o"
cc "${flags[@]}" -c "$input/source/native-ownkey-supplier-v4/custodian/veil_pq_custodian.c" -o "$out/veil_pq_custodian.o"
cc "${flags[@]}" -c "$input/source/native-ownkey-supplier-v4/custodian/veil_classic_protection.c" -o "$out/veil_classic_protection.o"
ar rcs "$out/libynx_social_custodian_linux.a" "$out/veil_pq_auth.o" "$out/veil_pq_custodian.o" "$out/veil_classic_protection.o"
cc "${flags[@]}" "$input/source/crypto-source-control.c" "$out/libynx_social_custodian_linux.a" "$out/oqs-install/lib/liboqs.a" "$out/sodium-install/lib/libsodium.a" -pthread -lm -ldl -o "$out/crypto-source-control"
"$out/crypto-source-control"
sha256sum "$out/libynx_social_custodian_linux.a" "$out/oqs-install/lib/liboqs.a" "$out/sodium-install/lib/libsodium.a" "$out/crypto-source-control" | tee "$out/OUTPUT_SHA256SUMS"
printf '%s\n' 'PASS Linux crypto source control only; no Root, device grant, APK, or M1 claim'
