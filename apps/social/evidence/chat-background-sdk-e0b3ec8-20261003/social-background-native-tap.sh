#!/bin/zsh
set -e
before=$1; label=$2; after=$3
node /tmp/social-background-ui.mjs "$before" "$label" /tmp/social-background-next-tap.txt >> /tmp/social-background-native-ui-actions.log
$HOME/Library/Android/sdk/platform-tools/adb -s emulator-5584 shell input tap $(cat /tmp/social-background-next-tap.txt)
$HOME/Library/Android/sdk/platform-tools/adb -s emulator-5584 exec-out uiautomator dump /dev/tty > "$after"
