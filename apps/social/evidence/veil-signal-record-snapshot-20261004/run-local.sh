#!/bin/sh
# Exact local QA dependencies, no download, deployment or live user operation.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
lab=/tmp/social-veil-jni-01040-20261004.PYpxgX
gradle=/Users/huangjiahao/.gradle/caches/modules-2/files-2.1
export VEIL_LIBSIGNAL_JAR="$lab/libsignal-client-0.104.0.jar"
export VEIL_SDK_CLASSPATH=$(printf '%s:' "$lab"/*.jar)
VEIL_KOTLIN_COMPILER_CLASSPATH=
for dependency in \
  "$gradle/org.jetbrains.kotlin/kotlin-compiler-embeddable/2.1.20/"*/*.jar \
  "$gradle/org.jetbrains.kotlin/kotlin-stdlib/2.1.20/"*/*.jar \
  "$gradle/org.jetbrains.kotlin/kotlin-script-runtime/2.1.20/"*/*.jar \
  "$gradle/org.jetbrains.kotlin/kotlin-reflect/1.6.10/"*/*.jar \
  "$gradle/org.jetbrains.intellij.deps/trove4j/1.0.20200330/"*/*.jar \
  "$gradle/org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm/1.8.0/"*/*.jar \
  "$gradle/org.jetbrains/annotations/13.0/"*/*.jar; do
  test -f "$dependency"
  VEIL_KOTLIN_COMPILER_CLASSPATH="$VEIL_KOTLIN_COMPILER_CLASSPATH:$dependency"
done
export VEIL_KOTLIN_COMPILER_CLASSPATH
export VEIL_KOTLIN_STDLIB="$gradle/org.jetbrains.kotlin/kotlin-stdlib/2.1.20/aa8ca79cd50578314f6d1180c47cbe14c0fee567/kotlin-stdlib-2.1.20.jar"
export VEIL_ANDROID_JAR=/Users/huangjiahao/Library/Android/sdk/platforms/android-36/android.jar
export VEIL_KOTLIN_JAVA=/Library/Java/JavaVirtualMachines/openjdk-17.jdk/Contents/Home/bin/java
export VEIL_JAVAC=/Library/Java/JavaVirtualMachines/zulu-24.jdk/Contents/Home/bin/javac
export VEIL_JAVA=/Library/Java/JavaVirtualMachines/zulu-24.jdk/Contents/Home/bin/java
exec sh "$root/apps/social/scripts/veil-libsignal-qa/native-adapter-check.sh" snapshot
