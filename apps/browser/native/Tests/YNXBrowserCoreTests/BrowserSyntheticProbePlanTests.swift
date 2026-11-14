import Foundation
import Testing
@testable import YNXBrowserCore

struct BrowserSyntheticProbePlanTests {
    @Test func publicFixtureIsBoundToNonceOriginAndHTTPS() throws {
        let origin = "https://fixture.ynx.invalid"
        let digest = String(repeating: "a", count: 64)
        let fixture: [String: Any] = ["origins": [origin], "nonce": "sample", "responseSHA256": digest, "downloadSHA256": digest]
        let bootstrap: [String: Any] = ["path": "/tmp/owned/bootstrap.html", "sha256": digest, "baseURL": origin]
        let input: [String: Any] = ["runID": "sample", "initialURL": origin + "/ynx-route-probe/sample/https", "routePort": 9150,
            "allowedHosts": ["fixture.ynx.invalid"], "durationSeconds": 60, "publicFixture": fixture, "bootstrap": bootstrap,
            "readinessFile": "/tmp/owned/ready.json", "phaseControlFile": "/tmp/owned/phase.json"]
        func decode(_ value: [String: Any]) throws -> BrowserSyntheticProbePlan {
            try JSONDecoder().decode(BrowserSyntheticProbePlan.self, from: JSONSerialization.data(withJSONObject: value))
        }
        let plan = try decode(input); try plan.validate(expectedRunID: "sample")
        #expect(plan.allows(URL(string: origin + "/ynx-route-probe/sample/https")!))
        #expect(plan.allows(URL(string: "wss://fixture.ynx.invalid/ynx-route-probe/sample/wss")!))
        for url in [origin + "/", origin + "/ynx-route-probe/other/https", "https://fixture.ynx.invalid:8443/ynx-route-probe/sample/https", "http://fixture.ynx.invalid/ynx-route-probe/sample/https"] { #expect(!plan.allows(URL(string: url)!)) }
        var wrongNonce = input; var changed = fixture; changed["nonce"] = "another"; wrongNonce["publicFixture"] = changed
        #expect(throws: PrivacyRouteError.unsafeTarget) { try decode(wrongNonce).validate(expectedRunID: "sample") }
        var noGate = input; noGate.removeValue(forKey: "readinessFile")
        #expect(throws: PrivacyRouteError.unsafeTarget) { try decode(noGate).validate(expectedRunID: "sample") }
        var credentials = input; var unsafe = bootstrap; unsafe["baseURL"] = "https://user:secret@fixture.ynx.invalid/"; credentials["bootstrap"] = unsafe
        #expect(throws: PrivacyRouteError.unsafeTarget) { try decode(credentials).validate(expectedRunID: "sample") }
    }
    @Test func syntheticOnlyScopeAndTLS() throws {
        let json = #"{"runID":"sample","initialURL":"https://sample.leak.test:8443/probe","routePort":9150,"allowedHosts":["sample.leak.test","cross.sample.leak.test"],"durationSeconds":20}"#
        let plan = try JSONDecoder().decode(BrowserSyntheticProbePlan.self, from: Data(json.utf8))
        try plan.validate(expectedRunID: "sample")
        #expect(plan.allows(URL(string: "wss://cross.sample.leak.test/wss")!))
        for value in ["https://duckduckgo.com/", "https://sample.leak.test.evil.test/", "http://sample.leak.test/", "file:///etc/passwd", "https://u:p@sample.leak.test/"] { #expect(!plan.allows(URL(string: value)!)) }
        #expect(throws: PrivacyRouteError.unsafeTarget) { try plan.validate(expectedRunID: "different-run") }
        let bad = json.replacingOccurrences(of: "sample.leak.test", with: "duckduckgo.com")
        let ordinary = try JSONDecoder().decode(BrowserSyntheticProbePlan.self, from: Data(bad.utf8))
        #expect(throws: PrivacyRouteError.unsafeTarget) { try ordinary.validate(expectedRunID: "sample") }
    }
}
