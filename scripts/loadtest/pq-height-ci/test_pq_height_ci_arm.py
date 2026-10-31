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
                self.assertEqual(h.main(["arm", "--arm", "after-a", "--operation", str(target)]), 0)
            self.assertFalse(target.exists())
            self.assertFalse(json.loads(out.getvalue())["executed"])

    def test_hosted_execution_refused_before_mutation(self):
        with tempfile.TemporaryDirectory() as raw, mock.patch.dict(h.os.environ, {"GITHUB_ACTIONS": "false"}):
            target = Path(raw) / "not-created"
            with self.assertRaisesRegex(RuntimeError, "fresh sole hosted"):
                h.main(["arm", "--arm", "after-a", "--operation", str(target), "--execute"])
            self.assertFalse(target.exists())

    def test_exact_actual_test_pass_and_no_zero_skip(self):
        success = b"=== RUN   TestPQPerHeightVectors\n--- PASS: TestPQPerHeightVectors (1.23s)\nPASS\n"
        h.pass_record(success)
        for raw in (b"PASS\n", success.replace(b"--- PASS", b"--- SKIP"), success + success,
                    success + b"=== RUN   OtherTest\n", success + b"testing: warning: no tests to run\n",
                    success.replace(b"PASS\n", b"FAIL\n")):
            with self.subTest(raw=raw[:40]), self.assertRaises(RuntimeError):
                h.pass_record(raw)

    def test_exact_upstream_controls_are_not_math_and_cannot_skip(self):
        good = b".........\n----------------------------------------------------------------------\nRan 10 tests in 0.123s\n\nOK\n"
        h.controls_record(good)
        for raw in (good.replace(b"10 tests", b"0 tests"), good.replace(b"OK", b"OK (skipped=1)"), good + good):
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

    def test_fixed_successful_before_cannot_be_overridden_or_regenerated(self):
        intake, _ = h.dependencies()
        got = h.before_artifact({"GITHUB_RUN_ID": "999", "GITHUB_SHA": "b" * 40}, intake)
        self.assertEqual(got, h.BEFORE_ARTIFACT)
        self.assertEqual(got["artifactId"], 13050898515)
        self.assertEqual(got["runId"], 41223769700)
        self.assertEqual(got["workflowCommit"], "759957070c303cf2adfc5e0db70275cb51ed9c2b")
        self.assertEqual(got["size"], 676742462)
        for field in ("HEIGHT_BEFORE_ARTIFACT_ID", "HEIGHT_BEFORE_ARTIFACT_DIGEST", "HEIGHT_BEFORE_ARTIFACT_NAME"):
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "cannot be overridden"):
                h.before_artifact({field: "untrusted"}, intake)
        got["artifactId"] = 1
        self.assertEqual(h.BEFORE_ARTIFACT["artifactId"], 13050898515)

    def test_only_missing_after_a_can_execute(self):
        with tempfile.TemporaryDirectory() as raw:
            for arm in ("before", "after-b"):
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    h.main(["arm", "--arm", arm, "--operation", str(Path(raw) / arm)])
                self.assertFalse((Path(raw) / arm).exists())

    def test_linux_controls_require_real_named_pass_and_cannot_hide_skip(self):
        name = "test_actual_owned_thread_group_read_after_injected_leader_esrch"
        good = (name + " (__main__.OwnedRSSControls." + name + ") ... ok\n"
                + "Ran 15 tests in 0.123s\n\nOK\n").encode()
        h.controls_record(good, 15, (name,))
        for raw in (good.replace(b" ... ok", b" ... skipped"), good.replace(b"Ran 15", b"Ran 12"),
                    good.replace(name.encode(), b"other_name"), good + good):
            with self.subTest(raw=raw[:32]), self.assertRaises(RuntimeError):
                h.controls_record(raw, 15, (name,))
        with tempfile.TemporaryDirectory() as raw:
            target = Path(raw) / "not-created"
            with contextlib.redirect_stdout(io.StringIO()) as out:
                h.main(["controls", "--operation", str(target)])
            self.assertFalse(target.exists())
            self.assertFalse(json.loads(out.getvalue())["actualLinux"])

    def test_guard_only_comparison_never_grants_performance_or_pressure(self):
        good = dict(before=h.ARMS["before"][0], after=h.ARMS["after-a"][0], inputSHA256=h.INPUT_SHA,
                    recordsCompared=41, perHeightFunctionalEqual=True, guardOnlyFunctionalCompatibility=True,
                    performanceComparisonQualified=False, optimizedPressureAuthorized=False)
        h.fixed_diff(good, h.ARMS["after-a"][0])
        for field, value in (("recordsCompared", 40), ("guardOnlyFunctionalCompatibility", False),
                             ("performanceComparisonQualified", True), ("optimizedPressureAuthorized", True),
                             ("inputSHA256", "f" * 64), ("after", h.ARMS["after-b"][0])):
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                h.fixed_diff(dict(good, **{field: value}), h.ARMS["after-a"][0])

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


class ProcessEvidenceIntakeControls(unittest.TestCase):
    """New source/receipt/catalog controls only; no rerun of retained Linux33."""
    def record(self):
        return dict(schema="YNX-PQ-HEIGHT-LINUX-GUARD-CONTROLS/v1", toolsCommit=h.KERNEL_TOOLS,
                    toolsTree=h.KERNEL_TREE, workflowCommit=h.GUARD_ARTIFACT["workflowCommit"],
                    runId=str(h.GUARD_ARTIFACT["runId"]), caps=h.CAPS, resourceObserverVersion="same-process-rss-v2",
                    resourceObserverSHA256=h.KERNEL_SHA, firstCause=None, cleanupComplete=True,
                    actualLinux=True, actualKernelControlPassed=True, inputGenerated=False, publicNetwork=False,
                    performanceComparisonQualified=False, optimizedPressureAuthorized=False,
                    fixtureCounts={name:dict(passed=count,skipped=0) for name,count in h.RETAINED_LINUX_CONTROLS.items()},
                    processes=[dict(name=name,pid=i+1,startTicks=100+i,exited=True,rawReturnCode=0)
                               for i,name in enumerate(h.GUARD_PROCESSES)])

    def test_fixed_retained_33_receipt_rejects_source_skip_replacement_and_bad_children(self):
        record=self.record();h.validate_guard_record(record)
        self.assertEqual(h.retained_guard_artifact({})["artifactId"],13052310092)
        with self.assertRaisesRegex(RuntimeError,"cannot be overridden"):
            h.retained_guard_artifact({"HEIGHT_GUARD_ARTIFACT_ID":"other"})
        for field,value in (("toolsCommit",h.TOOLS),("actualLinux",False),("cleanupComplete",False),
                            ("runId","999"),("workflowCommit","f"*40),("resourceObserverSHA256","0"*64)):
            changed=json.loads(json.dumps(record));changed[field]=value
            with self.subTest(field=field),self.assertRaises(RuntimeError):h.validate_guard_record(changed)
        for field,value in (("skipped",1),("skipped",False),("passed",14)):
            changed=json.loads(json.dumps(record));changed["fixtureCounts"]["test_linux_owned_rss.py"][field]=value
            with self.subTest(field=field,value=value),self.assertRaises(RuntimeError):h.validate_guard_record(changed)
        changed=json.loads(json.dumps(record));changed["processes"][0]["rawReturnCode"]=1
        with self.assertRaises(RuntimeError):h.validate_guard_record(changed)

    def test_retained_13_file_catalog_uses_original_closed_zip_decoder(self):
        self.assertEqual(len(h.GUARD_NAMES),13)
        intake,_=h.dependencies();h.height_catalog(intake)
        self.assertEqual(intake.public_names("linux-guard-original"),h.GUARD_NAMES)
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw).resolve();valid=root/"valid.zip";zipped(valid,h.GUARD_NAMES)
            got=intake.safe_extract(valid,root/"valid","linux-guard-original")
            self.assertEqual({p.name for p in got.iterdir()},h.GUARD_NAMES)
            for i,names in enumerate((h.GUARD_NAMES-{"test_linux_owned_rss.log"},h.GUARD_NAMES|{".private/key.raw"})):
                path=root/(str(i)+".zip");zipped(path,names)
                with self.assertRaises(RuntimeError):intake.safe_extract(path,root/("out"+str(i)),"linux-guard-original")

    def test_actual_pinned_kernel_ast_and_full_differential_are_both_required(self):
        import hashlib
        raw=b"CAPS = {}\ndef owned_rss(pid):\n return 1\ndef same_process_rss_alternative(pid):\n return 2\n"
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);old=root/"old.py";new=root/"new.py";old.write_bytes(raw);new.write_bytes(raw)
            pin=hashlib.sha256(raw).hexdigest()
            with mock.patch.object(h,"KERNEL_SHA",pin),mock.patch.dict(h.VENDOR,{"consensus-linux-cohort.py":pin}):
                self.assertTrue(h.kernel_equivalence(old,new)["actualKernelASTEqual"])
            changed=raw.replace(b"return 2",b"return 3");new.write_bytes(changed)
            with mock.patch.object(h,"KERNEL_SHA",pin),mock.patch.dict(h.VENDOR,{"consensus-linux-cohort.py":hashlib.sha256(changed).hexdigest()}):
                with self.assertRaisesRegex(RuntimeError,"AST or CAPS changed"):h.kernel_equivalence(old,new)
        good=dict(before=h.ARMS["before"][0],after=h.ARMS["after-a"][0],inputSHA256=h.INPUT_SHA,recordsCompared=41,
                  perHeightFunctionalEqual=True,guardOnlyFunctionalCompatibility=True,
                  performanceComparisonQualified=False,optimizedPressureAuthorized=False)
        h.fixed_diff(good,h.ARMS["after-a"][0])
        for field,value in (("guardOnlyFunctionalCompatibility",False),("performanceComparisonQualified",True),
                            ("optimizedPressureAuthorized",True),("recordsCompared",40)):
            with self.subTest(field=field),self.assertRaises(RuntimeError):h.fixed_diff(dict(good,**{field:value}),h.ARMS["after-a"][0])


if __name__ == "__main__":
    unittest.main()
