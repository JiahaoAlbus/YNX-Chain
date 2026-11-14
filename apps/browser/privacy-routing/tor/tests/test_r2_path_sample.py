#!/usr/bin/env python3
"""Compile the actual R2 path sampler with a deterministic callback fixture."""

import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import time

from test_worker_ownership import segment


FIXTURE = '''
import Foundation
import Darwin

struct TorPublicObservablePath: Sendable {
    let kind: String
    init(_ path: String) { kind = path }
}

@MainActor final class NWPathMonitor {
    static var starts = 0
    static var cancels = 0
    var pathUpdateHandler: ((String) -> Void)?
    func start(queue: DispatchQueue) {
        Self.starts += 1
        // Run after the caller suspends, as the SDK callback would.
        Task { @MainActor [self] in
            await Task.yield()
            pathUpdateHandler?("synthetic-public-path")
        }
    }
    func cancel() { Self.cancels += 1 }
}

@main struct ActualR2SamplerProbe {
    @MainActor static func main() async {
        let before = await PathSample().read()
        let after = await PathSample().read()
        let pass = before?.kind == "synthetic-public-path" && after?.kind == "synthetic-public-path"
            && NWPathMonitor.starts == 2 && NWPathMonitor.cancels == 2
        print("before=\\(before != nil) after=\\(after != nil) starts=\\(NWPathMonitor.starts) cancels=\\(NWPathMonitor.cancels)")
        exit(pass ? 0 : 1)
    }
__PATH_SAMPLE__
}
'''


def run(argv, output, stage, limit):
    start = time.monotonic()
    with (output/f'{stage}.stdout').open('xb') as stdout, (output/f'{stage}.stderr').open('xb') as stderr:
        child = subprocess.Popen(argv, stdout=stdout, stderr=stderr)
        timed_out = False
        try:
            child.wait(timeout=limit)
        except subprocess.TimeoutExpired:
            timed_out = True
            child.kill()
            child.wait(timeout=2)
    return dict(argv=argv, pid=child.pid, originalWait=child.returncode, reaped=child.poll() is not None,
                timedOut=timed_out, seconds=time.monotonic()-start)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(__file__).with_name('R2AdjacentCLI.swift')
    raw = source.read_bytes()
    actual = segment(raw.decode(), '@MainActor final class PathSample')
    probe = output/'ActualR2SamplerProbe.swift'
    probe.write_text(FIXTURE.replace('__PATH_SAMPLE__', actual))
    (output/source.name).write_bytes(raw)
    exe = output/'r2-path-sampler-probe'
    stages = {'compile': run(['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-O', '-j', '1',
                '-target', f'{platform.machine()}-apple-macosx14.0', '-parse-as-library',
                '-module-cache-path', str(output/'module-cache'), str(probe), '-o', str(exe)], output, 'compile', 30)}
    if stages['compile']['originalWait'] == 0:
        stages['probe'] = run([str(exe)], output, 'probe', 8)
    diagnostics = (output/'compile.stderr').read_text()
    warning = 'weak reference will always be nil' in diagnostics
    passed = (not warning and 'probe' in stages and all(s['originalWait'] == 0 and s['reaped']
              for s in stages.values()) and source.read_bytes() == raw)
    record = dict(status='PASS' if passed else 'FAIL', weakTemporaryDiagnostic=warning,
                  sourceSHA256=hashlib.sha256(raw).hexdigest(), controls=stages,
                  actualNWPathMonitor='NOT_RUN', torBackend='NOT_RUN', network='NOT_RUN')
    (output/'RESULT.json').write_text(json.dumps(record, indent=2)+'\n')
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
