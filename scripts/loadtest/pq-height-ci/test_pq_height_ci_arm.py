"""Pure intake controls. No Go, download, signature, node or actual Window."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

PATH = Path(__file__).with_name("pq-height-ci-arm.py")
SPEC = importlib.util.spec_from_file_location("height_ci_controls", PATH)
h = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(h)


def zipped(path, names, *, duplicate=None, symlink=None):
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(path, "x", zipfile.ZIP_DEFLATED) as archive:
            for name in [*sorted(names), *([duplicate] if duplicate else [])]:
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = (0o120777 if name == symlink else 0o100600) << 16
                archive.writestr(info, b"PUBLIC CONTROL ONLY; no source execution\n")


class HeightCIControls(unittest.TestCase):
    def test_frozen_bootstrap_and_caps_exact(self):
        intake, lab = h.dependencies()
        self.assertEqual(lab.CAPS, h.CAPS)
        self.assertEqual(intake.OLD_ARTIFACT["artifactId"], 13042588614)
        self.assertEqual(intake.B8_INPUT, h.INPUT_SHA)
        self.assertEqual(set(h.ARMS), {"before", "after-a", "after-b"})

    def test_prepared_only_has_no_effect(self):
        with tempfile.TemporaryDirectory() as raw:
            target = Path(raw) / "not-created"
            with contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(h.main(["arm", "--arm", "before", "--operation", str(target)]), 0)
            self.assertFalse(target.exists())
            self.assertFalse(json.loads(out.getvalue())["executed"])

    def test_hosted_execution_refused_before_mutation(self):
        with tempfile.TemporaryDirectory() as raw, mock.patch.dict(h.os.environ, {"GITHUB_ACTIONS": "false"}):
            target = Path(raw) / "not-created"
            with self.assertRaisesRegex(RuntimeError, "fresh sole hosted"):
                h.main(["arm", "--arm", "before", "--operation", str(target), "--execute"])
            self.assertFalse(target.exists())

    def test_exact_actual_test_pass_and_no_zero_skip(self):
        success = b"=== RUN   TestPQPerHeightVectors\n--- PASS: TestPQPerHeightVectors (1.23s)\nPASS\n"
        h.pass_record(success)
        for raw in (b"PASS\n", success.replace(b"--- PASS", b"--- SKIP"), success + success,
                    success + b"=== RUN   OtherTest\n", success + b"testing: warning: no tests to run\n",
                    success.replace(b"PASS\n", b"FAIL\n")):
            with self.subTest(raw=raw[:40]), self.assertRaises(RuntimeError):
                h.pass_record(raw)

    def test_nine_upstream_controls_are_not_math_and_cannot_skip(self):
        good = b".........\n----------------------------------------------------------------------\nRan 9 tests in 0.123s\n\nOK\n"
        h.controls_record(good)
        for raw in (good.replace(b"9 tests", b"0 tests"), good.replace(b"OK", b"OK (skipped=1)"), good + good):
            with self.assertRaises(RuntimeError):
                h.controls_record(raw)

    def test_height_catalog_exact_not_old_terminal_states(self):
        names = h.height_names()
        self.assertEqual(len(names), 88)
        self.assertEqual(len([x for x in names if x.endswith("-record.json")]), 41)
        self.assertNotIn("H512-K16-after.json", names)
        intake, _ = h.dependencies()
        old = intake.public_names("original")
        h.height_catalog(intake)
        self.assertEqual(intake.public_names("original"), old)
        self.assertEqual(intake.public_names("height-original"), names)

    def test_original_closed_zip_parser_accepts_only_exact_height_catalog(self):
        intake, _ = h.dependencies()
        h.height_catalog(intake)
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            archive = root / "height.zip"
            zipped(archive, h.height_names())
            extracted = intake.safe_extract(archive, root / "new", "height-original")
            self.assertEqual({p.name for p in extracted.iterdir()}, h.height_names())
            with self.assertRaisesRegex(RuntimeError, "fresh extraction"):
                intake.safe_extract(archive, root / "new", "height-original")

    def test_height_archive_missing_extra_duplicate_symlink_and_trailer_refused(self):
        cases = [
            (h.height_names() - {"height-005-state.json"}, {}, False),
            (h.height_names() | {".private/key.raw"}, {}, False),
            (h.height_names(), {"duplicate": "receipt.json"}, False),
            (h.height_names(), {"symlink": "height-005-state.json"}, False),
            (h.height_names(), {}, True),
        ]
        intake, _ = h.dependencies()
        h.height_catalog(intake)
        for names, kwargs, tail in cases:
            with self.subTest(kwargs=kwargs, tail=tail), tempfile.TemporaryDirectory() as raw:
                root = Path(raw).resolve()
                archive = root / "height.zip"
                zipped(archive, names, **kwargs)
                if tail:
                    with archive.open("ab") as out:
                        out.write(b"UNINDEXED")
                with self.assertRaises(RuntimeError):
                    intake.safe_extract(archive, root / "new", "height-original")
                self.assertFalse((root / "new").exists())

    def test_same_run_before_pins_required(self):
        intake, _ = h.dependencies()
        env = {"HEIGHT_BEFORE_ARTIFACT_ID": "123", "HEIGHT_BEFORE_ARTIFACT_DIGEST": "sha256:" + "a" * 64,
               "HEIGHT_BEFORE_ARTIFACT_NAME": "pq-height-before-456", "GITHUB_RUN_ID": "456", "GITHUB_SHA": "b" * 40}
        self.assertEqual(h.before_artifact(env, intake)["workflowCommit"], "b" * 40)
        for field, value in (("HEIGHT_BEFORE_ARTIFACT_ID", "0"), ("HEIGHT_BEFORE_ARTIFACT_DIGEST", "0" * 64),
                             ("HEIGHT_BEFORE_ARTIFACT_NAME", "pq-current-baseline-fdc-41202295972-1")):
            changed = dict(env, **{field: value})
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                h.before_artifact(changed, intake)

    def test_checkout_is_owned_sequential_and_never_go_env(self):
        class Window:
            def __init__(self, work):
                self.work, self.commands = work, []
            def launch(self, name, command):
                self.commands.append((name, command))
                return name
            def wait(self, process):
                self.commands.append(("wait", process))
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / ".private").mkdir()
            window = Window(root)
            h.checkout(window, "tools", h.TOOLS, h.TOOLS_TREE, ["/scripts/loadtest/"])
            self.assertEqual(len(window.commands), 14)
            self.assertTrue(all(name == "wait" for name, _ in window.commands[1::2]))
            actual = [command for name, command in window.commands if name != "wait"]
            self.assertFalse(any(command[0] == "go" for command in actual))
            self.assertIn(h.TOOLS, actual[2])
            self.assertIn(h.REPOSITORY_URL, actual[1])

    def test_actual_runner_public_path_no_private_escape(self):
        with tempfile.TemporaryDirectory() as raw:
            operation = Path(raw).resolve()
            public = operation / "pq-height-vectors-test/public"
            public.mkdir(parents=True)
            log = operation / "entry.log"
            log.write_text(json.dumps({"publicArtifacts": str(public)}) + "\n")
            self.assertEqual(h.public_from_runner(log, operation), public)
            private = operation / ".private/public"
            private.mkdir(parents=True)
            log.write_text(json.dumps({"publicArtifacts": str(private)}) + "\n")
            with self.assertRaisesRegex(RuntimeError, "escaped"):
                h.public_from_runner(log, operation)


if __name__ == "__main__":
    unittest.main()
