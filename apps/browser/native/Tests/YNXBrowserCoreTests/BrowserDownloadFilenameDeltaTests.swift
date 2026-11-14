import Foundation
import Testing
@testable import YNXBrowserCore

@Suite("Download filename filesystem regression")
struct BrowserDownloadFilenameDeltaTests {
    @Test("Long emoji suggestion keeps its extension and commits real bytes")
    func emojiSuggestion() throws {
        let name = BrowserDownloadFile.safeFilename(String(repeating: "😀", count: 160) + ".zip")
        #expect(name.hasSuffix(".zip"))
        try commitAndRead(name)
    }

    @Test("One oversized combining cluster does not survive as an invalid filename")
    func combiningSuggestion() throws {
        let input = "A" + String(repeating: "\u{0301}", count: 600) + ".zip"
        let name = BrowserDownloadFile.safeFilename(input)
        #expect(name == "Download.zip")
        try commitAndRead(name)
    }

    @Test("Existing valid Chinese names retain their exact spelling")
    func validChineseSuggestion() throws {
        let input = String(repeating: "汉", count: 100) + ".zip"
        let name = BrowserDownloadFile.safeFilename(input)
        #expect(name == input)
        try commitAndRead(name)
    }

    private func commitAndRead(_ name: String) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let bytes = Data("Owned complete filename regression bytes".utf8)
        let destination = directory.appendingPathComponent(name)
        let staging = BrowserDownloadFile.stagingURL(for: destination)
        try bytes.write(to: staging)
        try BrowserDownloadFile.commit(staging: staging, destination: destination)
        #expect(try Data(contentsOf: destination) == bytes)
        #expect(!FileManager.default.fileExists(atPath: staging.path))
    }
}
