#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

node --test sdk/js/index.test.mjs
python3 -m unittest sdk/python/test_ynx_client.py
(
  cd sdk/js
  npm pack --dry-run --json >/dev/null
)
package_work="$(mktemp -d)"
trap 'rm -rf "$package_work"' EXIT
cp -R sdk/python "$package_work/source"
(
  cd "$package_work/source"
  python3 -c 'import sys; from setuptools.build_meta import build_sdist; print(build_sdist(sys.argv[1]))' "$package_work/dist" >/dev/null
)
sdist="$(find "$package_work/dist" -maxdepth 1 -type f -name 'ynx_chain_sdk-0.1.0.tar.gz' -print -quit)"
[[ -n "$sdist" ]]
tar -tzf "$sdist" | grep -Eq '/ynx_client\.py$'

echo "sdk-check passed: JavaScript and Python clients and package metadata verified"
