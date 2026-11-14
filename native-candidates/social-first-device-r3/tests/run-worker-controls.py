#!/usr/bin/env python3
"""Compile the actual registry slice with explicit controlled test doubles."""
import os
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
output = Path(os.environ["BUILD_DIR"]).resolve()
output.mkdir(parents=True, exist_ok=True)
source = (root / "source/native/rust/ynx-native-operation/src/source_first_prepared_holder_ffi.rs").read_text()
start = source.index('#[cfg(feature="abi5-final-native-link")]\npub(super)mod server_participant{')
end = source.index('\n// Actual holder-to-collector transfer', start)
module = source[start:end].rstrip()
if not module.endswith('}'):
    raise RuntimeError("unexpected server module boundary")
cases = (root / "tests/server_cases.inc").read_text()
cases += (root / "tests/worker_pin_tests.inc").read_text()
(output / "test_server_completed_r5_module.rs").write_text(module[:-1] + cases + '}\n')
shutil.copyfile(root / "tests/server_completed_r5_controls.rs", output / "server_completed_r5_controls.rs")
compiler = os.environ.get("RUSTC", "rustc")
subprocess.run([compiler, "--edition=2024", "--test",
                '--cfg', 'feature="abi5-final-native-link"',
                '--cfg', 'feature="source-collector-bridge"',
                '--cfg', 'feature="source-server-collector"',
                "server_completed_r5_controls.rs", "-o", "worker-pin-controls"],
               cwd=output, check=True)
subprocess.run([str(output / "worker-pin-controls"), "--test-threads=1"], check=True)
