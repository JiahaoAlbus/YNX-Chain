import CryptoKit
import Darwin
import Foundation

// This overload exists only in the extracted-method fixture. It moves real files exactly
// between descriptor validation and the Darwin read without changing the extracted source.
func pread(_ fd: Int32, _ bytes: UnsafeMutableRawPointer, _ count: Int, _ offset: off_t) -> Int {
    let arguments = CommandLine.arguments
    if offset == 0 && arguments.count == 3 {
        let root = URL(fileURLWithPath: arguments[2], isDirectory: true)
        let marker = root.appendingPathComponent("before-read")
        if arguments[1] == "dispatcher-raced-replace" {
            let command = root.appendingPathComponent("command.json")
            if rename(marker.path, command.path) != 0 { precondition(errno == ENOENT) }
        } else if arguments[1] == "dispatcher-raced-growth" && unlink(marker.path) == 0 {
            let writeFD = open(root.appendingPathComponent("command.json").path, O_WRONLY | O_APPEND | O_NOFOLLOW)
            precondition(writeFD >= 0)
            var value: UInt8 = 0x61
            precondition(Darwin.write(writeFD, &value, 1) == 1)
            precondition(close(writeFD) == 0)
        }
    }
    return Darwin.pread(fd, bytes, count, offset)
}

@main struct ProtectedPrivateInputProbe {
    @MainActor static func main() throws {
        let arguments = CommandLine.arguments
        guard arguments.count == 3 else { throw ProtectedAcceptanceFailure.malformedInput }
        let operation = arguments[1], directory = URL(fileURLWithPath: arguments[2], isDirectory: true)
        let manifest = directory.appendingPathComponent("manifest.json")
        let bootstrap = directory.appendingPathComponent("bootstrap.html")
        let command = directory.appendingPathComponent("command.json")
        func hex(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
        func write(_ text: String, to url: URL) throws {
            try Data(text.utf8).write(to: url, options: .withoutOverwriting)
            guard chmod(url.path, 0o600) == 0 else { throw ProtectedAcceptanceFailure.malformedInput }
        }
        var held = false
        func attempt() throws -> Data {
            if operation.hasPrefix("dispatcher") {
                return try ProtectedAcceptanceDispatcher.probePrivate(command, maximum: 4096,
                    command: operation != "dispatcher-launch-fifo", sameDirectory: held)
            }
            let manifestDigest = operation == "consumer-valid"
                ? try hex(Data(contentsOf: manifest)) : String(repeating: "a", count: 64)
            let value = try ProtectedAcceptanceConsumer.Input.read(manifestURL: manifest, expectedManifestSHA256: manifestDigest,
                bootstrapURL: bootstrap, expectedBootstrapSHA256: hex(Data("<html></html>".utf8)))
            return Data(value.runID.utf8)
        }
        if operation == "dispatcher-directory-replace" {
            held = true
            let first = try attempt()
            precondition(first == Data("old command".utf8))
            let original = directory.appendingPathExtension("original")
            let replacement = directory.appendingPathExtension("replacement")
            guard rename(directory.path, original.path) == 0,
                  rename(replacement.path, directory.path) == 0 else { throw ProtectedAcceptanceFailure.malformedInput }
            do { _ = try attempt() }
            catch ProtectedAcceptanceDispatchFailure.invalidLaunch { print("Rejected a different private directory during the same run"); return }
            print("Accepted command from the replacement directory")
            exit(1)
        } else if operation == "dispatcher-replace" {
            held = true
            let first = try attempt()
            precondition(first == Data("old command".utf8))
            let next = directory.appendingPathComponent("command.next")
            try write("new command", to: next)
            guard rename(next.path, command.path) == 0 else { throw ProtectedAcceptanceFailure.malformedInput }
            let second = try attempt()
            precondition(second == Data("new command".utf8))
            print("Accepted two complete command generations across atomic rename")
        } else if operation == "dispatcher-raced-replace" {
            let accepted = try attempt()
            precondition(accepted == Data("raced new command".utf8))
            print("Rejected displaced file bytes and returned the exact atomic replacement")
        } else if operation == "consumer-valid" {
            let accepted = try attempt()
            precondition(accepted == Data("native-input-bounds".utf8))
            print("Accepted exact pinned immutable input")
        } else {
            do { _ = try attempt() }
            catch { print("Rejected \(operation)"); return }
            preconditionFailure("Unexpectedly accepted \(operation)")
        }
    }
}
