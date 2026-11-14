import Foundation
private enum Failure: Error { case check(String) }
private func check(_ value: Bool,_ name: String) throws { if !value { throw Failure.check(name) } }
@main private struct CaptureSpecSelfTest {
    static func main() throws {
        var count=0
        func spec(_ cap: Int=131072,_ policy: BackendOutputPolicy = .boundedCapture) -> BackendStartSpecification {
            .init(executable: URL(fileURLWithPath:"/PUBLIC/synthetic"), executableSHA256: String(repeating:"a",count:64), codeRequirement:"PUBLIC-only", arguments:[], environment:[:], outputPolicy:policy, outputCaptureLimit:cap)
        }
        try check(spec().outputCaptureLimit==131072,"default unchanged");count+=1
        try spec().requireCaptureAcknowledgement(nil);count+=1 // Only default legacy helper.
        try spec().requireCaptureAcknowledgement(NSNumber(value:131072));count+=1
        try spec(16777216).requireCaptureAcknowledgement(NSNumber(value:16777216));count+=1
        for cap in [-1,0,16777217] {
            do { try spec(cap).validateOutputCaptureLimit();throw Failure.check("bad cap accepted") }
            catch is BackendStartGateFailure { count+=1 }
        }
        do { try spec(1048576,.discardAfterBootstrap).validateOutputCaptureLimit();throw Failure.check("raised discard accepted") }
        catch is BackendStartGateFailure { count+=1 }
        let values: [Any?]=[nil,true,"1048576",NSNumber(value:131072),NSNumber(value:1048576.5),NSNull()]
        for value in values {
            do { try spec(1048576).requireCaptureAcknowledgement(value);throw Failure.check("bad/missing raised ACK accepted") }
            catch is BackendStartGateFailure { count+=1 }
        }
        print("{\"schema\":\"P05_CAPTURE_SPEC_ACK_DELTA_V1\",\"checks\":\(count),\"source\":\"actual extracted production spec and error type\",\"GateOrNEAuthority\":false}")
    }
}
