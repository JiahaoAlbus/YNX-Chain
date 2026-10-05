#!/bin/bash
# This native shell entry intentionally precedes Node's NODE_OPTIONS handling.
# Pass every argument verbatim; user command strings are never evaluated.
export YNX_JS_ORIGINAL_NODE_OPTIONS="${NODE_OPTIONS-}"
unset NODE_OPTIONS
ynx_js_launcher_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)" || exit 126
if [[ -n "${NODE_INSPECTOR_INFO-}" ]]; then
  export OPENSSL_CONF=/dev/null
  exec "$ynx_js_launcher_directory/node" "$ynx_js_launcher_directory/local-js-debug-launcher.mjs" --ynx-watchdog "$@"
fi
exec "$ynx_js_launcher_directory/node" "$ynx_js_launcher_directory/local-js-debug-launcher.mjs" "$@"
