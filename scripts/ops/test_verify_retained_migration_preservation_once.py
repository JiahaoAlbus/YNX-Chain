"""Exercise the actual read-only FD checker on small owned Linux fixtures.

The fixed controller, migration, tools, native PID and services are never run.
The normal CI invokes only the byte-extracted production FD function via sudo.
"""
from pathlib import Path
import json
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/ops/remote/verify-retained-migration-preservation-once.sh"
CONTROL = SOURCE.read_text(encoding="utf-8")
BEGIN = "# BEGIN YNX_RETAINED_MIGRATION_ROFD_CHECK\n"
END = "# END YNX_RETAINED_MIGRATION_ROFD_CHECK\n"
if CONTROL.count(BEGIN) != 1 or CONTROL.count(END) != 1:
    raise AssertionError("one actual original FD checker is required")
FUNCTION = CONTROL.split(BEGIN, 1)[1].split(END, 1)[0]
if not FUNCTION.startswith("ynx_retained_migration_rofd_check() {\n"):
    raise AssertionError("the actual normal FD checker was not extracted")
CLIENT_BEGIN = "# BEGIN YNX_OWNED_CLIENT_EXIT_CHECK\n"
CLIENT_END = "# END YNX_OWNED_CLIENT_EXIT_CHECK\n"
if CONTROL.count(CLIENT_BEGIN) != 1 or CONTROL.count(CLIENT_END) != 1:
    raise AssertionError("one actual client-exit checker is required")
CLIENT_FUNCTIONS = CONTROL.split(CLIENT_BEGIN, 1)[1].split(CLIENT_END, 1)[0]
RECEIPT_END = "' \"$case_dir/logs/verifier.stdout\" >/dev/null || bad unexpected-normal-preservation-receipt"
if CONTROL.count(RECEIPT_END) != 1:
    raise AssertionError("one actual normal receipt filter is required")
RECEIPT_FILTER = CONTROL.split(RECEIPT_END, 1)[0].rsplit("jq -e '\n", 1)[1]

BLOCKERS = [
    {"module": "pay", "records": 283, "reason": "source preservation validation passed; independent source merchant binding and original webhook secret custody have not been established for this migration"},
    {"module": "ai", "records": 39, "reason": "source preservation validation passed; source permissions have no signed principal or transaction; cannot create BFT signer authority during import"},
    {"module": "trust_governance", "records": 418, "reason": "source preservation validation passed; independently authenticated source reviewer/role binding is missing; original text identities cannot authorize review or resolution"},
]


HARNESS = r"""
set -Eeuo pipefail
umask 077
export PATH=/usr/bin:/bin LC_ALL=C LANG=C TZ=UTC
root=$1; mode=$2
[[ $EUID == 0 && $root == /tmp/ynx-retained-preservation-public-* && $(realpath -e -- "$root") == "$root" ]] || exit 91
path="$root/public-migration"
printf '%s\n' '{"publicSyntheticData":true}' > "$path"
chown 0:0 -- "$path"
chmod 0600 -- "$path"
bytes=$(stat -c '%s' -- "$path")
expected=$(stat -c '%d:%i:%f:%h:%u:%g:%s:%y:%z' -- "$path")
sha=$(sha256sum -- "$path"); sha=${sha%% *}
exec 3<"$path"
ynx_retained_migration_rofd_check "$path" "$bytes" "$sha" "$expected" || exit 92
case "$mode" in
  stable) cat -- "$path" >/dev/null ;;
  rename)
    mv -- "$path" "$path.retained"
    cp -- "$path.retained" "$path"
    chmod 0600 -- "$path" ;;
  inplace) printf 'real-mutation' >> "$path" ;;
  mode) chmod 0640 -- "$path" ;;
  nlink) ln -- "$path" "$path.second-link" ;;
  wrong-sha) sha=0000000000000000000000000000000000000000000000000000000000000000 ;;
  wrong-fd)
    printf 'another original descriptor' > "$root/other"
    exec 3<&-
    exec 3<"$root/other" ;;
  *) exit 93 ;;
esac
if ynx_retained_migration_rofd_check "$path" "$bytes" "$sha" "$expected"; then
  [[ $mode == stable ]] || exit 94
  printf '%s\n' 'YNX_RETAINED_PRESERVATION_ROFD_DATA_PASS'
else
  [[ $mode != stable && -f $path ]] || exit 95
  if [[ $mode == rename ]]; then
    [[ -f $path.retained && $(stat -c '%i' -- "$path") != "$(stat -c '%i' -- "$path.retained")" ]] || exit 96
    cmp -- "$path.retained" "/proc/$BASHPID/fd/3"
  fi
  printf 'changed_original_rejected=%s retained=true\n' "$mode"
fi
exec 3<&-
"""

CLIENT_HARNESS = r"""
set -Eeuo pipefail
export PATH=/usr/bin:/bin LC_ALL=C
/usr/bin/sleep 10 & fixture_child=$!
fixture_start=$(task_start "$fixture_child")
finish_fixture() {
  if [[ $(task_start "$fixture_child" 2>/dev/null || true) == "$fixture_start" ]]; then
    kill -TERM "$fixture_child" 2>/dev/null || true
  fi
  wait "$fixture_child" 2>/dev/null || true
}
trap finish_fixture EXIT
runner=$fixture_child
runner_start=
if owned_client_exited; then exit 101; fi
kill -0 "$fixture_child" || exit 102
runner_start=$fixture_start
if owned_client_exited; then exit 103; fi
kill -0 "$fixture_child" || exit 104
# A different claimed start cannot authorize killing this actual live child.
runner_start=$((fixture_start+1))
owned_client_exited || exit 105
kill -0 "$fixture_child" || exit 106
[[ $(task_start "$fixture_child") == "$fixture_start" ]] || exit 107
finish_fixture
runner_start=
owned_client_exited || exit 108
[[ ! -e /proc/$runner ]] || exit 109
printf '%s\n' 'missing_start_live_rejected=true missing_start_absent_confirmed_twice=true foreign_pid_untouched=true'
"""


class RetainedMigrationPreservationOnceControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not sys.platform.startswith("linux") or shutil.which("sudo") is None:
            raise AssertionError("normal controls require the actual Linux sudo Bash runner")
        subprocess.run(["sudo", "-n", "/usr/bin/true"], check=True, capture_output=True, timeout=5)

    def run_original_checker(self, mode):
        root = Path(tempfile.mkdtemp(prefix="ynx-retained-preservation-public-", dir="/tmp")).resolve()
        try:
            result = subprocess.run(
                ["sudo", "-n", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "LC_ALL=C", "TZ=UTC",
                 "/bin/bash", "--noprofile", "--norc", "-s", "--", str(root), mode],
                input=FUNCTION + "\n" + HARNESS, text=True, capture_output=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertNotIn("publicSyntheticData", result.stdout)
            return result.stdout
        finally:
            # Only this test's newly allocated public fixture is removable.
            self.assertEqual(root.parent, Path("/tmp"))
            self.assertTrue(root.name.startswith("ynx-retained-preservation-public-"))
            subprocess.run(["sudo", "-n", "/usr/bin/rm", "-rf", "--", str(root)],
                           check=True, capture_output=True, timeout=5)

    def test_actual_stable_original_fd_hash_and_metadata(self):
        output = self.run_original_checker("stable")
        self.assertEqual(output.count("YNX_RETAINED_PRESERVATION_ROFD_DATA_PASS"), 1)
        print("YNX_RETAINED_PRESERVATION_ROFD_DATA_PASS", flush=True)

    def test_actual_replacement_or_inplace_change_rejected_without_cleanup(self):
        for mode in ("rename", "inplace", "mode", "nlink", "wrong-sha", "wrong-fd"):
            with self.subTest(mode=mode):
                self.assertIn(f"changed_original_rejected={mode} retained=true", self.run_original_checker(mode))

    def test_actual_client_absence_requires_provenance_or_two_absent_observations(self):
        result = subprocess.run(
            ["/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "LC_ALL=C",
             "/bin/bash", "--noprofile", "--norc", "-s"],
            input=CLIENT_FUNCTIONS + "\n" + CLIENT_HARNESS,
            text=True, capture_output=True, timeout=12,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "missing_start_live_rejected=true missing_start_absent_confirmed_twice=true foreign_pid_untouched=true")
        self.assertNotIn('[[ -z $runner_start ||', CONTROL)
        self.assertIn('if ! runner_start=$(task_start "$runner"); then\n  runner_start=\n  refuse owned-client-start-identity-unavailable-no-retry', CONTROL)
        self.assertIn('[[ $pass == 2 ]] || sleep 0.2', CLIENT_FUNCTIONS)

    def test_actual_receipt_filter_requires_exact_original_coordinates_and_blockers(self):
        receipt = {
            "version": "YNX-MIGRATION-PRESERVATION-CHECK/v1", "classification": "data",
            "scope": "unbound-application-import",
            "sourceSHA256": "f45c7a9659e2882ec9ea5f35aabd16a89f9d90ed5aac28fe6cb9034757b915f8",
            "sourceBytes": "701825267", "height": "1991198",
            "lastBlockHash": "761011132fd50907bc64176fde4b1e5ec32b4a55bb1998042da98276820a47b4",
            "stateHash": "97fb0502a532c09a76b4fe88b97a1e08f8839833bdcad36bc73ad25c0ba69197",
            "applicationImport": "verified", "infoInitialized": False,
            "accountsChecked": "5310", "contractsChecked": "0", "historyBlocksChecked": "1991199",
            # Synthetic unknown counters exercise their nonnegative-string rule;
            # this fixture does not claim the retained original has zero records.
            "historyTransactionsChecked": "0", "accountPolicyChecked": True,
            "persistedColdRestore": "unchecked", "validatorBinding": "unchecked",
            "executionCapabilities": "unresolved", "blockers": BLOCKERS,
            "deployment": "not-performed", "initChain": "not-performed", "pqActivation": "not-performed",
        }

        def accepts(value):
            result = subprocess.run(["jq", "-e", RECEIPT_FILTER], input=json.dumps(value),
                                    text=True, capture_output=True, timeout=3)
            return result.returncode == 0

        self.assertTrue(accepts(receipt))
        for field, value in (("height", "1991197"), ("lastBlockHash", "a" * 64),
                             ("stateHash", "b" * 64), ("accountsChecked", "5311"),
                             ("historyBlocksChecked", "1991198"), ("contractsChecked", "-1"),
                             ("historyTransactionsChecked", 0), ("executionCapabilities", "no-listed-blockers")):
            with self.subTest(field=field):
                bad = json.loads(json.dumps(receipt))
                bad[field] = value
                self.assertFalse(accepts(bad))
        for mutation in ("empty", "missing", "order", "count", "reason", "extra-field"):
            with self.subTest(blockers=mutation):
                bad = json.loads(json.dumps(receipt))
                if mutation == "empty":
                    bad["blockers"] = []
                    bad["executionCapabilities"] = "no-listed-blockers"
                elif mutation == "missing":
                    bad["blockers"].pop()
                elif mutation == "order":
                    bad["blockers"].reverse()
                elif mutation == "count":
                    bad["blockers"][0]["records"] += 1
                elif mutation == "reason":
                    bad["blockers"][1]["reason"] = "authority supplied"
                else:
                    bad["blockers"][2]["approved"] = True
                self.assertFalse(accepts(bad))

    def test_fixed_single_normal_callee_and_owned_runtime_boundaries(self):
        self.assertEqual(CONTROL.count("--verify-migration-preservation /var/tmp/ynx-pq-offline-native-78c7c581bff3-once02/migration.json"), 1)
        self.assertEqual(CONTROL.count("/usr/bin/prlimit --fsize=65536:65536 -- systemd-run"), 1)
        for required in (
            "readonly candidate=74d677f82997ca2547c23e5d285b7ee4618b2086",
            "readonly case_dir=/var/tmp/ynx-pq-preservation-74d677f82997-once01",
            "readonly unit=ynx-pq-preservation-74d677f82997-once01.service",
            "readonly migration_bytes=701825267", "$device == 64770 && $inode == 437212",
            "readonly source_sha=641a1dc67e911ec50d0931fedea24e00f0d6a8be54b01d911e719dc13ca080f2",
            "readonly cli_sha=d353845b92612accd56e2b0384ce7ef964997c8f163081de20ea8edbcc7f07a3",
            "readonly chaind_sha=6739e301029249fd39bd28a1701c4b582885f9414fed8eb43a538c5ebdc6ee00",
            "--property=PrivateNetwork=yes", "--property=MemoryMax=6442450944",
            "--property=MemorySwapMax=0", "--property=CPUQuota=200%",
            "--property=TimeoutStopSec=12s", "--property=KillMode=control-group",
            "--property=Restart=no", "--property=ProtectSystem=strict",
            'ReadWritePaths=$case_dir', 'ReadOnlyPaths=$migration $tools',
            "GOMAXPROCS=2 GOGC=50 GOMEMLIMIT=5GiB", "179.5-($1-start)", "($1-start)<180",
            "available >= 23622320128 && memory >= 10485760", "-ge 17179869184",
            "head -c 65536", "cleanup_attempted=true", "owned_empty", "cgroup.procs",
            '$(task_start "$runner" 2>/dev/null || true) == "$runner_start"',
            "${fields[19]} == 1308783438", "$exe == /usr/local/bin/ynx-chaind",
            "== 64770:793", "noAutomaticRetry=true", "status=UNKNOWN",
            "authoritativeFinalCheckpoint=false", "persistedColdRestore=unchecked",
            "validatorBinding=unchecked", "initChain=false", "pqActivation=false", "nodeStarted=false",
        ):
            self.assertIn(required, CONTROL)
        for forbidden in ("--export-consensus-state", "--verify-migration-state", "--verify-migration-execution",
                          "reset-failed", "--collect", "--tools)", "--candidate)", "source.tmp"):
            self.assertNotIn(forbidden, CONTROL)


if __name__ == "__main__":
    unittest.main(verbosity=2)
