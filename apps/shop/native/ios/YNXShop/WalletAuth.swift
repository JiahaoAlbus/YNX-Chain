import Foundation
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// Same adopted Native SDK authority; historical Apple V1 records remain retired.
@MainActor enum WalletAuth {
    static func begin(api:APIClient)async throws {try await api.connectNative()}
    static func complete(_ url:URL,api:APIClient)async throws {try await api.returnNative(url)}
}

@MainActor enum WalletOpening {
    static func open(_ url:URL)async throws {
#if canImport(UIKit)
        guard await UIApplication.shared.open(url) else{throw ShopError.unavailable}
#elseif canImport(AppKit)
        guard NSWorkspace.shared.open(url) else{throw ShopError.unavailable}
#else
        throw ShopError.unavailable
#endif
    }
}
