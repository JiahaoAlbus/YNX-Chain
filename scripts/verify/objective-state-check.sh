#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

required=(
  docs/acceptance/GOAL_DIGEST.md
  docs/acceptance/PROJECT_STATE.md
  docs/acceptance/NEXT_ACTION.md
  docs/acceptance/FEATURE_COMPLETION_TRACKER.md
)

for file in "${required[@]}"; do
  test -s "$file" || {
    echo "missing objective state file: $file"
    exit 1
  }
done

grep -q "Final goal:" docs/acceptance/GOAL_DIGEST.md
grep -q "Chain repo:" docs/acceptance/GOAL_DIGEST.md
grep -q "Website repo:" docs/acceptance/GOAL_DIGEST.md
grep -q "ynx_6423-1" docs/acceptance/GOAL_DIGEST.md
grep -q "YNXT" docs/acceptance/GOAL_DIGEST.md
grep -q "43.153.202.237" docs/acceptance/GOAL_DIGEST.md
grep -q "43.134.23.58" docs/acceptance/GOAL_DIGEST.md
grep -q "43.162.100.54" docs/acceptance/GOAL_DIGEST.md
grep -q "43.164.132.81" docs/acceptance/GOAL_DIGEST.md
grep -q "ynx_9102-1" docs/acceptance/GOAL_DIGEST.md

grep -q "State snapshot baseline commit:" docs/acceptance/PROJECT_STATE.md
grep -q "Last pushed commit" docs/acceptance/PROJECT_STATE.md
grep -q "Chain repo state:" docs/acceptance/PROJECT_STATE.md
grep -q "Website repo state:" docs/acceptance/PROJECT_STATE.md
grep -q "Remote deployment state:" docs/acceptance/PROJECT_STATE.md
grep -q "Current blockers:" docs/acceptance/PROJECT_STATE.md
grep -q "Largest real gap" docs/acceptance/PROJECT_STATE.md

grep -q "Current single action:" docs/acceptance/NEXT_ACTION.md
grep -q "Files to touch:" docs/acceptance/NEXT_ACTION.md
grep -q "Validation commands:" docs/acceptance/NEXT_ACTION.md
grep -q "Completion standard:" docs/acceptance/NEXT_ACTION.md
grep -q "Explicitly not doing" docs/acceptance/NEXT_ACTION.md

grep -q "Module" docs/acceptance/FEATURE_COMPLETION_TRACKER.md
grep -q "Anti-Illegal Request Engine" docs/acceptance/FEATURE_COMPLETION_TRACKER.md
grep -q "Anti-Unreasonable Tracking Policy" docs/acceptance/FEATURE_COMPLETION_TRACKER.md
grep -q "Request Validity Standard" docs/acceptance/FEATURE_COMPLETION_TRACKER.md
grep -q "Appeal / Dispute" docs/acceptance/FEATURE_COMPLETION_TRACKER.md
grep -q "Transparency Report" docs/acceptance/FEATURE_COMPLETION_TRACKER.md

if rg -n "StrictHostKeyChecking=accept-new" scripts/deploy scripts/ops scripts/verify --glob '!scripts/verify/objective-state-check.sh' >/tmp/ynx-strict-ssh-policy.txt; then
  cat /tmp/ynx-strict-ssh-policy.txt
  echo "strict ssh policy failed: deployment, ops, and verification scripts must not auto-accept new host keys"
  exit 1
fi

echo "objective state files passed"
