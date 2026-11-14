#if YNX_PRIVACY_ACCEPTANCE
import Foundation

/// Pure post-identity lease reducer. It cannot construct either opaque proof authority or NE ACK.
@main struct SyntheticProofSelfTest {
    static func main() throws {
        let token = Data(repeating: 1,count:32), session = UUID(), another = UUID()
        let b = SyntheticTrialBinding(mode:.nym,runID:"proof-fixture",epoch:UUID().uuidString,profileID:"synthetic-proof-fixture",profileSHA256:String(repeating:"a",count:64),providerGeneration:UUID().uuidString,rootAuditTokenSHA256:ProtectionLease.hash(token),manifestSHA256:String(repeating:"b",count:64),bootstrapSHA256:String(repeating:"c",count:64),executableSHA256:String(repeating:"d",count:64))
        let scope = SyntheticProofChildScope(proofURL:URL(string:"https://one.example/ynx-route-probe/proof-fixture/proof?probe=baseline-https")!,responseSHA256:String(repeating:"e",count:64),routePort:28432,origins:[URL(string:"https://one.example")!,URL(string:"https://two.example")!])
        func request(_ op:String,_ seq:UInt64,_ url:URL?=nil,_ method:String?=nil)->SyntheticProofRequest { .init(schema:"P05_SYNTHETIC_PROOF_REQUEST_V1",operation:op,nonce:UUID().uuidString,sequence:seq,binding:b,ownAuditToken:token,helperAuditTokenSHA256:ProtectionLease.hash(token),readyBackendAuditTokenSHA256:nil,readyMarkerSHA256:nil,manifest:nil,requestURL:url,requestMethod:method) }
        var checks=[String]()
        func denied(_ name:String,_ body:()throws->Void) { do { try body(); preconditionFailure(name) } catch { checks.append(name) } }
        var lease=SyntheticProofLeaseState(binding:b,scope:scope,graphRevision:2,parentSession:UUID())
        denied("heartbeat-before-child-begin"){try lease.accept(request("heartbeat",1),session:session,now:100)}
        try lease.accept(request("begin",1),session:session,now:100);checks.append("begin-does-not-authorize-network")
        precondition(!lease.authorized && lease.live(now:101))
        denied("same-connection-replay"){try lease.accept(request("heartbeat",1),session:session,now:101)}
        denied("another-connection-not-identity"){try lease.accept(request("heartbeat",2),session:another,now:101)}
        denied("ordinary-target-refused"){try lease.accept(request("authorize",2,URL(string:"https://duckduckgo.com")!,"GET"),session:session,now:101)}
        denied("cross-origin-proof-refused"){try lease.accept(request("authorize",2,URL(string:"https://two.example/ynx-route-probe/proof-fixture/proof?probe=baseline-https")!,"GET"),session:session,now:101)}
        denied("post-refused"){try lease.accept(request("authorize",2,scope.proofURL,"POST"),session:session,now:101)}
        try lease.accept(request("authorize",2,scope.proofURL,"GET"),session:session,now:101);precondition(lease.authorized);checks.append("exact-single-get")
        denied("no-second-request-or-automatic-retry"){try lease.accept(request("authorize",3,scope.proofURL,"GET"),session:session,now:102)}
        try lease.accept(request("heartbeat",3),session:session,now:102);checks.append("heartbeat-same-connection")
        precondition(!lease.live(now:750_000_102))
        denied("absolute-monotonic-deadline-no-refresh-after-expiry"){try lease.accept(request("heartbeat",4),session:session,now:750_000_102)}
        var post=URLRequest(url:scope.proofURL);post.httpBody=Data([1]);denied("body-not-erased"){try scope.validate(post)}
        let out:[String:Any]=["schema":"P05_SYNTHETIC_PROOF_POLICY_DELTA_V1","checks":checks,"status":"PASS","actualSignedXPC":"NOT_RUN","actualNE":"NOT_RUN","opaqueAuthorityCreated":false,"productionRouteAdmission":false]
        print(String(decoding:try JSONSerialization.data(withJSONObject:out,options:[.sortedKeys]),as:UTF8.self))
    }
}
#endif
