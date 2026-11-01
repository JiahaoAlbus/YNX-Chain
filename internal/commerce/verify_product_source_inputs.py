"""Check exact complete supplier source inputs; hashes grant no Root authority."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[2]
manifest = json.loads((root / "internal/commerce/PRODUCT_SOURCE_DEPENDENCIES.json").read_text())
expected = manifest["files"]
for relative, digest in expected.items():
    path = root / relative
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit("supplier source differs: " + relative)
for directory in ("internal/securelink", "internal/commerce/third_party/productreadsource"):
    actual = {str(path.relative_to(root)) for path in (root / directory).rglob("*") if path.is_file()}
    declared = {path for path in expected if path.startswith(directory + "/")}
    if actual != declared:
        raise SystemExit("supplier package is incomplete or mixed: " + directory)
# LINK's complete original header closure lives alongside the existing normal
# command Go sources. They are unchanged and are not supplied by this header set.
headers = "cmd/ynx-secure-link-caller/"
actual = {str(path.relative_to(root)) for path in (root / headers).glob("*.h")}
if actual != {path for path in expected if path.startswith(headers)}:
    raise SystemExit("original LINK header closure differs")
print("PASS complete immutable Auth/LINK source inputs:", len(expected), "files; no Source admission implied")
