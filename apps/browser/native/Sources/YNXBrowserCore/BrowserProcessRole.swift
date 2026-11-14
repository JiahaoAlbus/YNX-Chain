import Foundation

public enum BrowserProcessRoleError: Error { case invalidLaunch }

/// A routed process cannot enter ordinary startup, profile restoration or Wallet callbacks.
/// The mode is fixed by the packaged bundle and must agree with its explicit launch argument.
public enum BrowserProcessRole: Equatable, Sendable {
    case ordinary
    case routed(PrivacyRouteMode)

    public static func resolve(arguments: [String], bundleMode: String?) throws -> Self {
        let tail = Array(arguments.dropFirst())
        let hasMarker = tail.contains { $0.hasPrefix("--ynx-routed") }
        guard let bundleMode else {
            guard !hasMarker else { throw BrowserProcessRoleError.invalidLaunch }
            return .ordinary
        }
        guard let mode = PrivacyRouteMode(launchValue: bundleMode),
              tail == ["--ynx-routed-mode", mode.launchValue] else { throw BrowserProcessRoleError.invalidLaunch }
        return .routed(mode)
    }
}

extension PrivacyRouteMode {
    public var launchValue: String { self == .tor ? "tor" : "nym" }
    public init?(launchValue: String) {
        switch launchValue { case "tor": self = .tor; case "nym": self = .nym; default: return nil }
    }
    public var applicationName: String { self == .tor ? "YNX Tor Route.app" : "YNX Nym Route.app" }
    public var bundleIdentifier: String { "com.ynxweb4.browser.route.\(launchValue)" }
}
