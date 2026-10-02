import CryptoKit
import Foundation
import Security

// Every Keychain operation is injected. This executable never accesses the
// user's real Keychain or ProductDeviceKey.shared.
@main enum NativeKeyPreservationChecks {
    struct Failure: Error { let message: String }
    static func require(_ value: Bool, _ message: String) throws {
        if !value { throw Failure(message: message) }
    }
    static func reject(_ store: ProductDeviceKey) throws {
        do {
            _ = try store.compressedPublicKey()
            throw Failure(message: "unavailable storage issued a device key")
        } catch is ProductDeviceKey.StorageError {}
    }
    static func encoded(_ key: P256.Signing.PrivateKey) -> String {
        key.publicKey.compressedRepresentation.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func main() throws {
        let original = P256.Signing.PrivateKey()
        var creates = 0, adds = 0
        let retained = ProductDeviceKey(read: { (errSecSuccess, original.rawRepresentation) },
            add: { _ in adds += 1; return errSecSuccess },
            create: { creates += 1; return P256.Signing.PrivateKey() })
        let publicKey = try retained.compressedPublicKey()
        try require(publicKey == encoded(original) && creates == 0 && adds == 0,
                    "existing key was not preserved")
        let compressed = Data(base64Encoded: publicKey.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/"))!
        try require(compressed.count == 33 && [2, 3].contains(compressed[0]),
                    "device key must use canonical compressed P-256 encoding")

        for status in [errSecInteractionNotAllowed, errSecAuthFailed, errSecNotAvailable, errSecDecode] {
            let unavailable = ProductDeviceKey(read: { (status, nil) },
                add: { _ in adds += 1; return errSecSuccess },
                create: { creates += 1; return P256.Signing.PrivateKey() })
            try reject(unavailable)
        }
        for data in [nil, Data([1, 2, 3])] as [Data?] {
            let damaged = ProductDeviceKey(read: { (errSecSuccess, data) },
                add: { _ in adds += 1; return errSecSuccess },
                create: { creates += 1; return P256.Signing.PrivateKey() })
            try reject(damaged)
        }
        try require(creates == 0 && adds == 0, "read failures generated or replaced a key")

        var stored: Data?, firstAdds = 0, firstCreates = 0
        let first = ProductDeviceKey(read: { (stored == nil ? errSecItemNotFound : errSecSuccess, stored) },
            add: { data in stored = data; firstAdds += 1; return errSecSuccess },
            create: { firstCreates += 1; return original })
        let firstKey = try first.compressedPublicKey()
        let restoredKey = try first.compressedPublicKey()
        try require(firstKey == encoded(original) && restoredKey == firstKey && stored == original.rawRepresentation,
                    "first-use key did not persist and restore")
        try require(firstAdds == 1 && firstCreates == 1, "restoration recreated the device")

        var locked = true, recoveryAdds = 0
        let recovery = ProductDeviceKey(read: { locked ? (errSecInteractionNotAllowed, nil) : (errSecSuccess, original.rawRepresentation) },
            add: { _ in recoveryAdds += 1; return errSecSuccess },
            create: { creates += 1; return P256.Signing.PrivateKey() })
        try reject(recovery)
        locked = false
        let recoveredKey = try recovery.compressedPublicKey()
        try require(recoveredKey == encoded(original) && recoveryAdds == 0 && creates == 0,
                    "retry after unlock failed to recover original identity")

        var winner: Data?, raceAdds = 0
        let raced = ProductDeviceKey(read: { (winner == nil ? errSecItemNotFound : errSecSuccess, winner) },
            add: { _ in winner = original.rawRepresentation; raceAdds += 1; return errSecDuplicateItem },
            create: { P256.Signing.PrivateKey() })
        let winningKey = try raced.compressedPublicKey()
        try require(winningKey == encoded(original) && winner == original.rawRepresentation && raceAdds == 1,
                    "creation race failed to use the winner's persisted key")

        for status in [errSecInteractionNotAllowed, errSecAuthFailed, errSecNotAvailable] {
            var attempts = 0
            let failedWrite = ProductDeviceKey(read: { (errSecItemNotFound, nil) },
                add: { _ in attempts += 1; return status }, create: { original })
            try reject(failedWrite)
            try require(attempts == 1, "failed write attempted destructive recovery")
        }

        for result in [(errSecInteractionNotAllowed, nil), (errSecItemNotFound, nil), (errSecSuccess, Data([1, 2, 3]))] as [(OSStatus, Data?)] {
            var reads = 0, attempts = 0
            let failedRace = ProductDeviceKey(read: {
                reads += 1
                return reads == 1 ? (errSecItemNotFound, nil) : result
            }, add: { _ in attempts += 1; return errSecDuplicateItem }, create: { original })
            try reject(failedRace)
            try require(reads == 2 && attempts == 1, "unavailable race winner was replaced or retried indefinitely")
        }
        print("PASS: Video device key preservation, first use, unlock recovery, creation races, failed writes, and canonical 33-byte encoding (injected storage only)")
    }
}
