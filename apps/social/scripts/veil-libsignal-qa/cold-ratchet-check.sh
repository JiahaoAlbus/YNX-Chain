#!/bin/sh
set -eu
: "${VEIL_LIBSIGNAL_JAR:?original pinned libsignal jar required}"
: "${VEIL_NATIVE_PORT_JAR:?original source-bound native port jar required}"
: "${VEIL_QA_DEPS_DIR:?original dependency directory required}"
: "${VEIL_ANDROID_JAR:?original Android compile API required}"
: "${VEIL_JAVA_HOME:?original Java toolchain required}"
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/social-veil-cold-ratchet.XXXXXX")
printf 'stage=%s\n' "$STAGE"
EXPECTED=c2b415784ea95b6552a87bea4b644d1f5178142cb7cc4113c0b2c68a35c43ec9
ACTUAL=$(shasum -a 256 "$VEIL_LIBSIGNAL_JAR" | cut -d ' ' -f 1)
[ "$ACTUAL" = "$EXPECTED" ] || { printf 'LIBSIGNAL_BYTES_MISMATCH\n' >&2; exit 1; }
CP="$VEIL_LIBSIGNAL_JAR:$VEIL_NATIVE_PORT_JAR:$VEIL_ANDROID_JAR"
for name in kotlin-stdlib-2.2.20.jar kotlinx-serialization-json-jvm-1.9.0.jar kotlinx-serialization-core-jvm-1.9.0.jar kotlinx-coroutines-core-jvm-1.10.2.jar; do
  test -f "$VEIL_QA_DEPS_DIR/$name"
  CP="$CP:$VEIL_QA_DEPS_DIR/$name"
done
mkdir "$STAGE/classes" "$STAGE/jni-temp"
find "$ROOT/crypto-engine/java" -name '*.java' -type f | LC_ALL=C sort > "$STAGE/sources.txt"
printf '%s\n' "$HERE/VeilEnvelopeCheck.java" "$HERE/VeilColdRatchetCheck.java" >> "$STAGE/sources.txt"
while IFS= read -r input; do shasum -a 256 "$input"; done < "$STAGE/sources.txt" > "$STAGE/inputs.sha256"
shasum -a 256 "$VEIL_NATIVE_PORT_JAR" "$VEIL_LIBSIGNAL_JAR" "$VEIL_ANDROID_JAR" >> "$STAGE/inputs.sha256"
"$VEIL_JAVA_HOME/bin/java" -version > "$STAGE/java-version.txt" 2>&1
if "$VEIL_JAVA_HOME/bin/javac" --release 21 -encoding UTF-8 -cp "$CP" -d "$STAGE/classes" @"$STAGE/sources.txt" > "$STAGE/compile.txt" 2>&1; then
  printf 'compile=PASS\n'
else
  cat "$STAGE/compile.txt"
  exit 1
fi
if "$VEIL_JAVA_HOME/bin/java" -Xcheck:jni -Djava.io.tmpdir="$STAGE/jni-temp" -cp "$STAGE/classes:$CP" com.ynx.social.matrix.VeilColdRatchetCheck > "$STAGE/run.txt" 2>&1; then
  cat "$STAGE/run.txt"
else
  cat "$STAGE/run.txt"
  exit 1
fi
