#!/usr/bin/env python3
"""Call the actual fixed PUBLIC response policy with inert WebKit callback fixtures."""

import argparse
import hashlib
import json
from pathlib import Path
import platform

from test_r2_path_sample import run
from test_worker_ownership import segment


FIXTURE = r'''
import CoreFoundation
import Darwin
import Foundation

@MainActor final class WKWebView {}
enum WKNavigationResponsePolicy { case allow, cancel }
struct WKNavigationResponse {
    let response: URLResponse
    let isForMainFrame: Bool
    let canShowMIMEType: Bool
}
@MainActor final class CaptureTrace {
    var rows: [[String: Any]] = []
    func record(_ event: String, _ fields: [String: Any]) { rows.append(fields.merging(["event":event]) { _, event in event }) }
}
@MainActor final class ActualPublicResponse {
    enum Failure { case targetRejected }
    var closing = false
    var web: WKWebView? = WKWebView()
    var routedBackendReady = true
    var responseStatus: Int?
    let adapter = (publicRuntimeTrace: Optional(CaptureTrace()), unused: false)
    var rejected = false
    func record(_ failure: Failure) { rejected = true }
    func shutdown() async -> Bool { true }
__RESPONSE__
}

@main struct Probe {
    @MainActor static func main() {
        let url = URL(string: TorPublicSearchDiagnosticPolicy.target)!
        let cases: [(String, URLResponse, Bool, Bool, String?)] = [
            ("unknownHTTP", URLResponse(url: url, mimeType: "text/html", expectedContentLength: 1, textEncodingName: nil), true, true, nil),
            ("200", http(url, 200), true, true, "htmlCandidate"),
            ("202", http(url, 202), true, true, "acceptedNeedsReview"),
            ("403", http(url, 403), true, true, "accessRefused"),
            ("429", http(url, 429), true, true, "rateLimited"),
            ("500", http(url, 500), true, true, "otherHTTP"),
            ("subframe", http(url, 200), false, true, nil),
            ("attachment", http(url, 200, attachment: "attachment"), true, true, nil),
            ("lostBackend", http(url, 200), true, false, nil),
        ]
        var checks: [String: Bool] = [:]
        for (name, value, main, backend, observation) in cases {
            let controller = ActualPublicResponse()
            controller.routedBackendReady = backend
            var decision: WKNavigationResponsePolicy?
            controller.webView(controller.web!, decidePolicyFor: .init(response: value, isForMainFrame: main, canShowMIMEType: true)) { decision = $0 }
            let captured = controller.adapter.publicRuntimeTrace?.rows ?? []
            if let observation, let value = value as? HTTPURLResponse {
                checks[name] = decision == .allow && controller.responseStatus == value.statusCode
                    && captured.count == 1 && captured[0]["event"] as? String == "publicSearchHTTPResponse"
                    && captured[0]["httpStatus"] as? Int == value.statusCode && captured[0]["observation"] as? String == observation
            } else {
                checks[name] = decision == .cancel && controller.responseStatus == nil && captured.isEmpty
            }
        }
        print(String(decoding: try! JSONSerialization.data(withJSONObject: checks, options: [.sortedKeys]), as: UTF8.self))
        exit(checks.values.allSatisfy { $0 } ? 0 : 1)
    }
    static func http(_ url: URL, _ status: Int, attachment: String? = nil) -> HTTPURLResponse {
        var headers = ["Content-Type": "text/html"]
        headers["Content-Disposition"] = attachment
        return HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
    }
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = Path(__file__).resolve().parents[3]/'native/Sources/YNXBrowserNative/TorPublicSearchDiagnostic.swift'
    raw = source.read_bytes()
    (out/source.name).write_bytes(raw)
    text = raw.decode()
    swift = out/'ActualPublicResponse.swift'
    swift.write_text(FIXTURE.replace('__RESPONSE__', segment(text, 'func webView(_ webView: WKWebView, decidePolicyFor response:'))
                     +'\n'+segment(text, 'enum TorPublicSearchDiagnosticPolicy {'))
    binary = out/'actual-response'
    commands = {'compile':run(['/usr/bin/xcrun', 'swiftc', '-swift-version', '6', '-j', '1',
        '-target', f'{platform.machine()}-apple-macosx14.0', '-parse-as-library',
        '-module-cache-path', str(out/'module-cache'), str(swift), '-o', str(binary)], out, 'compile', 30)}
    if commands['compile']['originalWait'] == 0:
        commands['probe'] = run([str(binary)], out, 'probe', 8)
    checks = json.loads((out/'probe.stdout').read_text()) if 'probe' in commands else {}
    passed = (len(checks)==9 and all(checks.values()) and all(row['originalWait']==0 for row in commands.values())
              and source.read_bytes()==raw)
    (out/'RESULT.json').write_text(json.dumps(dict(status='PASS' if passed else 'FAIL', checks=checks, processes=commands,
        sourceSHA256=hashlib.sha256(raw).hexdigest(), realWebKitNetwork='NOT_RUN', realDDG='NOT_RUN'), indent=2)+'\n')
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
