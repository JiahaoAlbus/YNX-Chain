#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
inspector="$root/apps/video/scripts/video-retained-takeover-preflight.sh"
[[ -f "$inspector" && ! -L "$inspector" ]] || { echo "preflight inspector unavailable" >&2; exit 66; }
[[ "$(shasum -a 256 "$inspector" | awk '{print $1}')" == "${YNX_VIDEO_PREFLIGHT_INSPECTOR_SHA256:-}" ]] || { echo "preflight inspector SHA mismatch" >&2; exit 66; }
[[ "${YNX_CENTRAL_SINGLE_USE_LEASE_ID:-}" == P0-VIDEO-RETAINED-TAKEOVER-PREFLIGHT-ZERO-WRITE-20260831 ]] || { echo "exact preflight lease id missing" >&2; exit 77; }
[[ -n "${YNX_VIDEO_SSH_IDENTITY:-}" && -f "$YNX_VIDEO_SSH_IDENTITY" ]] || { echo "protected SSH identity unavailable" >&2; exit 77; }

exec /usr/bin/ssh \
  -i "$YNX_VIDEO_SSH_IDENTITY" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o ConnectTimeout=10 \
  -o StrictHostKeyChecking=yes \
  ynx@43.153.202.237 \
  /usr/bin/sudo -n /usr/bin/env \
  YNX_VIDEO_EXECUTION_MODE=production \
  YNX_VIDEO_LEASE_AUTHORIZED=P0_VIDEO_RETAINED_TAKEOVER_PREFLIGHT_ZERO_WRITE \
  /bin/bash -s -- inspect < "$inspector"
