#!/usr/bin/python3
"""Compile new P06 producer against a hash-checked frozen original Auth boundary."""
import argparse
import hashlib
import json
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("boundary", type=pathlib.Path)
parser.add_argument("output", type=pathlib.Path)
parser.add_argument("--request-only", action="store_true")
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
boundary_bytes = args.boundary.read_bytes()
boundary = json.loads(boundary_bytes)
source = pathlib.Path(boundary["sourceRoot"])
if not source.is_absolute():
    raise ValueError("absolute original source root required")
frozen = args.output / "auth"
direct_source = (source / "pay_native_kernel.hpp").is_file()
for row in boundary["files"]:
    declared = pathlib.Path(row["path"])
    path = declared if declared.is_absolute() else source / declared
    try:
        relative = path.relative_to(source)
        if direct_source:
            relative = pathlib.Path("source") / relative
    except ValueError:
        relative = pathlib.Path("declared-extras") / path.relative_to(args.boundary.parent)
    if ".." in relative.parts:
        raise ValueError("invalid original source path")
    data = path.read_bytes()
    if len(data) != row["bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
        raise ValueError("original boundary source changed: " + str(relative))
    target = frozen / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
if "linkHeader" in boundary:
    row = boundary["linkHeader"]
    data = pathlib.Path(row["path"]).read_bytes()
    if len(data) != row["bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
        raise ValueError("matching original LINK header changed")
    (frozen / "source/private_client_v1.h").write_bytes(data)
(args.output / "AUTH_BOUNDARY.json").write_bytes(boundary_bytes)
own_source = pathlib.Path(__file__).resolve().parents[1] / "producer"
own = args.output / "producer"
own.mkdir()
own_pins = []
for path in sorted(own_source.iterdir()):
    if path.suffix not in (".cpp", ".hpp"):
        continue
    data = path.read_bytes()
    (own / path.name).write_bytes(data)
    own_pins.append({"path": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
(args.output / "P06_SOURCE_INPUTS.json").write_text(json.dumps(own_pins, indent=2) + "\n")
commands = []
if not args.request_only:
    for name in ("pay_native_runtime_private.hpp", "pay_native_channel_private.hpp", "private_client_v1.h"):
        if not (frozen / "source" / name).is_file():
            raise ValueError("complete matching Auth/LINK producer input required: " + name)
    for name in ("pay_native_requests.cpp", "pay_native_link_channel.cpp", "pay_native_capture.cpp"):
        command = ["/usr/bin/clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-pthread",
                   "-I" + str(frozen / "source"), "-I" + str(own), "-c", str(own / name),
                   "-o", str(args.output / (name + ".o"))]
        commands.append(command)
        with (args.output / (name + ".log")).open("w") as output:
            subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=True)
command = ["/usr/bin/clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-pthread",
           "-I" + str(frozen / "source"), "-I" + str(own),
           str(frozen / "source/pay_native_kernel.cpp"), str(own / "pay_native_requests.cpp"),
           str(own / "requests.test.cpp"), "-o", str(args.output / "requests-test")]
with (args.output / "commands.json").open("w") as output:
    json.dump(commands + [command], output, indent=2)
with (args.output / "compile.log").open("w") as output:
    subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=True)
with (args.output / "tests.log").open("w") as output:
    subprocess.run([str(args.output / "requests-test")], stdout=output, stderr=subprocess.STDOUT, check=True)
print("PASS fixed5 request controls" + ("" if args.request_only else " + all3 production Werror objects") +
      "; no Root/Source/Native admission or network dispatch")
