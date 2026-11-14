#!/usr/bin/python3
"""Freeze the original Shop commit into an owned PUBLIC joint composition.

No owner checkout, SDK, Root row or installed application is modified.
"""
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tarfile

shop = pathlib.Path(sys.argv[1]).resolve()
output = pathlib.Path(sys.argv[2]).resolve()
commit = "cea986c65089e08561c68f586ab168210b46b611"
if not str(output).endswith("/owners/P06/shop-session-link-joint-20261108/composition"):
    raise SystemExit("explicit P06 joint composition required")
if output.exists():
    raise SystemExit("preserve previous composition; do not overwrite")
task = pathlib.Path(__file__).resolve().parents[3]
archive = subprocess.check_output([
    "git", "archive", commit, "go.mod", "go.sum", "internal", "cmd/ynx-secure-link-caller",
    "packages/auth-grant-policy/go", "packages/auth-grant-runtime/go",
    "packages/auth-grant-history-client/go", "packages/open-protocol/go",
], cwd=shop)
output.mkdir(parents=True)
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    for member in tar.getmembers():
        if member.issym() or member.islnk() or ".." in pathlib.PurePosixPath(member.name).parts:
            raise SystemExit("unexpected source archive member")
        tar.extract(member, output)
fixture = task / "apps/pay/native/testsupport/shop-session-link-joint.go.txt"
(output / "internal/commerce/p06_shop_session_link_joint_test.go").write_bytes(fixture.read_bytes())

# PUBLIC pre-connection expectation uses the original LINK test observer. It
# is build-tagged out of normal binaries and never installs a production row.
link = output / "internal/securelink"
peer = (link / "local_caller_exchange_peer_test.go").read_text()
first = peer.index("func publicOriginalLocalCallerExpected(t ")
last = peer.index("\nfunc originalPeerEvidence", first)
helpers = peer[first:last].replace("publicOriginalLocalCaller", "p06PublicOriginalLocalCaller")
helpers = helpers.replace("func p06PublicOriginalLocalCallerExpected(t ", "func P06PublicExpectedProcessForJoint(t ", 1)
body = '//go:build p06_shop_proof_joint\n\npackage securelink\n\nimport("testing";"os";"path/filepath";"crypto/sha256";"io")\n' + helpers
(link / "p06_public_expected_fixture.go").write_text(body)
for platform in ["darwin", "linux"]:
    text = (link / ("local_caller_exchange_peer_expected_" + platform + "_test.go")).read_text()
    text = text.replace("//go:build ", "//go:build p06_shop_proof_joint && ", 1)
    text = text.replace("publicOriginalLocalCaller", "p06PublicOriginalLocalCaller")
    (link / ("p06_public_expected_fixture_" + platform + ".go")).write_text(text)
manifest = {
    "originalShopCommit": commit,
    "source": str(shop),
    "composition": str(output),
    "gitArchiveSHA256": hashlib.sha256(archive).hexdigest(),
    "PUBLICFixtureOnly": True,
    "RootRowsAdded": 0,
    "normalProductionSourceModified": False,
    "fixture": {"path": str(fixture), "sha256": hashlib.sha256(fixture.read_bytes()).hexdigest()},
    "files": [],
}
for file in sorted(output.rglob("*")):
    if file.is_file():
        raw = file.read_bytes()
        manifest["files"].append({"relative": str(file.relative_to(output)), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
(output.parent / "COMPOSITION.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"composition": str(output), "files": len(manifest["files"]), "originalCommit": commit}))
