#!/usr/bin/env bash
set -euo pipefail

script_path=$0
if command -v realpath >/dev/null 2>&1; then
  script_path=$(realpath "$script_path")
fi
base_dir=$(cd "$(dirname "$script_path")/.." && pwd)
case $(uname -s) in
  Darwin) config_dir="$base_dir/config_mac" ;;
  Linux|FreeBSD) config_dir="$base_dir/config_linux" ;;
  *) printf 'Unsupported JDT LS platform.\n' >&2; exit 64 ;;
esac
launcher=""
for candidate in "$base_dir"/plugins/org.eclipse.equinox.launcher_*.jar; do
  [[ -f $candidate ]] || continue
  [[ -z $launcher ]] || { printf 'Multiple JDT LS launchers found.\n' >&2; exit 65; }
  launcher=$candidate
done
[[ -n $launcher && -d $config_dir ]] || { printf 'Incomplete JDT LS installation.\n' >&2; exit 66; }

exec java \
  -Xms128m -Xmx768m \
  -Declipse.application=org.eclipse.jdt.ls.core.id1 \
  -Dosgi.bundles.defaultStartLevel=4 \
  -Declipse.product=org.eclipse.jdt.ls.core.product \
  -Dosgi.checkConfiguration=true \
  -Dosgi.sharedConfiguration.area="$config_dir" \
  -Dosgi.sharedConfiguration.area.readOnly=true \
  -Dosgi.configuration.cascaded=true \
  --add-modules=ALL-SYSTEM \
  --add-opens java.base/java.util=ALL-UNNAMED \
  --add-opens java.base/java.lang=ALL-UNNAMED \
  -jar "$launcher" "$@"
