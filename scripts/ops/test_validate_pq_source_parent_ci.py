"""Pure controls for Source-parent qualification in the original tagged call.

Execute the actual workflow collector on public synthetic JSONL controls only.
These controls do not run Go or qualify a protected host, Root, Source or grant.
"""
import ast
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
CONTROL = "scripts/ops/test_validate_pq_source_parent_ci.py"
HOOK = "          python3 -B -m unittest discover -s scripts/ops -p 'test_validate_pq_source_parent_ci.py' -v\n"
MARKER = "YNX_PQ_SOURCE_PARENT_TESTS"
REQUIRED = [
    "TestSourceParentFrameBounds",
    "TestSourceParentOriginalClockRace",
    "TestPQSourceParentPUBLICQualifiedCleanupAndLoss",
    "TestPQSourceParentPUBLICOriginalUnnamedSocket",
    "TestPQAccountSourceCancelPreservesOriginalCleanupPUBLIC",
    "TestPQProtectedSourceParentStableHostScopesPUBLIC",
    "TestPQCommittedAccountWirePUBLICCloseDebt",
    "TestPQSourceParentPUBLICDirectCleanupRetainsFirstCause",
]
spec = importlib.util.spec_from_file_location("source_parent_current4_control", ROOT / "scripts/ops/test_validate_pq_current4_ci.py")
current4 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(current4)
MARKERS = {current4.MARKER: current4.REQUIRED,
           "YNX_PQ_OBSERVER_ACCOUNT_TESTS": current4.OBSERVER_ACCOUNT_REQUIRED,
           MARKER: REQUIRED, "YNX_PQ_NORMAL_SOURCE_PARENT_TESTS": current4.NORMAL_SOURCE_PARENT_REQUIRED}
SOURCE_PATHS = ("internal/consensus/pq_source_parent_*.go", "internal/consensus/pq_source_identity*.go")


def execute(raw, events=None, text=None):
    with tempfile.TemporaryDirectory(prefix="source-parent-ci-") as directory:
        (Path(directory) / current4.OUTPUT).write_text(
            text if text is not None else "".join(json.dumps(event) + "\n" for event in events))
        output = io.StringIO()
        with patch.dict(os.environ, RUNNER_TEMP=directory, GITHUB_SHA="1" * 40), contextlib.redirect_stdout(output):
            exec(compile(current4.collector(raw), "actual-source-parent-ci-collector", "exec"), {})
    records = {}
    for line in output.getvalue().splitlines():
        marker, data = line.split(" ", 1)
        if marker in records:
            raise AssertionError("duplicate DATA marker")
        records[marker] = json.loads(data)
    if set(records) != set(MARKERS):
        raise AssertionError("four distinct original DATA markers required")
    for marker, names in MARKERS.items():
        record = records[marker]
        if set(record) != {"sourceCommit", "requiredPassed", "suitePassed", *current4.FALSE_FLAGS}:
            raise AssertionError("unexpected receipt fields")
        if record["sourceCommit"] != "1" * 40 or record["requiredPassed"] != names or record["suitePassed"] is not True:
            raise AssertionError("fixed tests and source identity required")
        if any(record[flag] is not False for flag in current4.FALSE_FLAGS):
            raise AssertionError("PUBLIC DATA qualification cannot grant authority")
    return records


def assert_contract(raw):
    current4.assert_contract(raw)  # Original 3 + 5 and complete state union stay.
    if current4.SOURCE_PARENT_REQUIRED != REQUIRED or current4.STREAM_REQUIRED != current4.REQUIRED + current4.OBSERVER_ACCOUNT_REQUIRED + REQUIRED + current4.NORMAL_SOURCE_PARENT_REQUIRED:
        raise AssertionError("only the fixed eight and four normal Source-parent cases must stay")
    program = current4.collector(raw)
    assignments = [ast.literal_eval(node.value) for node in ast.parse(program).body
                   if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "source_parent_required" for target in node.targets)]
    if assignments != [REQUIRED] or program.count(MARKER) != 1:
        raise AssertionError("one exact Source-parent list and independent receipt required")
    guards = (
        "stream_required = current4_required + observer_account_required + source_parent_required + normal_source_parent_required",
        "for name in stream_required:",
        "build_notices = [event for event in events if event.get('Action') == 'build-output']",
        "if build_notices != events[:len(build_notices)] or any(set(event) != {'Action', 'ImportPath', 'Output'} or event['ImportPath'] != package + '.test' or not isinstance(event['Output'], str) or not event['Output'] for event in build_notices):",
        "events = events[len(build_notices):]",
        "event.get('Package') != package",
        "('start', 'run', 'pause', 'cont', 'output', 'pass')",
        "event['Test'].split('/')[0] not in stream_required",
        "if len(runs) != 1 or outcomes != ['pass']:",
        "source_parent_names = {event['Test'] for event in events if 'Test' in event and event['Test'].split('/')[0] in source_parent_required + normal_source_parent_required}",
        "for name in source_parent_names:",
        "if any(not part for part in parts) or any('/'.join(parts[:i]) not in source_parent_names for i in range(1, len(parts))):",
        "if len(runs) != 1 or len(passed) != 1 or runs[0] >= passed[0]:",
        "if outcomes != ['pass']:",
    )
    if any(guard not in program for guard in guards):
        raise AssertionError("strict original run/top/child/package guards required")
    for event in ("push", "pull_request"):
        blocks = re.findall(r"(?ms)^  " + event + r":\n(.*?)(?=^  [a-z_]+:\n|\Z)", raw)
        if len(blocks) != 1:
            raise AssertionError("one normal trigger required")
        paths = (CONTROL, current4.TRACE + "/**") + (("internal/consensus/**",) if event == "push" else SOURCE_PATHS)
        if any(blocks[0].count("      - '" + path + "'\n") != 1 for path in paths):
            raise AssertionError("source, fixture and control must trigger normal CI")
    controls = current4.step(raw, "Verify Linux window controls without starting a node")
    if raw.count(HOOK) != 1 or controls.count(HOOK) != 1:
        raise AssertionError("independent pure controls must execute exactly once")
    execute(raw, current4.rows())


class SourceParentCIControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = current4.WORKFLOW.read_text(encoding="utf-8")

    def test_normal_single_call_keeps_original_tests_budget_and_full_union(self):
        assert_contract(self.raw)
        self.assertEqual(len(current4.STREAM_REQUIRED), 20)
        for name in REQUIRED:
            self.assertIsNotNone(re.fullmatch(current4.SELECTOR, name))
            self.assertIsNone(re.fullmatch(current4.SELECTOR, name + "Extra"))

    def test_actual_collector_keeps_three_distinct_non_authorizing_receipts(self):
        events = current4.rows()
        for name in REQUIRED:
            for suffix in ("/original", "/original/physical-debt"):
                events[-1:-1] = [dict(Action=action, Package=current4.PACKAGE, Test=name + suffix) for action in ("run", "pass")]
        records = execute(self.raw, events)
        self.assertEqual(records[MARKER]["requiredPassed"], REQUIRED)

    def test_each_source_parent_top_must_run_and_pass_once_in_original_package(self):
        good = current4.rows()
        for name in REQUIRED:
            variants = [[event for event in good if event.get("Test") != name]]
            for action in ("run", "pass"):
                variants += [[event for event in good if not (event.get("Test") == name and event["Action"] == action)],
                             good + [dict(Action=action, Package=current4.PACKAGE, Test=name)]]
            variants += [[dict(event, Package="foreign/package") if event.get("Test") == name else event for event in good]]
            for events in variants:
                with self.subTest(name=name), self.assertRaises(RuntimeError):
                    execute(self.raw, events)

    def test_same_package_build_diagnostic_is_only_a_closed_prefix_not_an_outcome(self):
        notice = dict(Action="build-output", ImportPath=current4.PACKAGE + ".test", Output="original compiler diagnostic\n")
        execute(self.raw, [notice] + current4.rows())
        variants = [[notice], current4.rows() + [notice]]
        for changed in (dict(notice, ImportPath="foreign.test"), dict(notice, Package=current4.PACKAGE),
                        dict(notice, Test=REQUIRED[0]), dict(notice, Output=None), dict(notice, Output=""),
                        dict(notice, Action="build-fail"), {k: v for k, v in notice.items() if k != "Output"}):
            variants.append([changed] + current4.rows())
        for events in variants:
            with self.assertRaises(RuntimeError):
                execute(self.raw, events)

    def test_each_observed_child_requires_unique_ordered_run_and_pass(self):
        for top in REQUIRED:
            name = top + "/direct-cleanup"
            child = [dict(Action=action, Package=current4.PACKAGE, Test=name) for action in ("run", "pass")]
            variants = [child[:1], child[1:], child + child[:1], child + child[1:], child[::-1]]
            variants += [[dict(row, Test=top + suffix) for row in child] for suffix in ("/", "/missing-parent/child", "//child")]
            for rows in variants:
                with self.subTest(top=top), self.assertRaises(RuntimeError):
                    execute(self.raw, current4.rows()[:-1] + rows + current4.rows()[-1:])

    def test_source_parent_child_fail_skip_and_unknown_action_are_terminal(self):
        for top in REQUIRED:
            for suffix in ("", "/nested/child"):
                for action in ("skip", "fail", "build-fail", "unknown"):
                    with self.subTest(top=top, action=action, suffix=suffix), self.assertRaises(RuntimeError):
                        execute(self.raw, current4.rows() + [dict(Action=action, Package=current4.PACKAGE, Test=top + suffix)])

    def test_partial_merged_foreign_or_missing_package_streams_never_qualify(self):
        good = current4.rows()
        groups = [current4.REQUIRED, current4.OBSERVER_ACCOUNT_REQUIRED, REQUIRED[:-1], REQUIRED[-1:]]
        partials = [[event for event in good if "Test" not in event or event["Test"] in group] for group in groups]
        variants = partials + [sum(partials, []), good[:-1], good + good[-1:],
                              good + [dict(Action="pass", Package="foreign/package")],
                              good + [dict(Action="pass", Package=current4.PACKAGE, Test="TestUnselected")]]
        for rows in variants:
            with self.assertRaises(RuntimeError):
                execute(self.raw, rows)
        for text in ("", "null\n", "[]\n", "{}\n", "{", "not-json", "1\n"):
            with self.subTest(text=text), self.assertRaises((RuntimeError, ValueError, TypeError)):
                execute(self.raw, text=text)

    def test_fixed_selector_declarations_budget_and_no_second_go_call(self):
        command = current4.COMMAND
        changes = []
        for name in REQUIRED:
            changes += [self.raw.replace(command, command.replace("|" + name, ""), 1),
                        self.raw.replace("source_parent_required = " + repr(REQUIRED), "source_parent_required = " + repr([item for item in REQUIRED if item != name]), 1)]
        for before, after in (("-timeout=120s", "-timeout=180s"), ("-p 1", "-p 2"),
                              ("-tags=ynx_public_trace_testsupport ", ""),
                              (current4.SELECTOR, "^TestPQSourceParent"),
                              (current4.TRACE, "untrusted-input")):
            changes.append(self.raw.replace(command, command.replace(before, after), 1))
        changes += [self.raw.replace(command, "", 1), self.raw.replace(command, command * 2, 1)]
        for changed in changes:
            self.assertNotEqual(changed, self.raw)
            with self.assertRaises(AssertionError):
                assert_contract(changed)

    def test_source_and_control_triggers_and_automatic_hook_are_required(self):
        changes = [self.raw.replace(HOOK, "", 1), self.raw.replace(HOOK, HOOK * 2, 1)]
        for path in (CONTROL, *SOURCE_PATHS):
            changes.append(self.raw.replace("      - '" + path + "'\n", "", 1))
        for changed in changes:
            with self.assertRaises(AssertionError):
                assert_contract(changed)

    def test_actual_guard_mutations_cannot_drop_child_or_package_failures(self):
        pairs = [("for name in stream_required:", "for name in current4_required:"),
                 ("for name in source_parent_names:", "for name in []:"),
                 ("if len(runs) != 1 or len(passed) != 1 or runs[0] >= passed[0]:", "if False:"),
                 ("if outcomes != ['pass']:", "if False:"),
                 ("event.get('Package') != package", "False"),
                 ("('start', 'run', 'pause', 'cont', 'output', 'pass')", "('start', 'run', 'pause', 'cont', 'output', 'pass', 'skip')")]
        body = current4.step(self.raw, current4.STEP)
        for before, after in pairs:
            changed = self.raw.replace(body, body.replace(before, after, 1), 1)
            self.assertNotEqual(changed, self.raw)
            with self.assertRaises(AssertionError):
                assert_contract(changed)

    def test_new_marker_cannot_claim_source_root_or_native_authority(self):
        program = current4.collector(self.raw)
        line = next(line for line in program.splitlines() if "print('" + MARKER in line)
        for flag in current4.FALSE_FLAGS:
            changed = self.raw.replace(line, line.replace(flag + "=False", flag + "=True"), 1)
            self.assertNotEqual(changed, self.raw)
            with self.assertRaises(AssertionError):
                assert_contract(changed)


if __name__ == "__main__":
    unittest.main()
