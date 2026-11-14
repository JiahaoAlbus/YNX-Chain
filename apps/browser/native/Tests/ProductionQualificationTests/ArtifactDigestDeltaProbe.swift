@main enum ArtifactDigestDeltaProbe {
    static func main() throws {
        let arguments = CommandLine.arguments
        let url = URL(fileURLWithPath: arguments[2])
        switch arguments[1] {
        case "regular":
            let expected = arguments[3]
            let capture = try NormalCaptureArtifactReader.digest(url)
            let qualification = try RoutedQualificationIdentity.digestFile(url)
            guard capture == expected, qualification == expected else { throw Failure.unexpectedDigest }
        case "fifo":
            do {
                _ = try NormalCaptureArtifactReader.digest(url)
                throw Failure.acceptedChangedArtifact
            } catch RoutedNormalCaptureFailure.wrongArtifact {}
            do {
                _ = try RoutedQualificationIdentity.digestFile(url)
                throw Failure.acceptedChangedArtifact
            } catch RoutedQualificationFailure.installationChanged {}
        case "growth", "replacement":
            var requests = [Int]()
            let size = Int(arguments[3])!
            let replacement = arguments.count == 5 ? arguments[4] : nil
            do {
                _ = try ScheduledArtifactReader.digest(url, afterStat: {
                    if let replacement {
                        guard Darwin.rename(replacement, url.path) == 0 else { throw Failure.fixtureMutation }
                    } else {
                        let writer = try FileHandle(forWritingTo: url)
                        defer { try? writer.close() }
                        try writer.seekToEnd()
                        try writer.write(contentsOf: Data(repeating: 0x80, count: 65_536))
                    }
                }, beforeRead: { requests.append($0) })
                throw Failure.acceptedChangedArtifact
            } catch RoutedNormalCaptureFailure.wrongArtifact {}
            guard requests == [65_536, size - 65_536, 1] else { throw Failure.unexpectedReadBudget }
        #if P05_ORIGINAL_DIGEST
        case "old-fifo":
            try FileHandle.standardOutput.write(contentsOf: Data("ABOUT_TO_OPEN_ORIGINAL\n".utf8))
            _ = try OriginalArtifactReader.digest(url)
            throw Failure.acceptedChangedArtifact
        #endif
        default:
            throw Failure.unexpectedMode
        }
        print("PASS \(arguments[1])")
    }

    enum Failure: Error {
        case unexpectedMode, unexpectedDigest, acceptedChangedArtifact, unexpectedReadBudget, fixtureMutation
    }
}
