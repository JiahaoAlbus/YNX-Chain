#!/bin/sh
# Dormant owner QA only. No download, enrollment, activation, or deployment.
set -eu

mode=${1:-}
case "$mode" in
  compile|keyless|lifecycle|independent) ;;
  *) printf '%s\n' 'Usage: sh native-adapter-check.sh compile|keyless|lifecycle|independent' >&2; exit 2 ;;
esac

: "${VEIL_LIBSIGNAL_JAR:?Supply the official pinned libsignal 0.104.0 JAR}"
: "${VEIL_SDK_CLASSPATH:?Supply the SDK and its locked runtime dependency classpath}"
: "${VEIL_KOTLIN_COMPILER_CLASSPATH:?Supply the existing Kotlin 2.1.20 compiler dependency classpath}"
: "${VEIL_KOTLIN_STDLIB:?Supply the existing Kotlin 2.1.20 stdlib JAR}"
: "${VEIL_ANDROID_JAR:?Supply the existing Android API36 android.jar}"
: "${VEIL_KOTLIN_JAVA:?Supply the existing Kotlin compiler Java executable}"
: "${VEIL_JAVAC:?Supply the existing Java21-or-newer javac executable}"
: "${VEIL_JAVA:?Supply the existing Java21-or-newer java executable}"

expected=c2b415784ea95b6552a87bea4b644d1f5178142cb7cc4113c0b2c68a35c43ec9
actual=$(shasum -a 256 "$VEIL_LIBSIGNAL_JAR" | awk '{print $1}')
[ "$actual" = "$expected" ] || { printf '%s\n' 'SDK checksum mismatch; refusing execution' >&2; exit 1; }

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
social=$(CDPATH= cd -- "$script_dir/../.." && pwd)
native="$social/modules/native-matrix/android/src/main/java/com/ynx/social/matrix"
adapter="$social/crypto-engine/java/com/ynx/social/matrix/VeilSignalProtocolStore.java"
stage=$(mktemp -d "${TMPDIR:-/tmp}/social-veil-native-adapter.XXXXXX")
mkdir -p "$stage/classes" "$stage/jni-temp"
printf 'stage=%s\nmode=%s\n' "$stage" "$mode"
shasum -a 256 "$VEIL_LIBSIGNAL_JAR" "$VEIL_ANDROID_JAR" "$VEIL_KOTLIN_STDLIB" \
  "$native/VeilNativeAuthority.kt" "$native/VeilNativeStore.kt" \
  "$native/VeilRecordTransaction.kt" "$adapter" > "$stage/inputs.sha256"
"$VEIL_JAVA" -version > "$stage/java-version.txt" 2>&1
"$VEIL_KOTLIN_JAVA" -version > "$stage/kotlin-java-version.txt" 2>&1

"$VEIL_KOTLIN_JAVA" -cp "$VEIL_KOTLIN_COMPILER_CLASSPATH" \
  org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect \
  -jvm-target 17 -classpath "$VEIL_KOTLIN_STDLIB:$VEIL_ANDROID_JAR" \
  -d "$stage/native-port.jar" "$native/VeilNativeAuthority.kt" \
  "$native/VeilNativeStore.kt" "$native/VeilRecordTransaction.kt" \
  > "$stage/kotlin-compile.txt" 2>&1

runtime="$stage/classes:$stage/native-port.jar:$VEIL_LIBSIGNAL_JAR:$VEIL_SDK_CLASSPATH:$VEIL_KOTLIN_STDLIB"
"$VEIL_JAVAC" --release 21 -cp "$runtime" -d "$stage/classes" \
  "$adapter" "$script_dir/VeilKeylessAdapterCheck.java" \
  "$script_dir/VeilPrekeyLifecycleCheck.java" > "$stage/java-compile.txt" 2>&1
printf '%s\n' 'PASS fresh dormant native port and adapter compilation'

case "$mode" in
  compile) exit 0 ;;
  keyless) main=com.ynx.social.matrix.VeilKeylessAdapterCheck ;;
  lifecycle) main=com.ynx.social.matrix.VeilPrekeyLifecycleCheck ;;
  independent)
    : "${VEIL_INDEPENDENT_CLASSES:?Supply the unchanged controller probe classes directory}"
    probe="$VEIL_INDEPENDENT_CLASSES/com/ynx/social/matrix/KeylessAdapterProbe.class"
    probe_sha=$(shasum -a 256 "$probe" | awk '{print $1}')
    [ "$probe_sha" = f7544c178d9dca44213c4c32e7e41cd2bbb038372602d2b44dbf99607a09ea2d ] \
      || { printf '%s\n' 'Independent probe checksum mismatch' >&2; exit 1; }
    runtime="$runtime:$VEIL_INDEPENDENT_CLASSES"
    main=com.ynx.social.matrix.KeylessAdapterProbe
    ;;
esac

"$VEIL_JAVA" --enable-native-access=ALL-UNNAMED -Xcheck:jni \
  -Djava.io.tmpdir="$stage/jni-temp" \
  -Xlog:class+load=info:file="$stage/class-load.txt" \
  -cp "$runtime" "$main" > "$stage/check.txt" 2>&1
cat "$stage/check.txt"
printf '%s\n' 'QA only: synthetic trust/memory port; no real device, durable anchor, or release approval.'
