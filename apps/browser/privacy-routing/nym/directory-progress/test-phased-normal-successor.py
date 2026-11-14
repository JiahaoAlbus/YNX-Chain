#!/usr/bin/env python3
"""Exercise the phased normal successor's input and allocation fences locally."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    "phased_normal", Path(__file__).with_name("phased-normal-successor.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InputFences(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(dir=os.environ["NYM_PHASED_TEST_ROOT"])
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name).resolve()
        self.leaf = self.root / "probe"
        self.leaf.write_bytes(b"valid")
        self.expected = {"probe": {"bytes": 5, "sha256": hashlib.sha256(b"valid").hexdigest()}}

    def read(self, tick=lambda: None):
        return module.snapshot(self.root, self.expected, tick)

    def test_read_exact_sha_and_owner_allocation(self):
        seen = self.read()
        self.assertEqual(seen["hashedBytes"], 5)
        self.assertGreater(seen["allocatedSumBytes"], 0)
        self.assertEqual(seen["allocatedSumBytes"], module.allocated_tree(self.root, lambda: None))
        module.verify_continuity(seen, self.read())

    def test_unchanged_mtime_does_not_hide_payload_or_identity_change(self):
        before = self.read()
        stamp = self.leaf.stat()
        # Child changes bytes without changing length, then restores atime and mtime.
        child = subprocess.run([sys.executable, "-IB", "-c",
            "import os,sys; p=sys.argv[1]; open(p,'wb').write(b'wrong'); "
            "os.utime(p,ns=(int(sys.argv[2]),int(sys.argv[3])))",
            str(self.leaf), str(stamp.st_atime_ns), str(stamp.st_mtime_ns)],
            timeout=5, check=False)
        self.assertEqual(child.returncode, 0)
        self.assertEqual(self.leaf.stat().st_mtime_ns, stamp.st_mtime_ns)
        with self.assertRaisesRegex(RuntimeError, "snapshot-content-mismatch"):
            self.read()
        with self.assertRaisesRegex(RuntimeError, "warm-cache-continuity"):
            module.verify_continuity(before, module.snapshot(self.root, None, lambda: None))

    def test_actual_concurrent_file_replacement_fails(self):
        pending = self.root.parent / (self.root.name + "-replacement")
        self.addCleanup(pending.unlink, missing_ok=True)
        pending.write_bytes(b"valid")
        original = module.read_digest

        def replace(dfd, tick):
            child = subprocess.run(["/bin/mv", str(pending), str(self.leaf)], timeout=5, check=False)
            self.assertEqual(child.returncode, 0)
            return original(dfd, tick)

        with mock.patch.object(module, "read_digest", replace):
            with self.assertRaisesRegex(RuntimeError, "snapshot-file-changed"):
                self.read()

    def test_extra_file_and_fifo_are_refused(self):
        extra = self.root / "extra"
        extra.write_bytes(b"unexpected")
        with self.assertRaisesRegex(RuntimeError, "snapshot-input-size-or-name"):
            self.read()
        extra.unlink()
        os.mkfifo(extra, mode=0o600)
        with self.assertRaisesRegex(RuntimeError, "snapshot-file-owner-or-type"):
            self.read()

    def test_plan_pin_and_digest_use_the_same_opened_bytes(self):
        raw = b'{"value": 7}\n'
        self.leaf.write_bytes(raw)
        self.assertEqual(module.sealed_data(self.leaf, hashlib.sha256(raw).hexdigest()), {"value": 7})
        with self.assertRaisesRegex(RuntimeError, "sealed-data-pin"):
            module.sealed_data(self.leaf, hashlib.sha256(b"").hexdigest())

    def test_separate_input_deadline_rejects_without_live_cargo(self):
        class Capacity:
            def facts(self, _):
                return {"homeFreeBytes": 3 * module.GIB, "WDFreeBytes": 32 * module.GIB,
                        "memoryFreePercent": 50}

            def require_floors(self, _):
                pass
        phase = module.ReadPhase(Capacity(), None, 0, self.root)
        with self.assertRaisesRegex(RuntimeError, "input-verification-deadline"):
            phase.sample()


class AllocationFences(unittest.TestCase):
    def test_allocation_growth_is_distinct_from_global_free_disk_growth(self):
        g = module.GIB
        baseline = {"ownAllocatedSumNotUniquePhysical": g, "WDFreeBytes": 32 * g}
        sample = {"ownAllocatedSumNotUniquePhysical": 5 * g, "WDFreeBytes": 28 * g,
                  "homeFreeBytes": 2 * g, "memoryFreePercent": 20}
        module.allocation_budget(sample, baseline)
        with self.assertRaisesRegex(RuntimeError, "input-own-allocated-growth"):
            module.allocation_budget(dict(sample, ownAllocatedSumNotUniquePhysical=5 * g + 1,
                                          WDFreeBytes=32 * g), baseline)
        with self.assertRaisesRegex(RuntimeError, "input-global-wd-growth"):
            module.allocation_budget(dict(sample, WDFreeBytes=28 * g - 1), baseline)

    def test_each_disk_and_memory_floor_remains_enforced(self):
        g = module.GIB
        sample = {"ownAllocatedSumNotUniquePhysical": 0, "WDFreeBytes": 16 * g,
                  "homeFreeBytes": 2 * g, "memoryFreePercent": 20}
        for name in ("WDFreeBytes", "homeFreeBytes", "memoryFreePercent"):
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "input-host-floor"):
                module.allocation_budget(dict(sample, **{name: sample[name] - 1}), sample)


if __name__ == "__main__":
    unittest.main(verbosity=2)
