#!/usr/bin/env python3
"""Actual routed-page search callbacks only; offline same-URL/route-loss/deadline delta."""
import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import time
from test_worker_ownership import segment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--legacy-counterexample', action='store_true')
    args = parser.parse_args(); output = args.output.resolve(); output.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    page = browser / 'native/Sources/YNXBrowserNative/RoutedBrowserPage.swift'
    probe = Path(__file__).with_name('SearchObservationDeltaProbe.swift')
    inputs = {}
    for path in [page, probe]:
        raw = path.read_bytes(); inputs[str(path.relative_to(browser))] = hashlib.sha256(raw).hexdigest()
        (output / path.name).write_bytes(raw)
    source = page.read_text()
    declarations = [segment(source, n) for n in ['private func observeSearchWebsite(', 'private func inspectSearchDocument(', 'func webView(_ webView: WKWebView, didStartProvisionalNavigation']]
    if not args.legacy_counterexample:
        declarations += [segment(source, n) for n in ['private func invalidateSearchObservation(', 'private func searchObservationIsCurrent(', 'private func completeSearchObservation(']]
    inspect_call = 'inspectSearchDocument(url)' if args.legacy_counterexample else 'inspectSearchDocument(url, generation: searchGeneration, navigation: activeNavigation)'
    actual = output / 'ActualSearchObservation.swift'
    actual.write_text('''import Foundation
import CoreFoundation
@MainActor final class ActualSearchObservation {
    var blocked = false
    var web: WKWebView?
    let status = FixtureStatus()
    var activeNavigation: ObjectIdentifier?
    var downloadNavigation: ObjectIdentifier?
    var searchObservation: Task<Void, Never>?
    var siteResponseStatus: Int?
    var searchGeneration = UUID()
    var searchObservationFinished = false
    var checks: [PrivacyRouteReadiness.Check] = []
    var allowed = true
    var authorizations = 0
    var failAtAuthorization: Int?
    init(url: URL) { web = WKWebView(url: url) }
    func authorizeProtection() throws {
        authorizations += 1
        guard allowed, failAtAuthorization != authorizations else { throw FixtureFailure.revoked }
    }
    func block(_ reason: String) { blocked = true; searchObservation?.cancel() }
    func recordSearchAvailability(_ check: PrivacyRouteReadiness.Check) { checks.append(check) }
    func inspectFixture(_ url: URL) { ''' + inspect_call + ''' }
    func observeFixture(_ url: URL) { observeSearchWebsite(url) }
''' + '\n'.join(declarations) + '\n}\n')
    (output / 'inputs.json').write_text(json.dumps(inputs, indent=2) + '\n')
    events, failure = [], None
    commands = [('compile', ['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-target', platform.machine()+'-apple-macosx14.0', '-j', '1', '-module-cache-path', str(output/'module-cache'), '-parse-as-library', str(actual), str(output/probe.name), '-o', str(output/'search-delta')], 90), ('new-delta', [str(output/'search-delta')] + (['--legacy-counterexample'] if args.legacy_counterexample else []), 12)]
    for name, command, budget in commands:
        start = time.monotonic(); p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE); timeout = False
        try: stdout, stderr = p.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout = True; p.terminate()
            try: stdout, stderr = p.communicate(timeout=2)
            except subprocess.TimeoutExpired: p.kill(); stdout, stderr = p.communicate(timeout=2)
        (output/(name+'.stdout')).write_bytes(stdout); (output/(name+'.stderr')).write_bytes(stderr)
        events.append(dict(name=name, command=command, pid=p.pid, returncode=p.returncode, timeout=timeout, reaped=p.poll() is not None, seconds=time.monotonic()-start))
        if timeout or p.returncode: failure = name+' failed; first cause retained'; break
    drift = [r for r,d in inputs.items() if hashlib.sha256((browser/r).read_bytes()).hexdigest() != d]
    if drift and failure is None: failure = 'source drift'
    result = dict(status='FAIL' if failure else ('BUG_REPRODUCED' if args.legacy_counterexample else 'PASS'), firstCause=failure, sourceDrift=drift, processes=events, scope='actual search callback/observation/navigation declarations, PUBLIC in-memory WK/route doubles', realWK='NOT_RUN', installedDDG='NOT_RUN', LeakSafe='NOT_RUN', networkGUIVendor='NOT_RUN', oldGroupsRepeated=False)
    (output/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(1 if failure else 0)


if __name__ == '__main__': main()
