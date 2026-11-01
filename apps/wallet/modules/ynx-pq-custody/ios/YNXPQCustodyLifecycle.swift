import Foundation
@_silgen_name("ynx_mobile_pq_invalidate_runtime_v1") private func invalidateNative() -> Bool
// Cleanup runs away from JS/UI, while actual custody stays on its dedicated
// C++ worker. GCD is NOT used to host pthread-bound NativePQOpenedAccount.
@objc(YNXPQCustodyLifecycle) public final class YNXPQCustodyLifecycle: NSObject {
    private let cleanup = DispatchQueue(label: "com.ynx.wallet.pq.lifecycle")
    @objc public func invalidate() { cleanup.async { _ = invalidateNative() } }
}
