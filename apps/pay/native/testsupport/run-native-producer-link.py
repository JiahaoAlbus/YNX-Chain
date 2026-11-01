#!/usr/bin/python3
"""Frozen production archive link plus PUBLIC actual Unix component controls."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shlex
import subprocess

parser = argparse.ArgumentParser()
for name in ("auth", "link", "producer", "output"):
    parser.add_argument(name, type=pathlib.Path)
for name in ("auth", "link", "producer"):
    parser.add_argument("--" + name + "-sha256", required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_manifest(path, expected):
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError("manifest changed: " + str(path))
    (args.output / (path.parent.name + "-" + path.name)).write_bytes(data)
    return json.loads(data)


def checked(path, row):
    data = path.read_bytes()
    if len(data) != row["bytes"] or digest(data) != row["sha256"]:
        raise ValueError("declared input changed: " + str(path))
    return data


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


auth = read_manifest(args.auth, args.auth_sha256)
link = read_manifest(args.link, args.link_sha256)
producer = read_manifest(args.producer, args.producer_sha256)
auth_dir = args.output / "auth"
producer_dir = args.output / "producer"
libraries = args.output / "libraries"
for row in auth["files"]:
    path = pathlib.Path(row["path"])
    data = checked(path, row)
    relative = "auth/" + path.name if path.parent == pathlib.Path(auth["sourceRoot"]) else "auth-extra/" + path.name
    write(args.output / relative, data)
old_header = checked(pathlib.Path(auth["linkHeader"]["path"]), auth["linkHeader"])
for row in link["source"]:
    relative = pathlib.Path(row["path"])
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("invalid LINK input path")
    write(args.output / "link-source" / relative, checked(args.link.parent / "source" / relative, row))
for row in link["artifacts"]:
    path = pathlib.Path(row["path"])
    write(libraries / path.name, checked(path, row))
new_header = (libraries / "private_client_v1.h").read_bytes()


def tokens(data):
    return re.sub(r"\s+", " ", re.sub(r"/\*.*?\*/", " ", data.decode(), flags=re.S)).strip()


if tokens(old_header) != tokens(new_header):
    raise ValueError("Auth and LINK private ABI differ beyond comments")
write(auth_dir / "private_client_v1.h", new_header)
for row in producer["files"]:
    path = pathlib.Path(row["path"])
    data = checked(path, row)
    write(args.output / "producer-inputs" / row["relative"], data)
    if path.suffix in (".cpp", ".hpp") and "/producer/" in str(path):
        write(producer_dir / path.name, data)
here = pathlib.Path(__file__).resolve().parent
for name in ("native-producer-link.cpp", "native-producer-normal.cpp"):
    write(args.output / name, (here / name).read_bytes())
driver_pins = []
for name in ("native-producer-link.cpp", "native-producer-normal.cpp", "run-native-producer-link.py"):
    data = (here / name).read_bytes()
    driver_pins.append({"path": name, "bytes": len(data), "sha256": digest(data)})
write(args.output / "driver-inputs.json", (json.dumps(driver_pins, indent=2) + "\n").encode())
commands = []


def run(name, command, env=None):
    commands.append(command)
    (args.output / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
    with (args.output / name).open("wb") as output:
        subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, env=env, check=True, timeout=45)


base = ["/usr/bin/clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-pthread",
        "-I" + str(auth_dir), "-I" + str(producer_dir),
        str(auth_dir / "pay_native_kernel.cpp"), str(auth_dir / "pay_native_source_lease.cpp")]
base += [str(producer_dir / name) for name in ("pay_native_requests.cpp", "pay_native_link_channel.cpp", "pay_native_capture.cpp")]
run("compile-public.log", base + [str(args.output / "native-producer-link.cpp"), "-L" + str(libraries),
    "-lynx_link_private_client_fixture", "-o", str(args.output / "public-unix-test")])
environment = dict(os.environ)
environment["DYLD_LIBRARY_PATH"] = str(libraries)
environment["TMPDIR"] = "/tmp"  # original private fixture needs a short owned Unix path
run("public-unix-result.json", [str(args.output / "public-unix-test")], environment)
public = json.loads((args.output / "public-unix-result.json").read_bytes())
assert public["passed"] and public["actualUnixPackets"] == 10
pkg_env = dict(os.environ)
pkg_env["PKG_CONFIG_PATH"] = "/opt/homebrew/opt/openssl@3/lib/pkgconfig"
openssl = shlex.split(subprocess.check_output(["pkg-config", "--libs", "openssl"], env=pkg_env).decode())
run("compile-normal-archive.log", base + [str(args.output / "native-producer-normal.cpp"),
    str(libraries / "libynx_link_private_client.a"), "-framework", "CoreFoundation", "-framework", "Security",
    "-lresolv"] + openssl + ["-o", str(args.output / "normal-archive-test")])
run("normal-archive-result.json", [str(args.output / "normal-archive-test")])
normal = json.loads((args.output / "normal-archive-result.json").read_bytes())
symbols = subprocess.check_output(["nm", "-g", str(args.output / "normal-archive-test")]).decode()
(args.output / "normal-symbols.log").write_text(symbols)
assert " T _ynx_wallet_capture_original_pay_channel_v1" in symbols
assert "_ynx_link_private_fixture_" not in symbols
result = {"passed": True, "publicActualUnix": public, "normalArchive": normal,
          "normalHasNoFixtureSymbols": True, "samePrivateABI": True,
          "normalStartupProducerComplete": False, "actualMainMatched": False,
          "installed": False, "RootAdmission": False, "SourceAdmission": False, "realFunds": False}
(args.output / "RESULT.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
