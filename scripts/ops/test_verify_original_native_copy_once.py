"""Run only the production ROFD-copy function on small owned public fixtures.

The fixed real host/controller/cgroup/Go path is never executed. The original
source function is extracted byte-for-byte; head boundary faults are declared
only in these fresh sudo/env-i Bash test processes, not in production inputs.
"""

from pathlib import Path
import hashlib
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/ops/remote/verify-original-native-copy-once.sh"
BEGIN = "# BEGIN YNX_NATIVE_READONLY_FD_COPY\n"
END = "# END YNX_NATIVE_READONLY_FD_COPY\n"
CONTROL = SOURCE.read_text(encoding="utf-8")
if CONTROL.count(BEGIN) != 1 or CONTROL.count(END) != 1:
    raise AssertionError("one actual private production ROFD function is required")
FUNCTION = CONTROL.split(BEGIN, 1)[1].split(END, 1)[0]
if not FUNCTION.startswith("ynx_native_copy_readonly_fd() {\n"):
    raise AssertionError("the actual normal copy function was not extracted")

# Exact pre-copy guard from preserved once01 (full script SHA256
# 8c6e4306f48f1873cc04058053fab442659baa767e931de882853f129a304996).
# Only this original guard runs on the same synthetic tmp fixture; the real
# host/controller and its consumed attempt are never executed or retried.
ORIGINAL_TMP_GUARD = 'for path in "$source.tmp" "$marker.tmp"; do [[ ! -e $path && ! -L $path ]] || bad original-temp-or-partial-present; done\n'
if hashlib.sha256(ORIGINAL_TMP_GUARD.encode()).hexdigest() != "36a1833fb6e1da24f39d8a9e1df6d9b998c3251d45435b0efdd6bedd2c180ff3":
    raise AssertionError("the exact original temporary-file refusal guard changed")


PREPARE = r"""
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C
root=$1
[[ $EUID == 0 && $root == /tmp/ynx-native-rofd-public-* && $(realpath -e -- "$root") == "$root" ]] || exit 91
mkdir -m 0755 -- "$root/source"
mkdir -m 0700 -- "$root/case"
source="$root/source/devnet-state.json"
marker="$root/source/devnet-state.integrity-version"
case_dir="$root/case"
printf '{"PUBLIC_DATA":"%s"}\n' "$(printf '%04096d' 0)" > "$source"
printf '2\n' > "$marker"
chown 995:986 -- "$source" "$marker"
chmod 0600 -- "$source" "$marker"
expected_bytes=$(stat -c '%s' -- "$source")
source_before=$(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$source")
marker_before=$(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$marker")
bad() { printf '%s\n' "$1" > "$case_dir/first-cause"; exit 1; }
"""


BOUNDARY = r"""
mode=$2
head() {
  /usr/bin/head "$@"
  if [[ ${2-} == "$expected_bytes" && ${mutated-false} == false ]]; then
    mutated=true
    case "$mode" in
      stable-tmp) sleep 0.15 ;;
      final-rename)
        mv -- "$source" "$source.retained"
        cp -- "$source.retained" "$source"
        chown 995:986 -- "$source"
        chmod 0600 -- "$source" ;;
      final-inplace) printf 'changed-final-byte' >> "$source" ;;
      marker) printf '3\n' > "$marker" ;;
      mode) chmod 0640 -- "$source" ;;
      nlink) ln -- "$source" "$source.extra-link" ;;
      *) exit 92 ;;
    esac
  fi
}
writer=
finish_public_writer() {
  if [[ -n $writer ]]; then
    kill "$writer" 2>/dev/null || true
    wait "$writer" 2>/dev/null || true
  fi
}
trap finish_public_writer EXIT
if [[ $mode == stable-tmp ]]; then
  printf 'PUBLIC independent temporary bytes' > "$source.tmp"
  initial_tmp_bytes=$(stat -c '%s' -- "$source.tmp")
  (
    while :; do
      printf 'still-writing-independent-temp' >> "$source.tmp"
      sleep 0.01
    done
  ) &
  writer=$!
  # Reproduce the actual previous first cause before invoking the fixed
  # production function against these same unchanged final source bytes.
  mkdir -m 0700 -- "$root/original-guard"
  set +e
  (
    case_dir="$root/original-guard"
    # EXACT_ORIGINAL_TMP_GUARD
  )
  original_result=$?
  set -e
  [[ $original_result != 0 && ! -e $root/original-guard/data-verified ]] || exit 99
  grep -qx 'original-temp-or-partial-present' "$root/original-guard/first-cause"
  printf '%s\n' 'YNX_NATIVE_ORIGINAL_TMP_GUARD_REPRODUCED_DATA_ONLY'
fi
set +e
( ynx_native_copy_readonly_fd "$source" "$marker" "$case_dir" "$expected_bytes" )
result=$?
set -e
if [[ $mode == stable-tmp ]]; then
  [[ $result == 0 && -f $case_dir/copy-receipt && ! -e $case_dir/first-cause ]] || exit 93
  [[ $(stat -c '%s' -- "$source.tmp") -gt $initial_tmp_bytes ]] || exit 94
  [[ $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$source") == "$source_before" &&
     $(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$marker") == "$marker_before" ]] || exit 95
  cmp -- "$source" "$case_dir/data-verified/devnet-state.json"
  cmp -- "$marker" "$case_dir/data-verified/devnet-state.integrity-version"
  grep -qx 'classification=DATA' "$case_dir/copy-receipt"
  grep -qx 'authoritativeFinalCheckpoint=false' "$case_dir/copy-receipt"
  grep -qx 'liveSourceNotPaused=true' "$case_dir/copy-receipt"
  printf '%s\n' 'YNX_NATIVE_ROFD_STABLE_FINAL_PATH_DATA_PASS'
else
  [[ $result != 0 && -s $case_dir/first-cause && ! -e $case_dir/copy-receipt ]] || exit 96
  [[ -f $case_dir/data-verified/devnet-state.json && -f $case_dir/data-verified/devnet-state.integrity-version &&
     $(stat -c '%s' -- "$case_dir/data-verified/devnet-state.json") == "$expected_bytes" ]] || exit 97
  grep -qx 'source-FD-path-or-full-copy-SHA-changed' "$case_dir/first-cause"
  if [[ $mode == final-rename ]]; then
    [[ -f $source.retained && $(stat -c '%i' -- "$source") != "$(stat -c '%i' -- "$source.retained")" ]] || exit 98
    cmp -- "$source.retained" "$case_dir/data-verified/devnet-state.json"
  fi
  printf 'YNX_NATIVE_ROFD_CHANGED_FINAL_REJECTED mode=%s partialRetained=true\n' "$mode"
fi
"""


class OriginalNativeCopyOnceControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not sys.platform.startswith("linux") or shutil.which("sudo") is None:
            raise AssertionError("normal controls require the original Linux sudo Bash runner")
        subprocess.run(["sudo", "-n", "/usr/bin/true"], check=True, capture_output=True, timeout=5)

    def run_original_function(self, mode):
        # The fixed producer never sees this path. Only the private function is
        # invoked with four explicit fresh fixture inputs, all below this root.
        root = Path(tempfile.mkdtemp(prefix="ynx-native-rofd-public-", dir="/tmp")).resolve()
        self.assertTrue(str(root).startswith("/tmp/ynx-native-rofd-public-"))
        try:
            harness = PREPARE + "\n" + FUNCTION + "\n" + BOUNDARY.replace("    # EXACT_ORIGINAL_TMP_GUARD\n", "    " + ORIGINAL_TMP_GUARD)
            result = subprocess.run(
                ["sudo", "-n", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "LC_ALL=C",
                 "/bin/bash", "--noprofile", "--norc", "-s", "--", str(root), mode],
                input=harness, text=True, capture_output=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            # Synthetic source/tmp bytes are never printed by this control.
            self.assertNotIn("PUBLIC_DATA", result.stdout)
            self.assertNotIn("still-writing-independent-temp", result.stdout)
            return result.stdout
        finally:
            # Only this newly created synthetic root is removable. Production
            # cases/UNKNOWN and preserved once01 files are never opened here.
            self.assertEqual(root.parent, Path("/tmp"))
            self.assertTrue(root.name.startswith("ynx-native-rofd-public-"))
            subprocess.run(["sudo", "-n", "/usr/bin/rm", "-rf", "--", str(root)],
                           check=True, capture_output=True, timeout=5)

    def test_source_tmp_can_exist_and_keep_writing_while_final_fds_stay_stable(self):
        output = self.run_original_function("stable-tmp")
        self.assertEqual(output.count("YNX_NATIVE_ORIGINAL_TMP_GUARD_REPRODUCED_DATA_ONLY"), 1)
        self.assertEqual(output.count("YNX_NATIVE_ROFD_STABLE_FINAL_PATH_DATA_PASS"), 1)
        print("YNX_NATIVE_ORIGINAL_TMP_GUARD_REPRODUCED_DATA_ONLY", flush=True)
        print("YNX_NATIVE_ROFD_STABLE_FINAL_PATH_DATA_PASS", flush=True)

    def test_actual_final_atomic_rename_is_rejected_and_partial_copy_retained(self):
        self.assertIn("mode=final-rename partialRetained=true", self.run_original_function("final-rename"))

    def test_actual_final_inplace_change_is_rejected_and_partial_copy_retained(self):
        self.assertIn("mode=final-inplace partialRetained=true", self.run_original_function("final-inplace"))

    def test_actual_marker_change_is_rejected_and_partial_copy_retained(self):
        self.assertIn("mode=marker partialRetained=true", self.run_original_function("marker"))

    def test_actual_mode_or_nlink_change_is_rejected_and_partial_copy_retained(self):
        for mode in ("mode", "nlink"):
            with self.subTest(mode=mode):
                self.assertIn(f"mode={mode} partialRetained=true", self.run_original_function(mode))

    def test_fixed_normal_caller_preserves_original_limits_and_no_tmp_provider(self):
        self.assertNotIn("$source.tmp", FUNCTION)
        self.assertNotIn("$marker.tmp", FUNCTION)
        self.assertEqual(CONTROL.count("declare -f ynx_native_copy_readonly_fd"), 1)
        self.assertEqual(CONTROL.count("ynx_native_copy_readonly_fd /var/lib/ynx-chain/testnet/devnet-state.json /var/lib/ynx-chain/testnet/devnet-state.integrity-version"), 1)
        for required in (
            'case_dir="/var/tmp/ynx-pq-offline-native-${candidate:0:12}-once02"',
            'unit="ynx-pq-offline-native-${candidate:0:12}-once02.service"',
            '^/var/tmp/ynx-pq-offline-native-[0-9a-f]{12}-once02$',
            '--property=MemoryMax=6442450944', '--property=TimeoutStopSec=12s',
            '119.5-($1-start)', '(($1-start)<120)', 'cleanup<=15s',
            'available >= 23622320128', '-ge 17179869184', '-le 6442450944',
            '--fsize=4294967296:4294967296', 'head -c 1048576',
            'existing-attempt-or-UNKNOWN-retained', 'original-native-process-changed',
            '/usr/bin/env -i PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC GOMAXPROCS=2 GOMEMLIMIT=6GiB GOGC=50',
            'authoritativeFinalCheckpoint=false', 'pqActivation=false',
        ):
            self.assertIn(required, CONTROL)
        self.assertNotIn('-once01"', CONTROL)
        self.assertNotIn('-once01.service', CONTROL)
        self.assertNotIn('source "$', CONTROL)


if __name__ == "__main__":
    unittest.main(verbosity=2)
