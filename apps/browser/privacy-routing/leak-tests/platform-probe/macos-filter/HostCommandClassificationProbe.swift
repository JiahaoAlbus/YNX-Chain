import Foundation
import NetworkExtension
import SystemExtensions

@main enum HostCommandClassificationProbe {
    static func main() {
        if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--read-manifest-fixture" {
            do {
                let bytes = try readManifestFixture(CommandLine.arguments[2])
                print(bytes.count)
            } catch {
                print(error)
                exit(78)
            }
            return
        }
        let provider = "com.ynxweb4.browser.routefilter.provider"
        typealias Evidence = ReviewedFilterHostEvidence
        var passed = 0

        func check(_ name: String, _ condition: Bool) {
            guard condition else {
                print("FAIL \(name)")
                exit(1)
            }
            print("PASS \(name)")
            passed += 1
        }

        func configured() -> NEFilterProviderConfiguration {
            let configuration = NEFilterProviderConfiguration()
            configuration.filterDataProviderBundleIdentifier = provider
            configuration.filterSockets = true
            return configuration
        }

        func action(
            _ configuration: NEFilterProviderConfiguration?, enabled: Bool = true,
            grade: NEFilterManager.Grade = .firewall, description: String? = Evidence.filterDescription,
            disablesEncryptedDNS: Bool = false
        ) -> Evidence.PreferenceAction {
            Evidence.preferenceAction(configuration, enabled: enabled, grade: grade, description: description,
                                      disablesEncryptedDNS: disablesEncryptedDNS, providerIdentifier: provider)
        }

        check("first explicit configuration", action(nil, enabled: false, description: nil) == .create)
        check("unexpected enabled state with no provider", action(nil) == .refuse)
        check("identical enabled configuration", action(configured()) == .alreadyConfigured)
        check("existing disabled configuration retained", action(configured(), enabled: false) == .refuse)
        check("conflicting grade", action(configured(), grade: .inspector) == .refuse)
        check("conflicting label", action(configured(), description: "Custom filter") == .refuse)
        check("conflicting encrypted DNS setting", action(configured(), disablesEncryptedDNS: true) == .refuse)
        check("encrypted DNS setting retained during first configuration",
              action(nil, enabled: false, disablesEncryptedDNS: true) == .refuse)

        let conflicts: [(String, (NEFilterProviderConfiguration) -> Void)] = [
            ("implicit default provider", { $0.filterDataProviderBundleIdentifier = nil }),
            ("foreign data provider", { $0.filterDataProviderBundleIdentifier = "com.example.foreign" }),
            ("packet filtering", { $0.filterPackets = true }),
            ("explicit packet provider", { $0.filterPacketProviderBundleIdentifier = "com.example.packet" }),
            ("socket filter disabled", { $0.filterSockets = false }),
            ("vendor configuration", { $0.vendorConfiguration = ["setting": true] }),
            ("server setting", { $0.serverAddress = "invalid.example" }),
            ("username setting", { $0.username = "fixture" }),
            ("organization setting", { $0.organization = "fixture" }),
            ("password reference", { $0.passwordReference = Data([0]) }),
            ("identity reference", { $0.identityReference = Data([0]) }),
        ]
        for (name, mutate) in conflicts {
            let configuration = configured()
            mutate(configuration)
            check(name, action(configuration) == .refuse)
        }

        for (result, state, finished, reboot) in [
            (OSSystemExtensionRequest.Result.completed, "completed", true, false),
            (.willCompleteAfterReboot, "pending-reboot", false, true),
        ] {
            let receipt = Evidence.ActivationState(result).receipt(result: result)
            check("activation receipt \(state)", receipt["activationResult"] as? Int == result.rawValue &&
                  receipt["activationState"] as? String == state && receipt["acceptedByOS"] as? Bool == true &&
                  receipt["activationCompleted"] as? Bool == finished && receipt["requiresReboot"] as? Bool == reboot &&
                  receipt["productionRouteAdmission"] as? Bool == false &&
                  receipt["networkAcceptance"] as? String == "NOT_RUN")
        }
        print("\(passed) Host classification checks passed")
    }
}
