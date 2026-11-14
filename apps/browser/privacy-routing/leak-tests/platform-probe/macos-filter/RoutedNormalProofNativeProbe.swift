import Foundation
import YNXBrowserCore

@main private struct RoutedNormalProofNativeProbe {
    @MainActor static func main() throws {
        var checks: [String] = []
        let malformed = ["probe", NymNormalProofHelper.flag, "malformed"]
        guard NymProofHelper.runIfRequested(arguments: malformed, bundle: .main) == 78 else { throw PrivacyRouteError.blocked }
        checks.append("actual-normal-dispatch-NoTeam-rejects-before-decode")
        guard NymNormalProofHelper.run(arguments: malformed, bundle: .main) == 78 else { throw PrivacyRouteError.blocked }
        checks.append("actual-normal-helper-NoTeam-rejects-before-binding-or-IPC")
        let legacy = ["probe", "--ynx-nym-proof-v1", "19160", "public-fixture", "https://controlled.example.com",
                      "https://controlled.example.com/ynx-route-probe/public-fixture/proof", String(repeating:"a",count:64)]
        guard NymProofHelper.runIfRequested(arguments:legacy,bundle:.main) == 78 else { throw PrivacyRouteError.blocked }
        checks.append("actual-legacy-no-scope-entry-rejected")
        print(String(decoding:try JSONSerialization.data(withJSONObject:["checks":checks,"actualSignedXPC":"NOT_RUN",
            "actualNE":"NOT_RUN","GUIOrNetworkUsed":false],options:.sortedKeys),as:UTF8.self))
    }
}
