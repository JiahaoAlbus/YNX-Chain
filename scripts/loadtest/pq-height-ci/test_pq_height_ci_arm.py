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
            with mock.patch.object(h,"KERNEL_SHA",pin),mock.patch.object(h,"EVIDENCE_SHA",pin):
                self.assertTrue(h.kernel_equivalence(old,new)["actualKernelASTEqual"])
            changed=raw.replace(b"return 2",b"return 3");new.write_bytes(changed)
            with mock.patch.object(h,"KERNEL_SHA",pin),mock.patch.object(h,"EVIDENCE_SHA",hashlib.sha256(changed).hexdigest()):
                with self.assertRaisesRegex(RuntimeError,"AST or CAPS changed"):h.kernel_equivalence(old,new)
        good=dict(before=h.ARMS["before"][0],after=h.ARMS["after-a"][0],inputSHA256=h.INPUT_SHA,recordsCompared=41,
                  perHeightFunctionalEqual=True,guardOnlyFunctionalCompatibility=True,
                  performanceComparisonQualified=False,optimizedPressureAuthorized=False)
        h.fixed_diff(good,h.ARMS["after-a"][0])
        for field,value in (("guardOnlyFunctionalCompatibility",False),("performanceComparisonQualified",True),
                            ("optimizedPressureAuthorized",True),("recordsCompared",40)):
            with self.subTest(field=field),self.assertRaises(RuntimeError):h.fixed_diff(dict(good,**{field:value}),h.ARMS["after-a"][0])


    def test_partial_path_printed_only_during_stop_is_preserved_after_terminal_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            work=Path(temporary).resolve();(work/"public").mkdir()
            public=work/"pq-height-vectors-late/public";public.mkdir(parents=True)
            log=work/"public/original-height-run.log"
            record=dict(firstCause="original live PID RSS refusal",cleanupComplete=False,
                        compileComplete=False,perHeightComplete=False,comparisonComplete=False)
            self.assertIsNone(h.public_after_cleanup(None,work,False))
            class Writer:
                def stop(self):
                    log.write_text(json.dumps(dict(publicArtifacts=str(public),firstCause="interrupted:15"))+"\n")
                    return True
            record["cleanupComplete"]=Writer().stop()
            self.assertEqual(h.public_after_cleanup(None,work,record["cleanupComplete"]),public)
            self.assertEqual(record["firstCause"],"original live PID RSS refusal")
            self.assertFalse(record["compileComplete"] or record["perHeightComplete"] or record["comparisonComplete"])
            # Merely seeing a late path is insufficient while writers are UNKNOWN.
            self.assertIsNone(h.public_after_cleanup(None,work,False))
            self.assertEqual(len(h.height_names()),88)
            self.assertNotIn("original-height-run.log",h.height_names())

    def test_partial_after_cleanup_missing_duplicate_and_nonowned_paths_stay_unpublished(self):
        with tempfile.TemporaryDirectory() as temporary:
            work=Path(temporary).resolve();(work/"public").mkdir()
            log=work/"public/original-height-run.log"
            self.assertIsNone(h.public_after_cleanup(None,work,True))
            private=work/".private/public";private.mkdir(parents=True)
            log.write_text(json.dumps(dict(publicArtifacts=str(private)))+"\n")
            self.assertIsNone(h.public_after_cleanup(None,work,True))
            public=work/"pq-height-vectors-late/public";public.mkdir(parents=True)
            row=json.dumps(dict(publicArtifacts=str(public)))+"\n"
            log.write_text(row+row)
            self.assertIsNone(h.public_after_cleanup(None,work,True))
            log.write_text("not a complete runner JSON row\n")
            self.assertIsNone(h.public_after_cleanup(None,work,True))
            # Existing owned DATA is kept without replacing it from a late log.
            self.assertEqual(h.public_after_cleanup(public,work,True),public)


class PidfdIntakeControls(unittest.TestCase):
    """Only the new fixed source/receipt/CLI delta; no Linux execution here."""

    def evidence(self):
        old = ProcessEvidenceIntakeControls().record()
        retained = dict(artifact=h.GUARD_ARTIFACT, actualLinux=True, actualKernelControlPassed=True,
                        fixtureCounts=old["fixtureCounts"], originalReceiptUnchanged=True)
        equality = dict(originalCommit=h.KERNEL_TOOLS, successorCommit=h.EVIDENCE_TOOLS,
                        originalSourceSHA256=h.KERNEL_SHA, successorSourceSHA256=h.EVIDENCE_SHA,
                        actualKernelASTEqual=True, originalCapsEqual=True)
        record = dict(schema="YNX-PQ-HEIGHT-LINUX-EVIDENCE-CONTROLS/v1",
                      toolsCommit=h.EVIDENCE_TOOLS, toolsTree=h.EVIDENCE_TREE,
                      workflowCommit=h.EVIDENCE_ARTIFACT["workflowCommit"],
                      runId=str(h.EVIDENCE_ARTIFACT["runId"]), caps=h.CAPS,
                      resourceObserverVersion="same-process-rss-v2", resourceObserverSHA256=h.EVIDENCE_SHA,
                      firstCause=None, cleanupComplete=True, actualLinux=True,
                      actualKernelControlPassed=True, inputGenerated=False, publicNetwork=False,
                      performanceComparisonQualified=False, optimizedPressureAuthorized=False,
                      retainedLinuxControls=retained, kernelEquivalence=equality,
                      fixtureCounts={"test_process_evidence.py": dict(passed=6, skipped=0)},
                      processes=[dict(name=name, pid=i+1, startTicks=100+i, exited=True, rawReturnCode=0)
                                 for i, name in enumerate(h.EVIDENCE_PROCESSES)])
        return record, retained

    def test_fixed_pidfd_sources_and_caps_are_original_blobs(self):
        import hashlib
        self.assertEqual(h.TOOLS, "4c14a893b1b98a1cf6a6259b243019fbf86400a1")
        self.assertEqual(h.TOOLS_TREE, "11aae01b4603949e2772f95ee6e3ab286776859c")
        expected = {
            "consensus-linux-cohort.py": (39502, "d7c657a1aa9787fa62a580f0f83caf71e17ba261697389322de521fef8902eaf"),
            "test_linux_thread_group_exit.py": (7820, "3b22ec42f247d76b0b12dc48fcdf28819efd799074d2931bee9d8ca235e84706"),
            "run-pq-baseline.py": (7991, "48fb354355810ad7b6bb66016536c934bc06f8379e6bd617f375870b1b25681d"),
            "pq-height-vectors.py": (19831, "88e7085944e7bc76018b59562fceaab0455a3b6a5dafbacf8309a690e925bb29"),
        }
        for name, (size, pin) in expected.items():
            raw = (h.HERE / "vendor" / name).read_bytes()
            self.assertEqual((len(raw), hashlib.sha256(raw).hexdigest()), (size, pin))
            self.assertEqual(h.VENDOR[name], pin)
        _, lab = h.dependencies()
        self.assertEqual(lab.RSS_OBSERVER_VERSION, "same-process-rss-v3-pidfd")
        self.assertEqual(lab.CAPS, dict(totalSeconds=900, cleanupSeconds=15, rssBytes=4294967296,
                                      newBytes=8589934592, initialMemoryBytes=6442450944,
                                      initialDiskBytes=17179869184, logBytes=4194304, cpus=2))
        self.assertEqual(h.LINUX_CONTROLS, {"test_linux_thread_group_exit.py": 6})
        self.assertEqual(h.BEFORE_ARTIFACT["artifactId"], 13050898515)
        self.assertEqual(h.INPUT_SHA, "c819fb976a422b855d3fc3e6939338995fa380556e642bda2ab59dcc66353401")

    def test_retained_six_cannot_be_relabelled_as_new_pidfd_success(self):
        record, retained = self.evidence()
        h.validate_evidence_record(record, retained)
        self.assertEqual(h.retained_evidence_artifact({})["artifactId"], 13053266101)
        self.assertEqual(h.EVIDENCE_ARTIFACT["size"], 6986)
        self.assertEqual(h.EVIDENCE_ARTIFACT["digest"], "64a0448ecabba5bc217c09c74d02c5ba8dafe8c0273e1c860f00a48503c12c2e")
        with self.assertRaises(RuntimeError):
            h.retained_evidence_artifact({"HEIGHT_EVIDENCE_ID": "replacement"})
        for key, value in (("toolsCommit", h.TOOLS), ("toolsTree", h.TOOLS_TREE),
                           ("resourceObserverVersion", "same-process-rss-v3-pidfd"),
                           ("cleanupComplete", False), ("actualLinux", False),
                           ("firstCause", "original refusal"), ("performanceComparisonQualified", True)):
            bad = json.loads(json.dumps(record)); bad[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                h.validate_evidence_record(bad, retained)
        for key, value in (("passed", 5), ("skipped", 1), ("skipped", False)):
            bad = json.loads(json.dumps(record)); bad["fixtureCounts"]["test_process_evidence.py"][key] = value
            with self.assertRaises(RuntimeError): h.validate_evidence_record(bad, retained)
        for key, value in (("rawReturnCode", 1), ("rawReturnCode", False), ("startTicks", 0)):
            bad = json.loads(json.dumps(record)); bad["processes"][-1][key] = value
            with self.assertRaises(RuntimeError): h.validate_evidence_record(bad, retained)
        bad = json.loads(json.dumps(record)); bad["retainedLinuxControls"]["artifact"]["artifactId"] += 1
        with self.assertRaises(RuntimeError): h.validate_evidence_record(bad, retained)

    def test_retained_twenty_catalog_keeps_original_closed_zip_parser(self):
        self.assertEqual(len(h.EVIDENCE_NAMES), 20)
        intake, _ = h.dependencies(); h.height_catalog(intake)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            valid = root / "valid.zip"; zipped(valid, h.EVIDENCE_NAMES)
            result = intake.safe_extract(valid, root / "actual", "linux-evidence-original")
            self.assertEqual({p.name for p in result.iterdir()}, h.EVIDENCE_NAMES)
            for i, (names, options) in enumerate((
                (h.EVIDENCE_NAMES - {"test_process_evidence.log"}, {}),
                (h.EVIDENCE_NAMES | {".private/key.raw"}, {}),
                (h.EVIDENCE_NAMES, {"symlink": "controller-identity.log"}),
                (h.EVIDENCE_NAMES, {"duplicate": "controller-identity.log"}),
            )):
                bad = root / (str(i) + ".zip"); zipped(bad, names, **options)
                with self.assertRaises(RuntimeError):
                    intake.safe_extract(bad, root / ("bad" + str(i)), "linux-evidence-original")

    def test_new_six_require_named_actual_linux_pass_without_skip(self):
        raw = ("\n".join(name + " (__main__.ThreadGroupExitControls." + name + ") ... ok"
                         for name in h.PIDFD_TEST_NAMES) + "\nRan 6 tests in 0.123s\n\nOK\n").encode()
        h.controls_record(raw, 6, h.PIDFD_TEST_NAMES)
        for bad in (raw.replace(b"Ran 6", b"Ran 0"), raw.replace(b"OK", b"OK (skipped=1)"),
                    raw.replace(h.PIDFD_TEST_NAMES[0].encode(), b"unrelated_test"), raw + raw,
                    raw.replace(b" ... ok", b" ... skipped 'Linux required'", 1)):
            with self.assertRaises(RuntimeError): h.controls_record(bad, 6, h.PIDFD_TEST_NAMES)

    def test_changed_guard_never_claims_v2_equals_v3_or_changes_other_code(self):
        import hashlib
        old = b'CAPS = {"cpus":2}\nRSS_OBSERVER_VERSION="same-process-rss-v2"\ndef owned_rss():\n return 1\ndef fallback():\n return 3\n'
        new = old.replace(b'RSS_OBSERVER_VERSION="same-process-rss-v2"', b'import select\nRSS_OBSERVER_VERSION="same-process-rss-v3-pidfd"').replace(b'return 1', b'return 2') + b'def process_group_exit_probe():\n return 4\n'
        with tempfile.TemporaryDirectory() as temporary:
            a, b = Path(temporary) / "original.py", Path(temporary) / "successor.py"
            a.write_bytes(old); b.write_bytes(new)
            with mock.patch.object(h, "EVIDENCE_SHA", hashlib.sha256(old).hexdigest()), mock.patch.dict(h.VENDOR, {"consensus-linux-cohort.py": hashlib.sha256(new).hexdigest()}):
                result = h.guard_only_transition(a, b)
                self.assertTrue(result["unchangedOtherModuleAST"])
                self.assertFalse(result["actualKernelASTEqual"] or result["actualNewLinuxControlPassed"])
                self.assertFalse(result["performanceComparisonQualified"] or result["optimizedPressureAuthorized"])
                b.write_bytes(new + b"# replacement without independent pin\n")
                with self.assertRaises(RuntimeError): h.guard_only_transition(a, b)
            for changed in (new.replace(b'"cpus":2', b'"cpus":1'), new.replace(b'return 3', b'return 0')):
                b.write_bytes(changed)
                with mock.patch.object(h, "EVIDENCE_SHA", hashlib.sha256(old).hexdigest()), mock.patch.dict(h.VENDOR, {"consensus-linux-cohort.py": hashlib.sha256(changed).hexdigest()}):
                    with self.assertRaisesRegex(RuntimeError, "unapproved functional"):
                        h.guard_only_transition(a, b)

    def test_default_and_workflow_only_execute_new_six_then_missing_a(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "absent"
            with contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(h.main(["controls", "--operation", str(target)]), 0)
            self.assertFalse(json.loads(out.getvalue())["executed"])
            self.assertFalse(target.exists())
            for arm in ("before", "after-b"):
                with self.assertRaisesRegex(RuntimeError, "only the missing"):
                    h.run(type("Args", (), dict(arm=arm, execute=True))())
        workflow = (h.HERE.parents[2] / ".github/workflows/pq-height-vectors-ci.yml").read_text()
        self.assertIn("--arm after-a", workflow)
        self.assertNotIn("--arm before", workflow); self.assertNotIn("--arm after-b", workflow)
        self.assertIn("go-version: '1.26.10'", workflow)
        self.assertIn("cache: false", workflow)
        self.assertIn("ProcessEvidenceIntakeControls.test_partial_path_printed_only_during_stop", workflow)
        self.assertIn("PidfdIntakeControls", workflow)


if __name__ == "__main__":
    unittest.main()
