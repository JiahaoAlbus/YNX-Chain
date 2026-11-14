#!/usr/bin/env python3
"""Offline same-provider refusal classification; optional immutable prior receipt replay."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--original-html-receipt', type=Path)
    parser.add_argument('--legacy-counterexample', action='store_true')
    args = parser.parse_args(); output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    inputs = {}
    sources = [Path(__file__).with_name('BackendResponse.swift'), Path(__file__).with_name('ServiceRefusalDeltaProbe.swift')]
    for source in sources:
        raw = source.read_bytes(); inputs[source.name] = hashlib.sha256(raw).hexdigest()
        (output / source.name).write_bytes(raw)
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    flags = ['--legacy-counterexample'] if args.legacy_counterexample else []
    receipt_hashes = {}
    if args.original_html_receipt:
        destination = output / 'prior-public-receipt'; destination.mkdir(mode=0o700)
        pins = {'ddg-hop1.body': '77aa0703d081062ae313cad05f0d3a92f21333cacdc71844599f9ddbbeca2522',
                'ddg-hop1.curl.json': 'dea5f61c257d996dd8c1b937fda9d78e2eac4feda158f00bfb08e0955da8ebef'}
        for name, digest in pins.items():
            raw = (args.original_html_receipt / name).read_bytes()
            if hashlib.sha256(raw).hexdigest() != digest: raise ValueError('original public receipt changed')
            (destination / name).write_bytes(raw); receipt_hashes[name] = digest
        flags += ['--receipt', str(destination)]
    commands = [('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', 'arm64-apple-macosx14.0', '-j', '1',
                             '-module-cache-path', str(output / 'module-cache'), '-parse-as-library'] +
                [str(output / p.name) for p in sources] + ['-o', str(output / 'refusal-delta')], 90),
                ('new-delta', [str(output / 'refusal-delta')] + flags, 8)]
    events, failure = [], None
    for name, command, budget in commands:
        start = time.monotonic(); process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        timeout = False
        try: stdout, stderr = process.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout = True; process.terminate()
            try: stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill(); stdout, stderr = process.communicate(timeout=2)
        (output / (name + '.stdout')).write_bytes(stdout); (output / (name + '.stderr')).write_bytes(stderr)
        events.append(dict(name=name, command=command, pid=process.pid, returncode=process.returncode, timeout=timeout,
                           reaped=process.poll() is not None, seconds=time.monotonic() - start))
        if timeout or process.returncode:
            failure = name + ' failed; first error preserved'; break
    drift = [p.name for p in sources if hashlib.sha256(p.read_bytes()).hexdigest() != inputs[p.name]]
    if drift and failure is None: failure = 'source drift'
    result = dict(status='FAIL' if failure else ('BUG_REPRODUCED' if args.legacy_counterexample else 'PASS'),
                  firstCause=failure, sourceDrift=drift, processes=events, priorReceiptPins=receipt_hashes,
                  newRequests=0, vendorNetworkGUI='NOT_RUN', currentRouteOrSearchQualification='NOT_RUN', old17Repeated=False)
    (output / 'RESULT.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2)); raise SystemExit(1 if failure else 0)


if __name__ == '__main__':
    main()
