import Foundation

public struct BrowserDownloadRecord: Codable, Equatable, Sendable {
    public let filename: String
    public let source: String
    public let finishedAt: Date

    public init(filename: String, source: String, finishedAt: Date) {
        self.filename = filename
        self.source = source
        self.finishedAt = finishedAt
    }
}

public struct BrowserDownloadContext: Equatable, Sendable {
    public let source: String
    public let isPrivate: Bool
    public var destinationFilename: String?

    public init(source: String, isPrivate: Bool, destinationFilename: String? = nil) {
        self.source = source
        self.isPrivate = isPrivate
        self.destinationFilename = destinationFilename
    }
}

public enum BrowserDownloadPersistenceOutcome: Equatable, Sendable {
    case omittedPrivate
    case persisted(BrowserDownloadRecord)
}

public enum BrowserDownloadPersistence {
    public static let defaultsKey = "downloads"

    @discardableResult
    public static func persistFinishedDownload(
        context: BrowserDownloadContext,
        defaults: UserDefaults,
        finishedAt: Date = Date(),
        limit: Int = 500
    ) -> BrowserDownloadPersistenceOutcome {
        guard context.isPrivate == false else {
            return .omittedPrivate
        }

        let record = BrowserDownloadRecord(
            filename: context.destinationFilename ?? "User-selected file",
            source: context.source,
            finishedAt: finishedAt
        )
        var records = decodeRecords(from: defaults.data(forKey: defaultsKey))
        records.insert(record, at: 0)
        let bounded = Array(records.prefix(max(1, limit)))
        if let data = try? JSONEncoder().encode(bounded) {
            defaults.set(data, forKey: defaultsKey)
        }
        return .persisted(record)
    }

    public static func decodeRecords(from data: Data?) -> [BrowserDownloadRecord] {
        guard let data else { return [] }
        return (try? JSONDecoder().decode([BrowserDownloadRecord].self, from: data)) ?? []
    }
}
