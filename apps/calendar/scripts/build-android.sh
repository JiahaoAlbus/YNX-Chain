#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
ANDROID_DIR="$ROOT/native/android"

java_major() {
  "$1" -version 2>&1 | awk -F'[".]' '/version/ { print $2; exit }'
}

JAVA_BIN=${JAVA_HOME:+$JAVA_HOME/bin/java}
if [ -z "${JAVA_BIN:-}" ] || [ ! -x "$JAVA_BIN" ]; then
  JAVA_BIN=$(command -v java || true)
fi
if [ -z "$JAVA_BIN" ]; then
  echo "YNX Calendar Android build requires JDK 17-21." >&2
  exit 1
fi

MAJOR=$(java_major "$JAVA_BIN")
case "$MAJOR" in
  ''|*[!0-9]*)
    echo "Unable to determine the active Java major version." >&2
    exit 1
    ;;
esac
if [ "$MAJOR" -lt 17 ] || [ "$MAJOR" -gt 21 ]; then
  if [ -x /usr/libexec/java_home ]; then
    RESOLVED_JAVA_HOME=$(/usr/libexec/java_home -v 17 2>/dev/null || true)
    if [ -n "$RESOLVED_JAVA_HOME" ] && [ -x "$RESOLVED_JAVA_HOME/bin/java" ]; then
      JAVA_HOME=$RESOLVED_JAVA_HOME
      export JAVA_HOME
      JAVA_BIN="$JAVA_HOME/bin/java"
      MAJOR=$(java_major "$JAVA_BIN")
    fi
  fi
fi
if [ "$MAJOR" -lt 17 ] || [ "$MAJOR" -gt 21 ]; then
  echo "Unsupported Java $MAJOR. YNX Calendar Android builds require JDK 17-21." >&2
  exit 1
fi

if [ -z "${ANDROID_HOME:-}" ]; then
  if [ -n "${ANDROID_SDK_ROOT:-}" ]; then
    ANDROID_HOME=$ANDROID_SDK_ROOT
  elif [ -d "$HOME/Library/Android/sdk" ]; then
    ANDROID_HOME="$HOME/Library/Android/sdk"
  elif [ -d "$HOME/Android/Sdk" ]; then
    ANDROID_HOME="$HOME/Android/Sdk"
  else
    echo "Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT." >&2
    exit 1
  fi
fi
if [ ! -d "$ANDROID_HOME" ]; then
  echo "ANDROID_HOME does not exist: $ANDROID_HOME" >&2
  exit 1
fi
export ANDROID_HOME

cd "$ANDROID_DIR"
exec ./gradlew --no-daemon :app:assembleDebug
