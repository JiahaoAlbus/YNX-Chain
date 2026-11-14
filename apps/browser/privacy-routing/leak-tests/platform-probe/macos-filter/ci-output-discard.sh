#!/bin/sh
# New owned-helper bounded-output delta only. No NE activation, vendor or old suite.
set -eu
if [ "$#" -ne 1 ]; then
  echo 'Usage: ci-output-discard.sh /absolute/fresh-output-directory' >&2
  exit 64
fi
exec /usr/bin/python3 "$(dirname "$0")/test_output_discard.py" --output "$1"
