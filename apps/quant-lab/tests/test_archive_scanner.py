import importlib.util
import pathlib
import stat
import tempfile
import unittest
import zipfile


SCRIPT = pathlib.Path(__file__).parents[1] / "scripts" / "scan-desktop-archive.py"
SPEC = importlib.util.spec_from_file_location("archive_scanner", SCRIPT)
SCANNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCANNER)


class ArchiveScannerTest(unittest.TestCase):
    def archive(self, entries):
        root = pathlib.Path(self.enterContext(tempfile.TemporaryDirectory()))
        path = root / "candidate.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as target:
            for name, content, attributes in entries:
                info = zipfile.ZipInfo(name)
                info.external_attr = attributes << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                target.writestr(info, content)
        return path

    def assert_rejected(self, entries, message):
        with self.assertRaisesRegex(ValueError, message):
            SCANNER.scan(self.archive(entries))

    def test_rejects_traversal_symlink_executable_secret_and_bomb(self):
        regular = stat.S_IFREG | 0o644
        self.assert_rejected([("../escape", b"x", regular)], "unsafe archive path")
        self.assert_rejected([("link", b"target", stat.S_IFLNK | 0o777)], "symbolic link")
        self.assert_rejected([("run.sh", b"exit 0", stat.S_IFREG | 0o755)], "unexpected executable")
        self.assert_rejected([("config.txt", b"BEGIN PRIVATE KEY", regular)], "credential pattern")
        self.assert_rejected([("bomb.txt", b"x" * (1024 * 1024), regular)], "compression ratio")

    def test_accepts_bounded_non_executable_content(self):
        result = SCANNER.scan(self.archive([("web/index.html", b"<title>YNX Quant Lab</title>", stat.S_IFREG | 0o644)]))
        self.assertTrue(result["passed"])
        self.assertFalse(result["pathTraversal"])


if __name__ == "__main__":
    unittest.main()
