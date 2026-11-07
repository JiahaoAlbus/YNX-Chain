#!/usr/bin/env python3
"""Actual archive controls only; no binary execution or compiler."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import tempfile
import unittest
import warnings
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("retained_reissue", HERE / "reissue.py")
reissue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reissue)
CARRIER = HERE / "carrier/client.zip"

class RetainedClientControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="retained-client-public-", dir=os.environ.get("REISSUE_TEST_TMP"))
        self.root = Path(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def copy(self):
        p = self.root / "candidate.zip"
        shutil.copyfile(CARRIER, p)
        return p
    def reject(self, p, code):
        with self.assertRaisesRegex(reissue.ValidationError, code):
            reissue.verify_archive(p, original=False)
    def mutate_central(self, p, name, edit):
        data = bytearray(p.read_bytes())
        with zipfile.ZipFile(p) as z:
            offset = z.start_dir
            for i in z.infolist():
                self.assertEqual(data[offset:offset+4], b"PK\x01\x02")
                name_len, extra_len, comment_len = struct.unpack_from("<HHH", data, offset+28)
                if i.filename == name:
                    edit(data, offset)
                    p.write_bytes(data)
                    return
                offset += 46 + name_len + extra_len + comment_len
        self.fail("member not found")
    def test_original_exact_closed_three_and_public_identity(self):
        out = reissue.verify_archive(CARRIER)
        self.assertEqual(out["originalSource"]["commit"], "70e7e450997a0ae77dbad5a8be3682f482c6ddd8")
        self.assertEqual(out["originalSource"]["producerCommit"], "da3060e150e2bd0f5695d67a76f3b30fafd1c696")
        self.assertEqual(out["originalArtifact"], 12609705118)
        self.assertFalse(out["binaryExecuted"])
        self.assertEqual(len(out["members"]), 3)
    def test_extract_creates_only_readonly_original_bytes(self):
        out = self.root / "new-three"
        record = reissue.verify_archive(CARRIER, output=out)
        self.assertEqual(sorted(x.name for x in out.iterdir()), sorted(x["name"] for x in record["members"]))
        for entry in record["members"]:
            p = out / entry["name"]
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o444)
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(), entry["sha256"])
    def test_existing_output_and_unknown_bytes_are_not_overwritten(self):
        out = self.root / "old-UNKNOWN"
        out.mkdir()
        (out / "UNKNOWN").write_bytes(b"retained old state")
        with self.assertRaises(FileExistsError):
            reissue.verify_archive(CARRIER, output=out)
        self.assertEqual((out / "UNKNOWN").read_bytes(), b"retained old state")
        self.assertEqual(len(list(out.iterdir())), 1)
    def test_changed_container_requires_explicit_reissued_mode(self):
        p = self.copy()
        with zipfile.ZipFile(p, "a") as z:
            z.comment = b"PUBLIC different container, same original bytes"
        with self.assertRaisesRegex(reissue.ValidationError, "ORIGINAL_ARCHIVE_HASH_MISMATCH"):
            reissue.verify_archive(p)
        out = reissue.verify_archive(p, original=False)
        self.assertNotEqual(out["archive"]["sha256"], reissue.contract()["originalArchive"]["sha256"])
        self.assertEqual(out["originalSource"], reissue.contract()["source"])
    def test_fourth_member_is_refused(self):
        p = self.copy()
        with zipfile.ZipFile(p, "a") as z:
            z.writestr("fourth.txt", b"PUBLIC extra")
        self.reject(p, "CLOSED_THREE_NAMES_REQUIRED")
    def test_duplicate_member_is_refused(self):
        p = self.copy()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(p, "a") as z:
                z.writestr("SOURCE.json", b"PUBLIC duplicate")
        self.reject(p, "DUPLICATE_MEMBER")
    def test_traversal_member_is_refused(self):
        p = self.copy()
        p.write_bytes(p.read_bytes().replace(b"SOURCE.json", b"../BAD.json"))
        self.reject(p, "CLOSED_THREE_NAMES_REQUIRED")
    def test_symlink_metadata_is_refused(self):
        p = self.copy()
        self.mutate_central(p, "SOURCE.json", lambda data, off: struct.pack_into("<I", data, off+38, (stat.S_IFLNK | 0o777) << 16))
        self.reject(p, "MEMBER_NOT_REGULAR")
    def test_directory_metadata_is_refused(self):
        p = self.copy()
        self.mutate_central(p, "SOURCE.json", lambda data, off: struct.pack_into("<I", data, off+38, (stat.S_IFDIR | 0o700) << 16))
        self.reject(p, "MEMBER_NOT_REGULAR")
    def test_encrypted_member_is_refused(self):
        p = self.copy()
        self.mutate_central(p, "SOURCE.json", lambda data, off: struct.pack_into("<H", data, off+8, struct.unpack_from("<H", data, off+8)[0] | 1))
        self.reject(p, "ENCRYPTED_MEMBER_REFUSED")
    def test_declared_size_is_refused_before_decompression(self):
        p = self.copy()
        self.mutate_central(p, "SOURCE.json", lambda data, off: struct.pack_into("<I", data, off+24, 709))
        self.reject(p, "MEMBER_SIZE_MISMATCH")
    def test_changed_crc_is_refused(self):
        p = self.copy()
        self.mutate_central(p, "SOURCE.json", lambda data, off: struct.pack_into("<I", data, off+16, 0))
        self.reject(p, "CRC_DECLARATION_MISMATCH")
    def test_corrupt_compressed_bytes_are_refused(self):
        p = self.copy()
        with zipfile.ZipFile(p) as z:
            item = z.getinfo("SOURCE.json")
        data = bytearray(p.read_bytes())
        name_len, extra_len = struct.unpack_from("<HH", data, item.header_offset+26)
        at = item.header_offset + 30 + name_len + extra_len + item.compress_size // 2
        data[at] ^= 0xff
        p.write_bytes(data)
        with self.assertRaises((reissue.ValidationError, zipfile.BadZipFile)):
            reissue.verify_archive(p, original=False)
    def test_input_symlink_is_refused(self):
        p = self.root / "link.zip"
        p.symlink_to(CARRIER)
        self.reject(p, "INPUT_NOT_REGULAR_OR_OPEN_FAILED")
    def test_archive_bound_is_enforced_before_read(self):
        p = self.root / "oversized.zip"
        with p.open("wb") as f:
            f.truncate(reissue.MAX_ARCHIVE + 1)
        self.reject(p, "ARCHIVE_SIZE_BOUND")
    def test_receipt_is_exclusive_and_does_not_replace_prior_failure(self):
        p = self.root / "receipt.json"
        reissue.receipt_write(p, {"status": "PUBLIC original first cause"})
        with self.assertRaises(FileExistsError):
            reissue.receipt_write(p, {"status": "replacement"})
        self.assertEqual(json.loads(p.read_bytes())["status"], "PUBLIC original first cause")

if __name__ == "__main__":
    reissue.enforce_budget()
    result = unittest.main(verbosity=2, exit=False).result
    if result.testsRun != 16 or result.skipped or not result.wasSuccessful():
        raise SystemExit("all16 retained archive controls must execute and pass")
