"""Public DATA serializer controls; no GitHub API, build, key or node runtime."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("stage", Path(__file__).with_name("pq-ci-stage-inputs.py"))
stage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stage)
SHA, TREE, RUN, ATTEMPT = "a" * 40, "b" * 40, "39166680001", "1"


class PublicStageInputsControls(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.source, self.target, self.bundle = (self.base / name for name in ("source", "target", "bundle"))
        self.source.mkdir(mode=0o700)
        self.target.mkdir(mode=0o700)
        (self.source / stage.OPERATOR).mkdir(mode=0o700)
        self.original = {name: ("public serializer DATA " + name + "\n").encode() for name in stage.FILES}
        for name, raw in self.original.items():
            stage.write_new(self.source / name, raw)

    def export(self):
        return stage.export_inputs(self.source, self.bundle, SHA, TREE, RUN, ATTEMPT)

    def restore(self, pin, **changes):
        values = dict(commit=SHA, tree=TREE, run_id=RUN, attempt=ATTEMPT, manifest_sha256=pin)
        values.update(changes)
        return stage.restore_inputs(self.target, self.bundle, **values)

    def test_exact_nine_public_files_round_trip_without_source_plan_database_or_binary(self):
        self.assertEqual(len(stage.FILES), 9)
        self.assertFalse(any(token in name for name in stage.FILES for token in ("original/", ".db", "key", "source-plan", "metadata", "consensus.test")))
        receipt = self.export()
        manifest = (self.bundle / "manifest.json").read_bytes()
        self.assertEqual(receipt["manifestSHA256"], hashlib.sha256(manifest).hexdigest())
        self.assertEqual(receipt["producerJob"], "focused-go")
        self.assertFalse(receipt["nodeStarted"])
        self.assertTrue(receipt["publicDataOnly"])
        self.assertEqual(self.restore(receipt["manifestSHA256"]), receipt)
        self.assertEqual(stage.material(self.source), self.original)
        self.assertEqual(stage.material(self.target), self.original)
        for name in stage.FILES:
            self.assertEqual((self.target / name).stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError):
            self.restore(receipt["manifestSHA256"])
        self.assertEqual(stage.material(self.target), self.original)

    def test_wrong_source_run_attempt_manifest_and_missing_pin_fail_before_restore(self):
        receipt = self.export()
        for changes in (dict(commit="c" * 40), dict(tree="c" * 40), dict(run_id="39166680002"),
                        dict(attempt="2"), dict(manifest_sha256=None), dict(manifest_sha256="0" * 64),
                        dict(manifest_sha256="c" * 64)):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.restore(receipt["manifestSHA256"], **changes)
            self.assertEqual(list(self.target.iterdir()), [])

    def test_export_missing_extra_empty_symlink_or_writable_input_never_creates_bundle(self):
        path = self.source / stage.OPERATOR / "migration.json"
        for mutation in ("missing", "empty", "symlink", "writable", "extra"):
            with self.subTest(mutation=mutation):
                extra = self.source / stage.OPERATOR / "private-key.json"
                path.unlink()
                if mutation == "empty":
                    path.touch(mode=0o600)
                elif mutation == "symlink":
                    path.symlink_to(self.source / "ynx-pq-consensus-light-proof-public.json")
                elif mutation == "writable":
                    stage.write_new(path, self.original[stage.OPERATOR + "/migration.json"])
                    path.chmod(0o666)
                elif mutation == "extra":
                    stage.write_new(path, self.original[stage.OPERATOR + "/migration.json"])
                    stage.write_new(extra, b"public negative DATA")
                with self.assertRaises((ValueError, OSError)):
                    self.export()
                self.assertFalse(os.path.lexists(self.bundle))
                if os.path.lexists(path):
                    path.unlink()
                if extra.exists():
                    extra.unlink()
                stage.write_new(path, self.original[stage.OPERATOR + "/migration.json"])

    def test_existing_bundle_and_destination_symlinks_are_preserved(self):
        self.bundle.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.export()
        self.assertTrue(self.bundle.is_symlink())
        self.assertEqual(stage.material(self.source), self.original)
        self.bundle.unlink()
        receipt = self.export()
        destination = self.target / stage.OPERATOR
        destination.symlink_to(self.source / stage.OPERATOR, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.restore(receipt["manifestSHA256"])
        self.assertTrue(destination.is_symlink())

    def test_changed_bytes_extra_catalog_duplicate_manifest_and_identity_do_not_restore(self):
        receipt = self.export()
        original_manifest = (self.bundle / "manifest.json").read_bytes()
        path = self.bundle / "ynx-pq-consensus-light-proof-public.json"
        path.write_bytes(b"substituted public DATA")
        with self.assertRaises(ValueError):
            self.restore(receipt["manifestSHA256"])
        path.write_bytes(self.original[path.name])
        manifest = json.loads(original_manifest)
        for mutation in ("extra", "duplicate", "boolean", "old-run", "old-attempt", "producer"):
            modified = copy.deepcopy(manifest)
            if mutation == "extra":
                modified["files"]["../outside"] = dict(bytes="1", sha256="c" * 64)
            elif mutation == "boolean":
                modified["nodeStarted"] = 0
            elif mutation == "old-run":
                modified["runId"] = "39166680002"
            elif mutation == "old-attempt":
                modified["runAttempt"] = "2"
            elif mutation == "producer":
                modified["producerJob"] = "protocol-delivery"
            raw = json.dumps(modified, separators=(",", ":")).encode()
            if mutation == "duplicate":
                raw = raw[:-1] + b',"commit":"' + SHA.encode() + b'"}'
            (self.bundle / "manifest.json").write_bytes(raw)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.restore(hashlib.sha256(raw).hexdigest())
            self.assertEqual(list(self.target.iterdir()), [])

    def test_size_bounds_and_interrupted_export_keep_partial_without_completion_marker(self):
        with patch.dict(stage.FILES, {"ynx-pq-consensus-light-proof-public.json": 1}):
            with self.assertRaises(ValueError):
                self.export()
        self.assertFalse(self.bundle.exists())
        original_writer = stage.write_new
        calls = 0

        def interrupted(path, raw):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("synthetic interrupted public copy")
            return original_writer(path, raw)

        with patch.object(stage, "write_new", side_effect=interrupted), self.assertRaises(OSError):
            self.export()
        self.assertTrue(self.bundle.exists())
        self.assertFalse((self.bundle / "manifest.json").exists())
        retained = {str(path.relative_to(self.bundle)): path.read_bytes() for path in self.bundle.rglob("*") if path.is_file()}
        with self.assertRaises(ValueError):
            self.export()
        self.assertEqual(retained, {str(path.relative_to(self.bundle)): path.read_bytes() for path in self.bundle.rglob("*") if path.is_file()})


if __name__ == "__main__":
    unittest.main()
