import Foundation
import Testing
@testable import YNXBrowserCore

@Suite("Native download persistence boundary")
struct DownloadPersistenceTests {
    @Test("normal then private persists only the normal record")
    func normalPrivatePair() throws {
        let (suite, defaults) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let finishedAt = Date(timeIntervalSince1970: 1_785_148_800)

        let normal = BrowserDownloadContext(
            source: "https://downloads.ynx.test/browser-release.zip",
            isPrivate: false,
            destinationFilename: "browser-release.zip"
        )
        let normalOutcome = BrowserDownloadPersistence.persistFinishedDownload(
            context: normal,
            defaults: defaults,
            finishedAt: finishedAt
        )
        let dataAfterNormal = try #require(defaults.data(forKey: BrowserDownloadPersistence.defaultsKey))

        let privateDownload = BrowserDownloadContext(
            source: "https://private.ynx.test/private-export.zip",
            isPrivate: true,
            destinationFilename: "private-export.zip"
        )
        let privateOutcome = BrowserDownloadPersistence.persistFinishedDownload(
            context: privateDownload,
            defaults: defaults,
            finishedAt: finishedAt.addingTimeInterval(1)
        )

        #expect(normalOutcome == .persisted(BrowserDownloadRecord(
            filename: "browser-release.zip",
            source: "https://downloads.ynx.test/browser-release.zip",
            finishedAt: finishedAt
        )))
        #expect(privateOutcome == .omittedPrivate)
        #expect(defaults.data(forKey: BrowserDownloadPersistence.defaultsKey) == dataAfterNormal)

        let records = BrowserDownloadPersistence.decodeRecords(from: dataAfterNormal)
        #expect(records.count == 1)
        #expect(records[0].filename == "browser-release.zip")
        #expect(records[0].source == "https://downloads.ynx.test/browser-release.zip")
        #expect(records.allSatisfy { $0.source != "https://private.ynx.test/private-export.zip" })
    }

    @Test("private-only completion writes no downloads metadata")
    func privateOnlyWritesNothing() {
        let (suite, defaults) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }

        let outcome = BrowserDownloadPersistence.persistFinishedDownload(
            context: BrowserDownloadContext(
                source: "https://private.ynx.test/confidential.pdf",
                isPrivate: true,
                destinationFilename: "confidential.pdf"
            ),
            defaults: defaults
        )

        #expect(outcome == .omittedPrivate)
        #expect(defaults.object(forKey: BrowserDownloadPersistence.defaultsKey) == nil)
    }

    @Test("normal persistence preserves initiating source attribution")
    func preservesInitiatingSource() throws {
        let (suite, defaults) = isolatedDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }

        _ = BrowserDownloadPersistence.persistFinishedDownload(
            context: BrowserDownloadContext(
                source: "https://origin-a.ynx.test/release.pkg",
                isPrivate: false,
                destinationFilename: "release.pkg"
            ),
            defaults: defaults
        )

        let records = BrowserDownloadPersistence.decodeRecords(
            from: defaults.data(forKey: BrowserDownloadPersistence.defaultsKey)
        )
        let record = try #require(records.first)
        #expect(record.source == "https://origin-a.ynx.test/release.pkg")
        #expect(record.filename == "release.pkg")
    }

    private func isolatedDefaults() -> (String, UserDefaults) {
        let suite = "com.ynxweb4.browser.tests.\(UUID().uuidString)"
        return (suite, UserDefaults(suiteName: suite)!)
    }
}
