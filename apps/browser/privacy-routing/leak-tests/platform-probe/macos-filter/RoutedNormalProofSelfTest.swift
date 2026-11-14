import Foundation

private enum TestFailure: Error { case failed(String) }
@main private struct RoutedNormalProofSelfTest {
    static func main() throws {
        var checks: [String] = []
        func check(_ value: Bool, _ label: String) throws {
            guard value else { throw TestFailure.failed(label) }; checks.append(label)
        }
        func denied(_ label: String, _ operation: () throws -> Void) throws {
            do { try operation(); throw TestFailure.failed(label) }
            catch is RoutedNormalProofFailure { checks.append(label) }
        }
        let hash = String(repeating: "a", count: 64), root = "root-public-fixture", proof = "proof-public-fixture"
        let raw: [String: Any] = ["rootRunID":root,"proofRunID":proof,"mode":"nym","epoch":UUID().uuidString,
            "providerGeneration":UUID().uuidString,"profileID":"ynx-route-bundled-PUBLIC","profileSHA256":hash,
            "rootAuditTokenSHA256":hash,"executableSHA256":hash,"purpose":"normal-nym-bootstrap-proof"]
        func binding(_ object: [String:Any]) throws -> RoutedNormalProofBinding {
            try JSONDecoder().decode(RoutedNormalProofBinding.self, from: JSONSerialization.data(withJSONObject: object))
        }
        let b = try binding(raw); try b.validate()
        try check(b.rootRunID != b.proofRunID, "separate-root-and-proof-run-lookup-DATA")
        let origin = URL(string:"https://controlled.example.com")!
        let url = URL(string:origin.absoluteString + "/ynx-route-probe/" + proof + "/proof")!
        let scope = RoutedNormalProofScope(proofURL:url,reviewedOrigin:origin,responseSHA256:hash,routePort:19160)
        try scope.validate(binding:b)
        try check(scope.routePort == 19160, "scope-validated-DATA-only-no-endpoint-authority")
        for host in ["a..com", "a.-bad.com", "a.bad-.com", String(repeating:"a",count:64)+".com", "a.local", "a.localhost", "a.invalid", "a.test", "a.onion", "a.internal", "a.home", "a.arpa", "127.0.0.1", "a.123", "a..", "-bad.com"] {
            try denied("reject-host-" + host) {
                let o=URL(string:"https://"+host)!, u=URL(string:o.absoluteString+"/ynx-route-probe/"+proof+"/proof")!
                try RoutedNormalProofScope(proofURL:u,reviewedOrigin:o,responseSHA256:hash,routePort:19160).validate(binding:b)
            }
        }
        for text in ["http://controlled.example.com/ynx-route-probe/\(proof)/proof",
                     origin.absoluteString+"/ynx-route-probe/\(root)/proof",
                     origin.absoluteString+"/ynx-route-probe/\(proof)/%70roof",
                     url.absoluteString+"?probe=baseline-https", url.absoluteString+"#fragment"] {
            try denied("reject-nonexact-target-"+text) { try scope.validate(URLRequest(url:URL(string:text)!),binding:b) }
        }
        var post=URLRequest(url:url);post.httpMethod="POST"
        try denied("reject-POST") { try scope.validate(post,binding:b) }
        var body=URLRequest(url:url);body.httpBody=Data([1])
        try denied("reject-GET-body") { try scope.validate(body,binding:b) }
        for (key, replacement) in [("purpose","synthetic"),("mode","tor"),("profileID","foreign scope"),("profileSHA256","not-hash"),("rootRunID","bad/run")] {
            var other=raw;other[key]=replacement
            try denied("reject-binding-"+key) { try binding(other).validate() }
        }
        let session=UUID(), otherSession=UUID()
        func request(_ op:String,_ seq:UInt64,_ bind:RoutedNormalProofBinding?=nil,_ target:URL?=nil) -> RoutedNormalProofRequest {
            .init(schema:"P05_NORMAL_PROOF_REQUEST_V1",operation:op,nonce:UUID().uuidString,sequence:seq,binding:bind ?? b,
                  ownAuditToken:Data(repeating:1,count:32),helperAuditTokenSHA256:hash,readyBackendAuditTokenSHA256:nil,
                  readyMarkerSHA256:nil,scope:nil,requestURL:target,requestMethod:target==nil ? nil : "GET")
        }
        var state=RoutedNormalProofLeaseState(binding:b,scope:scope,graphRevision:1,parentSession:UUID())
        try state.accept(request("begin",1),session:session,now:10)
        try check(state.live(now:749_999_999+10) && !state.live(now:750_000_000+10) && !state.live(now:9), "strict-monotonic-child-deadline-DATA")
        try denied("wrong-child-session") { try state.accept(request("heartbeat",2),session:otherSession,now:11) }
        try denied("replayed-sequence") { try state.accept(request("heartbeat",1),session:session,now:11) }
        var changed=raw;changed["profileID"]="different"
        let wrong=try binding(changed)
        try denied("changed-scope-binding") { try state.accept(request("heartbeat",2,wrong),session:session,now:11) }
        try denied("wrong-target-no-authorize") { try state.accept(request("authorize",2,nil,origin),session:session,now:11) }
        try check(!state.authorized, "rejected-target-does-not-set-authorized-DATA")
        try state.accept(request("authorize",2,nil,url),session:session,now:11)
        try denied("second-request-not-permitted") { try state.accept(request("authorize",3,nil,url),session:session,now:12) }
        try denied("expired-child-cannot-heartbeat") { try state.accept(request("heartbeat",3),session:session,now:750_000_011) }
        do { try RoutedNormalProofChildAuthority.preflight(); throw TestFailure.failed("NoTeam-preflight-accepted") }
        catch ProtectionLeaseFailure.signingNotConfigured { checks.append("actual-child-NoTeam-before-IPC") }
        do { _ = try RoutedNormalProofChildAuthority.begin(binding:b); throw TestFailure.failed("NoTeam-begin-accepted") }
        catch ProtectionLeaseFailure.signingNotConfigured { checks.append("actual-child-begin-NoTeam-before-binding-or-IPC") }
        print(String(decoding:try JSONSerialization.data(withJSONObject:["schema":"P05_NORMAL_PROOF_SCOPE_DELTA_V1","checks":checks,
            "actualSignedXPC":"NOT_RUN","actualNE":"NOT_RUN","reducerIsDataOnly":true,"GUIOrNetworkUsed":false],options:.sortedKeys),as:UTF8.self))
    }
}
