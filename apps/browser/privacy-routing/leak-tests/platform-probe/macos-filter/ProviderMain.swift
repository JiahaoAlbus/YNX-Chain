import Foundation
import NetworkExtension

@main enum ProviderMain {
    static func main() {
        // This binary is started only by macOS after a separately approved signed activation.
        // Building it or running policy tests never calls this entry point.
        NEProvider.startSystemExtensionMode()
        dispatchMain()
    }
}
