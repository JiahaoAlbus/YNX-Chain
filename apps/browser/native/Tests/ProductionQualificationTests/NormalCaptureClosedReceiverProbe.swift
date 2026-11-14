import Foundation
import Darwin

private enum ClosedReceiverProbeFailure:Error {case failed(String)}
@MainActor private func check(_ value:Bool,_ label:String)throws {if !value {throw ClosedReceiverProbeFailure.failed(label)}}
@MainActor private func rejects(_ label:String,_ body:()throws->Void)throws {
    do {try body();throw ClosedReceiverProbeFailure.failed("accepted-"+label)}
    catch let error as ClosedReceiverProbeFailure {throw error} catch {}
}
@main private struct NormalCaptureClosedReceiverProbe {
    @MainActor static func main() async {
        do {
            var groups:[String]=[]
            if CommandLine.arguments.contains("--legacy-cleared-generation") {
                // Exact former callsite supplied observation?.providerGeneration.
                var observation:RoutedNormalArtifactObservation?
                let old=observation?.providerGeneration
                let replacement=UUID().uuidString
                let accepted=old==nil || old==replacement
                print("{\"oldClearedObservationAcceptsReplacementGeneration\":\(accepted),\"expectedFailure\":true,\"signedProvider\":false}")
                exit(accepted ? 1:2)
            }
            var generation=NormalCaptureProviderGeneration()
            let original=UUID().uuidString
            try generation.accept(original)
            try generation.accept(original)
            try rejects("replacement-generation-after-observation-cleared") {try generation.accept(UUID().uuidString)}
            try rejects("invalid-provider-generation") {try generation.accept("PUBLIC-invalid")}
            try check(generation.value==original,"failed-generation-keeps-original")
            groups.append("sticky-provider-generation-through-retire")

            let owner=UUID(),other=UUID()
            var fence=NormalCaptureSessionFence();fence.open(owner);fence.open(other)
            try fence.requireCurrent(owner)
            // Simulated scheduling gap is DATA only, following the exact Provider
            // precheck -> strict-IO gap -> close -> final locked-check ordering.
            fence.close(owner)
            try rejects("closed-session-late-commit") {try fence.requireCurrent(owner)}
            try fence.requireCurrent(other)
            fence.closeAll()
            try rejects("sleep-or-filter-stop-late-commit") {try fence.requireCurrent(other)}
            groups.append("provider-session-fence-prevents-late-commit")

            var failure:RoutedNormalCaptureFailure?
            var callbacks=0
            let loss:(RoutedNormalCaptureFailure)->Void={reason in if failure==nil {failure=reason;callbacks += 1}}
            var pending:NormalCapturePending?
            let waiting=Task { @MainActor in
                try await withCheckedThrowingContinuation {(value:CheckedContinuation<Data,Error>) in pending=NormalCapturePending(value)}
            }
            while pending==nil {await Task.yield()}
            pending?.finish(.failure(RoutedNormalCaptureFailure.replyTimeout))
            loss(.replyTimeout) // Exact typed timeout handler semantics, no transportLost substitution.
            loss(.transportLost)
            pending?.finish(.success(Data("PUBLIC-late".utf8)))
            do {_=try await waiting.value;throw ClosedReceiverProbeFailure.failed("late-success")}
            catch RoutedNormalCaptureFailure.replyTimeout {}
            try check(failure == .replyTimeout && callbacks==1,"reply-timeout-firstcause")
            groups.append("normal-pending-timeout-preserved-before-late-loss")

            // Exercise the actual nonactor lifetime box with an anonymous endpoint.
            // No provider service, role, entitlement, peer authority or route is used.
            let listener=NSXPCListener.anonymous()
            let connection=NSXPCConnection(listenerEndpoint:listener.endpoint)
            var invalidated=false
            connection.invalidationHandler={Task { @MainActor in invalidated=true }}
            var lifetime:NormalCaptureConnectionLifetime?=NormalCaptureConnectionLifetime(connection)
            weak var weakLifetime=lifetime
            connection.resume()
            lifetime=nil
            try check(weakLifetime==nil,"lifetime-box-not-retained")
            let deadline=ContinuousClock.now.advanced(by:.seconds(2))
            while !invalidated && .now<deadline {try await Task.sleep(for:.milliseconds(10))}
            listener.invalidate()
            try check(invalidated,"real-Foundation-XPC-invalidation-observed")
            groups.append("actual-anonymous-XPC-lifetime-physically-invalidated")

            // Independent existing normal factory still rejects before opening IPC;
            // this checks no accidental mint branch was added by the receiver delta.
            do {_=try await RoutedProductionQualification.captureCurrentArtifact(mode:.tor);throw ClosedReceiverProbeFailure.failed("unexpected-capture")}
            catch RoutedQualificationFailure.signingNotConfigured {}
            groups.append("actual-normal-factory-remains-NoTeam-first")
            let result:[String:Any]=["newGroups":groups,"actualAnonymousXPCOnly":true,"normalQualifiedObjectCreated":false,
                "signedPeerOrNE":"NOT_RUN","normalAdmission":false,"old9and9Rerun":false]
            print(String(decoding:try JSONSerialization.data(withJSONObject:result,options:.sortedKeys),as:UTF8.self))
        } catch {print("{\"failed\":true,\"type\":\"\(String(describing:type(of:error)))\"}");exit(1)}
    }
}
