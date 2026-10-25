"""Normal native matrix sealer. Only fixed public CONTROL leaves leave CI."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def pin(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= 128 << 20:
        raise RuntimeError("only bounded regular public leaves may be delivered")
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    return dict(bytes=info.st_size, sha256=digest)


def main():
    if len(sys.argv) != 2:
        raise RuntimeError("one fixed normal CI case required")
    case = Path(os.environ["RUNNER_TEMP"]) / "ynx-project-control-cabi"
    if Path(sys.argv[1]) != case or not case.is_dir() or case.is_symlink():
        raise RuntimeError("fixed normal native CI case required")
    if command("git", "rev-parse", "HEAD") != os.environ["GITHUB_SHA"]:
        raise RuntimeError("CONTROL source differs from the selected commit")
    module = json.loads(command("go", "list", "-m", "-json", "github.com/cloudflare/circl"))
    if module.get("Version") != "v1.6.5" or module.get("Replace"):
        raise RuntimeError("fixed original provider dependency required")
    native_os, native_arch = command("go", "env", "GOOS"), command("go", "env", "GOARCH")
    if native_os not in ("linux", "darwin") or native_arch not in ("amd64", "arm64"):
        raise RuntimeError("executed native target required")
    if native_os == "darwin":
        if native_arch != "arm64":
            raise RuntimeError("original Main requires actual native arm64 execution")
        subprocess.run(["lipo", str(case / "libynx_project_control.a"), "-verify_arch", "arm64"], check=True)
        subprocess.run(["lipo", str(case / "c-driver"), "-verify_arch", "arm64"], check=True)
    source_names = command("git", "ls-files", "go.mod", "go.sum", "internal/ynxbatch", "internal/accountaddress",
        "cmd/ynx-artifact-release-cabi", "scripts/fixtures/verify-project-control-cabi",
        "scripts/verify/project-control-cabi-check.sh", "scripts/verify/seal-project-control-cabi.py",
        ".github/workflows/resource-market-ci.yml").splitlines()
    sources = {name: dict(**pin(Path(name)), gitBlob=command("git", "rev-parse", "HEAD:" + name)) for name in source_names}
    public = ("PUBLIC-RECEIPT.json", "PUBLIC-INTEROP.json")
    evidence = {name: pin(case / "output" / name) for name in public}
    original_archive = Path(os.environ["RUNNER_TEMP"]) / "ynx-artifact-release-cabi" / "libynx_artifact_release.a"
    if pin(case / "libynx_project_control.a") != pin(original_archive):
        raise RuntimeError("CONTROL must use the same executed original single Go archive")
    out = case / "delivery"
    out.mkdir(mode=0o700)
    shutil.copyfile(case / "libynx_project_control.a", out / "libynx_project_control.a")
    shutil.copyfile("cmd/ynx-artifact-release-cabi/ynx_project_control.h", out / "ynx_project_control.h")
    for name in public:
        shutil.copyfile(case / "output" / name, out / name)
    record = dict(version="YNX-PROJECT-CONTROL-CABI-CANDIDATE/v1", commit=os.environ["GITHUB_SHA"],
        sourceTree=command("git", "rev-parse", "HEAD^{tree}"), runId=os.environ["GITHUB_RUN_ID"],
        runAttempt=os.environ["GITHUB_RUN_ATTEMPT"], job=os.environ["GITHUB_JOB"],
        matrixRunner=os.environ["YNX_NATIVE_MATRIX_RUNNER"], runnerOS=os.environ["RUNNER_OS"],
        host=dict(os=native_os, arch=native_arch), target=dict(os=native_os, arch=native_arch),
        minimumSystemVersion="13.0" if native_os == "darwin" else None,
        deploymentTargetEnvironment=os.environ.get("MACOSX_DEPLOYMENT_TARGET") if native_os == "darwin" else None,
        goVersion=command("go", "version"), compilerVersion=command("cc", "--version"),
        circl={key: module[key] for key in ("Path", "Version", "Sum", "GoModSum") if key in module},
        sources=sources, abi="YNXProjectControlSignV1", abiVersion=1,
        coResidentABIs=["YNXArtifactPublicationSignV1", "YNXProjectControlSignV1"],
        originalSingleArchive=pin(original_archive),
        purpose="IDE-PROJECT-CONTROL", messageFrame="YNX-IDE-PROJECT-CONTROL-APPROVAL/v1", messageFields=13,
        suite="ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512", memberCount=1, memberIndex=0,
        archive=pin(out / "libynx_project_control.a"), header=pin(out / "ynx_project_control.h"),
        publicEvidence=evidence, nativeHostCoreTestsPassed=True, actualCABIExecuted=True,
        independentGoDualANDVerified=True, typedN1Inspected=True, crossCompiled=False,
        syntheticTestKeysOnly=True, privateMaterialIncluded=False,
        cleanup="logical Clear/Destroy/Discard; no provider physical-erasure guarantee",
        controlAuthorized=False, nativeRootAuthorized=False, mainCustodyVerified=False,
        productInstalled=False, publicDeployment=False, pqActivation=False)
    with (out / "SOURCE.json").open("x") as sink:
        sink.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
    if command("git", "status", "--porcelain", "--untracked-files=normal"):
        raise RuntimeError("CONTROL CI modified the source checkout")
    print("YNX_CONTROL_CABI_CANDIDATE " + json.dumps(dict(target=record["target"], archive=record["archive"], header=record["header"]), sort_keys=True))


if __name__ == "__main__":
    main()
