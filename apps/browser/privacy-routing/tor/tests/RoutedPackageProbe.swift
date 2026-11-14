import Foundation
import Darwin

/// Verifies the actual packaged helper manifests/signatures without launching any application.
@main enum RoutedPackageProbe {
    static func main() {
        do { try run() }
        catch { FileHandle.standardError.write(Data("Routed package rejected; no application launched.\n".utf8)); exit(78) }
    }
    static func run() throws {
        guard CommandLine.arguments.count == 2,
              let bundle = Bundle(url: URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)) else { throw BrowserRoutedLaunchError.unverifiedPackage }
        for mode in PrivacyRouteMode.allCases {
            let application = try BrowserRoutedPackage.verifiedApplication(mode, in: bundle)
            guard let helper = Bundle(url: application),
                  try BrowserProcessRole.resolve(arguments: ["browser", "--ynx-routed-mode", mode.launchValue], bundleMode: helper.object(forInfoDictionaryKey: "YNXPrivacyRouteMode") as? String) == .routed(mode) else { throw BrowserRoutedLaunchError.unverifiedPackage }
        }
        print("PASS both packaged routed helpers: exact sealed executable pins, code signatures, immutable separate roles; no launch or network.")
    }
}
