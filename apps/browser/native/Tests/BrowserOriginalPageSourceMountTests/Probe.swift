import Foundation
import Darwin

private enum PUBLICFault: Error { case acquisition, current, cleanup, timeout, assertion }
@MainActor private final class PUBLICPause {
    private var continuation: CheckedContinuation<Void,Never>?
    private var released=false
    private(set) var entered=false
    func wait() async { entered=true; if released{return};await withCheckedContinuation{continuation=$0} }
    func release(){released=true;let old=continuation;continuation=nil;old?.resume()}
}
@MainActor private final class PUBLICStats { var current=0, close=0, reads=0; var closeSawCancellation=false }
/// Control-lifecycle fixture ONLY. It is never registered as original Auth/Source and cannot
/// authenticate the fixture peer or produce a TaskGrant. No page request is made in this probe.
@MainActor private final class PUBLICOwner: BrowserOriginalPageReadoutOwner {
    let stats:PUBLICStats
    var closeFailures=0, currentFailureAt:Int?, onCurrent:(()->Void)?, closePause:PUBLICPause?
    init(_ stats:PUBLICStats){self.stats=stats}
    func requireCurrent() throws {stats.current+=1;onCurrent?();if stats.current==currentFailureAt{throw PUBLICFault.current}}
    func readOriginalBrowserPageReadout(_ request:Data) async throws->Data{stats.reads+=1;throw PUBLICFault.assertion}
    func close() async throws{
        stats.close+=1;stats.closeSawCancellation = stats.closeSawCancellation || Task.isCancelled
        if let closePause{await closePause.wait()}
        if closeFailures>0{closeFailures-=1;throw PUBLICFault.cleanup}
    }
}
@main struct BrowserSourceMountLifecycleProbe {
    @MainActor static func require(_ condition:Bool)throws{guard condition else{throw PUBLICFault.assertion}}
    @MainActor static func until(_ condition:()->Bool)async throws{for _ in 0..<10000{if condition(){return};await Task.yield()};throw PUBLICFault.timeout}
    @MainActor static func peer()throws->BrowserPageIPCPeer{
        // Syntactically valid PUBLIC peer requirement only; no connection/authentication attempt.
        try BrowserPageIPCPeer(pid:getpid(),uid:geteuid(),identifier:"com.ynx.PUBLIC.lifecycle",codeDirectoryHash:String(repeating:"a",count:40))
    }
    @MainActor static func main()async throws{
        var checks:[String]=[], allStats:[PUBLICStats]=[]
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats);var acquired=0
            let mount=BrowserOriginalPageSourceMount{_ in acquired+=1;return .init(owner:owner,peer:try?peer(),error:nil)}
            _=try await mount.start();try require(mount.state == .active);try mount.requireCurrent()
            do{_=try await mount.start();throw PUBLICFault.assertion}catch BrowserOriginalPageSourceMount.Failure.alreadyStarted{}
            try await mount.close();try await mount.close();try require(stats.close==1 && acquired==1 && mount.state == .closed)
            checks.append("one-shot-normal-current-and-idempotent-close")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats)
            let mount=BrowserOriginalPageSourceMount{_ in .init(owner:owner,peer:nil,error:PUBLICFault.acquisition)}
            do{_=try await mount.start();throw PUBLICFault.assertion}catch PUBLICFault.acquisition{}
            try require(stats.current==0 && stats.close==1 && mount.state == .closed && mount.firstFailure is PUBLICFault)
            checks.append("adopt-partial-owner-with-error-before-cleanup-no-activation")
        }
        do{
            var acquired=0
            let mount=BrowserOriginalPageSourceMount{_ in acquired+=1;return .init(owner:nil,peer:nil,error:nil)}
            let start=Task{@MainActor in withUnsafeCurrentTask{$0?.cancel()};return try await mount.start()}
            do{_=try await start.value;throw PUBLICFault.assertion}catch BrowserOriginalPageSourceMount.Failure.cancelled{}
            try require(acquired==0 && mount.state == .closed);checks.append("cancel-before-start-acquires-nothing")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats),pause=PUBLICPause()
            let mount=BrowserOriginalPageSourceMount{_ in await pause.wait();return .init(owner:owner,peer:try?peer(),error:nil)}
            let start=Task{@MainActor in try await mount.start()};try await until{pause.entered}
            mount.invalidate();let close=Task{@MainActor in try await mount.close()};await Task.yield();pause.release()
            do{_=try await start.value;throw PUBLICFault.assertion}catch BrowserOriginalPageSourceMount.Failure.cancelled{}
            try await close.value;try require(stats.current==0 && stats.close==1 && mount.state == .closed)
            checks.append("close-during-acquire-adopts-late-owner-never-resumes")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats),pause=PUBLICPause()
            let mount=BrowserOriginalPageSourceMount{_ in await pause.wait();return .init(owner:owner,peer:try?peer(),error:nil)}
            let start=Task{@MainActor in try await mount.start()};try await until{pause.entered};start.cancel()
            try await until{mount.state == .closing};pause.release()
            do{_=try await start.value;throw PUBLICFault.assertion}catch BrowserOriginalPageSourceMount.Failure.cancelled{}
            try require(stats.current==0 && stats.close==1 && !stats.closeSawCancellation && mount.state == .closed)
            checks.append("cancelled-waiter-late-acquire-cleaned-in-independent-task")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);var original:PUBLICOwner?=PUBLICOwner(stats);original!.closeFailures=1;weak var weakOwner=original
            let mount=BrowserOriginalPageSourceMount{[owner=original!]_ in .init(owner:owner,peer:try?peer(),error:nil)};original=nil
            _=try await mount.start()
            do{try await mount.close();throw PUBLICFault.assertion}catch PUBLICFault.cleanup{}
            try require(mount.state == .closeUnknown && weakOwner != nil && stats.close==1 && mount.lastCloseFailure != nil)
            do{try mount.requireCurrent();throw PUBLICFault.assertion}catch BrowserOriginalPageSourceMount.Failure.inactive{}
            try await mount.close();try require(stats.close==2 && weakOwner==nil && mount.state == .closed && mount.firstFailure != nil)
            checks.append("unknown-close-retains-original-owner-explicit-retry-releases-it")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats),pause=PUBLICPause();owner.closePause=pause
            let mount=BrowserOriginalPageSourceMount{_ in .init(owner:owner,peer:try?peer(),error:nil)};_=try await mount.start()
            let a=Task{@MainActor in try await mount.close()};try await until{pause.entered};let b=Task{@MainActor in try await mount.close()};await Task.yield()
            try require(stats.close==1);pause.release();try await a.value;try await b.value;try require(mount.state == .closed && stats.close==1)
            checks.append("concurrent-close-joins-one-real-owner-attempt")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats);owner.closeFailures=1
            let mount=BrowserOriginalPageSourceMount{_ in .init(owner:owner,peer:try?peer(),error:PUBLICFault.acquisition)}
            do{_=try await mount.start();throw PUBLICFault.assertion}catch PUBLICFault.acquisition{}
            try require(mount.state == .closeUnknown && (mount.firstFailure as? PUBLICFault) == .acquisition && (mount.lastCloseFailure as? PUBLICFault) == .cleanup)
            try await mount.close();try require(stats.close==2 && (mount.firstFailure as? PUBLICFault) == .acquisition)
            checks.append("partial-acquire-first-cause-survives-unknown-close-and-retry")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats);owner.currentFailureAt=4
            let mount=BrowserOriginalPageSourceMount{_ in .init(owner:owner,peer:try?peer(),error:nil)};_=try await mount.start()
            do{try mount.requireCurrent();throw PUBLICFault.assertion}catch PUBLICFault.current{}
            let count=stats.current;do{try mount.requireCurrent();throw PUBLICFault.assertion}catch BrowserOriginalPageSourceMount.Failure.inactive{}
            try require(mount.state == .closing && stats.current==count);try await mount.close()
            checks.append("active-current-loss-synchronously-invalidates-before-async-cleanup")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats)
            var mount:BrowserOriginalPageSourceMount!
            mount=BrowserOriginalPageSourceMount{_ in .init(owner:owner,peer:try?peer(),error:nil)}
            owner.onCurrent={[weak mount]in mount?.invalidate()}
            do{_=try await mount.start();throw PUBLICFault.assertion}catch BrowserOriginalPageSourceMount.Failure.cancelled{}
            try require(stats.current==1 && stats.close==1 && mount.state == .closed)
            checks.append("reentrant-invalidate-before-activation-cannot-resume")
        }
        do{
            let stats=PUBLICStats();allStats.append(stats);let owner=PUBLICOwner(stats);owner.currentFailureAt=3
            let mount=BrowserOriginalPageSourceMount{_ in .init(owner:owner,peer:try?peer(),error:nil)}
            do{_=try await mount.start();throw PUBLICFault.assertion}catch PUBLICFault.current{}
            try require(stats.close==1 && mount.state == .closed)
            checks.append("post-activation-current-failure-does-not-publish-endpoint")
        }
        do{
            let mount=BrowserOriginalPageSourceMount{_ in .init(owner:nil,peer:try?peer(),error:nil)}
            do{_=try await mount.start();throw PUBLICFault.assertion}catch BrowserOriginalPageSourceMount.Failure.missingOriginalOwner{}
            try require(mount.state == .closed);checks.append("missing-original-owner-never-activates")
        }
        try require(allStats.allSatisfy{$0.reads==0})
        let output:[String:Any]=["schema":"P05_PUBLIC_MOUNT_LIFECYCLE_PROBE_V1","checks":checks,"status":"PASS","scope":"PUBLIC control-lifecycle fixture using actual suspended anonymous listener and BaseIPC; no peer connected, no request sent","ownerReadCalls":0,"originalAuthFactory":"NOT_RUN","AuthOrRootQualification":"NOT_RUN","TaskGrantCreated":false,"GUIOrNetworkUsed":false]
        print(String(decoding:try JSONSerialization.data(withJSONObject:output,options:[.sortedKeys]),as:UTF8.self))
    }
}
