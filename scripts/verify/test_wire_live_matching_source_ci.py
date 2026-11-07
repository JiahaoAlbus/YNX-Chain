#!/usr/bin/env python3
"""Pure controls: no Go, subprocess child, network, node or source mutation."""
import base64
import contextlib
import hashlib
import importlib.util
import inspect
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("wire_live_ci", HERE / "wire-live-matching-source-ci.py")
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class WireLiveSourceControls(unittest.TestCase):
    def test_corrected_successor_requires_both_readiness_fixes_and_every_named_pass(self):
        self.assertEqual(len(ci.BUDGET), 22)
        self.assertEqual(len(ci.LOSSLESS_BUDGET), 24)
        required_new = ["TestLosslessHexBudgetInitialPeerReadinessDeadline",
                        "TestLosslessHexBudgetReadyTransitionKeepsSelectedCarrier"]
        self.assertEqual(ci.LOSSLESS_BUDGET[-2:], required_new)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = root / "third_party/cometbft/mempool"
            source.mkdir(parents=True)
            file = source / "lossless_hex_retry_budget_test.go"
            budget = [name for name in ci.LOSSLESS_BUDGET if name.startswith("TestLosslessHexBudget")]
            def write(names):
                file.write_text("\n".join("func " + name + "(t *testing.T) {}" for name in names) + "\n")
            for omitted in required_new:
                write([name for name in budget if name != omitted])
                with self.assertRaisesRegex(RuntimeError, "mandatory readiness"):
                    ci.lossless_budget_tests(root)
            write(budget + [budget[0]])
            with self.assertRaisesRegex(RuntimeError, "duplicated"):
                ci.lossless_budget_tests(root)
            write(budget)
            actual = ci.lossless_budget_tests(root)
            self.assertEqual(set(actual), set(ci.LOSSLESS_BUDGET))
            original_log = root / "budget.jsonl"
            events = [dict(Action=action, Test=name) for name in actual for action in ("run", "pass")]
            original_log.write_text("\n".join(json.dumps(row) for row in events) + "\n")
            ci.validate_go_jsonl(original_log, actual)
            for failed in required_new:
                rejected = [dict(row, Action="skip") if row["Test"] == failed and row["Action"] == "pass" else row for row in events]
                original_log.write_text("\n".join(json.dumps(row) for row in rejected) + "\n")
                with self.assertRaises(RuntimeError):
                    ci.validate_go_jsonl(original_log, actual)

    def test_lossless_requires_independent_successor_and_preserves_off_api(self):
        signature = inspect.signature(ci.prepare_wire_lossless_source)
        for name in ("supplier_commit", "supplier_tree"):
            self.assertEqual(signature.parameters[name].kind, inspect.Parameter.KEYWORD_ONLY)
            self.assertEqual(signature.parameters[name].default, inspect.Parameter.empty)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            destination = root / "not-created"
            variants = [(None, "b" * 40), ("a" * 40, None), ("0" * 40, "b" * 40),
                        ("A" * 40, "b" * 40), ("a" * 40, "b" * 39),
                        (ci.FORK_COMMIT, "b" * 40), ("a" * 40, ci.FORK_TREE),
                        ("a" * 40, ci.PRODUCTION_TREE)]
            with patch.object(ci, "git") as git, patch.object(ci, "extract") as extract:
                for commit, tree in variants:
                    with self.subTest(commit=commit, tree=tree), self.assertRaises(RuntimeError):
                        ci.prepare_wire_lossless_source(root, destination, "source", "tree",
                                                       supplier_commit=commit, supplier_tree=tree)
                git.assert_not_called()
                extract.assert_not_called()
            self.assertFalse(destination.exists())

    def test_exact_off_and_successor_compositions_keep_original_sources_and_false_run_claims(self):
        for current, lossless in ((False, False), (False, True), (True, False), (True, True)):
            with self.subTest(current=current, lossless=lossless), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                original = root / "original-source"
                original.write_bytes(b"original source and UNKNOWN are retained")
                commit, tree = "c" * 40, "d" * 40
                production = ci.CURRENT_PRODUCTION_TREE if current else ci.PRODUCTION_TREE
                supplier = ci.CURRENT_FORK_COMMIT if current else ("a" * 40 if lossless else ci.FORK_COMMIT)
                supplier_tree = ci.CURRENT_FORK_TREE if current else ("b" * 40 if lossless else ci.FORK_TREE)
                descriptors = {name: ("original " + name).encode() for name in ci.DESCRIPTORS}
                retained = {name: ("original " + name).encode() for name in ci.CURRENT_RETAINED} if current else {}
                destination = root / "composition"
                calls = []
                def original_git(_, *args):
                    calls.append(args)
                    if args == ("rev-parse", "HEAD"): return commit.encode()
                    if args == ("rev-parse", "HEAD^{tree}"): return tree.encode()
                    if args[0] == "status": return b""
                    if args == ("rev-parse", "HEAD:third_party/cometbft"): return production.encode()
                    if args == ("rev-parse", "--verify", supplier + "^{commit}"): return supplier.encode()
                    if args == ("rev-parse", "--verify", supplier + ":third_party/cometbft"): return supplier_tree.encode()
                    if args == ("diff", "--name-only", production, supplier_tree): return "\n".join(sorted(ci.DIFF)).encode()
                    if args == ("diff", "--diff-filter=D", "--name-only", production, supplier_tree): return b""
                    for name, raw in descriptors.items():
                        if args == ("show", commit + ":" + name): return raw
                        if name.startswith("third_party/") and args == ("show", supplier + ":" + name): return raw
                    for name, raw in retained.items():
                        if args in (("show", production + ":" + name), ("show", supplier_tree + ":" + name)): return raw
                    self.fail("unexpected git operation: " + str(args))
                def original_extract(_, revision, target, paths=()):
                    if revision == commit:
                        self.assertEqual(paths, ("go.mod", "go.sum", "cmd", "internal", "contracts", "third_party"))
                        for name, raw in descriptors.items():
                            path = target / name
                            path.parent.mkdir(parents=True, exist_ok=True)
                            path.write_bytes(raw)
                        for name, raw in retained.items():
                            path = target / "third_party/cometbft" / name
                            path.parent.mkdir(parents=True, exist_ok=True)
                            path.write_bytes(raw)
                    else:
                        self.assertEqual(revision, supplier + ":third_party/cometbft")
                        self.assertEqual(paths, ())
                        (target / "selected-source").write_bytes(supplier_tree.encode())
                with patch.object(ci, "git", side_effect=original_git), patch.object(ci, "extract", side_effect=original_extract):
                    if lossless:
                        result = ci.prepare_wire_lossless_source(root, destination, commit, tree,
                            supplier_commit=supplier, supplier_tree=supplier_tree)
                    else:
                        result = ci.prepare_wire_live_source(root, destination, commit, tree)
                selection = result["sourceSelection"]
                self.assertEqual(selection["originalProductionForkTree"], production)
                if current:
                    self.assertEqual(selection["moduleDescriptorSHA256"], {name: hashlib.sha256(raw).hexdigest() for name, raw in descriptors.items()})
                    self.assertEqual(selection["retainedProductionSHA256"], {name: hashlib.sha256(raw).hexdigest() for name, raw in retained.items()})
                else:
                    self.assertNotIn("retainedProductionSHA256", selection)
                self.assertEqual(selection["selectedOptionalForkCommit"], supplier)
                self.assertEqual(selection["selectedOptionalForkTree"], supplier_tree)
                self.assertEqual(selection["exactOptionalDifference"], sorted(ci.DIFF))
                self.assertEqual(selection["buildTags"], ["ynx_live_wire_observation", "ynx_lossless_hex"] if lossless else ["ynx_live_wire_observation"])
                for claim in ("nodeStarted", "carrierEnabled", "publicActivation", "fakeVCSIdentity", "originalCheckoutWritten", "originalModuleDescriptorsChanged"):
                    self.assertIs(selection[claim], False)
                self.assertIs(selection["sourceOnly"], True)
                if lossless:
                    self.assertIs(selection["losslessOptInSupported"], True)
                    self.assertIs(selection["actualOnExecution"], False)
                else:
                    self.assertNotIn("losslessOptInSupported", selection)
                    self.assertNotIn("actualOnExecution", selection)
                self.assertFalse((Path(result["sourceDirectory"]) / ".git").exists())
                self.assertEqual(original.read_bytes(), b"original source and UNKNOWN are retained")
                receipt = Path(result["receiptPath"]).read_bytes()
                self.assertEqual(hashlib.sha256(receipt).hexdigest(), result["receiptSHA256"])
                self.assertNotIn("fetch", [word for call in calls for word in call])
                with patch.object(ci, "git") as git, self.assertRaisesRegex(RuntimeError, "no retry overwrite"):
                    ci.prepare_wire_live_source(root, destination, commit, tree)
                git.assert_not_called()
                self.assertEqual(Path(result["receiptPath"]).read_bytes(), receipt)

    def test_successor_extra_or_deleted_leaf_rejects_before_archive(self):
        for changed, deleted in ((ci.DIFF | {"types/tx.go"}, b""), (ci.DIFF, b"mempool/reactor.go\n")):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                destination = root / "fresh"
                def original_git(_, *args):
                    if args == ("rev-parse", "HEAD"): return b"source"
                    if args == ("rev-parse", "HEAD^{tree}"): return b"tree"
                    if args[0] == "status": return b""
                    if args == ("rev-parse", "HEAD:third_party/cometbft"): return ci.PRODUCTION_TREE.encode()
                    if args == ("diff", "--name-only", ci.PRODUCTION_TREE, "b" * 40): return "\n".join(sorted(changed)).encode()
                    if args == ("diff", "--diff-filter=D", "--name-only", ci.PRODUCTION_TREE, "b" * 40): return deleted
                    self.fail(str(args))
                with patch.object(ci, "git", side_effect=original_git), patch.object(ci, "require_supplier_source"), patch.object(ci, "extract") as extract:
                    with self.assertRaisesRegex(RuntimeError, "unapproved delta|cannot remove"):
                        ci.prepare_wire_lossless_source(root, destination, "source", "tree", supplier_commit="a" * 40, supplier_tree="b" * 40)
                    extract.assert_not_called()
                self.assertFalse(destination.exists())

    def test_current_requires_exact_observer_and_committed_view_source_tuple(self):
        for production, supplier, tree, message in (
                ("01a03403ecbb5d17983cbe964dbbb73fcddf8a13", ci.CURRENT_FORK_COMMIT, ci.CURRENT_FORK_TREE, "production fork changed"),
                (ci.CURRENT_PRODUCTION_TREE, "ed628e5cdd00c4496de5b2587bf2e9585aaf3d2d", "f1a8837079178469bc57ede955c55973f8b7d8ba", "exact matching supplier"),
                (ci.CURRENT_PRODUCTION_TREE, "a" * 40, ci.CURRENT_FORK_TREE, "exact matching supplier"),
                (ci.CURRENT_PRODUCTION_TREE, ci.CURRENT_FORK_COMMIT, "b" * 40, "exact matching supplier")):
            with self.subTest(production=production, supplier=supplier), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                destination = root / "fresh"
                def original_git(_, *args):
                    if args == ("rev-parse", "HEAD"): return b"source"
                    if args == ("rev-parse", "HEAD^{tree}"): return b"tree"
                    if args[0] == "status": return b""
                    if args == ("rev-parse", "HEAD:third_party/cometbft"): return production.encode()
                    self.fail("no supplier acquisition/archive after mismatched production tuple: " + str(args))
                with patch.object(ci, "git", side_effect=original_git), patch.object(ci, "extract") as extract:
                    with self.assertRaisesRegex(RuntimeError, message):
                        ci.prepare_wire_lossless_source(root, destination, "source", "tree", supplier_commit=supplier, supplier_tree=tree)
                    extract.assert_not_called()
                self.assertFalse(destination.exists())

    def current_source_control(self, root, *, supplier_drift=None, extracted_drift=None):
        descriptors = {name: ("original descriptor " + name).encode() for name in ci.DESCRIPTORS}
        retained = {name: ("original production " + name).encode() for name in ci.CURRENT_RETAINED}
        def original_git(_, *args):
            if args == ("rev-parse", "HEAD"): return b"source"
            if args == ("rev-parse", "HEAD^{tree}"): return b"tree"
            if args[0] == "status": return b""
            if args == ("rev-parse", "HEAD:third_party/cometbft"): return ci.CURRENT_PRODUCTION_TREE.encode()
            if args == ("rev-parse", "--verify", ci.CURRENT_FORK_COMMIT + "^{commit}"): return ci.CURRENT_FORK_COMMIT.encode()
            if args == ("rev-parse", "--verify", ci.CURRENT_FORK_COMMIT + ":third_party/cometbft"): return ci.CURRENT_FORK_TREE.encode()
            if args == ("diff", "--name-only", ci.CURRENT_PRODUCTION_TREE, ci.CURRENT_FORK_TREE): return "\n".join(sorted(ci.DIFF)).encode()
            if args == ("diff", "--diff-filter=D", "--name-only", ci.CURRENT_PRODUCTION_TREE, ci.CURRENT_FORK_TREE): return b""
            for name, raw in descriptors.items():
                if args == ("show", "source:" + name): return raw
                if name.startswith("third_party/") and args == ("show", ci.CURRENT_FORK_COMMIT + ":" + name):
                    return raw + b"changed" if supplier_drift == name else raw
            for name, raw in retained.items():
                if args == ("show", ci.CURRENT_PRODUCTION_TREE + ":" + name): return raw
                if args == ("show", ci.CURRENT_FORK_TREE + ":" + name):
                    return raw + b"changed" if supplier_drift == name else raw
            self.fail(str(args))
        def original_extract(_, revision, target, paths=()):
            if revision == "source":
                for name, raw in {**descriptors, **{"third_party/cometbft/" + n: b for n, b in retained.items()}}.items():
                    path = target / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(raw)
            else:
                self.assertEqual(revision, ci.CURRENT_FORK_COMMIT + ":third_party/cometbft")
                if extracted_drift:
                    (root / "fresh/source" / extracted_drift).write_bytes(b"changed during source extraction")
        return original_git, original_extract

    def test_current_supplier_cannot_change_any_descriptor_or_retained_production_leaf(self):
        for name in (*ci.DESCRIPTORS[2:], *ci.CURRENT_RETAINED):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                git, _ = self.current_source_control(root, supplier_drift=name)
                with patch.object(ci, "git", side_effect=git), patch.object(ci, "extract") as extract:
                    with self.assertRaisesRegex(RuntimeError, "module descriptors differ|changed an original observer/committed-view"):
                        ci.prepare_wire_live_source(root, root / "fresh", "source", "tree")
                    extract.assert_not_called()
                self.assertFalse((root / "fresh").exists())

    def test_extraction_drift_retains_partial_and_cannot_issue_source_receipt(self):
        for name in (*ci.DESCRIPTORS, *("third_party/cometbft/" + n for n in ci.CURRENT_RETAINED)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                git, extract = self.current_source_control(root, extracted_drift=name)
                with patch.object(ci, "git", side_effect=git), patch.object(ci, "extract", side_effect=extract):
                    with self.assertRaisesRegex(RuntimeError, "descriptors changed|bytes changed during extraction"):
                        ci.prepare_wire_live_source(root, root / "fresh", "source", "tree")
                self.assertTrue((root / "fresh/source").is_dir())
                self.assertEqual((root / "fresh/source" / name).read_bytes(), b"changed during source extraction")
                self.assertFalse((root / "fresh/SOURCE-SELECTION.json").exists())
                with self.assertRaisesRegex(RuntimeError, "no retry overwrite"):
                    ci.prepare_wire_live_source(root, root / "fresh", "source", "tree")

    def test_fullheight_equality_keeps_every_byte_and_never_claims_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            before, after = root / "off.full.json", root / "on.full.json"
            # Controls only: the real Application Time/PQ history counterexample
            # is exercised by TestOperatorLosslessPairOriginalPQTimeIsConsensusState.
            raw = b'{"height":"5","time":"original","history":[1],"errors":[],"balance":"70"}\n'
            before.write_bytes(raw)
            after.write_bytes(raw)
            pin = hashlib.sha256(raw).hexdigest()
            result = ci.require_lossless_pair_fullheight_equal(before, pin, after, pin)
            self.assertEqual(result, dict(completeOriginalBytesEqual=True, bytes=len(raw), sha256=pin,
                normalizationApplied=False, networkExecutionQualified=False, independentFinalityVerified=False, authorityGranted=False))
            for changed in (raw.replace(b'original', b'different'), raw.replace(b'[1]', b'[]'),
                            raw.replace(b'"errors":[]', b'"errors":["UNKNOWN"]'), raw + b' ', raw[:-1]):
                after.write_bytes(changed)
                with self.assertRaisesRegex(RuntimeError, "LOSSLESS_PAIR_EQUALITY_FAIL_CLOSED"):
                    ci.require_lossless_pair_fullheight_equal(before, pin, after, hashlib.sha256(changed).hexdigest())
                self.assertEqual(before.read_bytes(), raw)
                self.assertEqual(after.read_bytes(), changed)

    def test_fullheight_pin_alias_empty_symlink_and_oversize_reject(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            before, after = root / "off", root / "on"
            raw = b"original UNKNOWN full readback"
            pin = hashlib.sha256(raw).hexdigest()
            before.write_bytes(raw)
            after.write_bytes(raw)
            with self.assertRaisesRegex(RuntimeError, "pin differs"):
                ci.require_lossless_pair_fullheight_equal(before, "a" * 64, after, pin)
            with self.assertRaisesRegex(RuntimeError, "distinct"):
                ci.require_lossless_pair_fullheight_equal(before, pin, before, pin)
            link = root / "symlink"
            link.symlink_to(after)
            with self.assertRaisesRegex(RuntimeError, "canonical"):
                ci.require_lossless_pair_fullheight_equal(before, pin, link, pin)
            for size in (0, (256 << 20) + 1):
                with after.open("wb") as handle: handle.truncate(size)
                with self.assertRaisesRegex(RuntimeError, "bounded complete"):
                    ci.require_lossless_pair_fullheight_equal(before, pin, after, pin)
            self.assertEqual(before.read_bytes(), raw)
            self.assertEqual(after.stat().st_size, (256 << 20) + 1)

    def test_fullheight_change_during_read_is_not_laundered_by_matching_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            before, after = root / "off", root / "on"
            raw = b"original retained full-height result"
            pin = hashlib.sha256(raw).hexdigest()
            before.write_bytes(raw)
            after.write_bytes(raw)
            real_fstat = os.fstat
            calls = 0
            def changed_at_final_identity(fd):
                nonlocal calls
                calls += 1
                if calls == 3:
                    before.write_bytes(raw + b"UNKNOWN")
                return real_fstat(fd)
            with patch.object(ci.os, "fstat", side_effect=changed_at_final_identity):
                with self.assertRaisesRegex(RuntimeError, "changed during"):
                    ci.require_lossless_pair_fullheight_equal(before, pin, after, pin)
            self.assertEqual(before.read_bytes(), raw + b"UNKNOWN")
            self.assertEqual(after.read_bytes(), raw)

    def run_control(self, stdout, stderr=b"", code=0, timeout=False):
        temporary = tempfile.TemporaryDirectory(prefix="wire-live-pure-")
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name).resolve()
        def simulated_run(argv, **kwargs):
            self.assertEqual(argv, ["go", "test", "-json", "-p", "1"])
            self.assertEqual(kwargs["timeout"], 240)
            self.assertIsNot(kwargs["stdout"], kwargs["stderr"])
            self.assertNotEqual(kwargs["stderr"], subprocess.STDOUT)
            kwargs["stdout"].write(stdout)
            kwargs["stderr"].write(stderr)
            if timeout:
                raise subprocess.TimeoutExpired(argv, 240)
            return subprocess.CompletedProcess(argv, code)
        error, result = None, None
        with patch.object(ci.subprocess, "run", side_effect=simulated_run) as run:
            try:
                result = ci.run_go(output, output, "case", ["-json", "-p", "1"], ["TestOriginal"], {})
            except Exception as caught:
                error = caught
            self.assertEqual(run.call_count, 1)
        self.assertEqual((output / "case.jsonl").read_bytes(), stdout)
        self.assertEqual((output / "case.stderr.log").read_bytes(), stderr)
        record = json.loads((output / "case.result.json").read_bytes())
        for field, raw in (("stdout", stdout), ("stderr", stderr)):
            self.assertEqual(record[field]["bytes"], len(raw))
            self.assertEqual(record[field]["sha256"], hashlib.sha256(raw).hexdigest())
        return result, record, error

    @staticmethod
    def events(action="pass"):
        return (json.dumps(dict(Action="run", Test="TestOriginal")) + "\n" +
                json.dumps(dict(Action=action, Test="TestOriginal")) + "\n").encode()

    def test_cold_cache_stderr_is_preserved_separately(self):
        diagnostics = b"go: downloading example.org/original v1.0.0\nraw-byte:\xff\n"
        result, record, error = self.run_control(self.events(), diagnostics)
        self.assertIsNone(error)
        self.assertTrue(record["validationPassed"])
        self.assertEqual(record["returnCode"], 0)
        self.assertEqual(record["requiredPassed"], ["TestOriginal"])
        self.assertEqual(result["stderr"], record["stderr"])
        self.assertEqual(result["sha256"], record["stdout"]["sha256"])

    def test_non_json_stdout_is_never_filtered_into_pass(self):
        for contaminant in (b"go: downloading example.org/source v1.0.0\n", b"\n", b"[]\n", b"null\n", b"\xff\n"):
            with self.subTest(contaminant=contaminant):
                result, record, error = self.run_control(contaminant + self.events(), b"original diagnostic\n")
                self.assertIsNone(result)
                self.assertIsNotNone(error)
                self.assertFalse(record["validationPassed"])
                self.assertEqual(record["requiredPassed"], [])
                self.assertIsNotNone(record["firstFailure"])

    def test_missing_skipped_failed_duplicate_or_empty_named_results_reject(self):
        variants = [b"", self.events("skip"), self.events("fail"), self.events() + self.events(),
                    b'{"Action":"fail","Action":"pass","Test":"TestOriginal"}\n',
                    b'{"Action":"pass","Test":"TestOther"}\n']
        for stdout in variants:
            with self.subTest(stdout=stdout):
                _, record, error = self.run_control(stdout)
                self.assertIsNotNone(error)
                self.assertFalse(record["validationPassed"])

    def test_nonzero_exit_cannot_be_hidden_by_pass_events(self):
        _, record, error = self.run_control(self.events(), b"actual compiler/test failure\n", code=1)
        self.assertIsNotNone(error)
        self.assertEqual(record["returnCode"], 1)
        self.assertFalse(record["validationPassed"])
        self.assertFalse(record["timedOut"])

    def test_timeout_retains_both_streams_without_inventing_exit(self):
        _, record, error = self.run_control(self.events("run"), b"partial original stderr\n", timeout=True)
        self.assertIsInstance(error, subprocess.TimeoutExpired)
        self.assertIsNone(record["returnCode"])
        self.assertTrue(record["timedOut"])
        self.assertFalse(record["validationPassed"])

    def test_existing_result_is_never_overwritten_or_reexecuted(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            original = output / "case.result.json"
            original.write_bytes(b"original UNKNOWN")
            with patch.object(ci.subprocess, "run") as run:
                with self.assertRaises(FileExistsError):
                    ci.run_go(output, output, "case", [], ["TestOriginal"], {})
                run.assert_not_called()
            self.assertEqual(original.read_bytes(), b"original UNKNOWN")

    def test_supplier_missing_or_wrong_is_explicit_and_never_fetches(self):
        for mode in ("missing-commit", "missing-tree", "wrong-tree", "correct"):
            calls = []
            def original_git(root, *args):
                calls.append(args)
                self.assertNotIn("fetch", args)
                self.assertEqual(args[:2], ("rev-parse", "--verify"))
                if args[-1] == ci.FORK_COMMIT + "^{commit}":
                    if mode == "missing-commit":
                        raise subprocess.CalledProcessError(128, ["git", *args])
                    return (ci.FORK_COMMIT + "\n").encode()
                self.assertEqual(args[-1], ci.FORK_COMMIT + ":third_party/cometbft")
                if mode == "missing-tree":
                    raise subprocess.CalledProcessError(128, ["git", *args])
                return (("a" * 40 if mode == "wrong-tree" else ci.FORK_TREE) + "\n").encode()
            with self.subTest(mode=mode), patch.object(ci, "git", side_effect=original_git):
                if mode == "correct":
                    ci.require_supplier_source(Path("/original"))
                else:
                    with self.assertRaisesRegex(RuntimeError, "unavailable locally|fork tree changed"):
                        ci.require_supplier_source(Path("/original"))
            self.assertLessEqual(len(calls), 2)

    def test_missing_supplier_does_not_create_composition_or_change_shared_api(self):
        self.assertEqual(list(inspect.signature(ci.prepare_wire_live_source).parameters),
                         ["root", "fresh_output", "expected_commit", "expected_tree"])
        self.assertEqual(len(ci.LIVE), 7)
        self.assertEqual(len(ci.BUDGET), 22)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            destination = root / "fresh"
            def original_git(_, *args):
                if args == ("rev-parse", "HEAD"):
                    return b"original\n"
                if args == ("rev-parse", "HEAD^{tree}"):
                    return b"original-tree\n"
                if args[0] == "status":
                    return b""
                if args == ("rev-parse", "HEAD:third_party/cometbft"):
                    return ci.PRODUCTION_TREE.encode()
                raise subprocess.CalledProcessError(128, ["git", *args])
            with patch.object(ci, "git", side_effect=original_git), patch.object(ci, "extract") as extract:
                with self.assertRaisesRegex(RuntimeError, "unavailable locally"):
                    ci.prepare_wire_live_source(root, destination, "original", "original-tree")
                extract.assert_not_called()
            self.assertFalse(destination.exists())

    def test_workflow_fetches_only_fixed_supplier_with_ephemeral_read_credential(self):
        workflow = (HERE.parents[1] / ".github/workflows/chain-core.yml").read_text()
        step = workflow.split("      - name: Acquire only the immutable optional supplier object\n", 1)[1]
        step = step.split("      - name: Verify exact optional live getter composition", 1)[0]
        script = step.split("          python3 -B - <<'PY'\n", 1)[1].rsplit("          PY\n", 1)[0]
        script = "\n".join(line[10:] for line in script.splitlines())
        secret = "synthetic-read-only-test-credential"
        header = base64.b64encode(("x-access-token:" + secret).encode()).decode()
        def simulated_fetch(argv, **kwargs):
            self.assertEqual(argv, ["git", "fetch", "--quiet", "--no-tags", "--no-recurse-submodules", "--depth=1", "--no-write-fetch-head", "origin", ci.CURRENT_FORK_COMMIT])
            self.assertNotIn(secret, " ".join(argv))
            self.assertNotIn("WIRE_SUPPLIER_READ_TOKEN", kwargs["env"])
            self.assertEqual(kwargs["env"]["GIT_CONFIG_VALUE_0"], "AUTHORIZATION: basic " + header)
            self.assertEqual(kwargs["env"]["GIT_CONFIG_KEY_0"], "http.https://github.com/.extraheader")
            self.assertEqual(kwargs["env"]["GIT_TERMINAL_PROMPT"], "0")
            self.assertEqual(kwargs["timeout"], 60)
            return subprocess.CompletedProcess(argv, 0)
        def read_original(argv, **kwargs):
            if argv[-1] == ci.CURRENT_FORK_COMMIT + "^{commit}": return ci.CURRENT_FORK_COMMIT + "\n"
            if argv[-1] == ci.CURRENT_FORK_COMMIT + ":third_party/cometbft": return ci.CURRENT_FORK_TREE + "\n"
            if argv == ["git", "rev-parse", "HEAD"]: return "original\n"
            self.assertEqual(argv, ["git", "status", "--porcelain"])
            return b""
        output = io.StringIO()
        with patch.dict(os.environ, {"WIRE_SUPPLIER_READ_TOKEN": secret, "GITHUB_SHA": "original"}, clear=True), \
             patch.object(subprocess, "run", side_effect=simulated_fetch) as fetch, \
             patch.object(subprocess, "check_output", side_effect=read_original), contextlib.redirect_stdout(output):
            exec(compile(script, "actual-workflow-fetch", "exec"), {})
        self.assertEqual(fetch.call_count, 1)
        self.assertNotIn(secret, output.getvalue())
        self.assertNotIn(header, output.getvalue())
        self.assertIn(ci.CURRENT_FORK_COMMIT, output.getvalue())
        on_step = workflow.split("      - name: Acquire only the fixed corrected lossless supplier\n", 1)[1].split("      - name: Preserve only public corrected lossless source evidence", 1)[0]
        self.assertIn("commit = '" + ci.CURRENT_FORK_COMMIT + "'", on_step)
        self.assertIn("tree = '" + ci.CURRENT_FORK_TREE + "'", on_step)
        self.assertIn("--lossless-supplier-commit " + ci.CURRENT_FORK_COMMIT, on_step)
        self.assertIn("--lossless-supplier-tree " + ci.CURRENT_FORK_TREE, on_step)
        self.assertNotIn("ed628e5cdd00c4496de5b2587bf2e9585aaf3d2d", on_step)
        on_job = workflow.split("  lossless-matching-source:\n", 1)[1].split("  commit-observation:\n", 1)[0]
        for suffix in (".jsonl", ".stderr.log", ".result.json"):
            self.assertIn("retained-observer" + suffix, on_job)
        client_job = workflow.split("  client-observations:\n", 1)[1].split("  commit-observation:\n", 1)[0]
        self.assertIn("persist-credentials: false", client_job)
        self.assertIn("fetch-depth: 1", client_job)
        self.assertIn("timeout-minutes: 8", client_job)
        self.assertIn("contents: read", workflow)
        for name in ("normal-live-caller", "original-peer-budget"):
            for suffix in (".jsonl", ".stderr.log", ".result.json"):
                self.assertIn(name + suffix, client_job)


if __name__ == "__main__":
    unittest.main(verbosity=2)
