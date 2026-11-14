#!/usr/bin/env python3
"""Fixed PUBLIC diagnostic rejection + new shutdown consumer; no UI/backend/network."""
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
    args = parser.parse_args(); out = args.output.resolve(); out.mkdir(parents=True, mode=0o700, exist_ok=False)
    browser = Path(__file__).resolve().parents[3]
    source = browser/'native/Sources/YNXBrowserNative/TorPublicSearchDiagnostic.swift'
    worker = browser/'native/Sources/YNXBrowserNative/TorProtectedRouteProvider.swift'
    probe = Path(__file__).with_name('PublicSearchDiagnosticDeltaProbe.swift')
    inputs = {}
    for p in [source, worker, probe]:
        raw=p.read_bytes(); inputs[str(p.relative_to(browser))]=hashlib.sha256(raw).hexdigest();(out/p.name).write_bytes(raw)
    text=source.read_text()
    actual=out/'ActualPublicDiagnostic.swift'
    actual.write_text('import Foundation\nimport CoreFoundation\n'+segment(text,'enum TorPublicSearchDiagnosticPolicy {')+'\n'+segment(worker.read_text(),'@MainActor final class TorStartupOwnership<Value: Sendable>')+'''
@MainActor extension FixtureAdapter {
    var publicKnownManagedTransportAbsence: Bool? { nil }
    var publicRuntimeTrace: FixtureTrace? { nil }
    var publicBackendFatal: FixtureFatal? { nil }
}
@MainActor final class FixtureTrace {
    func record(_ event: String, _ fields: [String: Any]) {}
    func checkpoint(_ event: String) {}
}
struct FixtureFatal { let kind: String }
@MainActor final class FixtureNymRuntime {
    var cleanupConfirmed: Bool { false }
    func stop() async -> Bool { false }
}
@MainActor final class ActualPublicDiagnostic {
'''+segment(text,'enum Failure:')+'''
    let adapter = FixtureAdapter()
    let worker = TorStartupOwnership<Void>()
    var outerStart: Task<Void,Never>?
    var shutdownTask: Task<Bool,Never>?
    var nymRuntime: FixtureNymRuntime?
    var snowflakeLaunch: Bool?
    var originalBackendPID: Int32?
    var managedTransportExitObservation = "NOT_OBSERVED"
    var backendScopeCurrent = true
    static func claimsNym() -> Bool { false }
    var pendingStart = false
    var cleanupUnknown = false
    var closing = false
    var claimedNavigation = false
    var web: WKWebView? = WKWebView()
    var ruleStore: Int?
    var cancelledDownloads: [Int:Int] = [:]
    var firstFailure: Failure?
    var firstErrorSummary: String?
    let status = FixtureStatus()
    func fence() { closing = true; web = nil }
    func observeFailure(_ failure: Failure) { record(failure) }
'''+ '\n'.join(segment(text,n) for n in ['var cleanupConfirmed: Bool {', 'private var backendDiagnosticFailure:', 'private var routedBackendReady:', 'private func record(', 'func shutdown() async -> Bool', 'func webView(_ webView: WKWebView, decidePolicyFor action:'])+'\n}\n')
    (out/'inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
    commands=[('compile',['/usr/bin/xcrun','swiftc','-swift-version','6','-target',platform.machine()+'-apple-macosx14.0','-j','1','-module-cache-path',str(out/'module-cache'),'-parse-as-library',str(actual),str(out/probe.name),'-o',str(out/'public-delta')],90),('new-delta',[str(out/'public-delta')],35)]
    events=[];failure=None
    for name,command,budget in commands:
        start=time.monotonic();p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE);timeout=False
        try:stdout,stderr=p.communicate(timeout=budget)
        except subprocess.TimeoutExpired:
            timeout=True;p.terminate()
            try:stdout,stderr=p.communicate(timeout=2)
            except subprocess.TimeoutExpired:p.kill();stdout,stderr=p.communicate(timeout=2)
        (out/(name+'.stdout')).write_bytes(stdout);(out/(name+'.stderr')).write_bytes(stderr)
        events.append(dict(name=name,command=command,pid=p.pid,returncode=p.returncode,timeout=timeout,reaped=p.poll() is not None,seconds=time.monotonic()-start))
        if timeout or p.returncode:failure=name+' failed; first cause preserved';break
    drift=[r for r,d in inputs.items() if hashlib.sha256((browser/r).read_bytes()).hexdigest()!=d]
    if drift and failure is None:failure='source drift'
    result=dict(status='FAIL' if failure else 'PASS',firstCause=failure,sourceDrift=drift,processes=events,scope='actual fixed PUBLIC policy/action/shutdown declarations with Tor memory-only handles; Nym execution not exercised',actualWKArtiManagedPTDDGNetwork='NOT_RUN',privacyQualification='NOT_CONSTRUCTED',oldGroupsRepeated=False)
    (out/'RESULT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));raise SystemExit(1 if failure else 0)


if __name__=='__main__':main()
