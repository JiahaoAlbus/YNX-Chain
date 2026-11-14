import Foundation
import CryptoKit
import Darwin

private enum CaptureProbeFailure:Error {case failed(String)}
@MainActor private func check(_ value:Bool,_ name:String)throws {if !value {throw CaptureProbeFailure.failed(name)}}
@MainActor private func refuses(_ name:String,_ body:()throws->Void)throws {
    do {try body();throw CaptureProbeFailure.failed("accepted-"+name)}
    catch let error as CaptureProbeFailure {throw error} catch {}
}
@main private struct NormalCaptureProbe {
    @MainActor static func main() async {
        do {
            var groups:[String]=[]
            for mode in PrivacyRouteMode.allCases {
                do {_=try await RoutedProductionQualification.captureCurrentArtifact(mode:mode);throw CaptureProbeFailure.failed("normal-capture-created-without-Team")}
                catch RoutedQualificationFailure.signingNotConfigured {}
                do {_=try RoutedProductionQualification.acquireCurrent(mode:mode);throw CaptureProbeFailure.failed("qualification-created")}
                catch RoutedQualificationFailure.signingNotConfigured {}
            }
            groups.append("actual-normal-capture-and-qualification-NoTeam-first")
            #if YNX_PRIVACY_ACCEPTANCE
            try refuses("acceptance-build-role") {try NormalCaptureRolePolicy.requireNormal(role:"normal-artifact-observation-v1",bundleIdentifier:RoutedIsolationMode.tor.bundleIdentifier,mode:.tor)}
            #else
            try NormalCaptureRolePolicy.requireNormal(role:"normal-artifact-observation-v1",bundleIdentifier:RoutedIsolationMode.tor.bundleIdentifier,mode:.tor)
            for role:Any in [true,"PUBLIC-QA-role",""] {try refuses("fake-role") {try NormalCaptureRolePolicy.requireNormal(role:role,bundleIdentifier:RoutedIsolationMode.tor.bundleIdentifier,mode:.tor)}}
            try refuses("QA-bundle") {try NormalCaptureRolePolicy.requireNormal(role:"normal-artifact-observation-v1",bundleIdentifier:"com.ynxweb4.browser.qa.tor.public-search",mode:.tor)}
            #endif
            groups.append("actual-normal-role-policy-QA-fake-role-wrong-bundle")
            // PUBLIC reducer fixture tokens/pins are DATA, not real audit tokens or approval.
            let token=Data(repeating:0x42,count:32),session=UUID(),generation=UUID().uuidString
            let artifact=NormalArtifactBinding(mode:.tor,team:"PUBLIC0001",bundleID:RoutedIsolationMode.tor.bundleIdentifier,
                browserSHA256:String(repeating:"a",count:64),browserCodeHash:String(repeating:"b",count:40),
                helperSHA256:String(repeating:"c",count:64),providerSHA256:String(repeating:"d",count:64),osBuild:"PUBLIC synthetic OS")
            let id=UUID().uuidString,epoch=UUID().uuidString
            func query(_ operation:String,_ sequence:UInt64,_ value:NormalArtifactBinding?=nil)->NormalArtifactRequest {
                .init(schema:"P05_NORMAL_ARTIFACT_REQUEST_V1",captureID:id,captureEpoch:epoch,nonce:UUID().uuidString,
                    sequence:sequence,operation:operation,auditTokenHex:token.map({String(format:"%02x",$0)}).joined(),binding:value ?? artifact)
            }
            let first=query("capture",1),raw=try NormalCaptureWire.encode(first)
            _=try NormalCaptureWire.decode(NormalArtifactRequest.self,raw)
            var fields=try JSONSerialization.jsonObject(with:raw) as! [String:Any]
            fields["issuer"]="PUBLIC forged authority";fields["approved"]=true
            try refuses("caller-issuer-and-ready") {_=try NormalCaptureWire.decode(NormalArtifactRequest.self,JSONSerialization.data(withJSONObject:fields,options:[.sortedKeys,.withoutEscapingSlashes]))}
            let duplicate=Data((String(decoding:raw.dropLast(),as:UTF8.self)+",\"sequence\":1}").utf8)
            try refuses("duplicate-key") {_=try NormalCaptureWire.decode(NormalArtifactRequest.self,duplicate)}
            for value:Any in [true,"1",-1,0,1.5] {
                var changed=try JSONSerialization.jsonObject(with:raw) as! [String:Any];changed["sequence"]=value
                try refuses("bad-sequence") {let q=try NormalCaptureWire.decode(NormalArtifactRequest.self,JSONSerialization.data(withJSONObject:changed,options:[.sortedKeys,.withoutEscapingSlashes]));try q.validate(operation:"capture")}
            }
            try refuses("issuer-operation") {try query("approve",1).validate(operation:"approve")}
            groups.append("actual-normal-codec-forged-issuer-duplicate-type-refusals")
            var ledger=NormalCaptureLedger()
            let observed=try ledger.handle(first,operation:"capture",owner:token,session:session,generation:generation,now:0)
            try check(observed.originalApprovalState=="not-supplied" && ledger.rows.count==1,"observation-is-not-approval")
            let replyBinding=NormalCaptureReplyBinding(artifact:artifact,ownerToken:token,captureID:id,captureEpoch:epoch)
            _=try replyBinding.consume(NormalCaptureWire.encode(observed),request:first,retiring:false,knownProviderGeneration:nil)
            for field in ["browserSHA256","providerSHA256","providerGeneration","ownerAuditTokenSHA256","nonce","captureEpoch","originalApprovalState","state"] {
                var changed=try JSONSerialization.jsonObject(with:NormalCaptureWire.encode(observed)) as! [String:Any]
                changed[field]=field=="originalApprovalState" ? "approved" : "PUBLIC-wrong"
                try refuses("reply-"+field) {_=try replyBinding.consume(JSONSerialization.data(withJSONObject:changed,options:[.sortedKeys,.withoutEscapingSlashes]),request:first,retiring:false,knownProviderGeneration:generation)}
            }
            try refuses("provider-restart") {_=try replyBinding.consume(NormalCaptureWire.encode(observed),request:first,retiring:false,knownProviderGeneration:UUID().uuidString)}
            groups.append("actual-normal-receiver-wrong-artifact-approval-and-provider-refusals")
            let changed=NormalArtifactBinding(mode:.nym,team:artifact.team,bundleID:RoutedIsolationMode.nym.bundleIdentifier,
                browserSHA256:artifact.browserSHA256,browserCodeHash:artifact.browserCodeHash,helperSHA256:artifact.helperSHA256,
                providerSHA256:artifact.providerSHA256,osBuild:artifact.osBuild)
            try refuses("QA-or-other-artifact-scope") {_=try ledger.handle(query("current",2,changed),operation:"current",owner:token,session:session,generation:generation,now:1)}
            try refuses("different-authenticated-session") {_=try ledger.handle(query("current",2),operation:"current",owner:token,session:UUID(),generation:generation,now:1)}
            _=try ledger.handle(query("current",2),operation:"current",owner:token,session:session,generation:generation,now:1)
            let retired=try ledger.handle(query("retire",3),operation:"retire",owner:token,session:session,generation:generation,now:2)
            try check(retired.state=="retired" && ledger.rows.isEmpty,"retire-removes-only-own-observation")
            try refuses("retired-capture-replay") {_=try ledger.handle(first,operation:"capture",owner:token,session:session,generation:generation,now:3)}
            groups.append("actual-ledger-current-retire-session-artifact-binding")
            var expired=NormalCaptureLedger();_=try expired.handle(first,operation:"capture",owner:token,session:session,generation:generation,now:0)
            try refuses("exact-expiry-boundary") {_=try expired.handle(query("current",2),operation:"current",owner:token,session:session,generation:generation,now:5_000_000_000)}
            try check(expired.rows.isEmpty,"expired-observation-disposed")
            var closed=NormalCaptureLedger();_=try closed.handle(first,operation:"capture",owner:token,session:session,generation:generation,now:0)
            closed.close(session:session);try check(closed.rows.isEmpty,"channel-loss-disposes-observation")
            groups.append("actual-ledger-expiry-and-channel-loss")
            // Compile the exact private normal pending body into this probe file.
            // It owns only a continuation/timeout, never a permission or fake peer.
            var pending:NormalCapturePending?
            var timeoutFired=false
            let waiter=Task { @MainActor in
                try await withCheckedThrowingContinuation { (continuation:CheckedContinuation<Data,Error>) in
                    let value=NormalCapturePending(continuation);pending=value
                    value.timeout=Task { @MainActor in do {try await Task.sleep(for:.milliseconds(30))}catch{return};timeoutFired=true }
                }
            }
            while pending==nil {await Task.yield()}
            pending?.finish(.failure(RoutedNormalCaptureFailure.retired))
            pending?.finish(.success(Data("PUBLIC-late-success".utf8)))
            do {_=try await waiter.value;throw CaptureProbeFailure.failed("late-reply-revived-pending")}
            catch RoutedNormalCaptureFailure.retired {}
            try await Task.sleep(for:.milliseconds(55));try check(!timeoutFired,"pending-disposes-timeout")
            groups.append("actual-normal-pending-first-failure-late-success-and-disposal")
            let interface=NSXPCInterface(with:ScopedNormalCaptureControl.self)
            _=interface // Construct real Foundation interface; no listener or Mach service opened.
            groups.append("actual-NSXPC-selector-contract-construction")
            let directory=URL(fileURLWithPath:CommandLine.arguments[1]),file=directory.appendingPathComponent("PUBLIC-artifact.bin")
            try Data("PUBLIC-artifact-original".utf8).write(to:file,options:.withoutOverwriting)
            func fdCount()->Int {(0..<256).filter {fcntl(Int32($0),F_GETFD)>=0}.count}
            let before=fdCount(),hash=try NormalCaptureArtifactReader.digest(file)
            for _ in 0..<20 {_=try NormalCaptureArtifactReader.digest(file)}
            try check(before==fdCount(),"artifact-FDs-physically-closed")
            try Data("PUBLIC-artifact-changed".utf8).write(to:file)
            try check(try NormalCaptureArtifactReader.digest(file) != hash,"wrong-bytes-change-binding")
            groups.append("actual-synthetic-artifact-reader-change-and-FD-close")
            let result:[String:Any]=["groups":groups,"signedPeerAndNEPositive":"NOT_RUN","normalQualificationCreated":false,
                "normalRootOrBackendStarted":false,"fixtureOnly":"PUBLIC DATA/lifecycle; actual normal factories reject NoTeam"]
            print(String(decoding:try JSONSerialization.data(withJSONObject:result,options:.sortedKeys),as:UTF8.self))
        } catch {print("{\"failed\":true,\"errorType\":\"\(String(describing:type(of:error)))\"}");exit(1)}
    }
}
