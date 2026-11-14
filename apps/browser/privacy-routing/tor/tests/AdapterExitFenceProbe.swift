import Foundation
import Darwin

@main struct AdapterExitFenceProbe {
    @MainActor static func main() async {
        if CommandLine.arguments.dropFirst().first == "--owned-natural-exit" { exit(7) }
        if CommandLine.arguments.dropFirst().first == "--owned-wait" {
            _ = Darwin.signal(SIGINT, SIG_DFL); _ = Darwin.signal(SIGTERM, SIG_DFL)
            Darwin.sleep(20); exit(0)
        }
        do {
            let result = try await ArtiProcessAdapter().exerciseActualExitFence(executable: URL(fileURLWithPath: CommandLine.arguments[0]))
            print(String(decoding: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), as: UTF8.self))
            exit(result["status"] as? String == "EXPECTED_RED" ? 1 : 0)
        } catch {
            print("{\"status\":\"FAIL\",\"firstCause\":\"actual_adapter_exit_fence_fixture\",\"network\":\"NOT_RUN\"}")
            exit(2)
        }
    }
}
