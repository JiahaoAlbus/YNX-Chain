#!/usr/bin/env python3
"""Offline controls for the exact vendor recipe and terminal receipt."""

from copy import deepcopy
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().with_name("build-vendor-successor.py")
spec = importlib.util.spec_from_file_location("vendor_successor", SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class VendorContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.body, cls.guard = release.load_owner()
        cls.plan = release.read(release.PLAN)
        cls.digest = cls.guard.sha(release.PLAN)

    def test_plan_matches_from_frozen_cohort_path(self):
        with tempfile.TemporaryDirectory(dir=release.CASE, prefix="release-contract.") as scratch:
            family = Path(scratch) / "successors"
            here = family / "cache-observation"
            here.mkdir(parents=True)
            for source in (SCRIPT, release.PATCH, release.SOURCE_PIN, release.HERE / "observe-headers.py"):
                shutil.copy2(source, here)
            shutil.copytree(release.HERE / "overlay", here / "overlay")
            owner_path = family / "body-idle-observation"
            owner_path.mkdir()
            shutil.copy2(release.OWNER, owner_path)
            staged_spec = importlib.util.spec_from_file_location("cohort", here / SCRIPT.name)
            staged = importlib.util.module_from_spec(staged_spec)
            staged_spec.loader.exec_module(staged)
            body, guard = staged.load_owner()
            self.assertEqual(staged.checked_plan(body, guard), self.plan)

    def test_only_expected_overlay_file_changes(self):
        original = release.read(release.SOURCE_MANIFEST)
        modified = deepcopy(original)
        for name, row in self.plan["sourceDelta"].items():
            pinned = release.HERE / "overlay" / name
            modified[name] = {"mode": original.get(name, {}).get("mode", "0o644"),
                              "bytes": pinned.stat().st_size, "sha256": self.guard.sha(pinned)}
        release.verified_source_manifest(self.plan, modified)
        changed = deepcopy(modified)
        changed["Cargo.lock"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "unrelated-source-delta:Cargo.lock"):
            release.verified_source_manifest(self.plan, changed)
        changed = deepcopy(modified)
        changed["unexpected"] = {}
        with self.assertRaisesRegex(RuntimeError, "source-file-set"):
            release.verified_source_manifest(self.plan, changed)

    def test_original_wait_release_requirements(self):
        expected = release.build_steps(self.plan)
        observed = {
            "schema": "P05_NYM_QA_CACHE_OBSERVATION_VENDOR_TERMINAL_V1", "phase": "build",
            "buildPlanSHA256": self.digest, "firstFailure": None, "cleanupFailure": None,
            "childOutcomeRecordingFailure": None, "remainingOwned": [], "callerSignals": [],
            "productionRelease": False, "publicNetwork": False, "elapsedSeconds": 20, "groupRSSPeakBytes": 2048,
            "resourceSamples": [{"homeFreeBytes": release.LIMITS["runHostBytes"],
                                 "WDFreeBytes": release.LIMITS["minimumWDBytes"], "memoryFreePercent": 20,
                                 "ownAllocatedGrowth": 0, "globalWDFreeDropUnattributed": 0}],
            "steps": [{"name": name, "argv": argv, "pid": pid, "pgid": pid, "exit": 0, "elapsed": 1,
                       "reaped": True, "terminalOutcome": "ORIGINAL_POPEN_WAIT"}
                      for pid, (name, argv) in enumerate(expected.items(), 101)],
        }
        release.terminal_ok(observed, "build", self.digest, expected)
        mutations = (
            ("firstFailure", {"cause": "first-build-failure"}, "receipt-unclosed"),
            ("cleanupFailure", {"cause": "cleanup-failed"}, "receipt-unclosed"),
            ("remainingOwned", [{"state": "UNKNOWN"}], "receipt-unclosed"),
            ("productionRelease", True, "receipt-unclosed"),
            ("elapsedSeconds", 901, "receipt-resource-limit"),
            ("groupRSSPeakBytes", 4 * release.GIB + 1, "receipt-resource-limit"),
        )
        for field, value, error in mutations:
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, error):
                release.terminal_ok(dict(observed, **{field: value}), "build", self.digest, expected)
        for field, value, error in (("reaped", False, "receipt-original-child-wait"),
                                    ("exit", False, "receipt-original-child-wait"),
                                    ("pgid", 222, "receipt-original-child-wait"),
                                    ("argv", ["/usr/bin/false"], "receipt-command-order")):
            changed = deepcopy(observed)
            changed["steps"][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, error):
                release.terminal_ok(changed, "build", self.digest, expected)
        changed = deepcopy(observed)
        changed["resourceSamples"][0]["globalWDFreeDropUnattributed"] = 4 * release.GIB + 1
        with self.assertRaisesRegex(RuntimeError, "receipt-resource-samples"):
            release.terminal_ok(changed, "build", self.digest, expected)

    def test_known_identical_rewrite_only(self):
        with tempfile.TemporaryDirectory(dir=release.CASE, prefix="release-contract.") as scratch:
            root = Path(scratch)
            env = root / "source" / release.ENV_REWRITE
            env.parent.mkdir(parents=True)
            env.write_bytes(b"original")
            before = {release.ENV_REWRITE: [1, 2, 8, 3, 4, 0o644], "other": [1, 3, 1, 2, 3, 0o644]}
            observed = deepcopy(before)
            observed[release.ENV_REWRITE][3] = 8
            manifest = {release.ENV_REWRITE: {"sha256": self.guard.sha(env)}}
            with patch.object(release, "WORK", root):
                release.allow_env_rewrite(self.guard, before, observed, manifest)
                env.write_bytes(b"mutation")
                with self.assertRaisesRegex(RuntimeError, "source-drift:envs/mainnet.env"):
                    release.allow_env_rewrite(self.guard, before, observed, manifest)
                env.write_bytes(b"original")
                observed["other"][3] = 8
                with self.assertRaisesRegex(RuntimeError, "source-drift:other"):
                    release.allow_env_rewrite(self.guard, before, observed, manifest)

    def test_binary_marker_is_not_in_predecessor(self):
        self.assertFalse(release.binary_observation_marker(release.OLD_BINARY))
        with tempfile.TemporaryDirectory(dir=release.CASE, prefix="release-contract.") as scratch:
            target = Path(scratch) / "binary-test"
            target.write_bytes(b"!" * (1024 * 1024 - 8) + release.OBSERVATION_MARKER)
            self.assertTrue(release.binary_observation_marker(target))


if __name__ == "__main__":
    unittest.main(verbosity=2)
