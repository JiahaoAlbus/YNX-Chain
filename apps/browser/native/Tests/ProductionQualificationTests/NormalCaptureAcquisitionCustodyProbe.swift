import Foundation
import Darwin

private enum CustodyProbeFailure:Error {case failed(String),lateFailure,retired,unknown}
@MainActor private func check(_ value:Bool,_ label:String)throws {if !value {throw CustodyProbeFailure.failed(label)}}
@MainActor private final class PUBLICObservation {
    var firstFailure:CustodyProbeFailure?
    var retiredAcknowledged=false,localDisposed=false
    var refreshes=0
    func requireCurrent()throws {if let firstFailure {throw firstFailure}}
    var replaceable:Bool {retiredAcknowledged && localDisposed}
}

@MainActor private func preAdoptFailureCanRetry()async throws {
    let custody=NormalCaptureAcquisitionCustody<PUBLICObservation>()
    var attempts=0
    let original=PUBLICObservation()
    let create:@MainActor (@escaping @MainActor (PUBLICObservation)throws->Void)async throws->PUBLICObservation={adopt in
        attempts += 1
        if attempts==1 {throw CustodyProbeFailure.lateFailure} // Before any adoption/effect in this fixture.
        try adopt(original);return original
    }
    do {_=try await custody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:{_ in},create:create);throw CustodyProbeFailure.failed("pre-adopt-failure-returned")}
    catch CustodyProbeFailure.lateFailure {}
    try check(custody.held==nil && attempts==1,"pre-adopt-failure-no-owner-debt")
    let value=try await custody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:{_ in},create:create)
    try check(value===original && custody.held===original && attempts==2,"explicit-retry-after-no-adoption")
    try check(custody.firstFailure is CustodyProbeFailure,"pre-adopt-firstcause-preserved")
}

@main private struct NormalCaptureAcquisitionCustodyProbe {
    @MainActor static func main()async {
        do {
            var groups:[String]=[]
            #if YNX_CUSTODY_PRE_ADOPT_ONLY
            try await preAdoptFailureCanRetry()
            groups.append("pre-adopt-no-effect-failure-allows-next-explicit-attempt")
            #else
            let custody=NormalCaptureAcquisitionCustody<PUBLICObservation>()
            var creates=0,adopted=0,active=0,maximum=0,cancelInherited=false
            let create:@MainActor (@escaping @MainActor (PUBLICObservation)throws->Void)async throws->PUBLICObservation={adopt in
                creates += 1;active += 1;maximum=max(maximum,active);defer {active -= 1}
                cancelInherited=cancelInherited || Task.isCancelled
                let value=PUBLICObservation();try adopt(value);adopted += 1
                try await Task.sleep(for:.milliseconds(30));return value
            }
            let refresh:@MainActor (PUBLICObservation)async throws->Void={value in value.refreshes += 1;try await Task.sleep(for:.milliseconds(15))}
            let one=Task { @MainActor in try await custody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:create) }
            let two=Task { @MainActor in try await custody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:create) }
            let first=try await one.value,second=try await two.value
            try check(first===second && creates==1 && adopted==1 && maximum==1,"single-original-creation")
            groups.append("concurrent-capture-coalesces-one-adopted-owner")
            let cancelled=Task { @MainActor in try await custody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:create) }
            cancelled.cancel()
            do {_=try await cancelled.value;throw CustodyProbeFailure.failed("cancelled-caller-returned-owner")}
            catch is CancellationError {}
            try check(creates==1 && !cancelInherited && custody.held===first,"caller-cancel-keeps-original-worker-custody")
            groups.append("cancelled-caller-cannot-cancel-or-replace-owned-worker")

            first.firstFailure = .unknown;first.localDisposed=true
            do {_=try await custody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:create);throw CustodyProbeFailure.failed("UNKNOWN-replaced")}
            catch CustodyProbeFailure.unknown {}
            try check(creates==1 && custody.held===first,"UNKNOWN-held-without-new-create")
            first.firstFailure = .retired;first.retiredAcknowledged=true;first.localDisposed=false
            do {_=try await custody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:create);throw CustodyProbeFailure.failed("ack-alone-replaced")}
            catch CustodyProbeFailure.retired {}
            try check(creates==1 && custody.held===first,"remote-ack-alone-insufficient")
            first.localDisposed=true
            let replacement=try await custody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:create)
            try check(replacement !== first && creates==2 && custody.held===replacement,"ack-and-dispose-allow-next-explicit-create")
            groups.append("UNKNOWN-and-remote-ack-alone-cannot-replace-owner")

            let partialCustody=NormalCaptureAcquisitionCustody<PUBLICObservation>()
            var partialCreates=0
            let partial=PUBLICObservation()
            let partialCreate:@MainActor (@escaping @MainActor (PUBLICObservation)throws->Void)async throws->PUBLICObservation={adopt in
                partialCreates += 1;try adopt(partial);partial.firstFailure = .lateFailure;partial.localDisposed=true
                try await Task.sleep(for:.milliseconds(10));throw CustodyProbeFailure.lateFailure
            }
            do {_=try await partialCustody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:partialCreate);throw CustodyProbeFailure.failed("partial-failure-accepted")}
            catch CustodyProbeFailure.lateFailure {}
            do {_=try await partialCustody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:partialCreate);throw CustodyProbeFailure.failed("partial-owner-replaced")}
            catch CustodyProbeFailure.lateFailure {}
            try check(partialCustody.held===partial && partialCreates==1 && partialCustody.firstFailure is CustodyProbeFailure,"first-failed-partial-retained")
            groups.append("failed-acquisition-retains-exact-adopted-partial-and-firstcause")

            let lateCustody=NormalCaptureAcquisitionCustody<PUBLICObservation>()
            let late=PUBLICObservation()
            let lateTask=Task { @MainActor in
                try await lateCustody.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:{adopt in
                    try adopt(late)
                    try await Task.sleep(for:.milliseconds(35));return late
                })
            }
            while lateCustody.held==nil {await Task.yield()}
            late.firstFailure = .retired;late.localDisposed=true
            do {_=try await lateTask.value;throw CustodyProbeFailure.failed("late-create-revived-owner")}
            catch CustodyProbeFailure.retired {}
            try check(lateCustody.held===late,"late-failure-keeps-original-owner")
            groups.append("late-acquisition-result-rechecks-retired-original")

            let pressure=NormalCaptureAcquisitionCustody<PUBLICObservation>()
            var pressureCreates=0
            let original=PUBLICObservation()
            var waiters:[Task<PUBLICObservation,Error>]=[]
            for _ in 0..<32 {
                waiters.append(Task { @MainActor in try await pressure.acquire(canReplace:{$0.replaceable},validate:{try $0.requireCurrent()},refresh:refresh,create:{adopt in
                    pressureCreates += 1;try adopt(original);try await Task.sleep(for:.milliseconds(30));return original
                }) })
            }
            for task in waiters {let value=try await task.value;try check(value===original,"backpressure-same-owner")}
            try check(pressureCreates==1,"no-spawn-per-waiter")
            groups.append("32-call-backpressure-joins-one-owned-acquisition")

            do {_=try await RoutedProductionQualification.captureCurrentArtifact(mode:.tor);throw CustodyProbeFailure.failed("actual-normal-capture-granted")}
            catch RoutedQualificationFailure.signingNotConfigured {}
            do {_=try RoutedProductionQualification.acquireCurrent(mode:.tor);throw CustodyProbeFailure.failed("actual-normal-qualification-granted")}
            catch RoutedQualificationFailure.signingNotConfigured {}
            groups.append("actual-normal-factories-still-NoTeam-before-effects")
            try await preAdoptFailureCanRetry()
            groups.append("pre-adopt-no-effect-failure-allows-next-explicit-attempt")
            #endif
            let result:[String:Any]=["newGroups":groups,"PUBLICFixturesOnly":true,"authenticQualificationCreated":false,
                "signedPeerAndNE":"NOT_RUN","networkAndGUIStarted":false,"oldGroupsRerun":false]
            print(String(decoding:try JSONSerialization.data(withJSONObject:result,options:.sortedKeys),as:UTF8.self))
        } catch {print("{\"failed\":true,\"errorType\":\"\(String(describing:type(of:error)))\"}");exit(1)}
    }
}
