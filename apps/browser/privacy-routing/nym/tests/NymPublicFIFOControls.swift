import Darwin
import Foundation

@main struct NymPublicFIFOControls {
    static func main() throws {
        let arguments = CommandLine.arguments
        let parent = URL(fileURLWithPath: arguments[1], isDirectory: true)
        switch arguments[2] {
        case "scratch":
            let scratch = try NymPublicScratch.create(parent: parent)
            try scratch.makeDirectory("data")
            let fixture = Data("REGULAR_FIXTURE".utf8)
            try scratch.writeNew(fixture, relative: "data/config.toml")
            let readback = try scratch.read("data/config.toml", limit: 1024)
            precondition(readback == fixture)
            let fifo = scratch.path("data/public_identity.pem")
            precondition(mkfifo(fifo.path, 0o600) == 0)
            FileHandle.standardOutput.write(Data("ENTER_NO_WRITER_FIFO scratch\n".utf8))
            do {
                _ = try scratch.read("data/public_identity.pem", limit: 1024)
                preconditionFailure("FIFO reached scratch data consumer")
            } catch NymPublicRuntimeFailure.unsafeProfile {}
        case "manifest":
            let app = parent.appendingPathComponent("Fixture.app", isDirectory: true)
            let contents = app.appendingPathComponent("Contents", isDirectory: true)
            let resource = contents.appendingPathComponent("Resources", isDirectory: true)
            let supply = resource.appendingPathComponent("NymPublicRuntime", isDirectory: true)
            try FileManager.default.createDirectory(at: supply, withIntermediateDirectories: true)
            let info = try PropertyListSerialization.data(fromPropertyList: [
                "CFBundleIdentifier": "com.ynx.fixture.nym-fifo", "CFBundlePackageType": "APPL"
            ], format: .xml, options: 0)
            try info.write(to: contents.appendingPathComponent("Info.plist"))
            guard let bundle = Bundle(url: app), bundle.resourceURL?.path == resource.path else {
                throw CocoaError(.fileReadCorruptFile)
            }
            precondition(mkfifo(supply.appendingPathComponent("manifest.json").path, 0o600) == 0)
            FileHandle.standardOutput.write(Data("ENTER_NO_WRITER_FIFO manifest\n".utf8))
            do {
                _ = try NymPublicExecutableSupply.load(bundle: bundle)
                preconditionFailure("FIFO reached supply data consumer")
            } catch NymPublicRuntimeFailure.supplyRejected {}
        default:
            preconditionFailure("unknown FIFO fixture")
        }
        print("PASS native no-writer FIFO rejected at regular-file boundary")
    }
}
