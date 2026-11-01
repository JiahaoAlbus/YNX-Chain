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
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
boundary_bytes = args.boundary.read_bytes()
boundary = json.loads(boundary_bytes)
source = pathlib.Path(boundary["sourceRoot"])
if not source.is_absolute():
    raise ValueError("absolute original source root required")
frozen = args.output / "auth"
for row in boundary["files"]:
    relative = pathlib.Path(row["path"])
    if relative.is_absolute():
        relative = relative.relative_to(source)
    if ".." in relative.parts:
        raise ValueError("invalid original source path")
    data = (source / relative).read_bytes()
    if len(data) != row["bytes"] or hashlib.sha256(data).hexdigest() != row["sha256"]:
        raise ValueError("original boundary source changed: " + str(relative))
    target = frozen / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
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
command = ["/usr/bin/clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-pthread",
           "-I" + str(frozen / "source"), "-I" + str(own),
           str(frozen / "source/pay_native_kernel.cpp"), str(own / "pay_native_requests.cpp"),
           str(own / "requests.test.cpp"), "-o", str(args.output / "requests-test")]
with (args.output / "commands.json").open("w") as output:
    json.dump(command, output, indent=2)
with (args.output / "compile.log").open("w") as output:
    subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=True)
with (args.output / "tests.log").open("w") as output:
    subprocess.run([str(args.output / "requests-test")], stdout=output, stderr=subprocess.STDOUT, check=True)
print("PASS new fixed5 request controls; no Root/Source/Native admission or network dispatch")
