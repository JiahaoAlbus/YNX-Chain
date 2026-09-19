#!/usr/bin/env python3
"""Finance-only rollback-first deployment for the frozen Weekly v3 artifact.

Run as root on the approved Finance host. The script never prints environment
values, never restores or clears Finance state, and never edits the unit,
drop-in, Caddy, Wallet, RPC, or another service.
"""

import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import stat
import subprocess
import tarfile
import time
import urllib.error
import urllib.request

RUN = "finance-weekly-v3-9912d29f-20260919T144000Z"
SOURCE = "9912d29f82d5ceca689f07e20e944648a2be6de3"
SOURCE_TREE = "516866313345666ea1987f760aae3adc15464338"
EVIDENCE = "5936ca3e083742dcb85fcd85e1f48a2370ac92db"
ARCHIVE = Path("/tmp/ynx-finance-weekly-v3-9912d29f82d5-linux-amd64-r2.tar.gz")
ARCHIVE_SHA = "359aa7fb7cc88d8332f3764ba83ac212d329e0486ad0079ce180a83500eee474"
ARCHIVE_BYTES = 15562500
BINARY_SHA = "752f27f786c5041a6dd41eaf6de636ef3b1c04a8238ae8294765c670bba7f1f9"
TOOLS_SHA = "5b91813aa926b1a46bc23c068de4462f7c3d7c38770a337487fd86e7bc4db15d"
OLD = Path("/opt/ynx/releases/finance/finance-sdk-7a1d2aba-20260912T104700Z-r2")
STAGE = Path("/opt/ynx/stage/finance") / RUN
BACKUP = STAGE / "rollback"
RELEASE = Path("/opt/ynx/releases/finance") / RUN
CURRENT = Path("/opt/ynx/finance-current")
CURRENT_NEXT = Path("/opt/ynx/finance-weekly-v3-9912d29f.next")
ENV = Path("/etc/ynx/finance.env")
ENV_NEXT = Path("/etc/ynx/finance-weekly-v3-9912d29f.env.next")
STATE = Path("/var/lib/ynx/finance/state.json")
UNIT = Path("/etc/systemd/system/ynx-finance.service")
DROPIN = Path("/etc/systemd/system/ynx-finance.service.d/actions.conf")
CADDY = Path("/etc/caddy/Caddyfile")
EXPECTED_ENV_SHA = "000ef2feed4a35b1b0f17cf9955433ea354e786bdd65a724f8204d0a1c66fd7a"
EXPECTED_UNIT_SHA = "2e72cdad422a3a714c46d074ea97b725233576cf726dbbfd43e82e99c2c2975b"
EXPECTED_DROPIN_SHA = "ae13bc19e87b97f55a0bc4c1a8b59bdfe217deda18213003142a796b1307c397"
EXPECTED_CADDY_SHA = "c9f18ca97f865efce1472b6fd99df5875cad9bba057c8f35abddedfa3f7c54c9"
EXPECTED_OLD_BINARY_SHA = "d0cc204f851afa0aace9bba06c3048a0bd1dc623b686eac56cab8ae6e0046c77"
EXPECTED_OLD_PID = "1664408"


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def receipt(path):
    path = Path(path)
    if not path.exists() and not path.is_symlink():
        return {"path": str(path), "absent": True}
    value = path.lstat()
    result = {
        "path": str(path), "device": value.st_dev, "inode": value.st_ino,
        "uid": value.st_uid, "gid": value.st_gid,
        "mode": oct(stat.S_IMODE(value.st_mode)), "nlink": value.st_nlink,
        "bytes": value.st_size,
    }
    if stat.S_ISREG(value.st_mode):
        result.update(type="file", sha256=digest(path.read_bytes()))
    elif stat.S_ISDIR(value.st_mode):
        result.update(type="directory")
    elif stat.S_ISLNK(value.st_mode):
        result.update(type="symlink", target=os.readlink(path))
    else:
        raise AssertionError("unsupported filesystem object")
    return result


def regular(path, expected_sha=None, expected_bytes=None):
    path = Path(path)
    result = receipt(path)
    assert result.get("type") == "file" and result["nlink"] == 1
    assert path.resolve() == path
    if expected_sha is not None:
        assert result["sha256"] == expected_sha
    if expected_bytes is not None:
        assert result["bytes"] == expected_bytes
    return result


def absent(path):
    path = Path(path)
    assert not path.exists() and not path.is_symlink()


def save_new(path, raw, mode, gid):
    path = Path(path)
    with open(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, mode), "wb") as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
        os.fchmod(output.fileno(), mode)
        os.fchown(output.fileno(), 0, gid)
    return receipt(path)


def service():
    output = subprocess.check_output([
        "/usr/bin/systemctl", "show", "ynx-finance.service", "-p", "MainPID",
        "-p", "NRestarts", "-p", "ActiveState", "-p", "SubState",
        "-p", "User", "-p", "Group", "-p", "WorkingDirectory",
    ], text=True)
    return dict(line.split("=", 1) for line in output.splitlines())


def systemctl(action):
    subprocess.run(
        ["/usr/bin/systemctl", action, "ynx-finance.service"], check=True,
        timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def http(url, expected_sha=None, expected_source=None):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "Accept-Encoding": "identity"})
    try:
        response = urllib.request.urlopen(request, timeout=12)
    except urllib.error.HTTPError as error:
        response = error
    with response as result:
        raw = result.read(2 * 1024 * 1024)
        observed = {
            "url": url, "status": result.status, "bytes": len(raw),
            "sha256": digest(raw), "mime": result.headers.get("Content-Type"),
            "cacheControl": result.headers.get("Cache-Control"),
        }
        assert result.status == 200
        if expected_sha is not None:
            assert observed["sha256"] == expected_sha
        if expected_source is not None:
            assert json.loads(raw)["commit"] == expected_source
        return observed


def health(base, source):
    return [http(base + "/version", expected_source=source), http(base + "/health"), http(base + "/ready")]


def route(path):
    assert path.startswith("web/")
    return "/" if path == "web/index.html" else "/" + path[4:]


def candidate_environment(raw):
    lines = raw.splitlines(keepends=True)
    web_key = b"YNX_FINANCE_WEB_DIR="
    auth_key = b"YNX_FINANCE_AUTH_MODE="
    assert sum(line.startswith(web_key) for line in lines) == 1
    assert sum(line.startswith(auth_key) for line in lines) == 1
    for index, line in enumerate(lines):
        if line.startswith(web_key):
            assert line.rstrip(b"\r\n") == web_key + str(OLD / "web").encode()
            lines[index] = web_key + str(RELEASE / "web").encode() + b"\n"
        if line.startswith(auth_key):
            assert line.rstrip(b"\r\n") == b"YNX_FINANCE_AUTH_MODE=product-session-v2"
    return b"".join(lines)


def main():
    assert os.geteuid() == 0 and os.uname().machine == "x86_64"
    ynx = pwd.getpwnam("ynx")
    assert (ynx.pw_uid, ynx.pw_gid) == (995, 986)
    for parent in (STAGE.parent, RELEASE.parent, ENV.parent, CURRENT.parent):
        assert parent.is_dir() and parent.resolve() == parent
    for target in (STAGE, RELEASE, ENV_NEXT, CURRENT_NEXT):
        absent(target)

    archive_receipt = regular(ARCHIVE, ARCHIVE_SHA, ARCHIVE_BYTES)
    old_env_receipt = regular(ENV, EXPECTED_ENV_SHA)
    unit_receipt = regular(UNIT, EXPECTED_UNIT_SHA)
    dropin_receipt = regular(DROPIN, EXPECTED_DROPIN_SHA)
    caddy_receipt = regular(CADDY, EXPECTED_CADDY_SHA)
    regular(OLD / "ynx-finance", EXPECTED_OLD_BINARY_SHA)
    assert CURRENT.is_symlink() and CURRENT.resolve() == OLD and os.readlink(CURRENT) == str(OLD)
    assert receipt(STATE).get("absent") is True
    old_service = service()
    assert old_service == {
        "MainPID": EXPECTED_OLD_PID, "NRestarts": "0", "WorkingDirectory": str(CURRENT),
        "User": "ynx", "Group": "ynx", "ActiveState": "active", "SubState": "running",
    }
    assert subprocess.check_output(["/usr/bin/pgrep", "-c", "-x", "ynx-finance"], text=True).strip() == "1"

    old_http = []
    for base in ("http://127.0.0.1:6483", "https://finance.ynxweb4.com"):
        old_http += health(base, "7a1d2aba6e72e5567931f451a9f069a544f58783")
        old_http.append(http(base + "/"))

    old_env = ENV.read_bytes()
    new_env = candidate_environment(old_env)
    effective = dict(
        item.split(b"=", 1) for item in Path("/proc/" + old_service["MainPID"] + "/environ").read_bytes().split(b"\0") if b"=" in item
    )
    assert not effective.get(b"YNX_FINANCE_DATABASE_URL")
    assert not effective.get(b"ALPACA_BROKER_CLIENT_ID")
    assert not effective.get(b"ALPACA_BROKER_CLIENT_SECRET")
    assert not effective.get(b"FINANCE_SANDBOX_WRITES_ENABLED")

    evidence = {
        "schemaVersion": "ynx.finance.weekly-v3-public-deployment.v1",
        "run": RUN, "source": SOURCE, "sourceTree": SOURCE_TREE, "evidenceCommit": EVIDENCE,
        "archive": archive_receipt,
        "before": {
            "current": receipt(CURRENT), "service": old_service, "state": receipt(STATE),
            "env": old_env_receipt, "unit": unit_receipt, "dropin": dropin_receipt,
            "caddy": caddy_receipt, "http": old_http,
        },
        "statePolicy": "state must remain absent through switch; never migrate, clear, import, or restore state",
        "brokerCredentialsConfigured": False,
        "providerReadAttempted": False,
        "providerWriteAttempted": False,
    }
    phase = "STAGING"
    switched = False
    stopped = False
    isolated_process = None
    STAGE.mkdir(mode=0o750)
    os.chown(STAGE, 0, 986)
    BACKUP.mkdir(mode=0o700)
    save_new(BACKUP / "finance.env", old_env, 0o600, 0)
    save_new(BACKUP / "service.unit", UNIT.read_bytes(), 0o600, 0)
    save_new(BACKUP / "actions.conf", DROPIN.read_bytes(), 0o600, 0)
    save_new(BACKUP / "Caddyfile", CADDY.read_bytes(), 0o600, 0)
    try:
        phase = "ARCHIVE_EXTRACT"
        with tarfile.open(ARCHIVE, "r:gz") as archive:
            members = archive.getmembers()
            expected_names = {
                "ynx-finance", "ynx-finance-broker-tools", "manifest.json",
                "web/index.html", "web/app.js", "web/wallet-auth.js", "web/read-sources.js",
                "web/styles.css", "web/manifest.webmanifest", "web/ynx-logo.png",
            }
            assert {member.name for member in members} == expected_names and len(members) == len(expected_names)
            assert all(member.isfile() and not member.issym() and not member.islnk() for member in members)
            manifest = json.load(archive.extractfile("manifest.json"))
            assert manifest["sourceCommit"] == SOURCE and manifest["sourceTree"] == SOURCE_TREE
            assert manifest["evidenceCommit"] == EVIDENCE and len(manifest["files"]) == 9
            RELEASE.mkdir(mode=0o750)
            os.chown(RELEASE, 0, 986)
            (RELEASE / "web").mkdir(mode=0o755)
            os.chown(RELEASE / "web", 0, 986)
            for member in members:
                raw = archive.extractfile(member).read()
                mode = 0o755 if member.name in ("ynx-finance", "ynx-finance-broker-tools") else 0o644
                save_new(RELEASE / member.name, raw, mode, 986)

        for item in manifest["files"]:
            regular(RELEASE / item["path"], item["sha256"], item["bytes"])
        regular(RELEASE / "ynx-finance", BINARY_SHA, 20439224)
        regular(RELEASE / "ynx-finance-broker-tools", TOOLS_SHA, 19398840)
        for binary in (RELEASE / "ynx-finance", RELEASE / "ynx-finance-broker-tools"):
            header = binary.read_bytes()[:20]
            assert header[:5] == b"\x7fELF\x02" and header[18:20] == b"\x3e\x00"

        phase = "SERVICE_USER_ACCESS"
        subprocess.run([
            "/usr/sbin/runuser", "-u", "ynx", "--", "/bin/sh", "-c",
            'cd "$1" && test -x ./ynx-finance && test -x ./ynx-finance-broker-tools && test -r ./web/index.html && test -r ./web/app.js',
            "finance-access", str(RELEASE),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        phase = "ISOLATED_CANDIDATE"
        isolated = RELEASE / ".isolated-preflight"
        isolated.mkdir(mode=0o700)
        os.chown(isolated, 995, 986)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        isolated_env = dict(effective)
        isolated_env.update({
            b"YNX_FINANCE_LISTEN": ("127.0.0.1:" + str(port)).encode(),
            b"YNX_FINANCE_STATE_PATH": str(isolated / "state.json").encode(),
            b"YNX_FINANCE_WEB_DIR": str(RELEASE / "web").encode(),
            b"YNX_FINANCE_AUTH_MODE": b"product-session-v2",
        })
        isolated_process = subprocess.Popen(
            [str(RELEASE / "ynx-finance")], cwd=RELEASE, env=isolated_env,
            user=995, group=986, extra_groups=[986], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(1)
        assert isolated_process.poll() is None
        isolated_http = health("http://127.0.0.1:" + str(port), SOURCE)
        for item in manifest["files"]:
            if item["path"].startswith("web/"):
                isolated_http.append(http("http://127.0.0.1:" + str(port) + route(item["path"]), item["sha256"]))
        isolated_process.terminate()
        isolated_process.wait(timeout=10)
        isolated_process = None
        absent(isolated / "state.json")
        isolated.rmdir()
        evidence["isolatedCandidate"] = isolated_http

        phase = "PRE_SWITCH"
        assert service() == old_service
        regular(ENV, EXPECTED_ENV_SHA)
        regular(UNIT, EXPECTED_UNIT_SHA)
        regular(DROPIN, EXPECTED_DROPIN_SHA)
        regular(CADDY, EXPECTED_CADDY_SHA)
        assert CURRENT.resolve() == OLD and receipt(STATE).get("absent") is True
        env_next_receipt = save_new(ENV_NEXT, new_env, 0o640, 986)
        systemctl("stop")
        stopped = True
        assert service()["MainPID"] == "0" and receipt(STATE).get("absent") is True

        phase = "ATOMIC_SWITCH"
        assert receipt(ENV_NEXT) == env_next_receipt
        os.replace(ENV_NEXT, ENV)
        switched = True
        os.symlink(str(RELEASE), CURRENT_NEXT)
        os.replace(CURRENT_NEXT, CURRENT)
        systemctl("start")
        stopped = False
        time.sleep(1)

        phase = "PUBLIC_VERIFY"
        candidate_service = service()
        assert candidate_service["ActiveState"] == "active" and candidate_service["SubState"] == "running"
        assert int(candidate_service["MainPID"]) > 0 and candidate_service["MainPID"] != old_service["MainPID"]
        assert candidate_service["NRestarts"] == "0" and CURRENT.resolve() == RELEASE
        assert receipt(STATE).get("absent") is True
        after_http = []
        for base in ("http://127.0.0.1:6483", "https://finance.ynxweb4.com"):
            after_http += health(base, SOURCE)
            for item in manifest["files"]:
                if item["path"].startswith("web/"):
                    after_http.append(http(base + route(item["path"]), item["sha256"]))
        regular(UNIT, EXPECTED_UNIT_SHA)
        regular(DROPIN, EXPECTED_DROPIN_SHA)
        regular(CADDY, EXPECTED_CADDY_SHA)
        evidence.update(
            status="DEPLOYED_SOURCE_BOUND_PUBLIC", deployCount=1, automaticRollbackCount=0,
            after={
                "current": receipt(CURRENT), "service": candidate_service, "state": receipt(STATE),
                "env": receipt(ENV), "binary": receipt(RELEASE / "ynx-finance"),
                "brokerTools": receipt(RELEASE / "ynx-finance-broker-tools"), "http": after_http,
            },
            rollback={"release": str(OLD), "environmentBackup": str(BACKUP / "finance.env"), "stateRestore": False},
            retained={"release": str(RELEASE), "rollback": str(BACKUP), "archive": str(ARCHIVE)},
            forbiddenMutations={"unit": False, "dropin": False, "caddy": False, "state": False, "wallet": False, "rpc": False, "otherServices": False},
            installedRuntimeVerified=False, walletApprovalVerified=False, signingVerified=False,
            securitiesOrderSubmitted=False, chainTransactionSubmitted=False,
        )
        save_new(STAGE / "deployment-receipt.json", (json.dumps(evidence, indent=2) + "\n").encode(), 0o600, 0)
        print(json.dumps(evidence), flush=True)
    except BaseException as error:
        if isolated_process is not None and isolated_process.poll() is None:
            isolated_process.terminate()
            isolated_process.wait(timeout=10)
        rolled_back = False
        if switched or stopped:
            systemctl("stop")
            if switched:
                absent(ENV_NEXT)
                save_new(ENV_NEXT, old_env, 0o640, 986)
                os.replace(ENV_NEXT, ENV)
                absent(CURRENT_NEXT)
                os.symlink(str(OLD), CURRENT_NEXT)
                os.replace(CURRENT_NEXT, CURRENT)
            systemctl("start")
            time.sleep(1)
            regular(ENV, EXPECTED_ENV_SHA)
            assert CURRENT.resolve() == OLD and service()["ActiveState"] == "active"
            for item in old_http:
                http(item["url"], item["sha256"])
            rolled_back = True
        print(json.dumps({
            "status": "FAILED_CLOSED", "phase": phase, "errorClass": type(error).__name__,
            "automaticRollback": rolled_back, "current": receipt(CURRENT), "service": service(),
            "state": receipt(STATE), "retained": [str(STAGE), str(RELEASE), str(ARCHIVE)],
            "stateSnapshotRestored": False,
        }), flush=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
