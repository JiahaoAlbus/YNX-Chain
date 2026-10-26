"""Tiny synthetic metadata tests; never starts a process, node, or network.

Derived from integration af1cbaf94313e628e212aabad60d05d85c2aa3fc.
Temporary fixtures remain beside this script (including external staging).
"""

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pq_network_sizes", HERE / "pq-network-file-sizes.py")
sizes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sizes)


class FileSizeControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix=".sizes-unit-", dir=HERE)
        self.addCleanup(self.tmp.cleanup)
        self.parent = Path(self.tmp.name).resolve()
        self.case = self.parent / "ynx-pq-network-123-1"
        self.case.mkdir(mode=0o700)

    def write(self, relative, payload=b"synthetic-only"):
        path = self.case / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return path

    def scan(self):
        return sizes.scan_case(str(self.parent), str(self.case), "123", "1")

    def test_exact_categories_totals_and_private_output(self):
        root = "tmp/TestPQNetworkSynthetic/001/validator-0/data/"
        rows = {
            "prepared.json": ("case_metadata", 3),
            "go.stdout.log": ("case_metadata", 5),
            root + "cs.wal/wal": ("consensus_wal", 7),
            root + "cs.wal/wal.000": ("consensus_wal", 11),
            root + "blockstore.db/000001.log": ("blockstore_db", 13),
            root + "state.db/000001.ldb": ("state_db", 17),
            root + "tx_index.db/CURRENT": ("tx_index_db", 19),
            root + "evidence.db/MANIFEST-000001": ("evidence_db", 23),
            root + "application.json": ("application_snapshot", 29),
            root + ".ynx-abci-state-temp": ("application_snapshot", 31),
            root + "application.json.journal": ("application_journal", 37),
            root + "pq-sign-state.json": ("sign_state", 41),
            root + "priv_validator_state.json": ("sign_state", 43),
            root + "credential-name-MUST-NOT-APPEAR": ("other", 47),
        }
        for path, (_, length) in rows.items():
            self.write(path, b"x" * length)
        # A sibling, build output, or unrelated runner path is never scanned.
        (self.parent / "unrelated-private-file").write_bytes(b"not included")
        result = self.scan()
        expected = sum(length for _, length in rows.values())
        self.assertEqual((result["count"], result["logicalBytes"]), (len(rows), expected))
        categories = {item["category"]: item for item in result["categories"]}
        for category in sizes.CATEGORIES:
            chosen = [length for kind, length in rows.values() if kind == category]
            self.assertEqual(categories[category], dict(category=category, count=len(chosen), logicalBytes=sum(chosen)))
        self.assertEqual(result["largest"][0], dict(category="other", logicalBytes=47,
            pathSHA256=hashlib.sha256(b"YNX-PQ-NETWORK-PATH/v1\0" +
                (root + "credential-name-MUST-NOT-APPEAR").encode()).hexdigest(),
            arm="unknown", nodeIndex=None, kind="other"))
        encoded = sizes.encode_report(result)
        self.assertLess(len(encoded), sizes.MAX_JSON_BYTES)
        for secret in (str(self.parent), "credential-name-MUST-NOT-APPEAR", "000001.log", "synthetic-only"):
            self.assertNotIn(secret.encode(), encoded)
        # Same logical-byte metric as the original guard, not st_blocks or
        # file content hashing. This reference only inspects this tiny tree.
        reference = sum(p.lstat().st_size for p in self.case.rglob("*") if stat.S_ISREG(p.lstat().st_mode))
        self.assertEqual(result["logicalBytes"], reference)

    def test_fresh_details_use_the_same_metadata_and_preserve_exact_totals(self):
        before = "tmp/ynx-pq-fresh-paired-123456/before/"
        after = "tmp/ynx-pq-fresh-paired-123456/after/"
        rows = {}
        for i, kind in enumerate(("state", "migration", "genesis", "schedule", "trusted")):
            rows[before + "host-input-" + kind + "-" + "ab" * 32 + ".json"] = (
                "host-input-" + kind, "before", None, i + 1)
        rows.update({
            before + "member-00.host-context.json": ("host-context", "before", None, 11),
            before + "member-15.wire": ("client-wire", "before", None, 13),
            after + "birth-16.wire": ("client-wire", "after", None, 17),
            before + "member-00-submit.json": ("client-submission", "before", None, 19),
            after + "member-15-readback.json": ("client-readback", "after", None, 23),
            before + "member-00-submit.stdout": ("client-stdout-stderr", "before", None, 29),
            after + "member-15-readback.stderr": ("client-stdout-stderr", "after", None, 31),
            before + "validator-0/data/cs.wal/wal": ("consensus_wal", "before", 0, 37),
            after + "validator-3/data/cs.wal/wal.000": ("consensus_wal", "after", 3, 41),
            after + "unknown-private-name": ("other", "after", None, 43),
        })
        for relative, (_, _, _, size) in rows.items():
            self.write(relative, b"x" * size)
        with mock.patch.object(sizes, "_scan", wraps=sizes._scan) as scans:
            result = self.scan()
        self.assertEqual(scans.call_count, 2)
        self.assertEqual(result["schema"], sizes.SCHEMA)
        self.assertEqual(result["metric"], "sum-regular-file-st_size")
        self.assertFalse(result["contentsRead"])
        self.assertFalse(result["historicalPeakMeasured"])
        self.assertEqual(result["consistency"], "two-identical-metadata-scans")
        self.assertEqual(result["count"], len(rows))
        self.assertEqual(result["logicalBytes"], sum(row[3] for row in rows.values()))
        categories = {row["category"]: row for row in result["categories"]}
        self.assertEqual(tuple(categories), sizes.CATEGORIES)
        self.assertEqual(categories["consensus_wal"], dict(category="consensus_wal", count=2, logicalBytes=78))
        by_pin = {row["pathSHA256"]: row for row in result["largest"]}
        self.assertEqual(len(by_pin), len(rows))
        for relative, (kind, arm, node, size) in rows.items():
            key = hashlib.sha256(b"YNX-PQ-NETWORK-PATH/v1\0" + relative.encode()).hexdigest()
            row = by_pin[key]
            self.assertEqual((row["kind"], row["arm"], row["nodeIndex"], row["logicalBytes"]),
                             (kind, arm, node, size))
            self.assertEqual(set(row), {"category", "logicalBytes", "pathSHA256", "arm", "nodeIndex", "kind"})
        kinds = {row["kind"]: row for row in result["otherKinds"]}
        self.assertEqual(tuple(kinds), sizes.OTHER_KINDS)
        for kind, item in kinds.items():
            selected = [row[3] for row in rows.values() if row[0] == kind]
            self.assertEqual(item, dict(kind=kind, count=len(selected), logicalBytes=sum(selected)))
        self.assertEqual(sum(row["count"] for row in kinds.values()), categories["other"]["count"])
        self.assertEqual(sum(row["logicalBytes"] for row in kinds.values()), categories["other"]["logicalBytes"])
        encoded = sizes.encode_report(result)
        for hidden in (str(self.parent), "ynx-pq-fresh-paired-123456", "unknown-private-name", "member-15", "validator-3", "ab" * 32):
            self.assertNotIn(hidden.encode(), encoded)

    def test_fresh_nested_and_unknown_names_cannot_select_a_known_kind_or_node(self):
        root = "tmp/ynx-pq-fresh-paired-23/"
        host = "host-input-state-" + "cd" * 32 + ".json"
        rows = {
            root + "before/nested/" + host: ("before", None),
            root + "after/nested/validator-1/" + host: ("after", None),
            root + "before/validator-4/data/unknown": ("before", None),
            root + "after/member-16.wire": ("after", None),
            root + "after/member-00-readback.json.extra": ("after", None),
            root + "before/host-input-state-not-a-pin.json": ("before", None),
            "nested/" + root + "before/" + host: ("unknown", None),
            "tmp/ynx-pq-fresh-paired-private/before/" + host: ("unknown", None),
            root + "not-an-arm/validator-1/data/unknown": ("unknown", None),
            "before/validator-2/data/unknown": ("unknown", None),
        }
        for relative in rows:
            self.write(relative, b"x")
        report = self.scan()
        by_pin = {row["pathSHA256"]: row for row in report["largest"]}
        for relative, location in rows.items():
            key = hashlib.sha256(b"YNX-PQ-NETWORK-PATH/v1\0" + relative.encode()).hexdigest()
            row = by_pin[key]
            self.assertEqual((row["arm"], row["nodeIndex"]), location)
            self.assertEqual((row["category"], row["kind"]), ("other", "other"))
        self.assertEqual(report["count"], len(rows))
        self.assertEqual(report["logicalBytes"], len(rows))
        kinds = {row["kind"]: row for row in report["otherKinds"]}
        self.assertEqual(kinds["other"]["count"], len(rows))
        self.assertTrue(all(row["count"] == row["logicalBytes"] == 0
                            for kind, row in kinds.items() if kind != "other"))

    def test_empty_tree_has_explicit_zero_categories_and_other_kinds(self):
        report = self.scan()
        self.assertEqual((report["count"], report["logicalBytes"], report["largest"]), (0, 0, []))
        self.assertEqual(report["categories"], [dict(category=name, count=0, logicalBytes=0)
                                               for name in sizes.CATEGORIES])
        self.assertEqual(report["otherKinds"], [dict(kind=name, count=0, logicalBytes=0)
                                               for name in sizes.OTHER_KINDS])

    def test_known_fresh_basename_does_not_bypass_original_symlink_refusal(self):
        original = self.write("original-private", b"retained synthetic original")
        alias = self.case / ("tmp/ynx-pq-fresh-paired-42/before/host-input-state-"
                             + "ef" * 32 + ".json")
        alias.parent.mkdir(parents=True)
        alias.symlink_to(original)
        with self.assertRaisesRegex(sizes.ScanError, "nonregular_entry"):
            self.scan()
        self.assertTrue(alias.is_symlink())
        self.assertEqual(original.read_bytes(), b"retained synthetic original")

    def test_no_regular_file_content_is_opened_or_read(self):
        self.write("tmp/validator-1/data/application.json", b"private bytes must not be opened")
        original = os.open
        calls = []

        def directory_only(path, flags, *args, **kwargs):
            self.assertTrue(flags & os.O_DIRECTORY)
            self.assertTrue(flags & os.O_NOFOLLOW)
            calls.append(flags)
            return original(path, flags, *args, **kwargs)

        with mock.patch.object(sizes.os, "open", side_effect=directory_only), \
                mock.patch("builtins.open", side_effect=AssertionError("content open")), \
                mock.patch.object(sizes.os, "read", side_effect=AssertionError("content read")):
            report = self.scan()
        self.assertEqual(report["count"], 1)
        self.assertTrue(calls)

    def test_rejects_root_ancestor_and_descendant_symlink_aliases(self):
        self.write("retained", b"original")
        alias = self.parent / "alias"
        alias.symlink_to(self.case, target_is_directory=True)
        with self.assertRaises(sizes.ScanError):
            sizes.scan_case(str(self.parent), str(alias), "123", "1")
        parent_alias = self.parent / "parent-alias"
        parent_alias.symlink_to(self.parent, target_is_directory=True)
        with self.assertRaises(sizes.ScanError):
            sizes.scan_case(str(parent_alias), str(parent_alias / self.case.name), "123", "1")
        (self.case / "linked").symlink_to(self.parent / "retained-private", target_is_directory=False)
        with self.assertRaises(sizes.ScanError):
            self.scan()

    def test_rejects_root_replaced_with_symlink(self):
        saved = self.parent / "retained-original-case"
        self.case.rename(saved)
        self.case.symlink_to(saved, target_is_directory=True)
        with self.assertRaises(sizes.ScanError):
            self.scan()
        self.assertTrue(saved.is_dir())

    def test_rejects_hardlink_and_nonregular_entries(self):
        path = self.write("one")
        os.link(path, self.parent / "outside-alias")
        with self.assertRaisesRegex(sizes.ScanError, "hardlink_alias"):
            self.scan()
        (self.parent / "outside-alias").unlink()
        os.mkfifo(self.case / "fifo")
        with self.assertRaisesRegex(sizes.ScanError, "nonregular_entry"):
            self.scan()

    def test_rejects_noncanonical_wrong_coordinates_and_permissions(self):
        cases = [
            (str(self.parent), str(self.case) + "/.", "123", "1"),
            (str(self.parent), str(self.case), "124", "1"),
            (str(self.parent), str(self.case), "123", "01"),
            (str(self.parent), str(self.case), "0", "1"),
            (str(self.parent), str(self.case), "123", "1/escape"),
        ]
        for args in cases:
            with self.subTest(args=args), self.assertRaises(sizes.ScanError):
                sizes.scan_case(*args)
        self.case.chmod(0o755)
        with self.assertRaisesRegex(sizes.ScanError, "case_must_be_owned_and_0700"):
            self.scan()

    def test_changed_file_between_scans_is_not_reported_as_complete(self):
        path = self.write("one", b"a")
        original = sizes._scan
        calls = 0

        def change(fd):
            nonlocal calls
            result = original(fd)
            calls += 1
            if calls == 1:
                path.write_bytes(b"changed")
            return result

        with mock.patch.object(sizes, "_scan", side_effect=change), \
                self.assertRaisesRegex(sizes.ScanError, "case_changed_between_scans"):
            self.scan()
        self.assertEqual(path.read_bytes(), b"changed")

    def test_root_replacement_between_scans_is_rejected(self):
        self.write("one")
        original = sizes._scan
        calls = 0

        def replace(fd):
            nonlocal calls
            result = original(fd)
            calls += 1
            if calls == 1:
                self.case.rename(self.parent / "retained-old-case")
                self.case.mkdir(mode=0o700)
            return result

        with mock.patch.object(sizes, "_scan", side_effect=replace), self.assertRaises(sizes.ScanError):
            self.scan()

    def test_entry_depth_and_json_bounds(self):
        self.write("a/b/c/one", b"a")
        with mock.patch.object(sizes, "MAX_ENTRIES", 2), \
                self.assertRaisesRegex(sizes.ScanError, "entry_count_bound"):
            self.scan()
        with mock.patch.object(sizes, "MAX_DEPTH", 2), \
                self.assertRaisesRegex(sizes.ScanError, "depth_bound"):
            self.scan()
        with mock.patch.object(sizes, "MAX_JSON_BYTES", 8), \
                self.assertRaisesRegex(sizes.ScanError, "json_output_bound"):
            sizes.encode_report(self.scan())

    def test_largest_is_bounded_but_total_includes_every_file(self):
        for i in range(25):
            self.write("file-%02d" % i, b"x" * (i + 1))
        report = self.scan()
        self.assertEqual((report["count"], report["logicalBytes"]), (25, sum(range(1, 26))))
        self.assertEqual(len(report["largest"]), 20)
        self.assertEqual([item["logicalBytes"] for item in report["largest"]], list(range(25, 5, -1)))

    def test_cli_success_and_failure_never_print_paths_or_exception_text(self):
        self.write("one", b"tiny")
        args = ["--ephemeral-parent", str(self.parent), "--case", str(self.case),
                "--run-id", "123", "--run-attempt", "1"]
        output = io.BytesIO()
        with mock.patch.object(sizes.sys, "stdout", SimpleNamespace(buffer=output)):
            self.assertEqual(sizes.main(args), 0)
        self.assertEqual(json.loads(output.getvalue())["logicalBytes"], 4)
        output = io.BytesIO()
        with mock.patch.object(sizes.sys, "stdout", SimpleNamespace(buffer=output)), \
                mock.patch.object(sizes, "scan_case", side_effect=OSError("private absolute /secret/path")):
            self.assertEqual(sizes.main(args), 1)
        failed = json.loads(output.getvalue())
        self.assertEqual(failed, dict(schema=sizes.SCHEMA, status="failed", errorCode="filesystem_metadata_unavailable"))
        self.assertNotIn(b"/secret/path", output.getvalue())

    def test_cli_parse_errors_do_not_echo_input_paths(self):
        output = io.BytesIO()
        errors = io.StringIO()
        with mock.patch.object(sizes.sys, "stdout", SimpleNamespace(buffer=output)), \
                mock.patch.object(sizes.sys, "stderr", errors):
            self.assertEqual(sizes.main(["--unknown-private-path=/private/secret"]), 1)
        self.assertEqual(json.loads(output.getvalue())["errorCode"], "invalid_cli_arguments")
        self.assertEqual(errors.getvalue(), "")
        self.assertNotIn(b"/private/secret", output.getvalue())


if __name__ == "__main__":
    unittest.main()
