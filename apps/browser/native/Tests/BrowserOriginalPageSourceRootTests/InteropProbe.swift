import Foundation

// Compile-only actual Clang-imported API use. No alternate Root declaration,
// _silgen_name, callback injection or opaque-pointer construction is used.
// The actual Root0 lifecycle is exercised by Probe.mm against real r3 objects.
private func checkOriginalNativeAPI(_ root: BrowserOriginalPageSourceRoot) {
    let acquisition: Int32 = root.acquisitionStatus
    let first: Int32 = root.firstStatus
    let owned: Bool = root.ownsOriginalRoot
    let status: Int32 = root.requireCurrent()
    var context: NSDictionary?
    let contextStatus: Int32 = root.copyOriginalContext(&context)
    var deadline: UInt64 = 0
    let deadlineStatus: Int32 = root.copyOriginalReadDeadline(&deadline)
    let retired: Int32 = root.retireOriginal()
    let drain: BrowserOriginalPageRootDrain = root.closeOriginal()
    let facts: (Int32, UInt32, UInt32) = (drain.firstStatus, drain.completed, drain.destroyed)
    _ = (acquisition, first, owned, status, contextStatus, deadlineStatus, retired, facts)
}
