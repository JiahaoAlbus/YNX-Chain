"""Run the original P06 fixed legacy joint; this never commissions session4."""
from pathlib import Path, PurePosixPath
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[3]
PAY = "fd9059897778a488754804adf392476575957c73"
SHOP = "cea986c65089e08561c68f586ab168210b46b611"
MAIN = "1bb93bd0b687fea0e421b8a57028f0039201eff0"
WRAPPER = "apps/wallet-desktop/src/wallet-native-pay-product.mjs"
WRAPPER_SHA = "3e44cc3e96092616ebaa0752ae6bdcf62f4cb808ac2f6d4e72cc97b15ad2731a"
ZIP_SHA = "85f90d7bc555675f13e59ec9427e19ca4f4ac8223a2a5cac74674134865afb4a"
TGZ_SHA = "f6d84ae190c75d39eca110faf005ca12f6abc8022c1c7de7d6a32fd63fed9f46"


def exact(raw, size, digest):
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
        raise SystemExit("original input bytes/hash differ")


def unpack(raw, target, prefix=""):
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        members = archive.getmembers()
        if len(members) > 10000 or sum(m.size for m in members) > 128 << 20:
            raise SystemExit("original archive bounds exceeded")
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not (member.isdir() or member.isfile()):
                raise SystemExit("unsafe original archive member")
            if prefix:
                if not member.name.startswith(prefix):
                    raise SystemExit("unexpected original archive prefix")
                member.name = member.name[len(prefix):]
                if not member.name:
                    continue
            archive.extract(member, target)


def main():
    base = Path(os.environ["RUNNER_TEMP"]) / "p07-fixed-legacy-joint"
    base.mkdir(mode=0o700)  # Preserve any earlier run; never overwrite it.
    subprocess.run(["git", "fetch", "--no-tags", "--depth=1", "origin", PAY, SHOP, MAIN], cwd=ROOT, check=True)
    for commit in (PAY, SHOP, MAIN):
        subprocess.run(["git", "cat-file", "-e", commit + "^{commit}"], cwd=ROOT, check=True)

    pay = base / "pay-source"
    raw = subprocess.check_output(["git", "archive", PAY, "apps/pay/native/r6",
        "apps/pay/native/testsupport/shop-session-link-joint.go.txt",
        "apps/pay/native/testsupport/shop-session-link-joint.mjs",
        "internal/payproduct/testsupport/prepare_shop_session_joint.py",
        "internal/payproduct/testsupport/run_native_workflow.sh"], cwd=ROOT)
    unpack(raw, pay)
    wrapper = base / "pinned-main-wrapper.mjs"
    raw = subprocess.check_output(["git", "show", MAIN + ":" + WRAPPER], cwd=ROOT)
    exact(raw, 1886, WRAPPER_SHA)
    wrapper.write_bytes(raw)

    package_zip = base / "official-sdk.zip"
    with package_zip.open("wb") as output:
        subprocess.run(["gh", "api", "repos/JiahaoAlbus/YNX-Chain/actions/artifacts/13598842870/zip"], stdout=output, check=True)
    exact(package_zip.read_bytes(), 10719905, ZIP_SHA)
    with zipfile.ZipFile(package_zip) as archive:
        candidates = [i for i in archive.infolist() if i.filename.endswith("/ynx-chain-wallet-auth-1.3.0-pq.3.32-auth.49.tgz")]
        if len(candidates) != 1 or candidates[0].file_size != 9551854:
            raise SystemExit("original official SDK package missing")
        tgz = archive.read(candidates[0])
    exact(tgz, 9551854, TGZ_SHA)
    central = base / "sdk"
    unpack(tgz, central / "packages/wallet-auth", "package/")
    for required in ("src/product-session-gateway-node-host.js", "node_modules/@noble/curves/nist.js", "node_modules/@noble/hashes/sha2.js"):
        if not (central / "packages/wallet-auth" / required).is_file():
            raise SystemExit("official SDK composition is incomplete")

    composition = base / "owners/P06/shop-session-link-joint-20261108/composition"
    prepare = pay / "internal/payproduct/testsupport/prepare_shop_session_joint.py"
    subprocess.run(["python3", str(prepare), str(ROOT), str(composition)], check=True)
    # All original inputs above are fixed commits or exact official bytes.
    # Only PUBLIC build-tagged observers are added by the original preparer.
    manifest = json.loads((composition.parent / "COMPOSITION.json").read_text())
    if manifest["originalShopCommit"] != SHOP or manifest["RootRowsAdded"] != 0:
        raise SystemExit("original composition boundary changed")
    socket_root = Path(tempfile.mkdtemp(prefix="p7j-", dir="/tmp"))
    socket_root.chmod(0o700)
    result = base / "public-result"
    result.mkdir(mode=0o700)
    env = os.environ.copy()
    env.pop("GH_TOKEN", None)
    env.pop("GITHUB_TOKEN", None)
    env.update(PAY_NATIVE_WORKFLOW_SUITE="shop-session-link-joint", PAY_GO_BINARY=shutil.which("go"),
        PAY_NODE_BINARY=shutil.which("node"), PAY_MAIN_PRODUCT_MODULE=str(wrapper),
        PAY_MAIN_PRODUCT_SHA256=WRAPPER_SHA, PAY_SHOP_SOURCE_ROOT=str(composition),
        PAY_SHOP_SESSION_RESULT=str(result), YNX_QA_CENTRAL_SOURCE=str(central),
        SHOP_SOURCE_READ_SOCKET_ROOT=str(socket_root), GOWORK="off", GOMAXPROCS="2")
    log = base / "joint.log"
    try:
        with log.open("w") as output:
            completed = subprocess.run(["sh", str(pay / "internal/payproduct/testsupport/run_native_workflow.sh"),
                str(base / "owners/P06/pq-core-composition-shop-joint"), str(result)], env=env, stdout=output, stderr=subprocess.STDOUT)
        text = log.read_text()
        print(text, end="")
        name = "TestP06LegacyV2ShopProofOwnedLINKNormalConsumerColdRevoke"
        if completed.returncode or len(re.findall(r"^--- PASS: " + name + r" ", text, re.M)) != 1 or "--- SKIP:" in text:
            raise SystemExit("required original legacy joint did not execute/pass exactly once")
        data = json.loads((result / "RESULT.json").read_text())
        expected = dict(actualSessionVersion="2", actualOwnedUnixGETs=6, sameExchangePhysicalClosed=6,
            producerColdBoots=3, sessionGeneration=1, actualSDKProof=True,
            financialAndNonceExactlyRetained=True, missingProofDenied=True, wrongTenantDenied=True,
            ownSessionRevokedAcrossCold=True, RootAdmission=False, SourceAdmission=False,
            genuineNativeHolder=False, payOrMoneyDispatched=0)
        for key, value in expected.items():
            if data.get(key) != value:
                raise SystemExit("original joint result differs: " + key)
        consumers = data["normalMainConsumers"]
        if len(consumers) != 2 or any(not c.get("pinnedOriginalMainWrapper") or c.get("payDispatched") != 0 or c.get("signing") != 0 for c in consumers):
            raise SystemExit("original Main source consumer boundary differs")
        receipt = dict(state="FIXED_LEGACY_SESSION2_JOINT_PASSED_NOT_SESSION4_OR_ADMISSION",
            Shop=SHOP, Pay=PAY, Main=MAIN, officialSDKArtifact=13598842870,
            officialSDKPackageSHA256=TGZ_SHA, newSession4=False, installed=False, deployed=False)
        (base / "CI_RECEIPT.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt))
    finally:
        # Original fixture joins children and physically closes six exchanges.
        # Never delete an occupied socket directory after an unsuccessful run.
        if socket_root.exists() and not any(socket_root.iterdir()):
            socket_root.rmdir()


if __name__ == "__main__":
    main()
