import CryptoKit
import Foundation

// Retain the inherited device-p256 item and original UTF-8/base64 representation.
final class MusicDeviceSigner {
    static let shared=MusicDeviceSigner(credentials:.shared)
    private let credentials: MusicCredentials
    init(credentials: MusicCredentials) { self.credentials=credentials }
    func compressedPublicKey(allowCreation: Bool=true) throws -> String {
        let exists=try credentials.hasDeviceKey()
        let canCreate=try allowCreation && !exists && credentials.session()==nil
        return Self.encode(try credentials.deviceKey(allowCreation:canCreate).publicKey.compressedRepresentation)
    }
    func signProtocolBytes(_ bytes: Data) throws -> String { Self.encode(try credentials.deviceKey(allowCreation:false).signature(for:bytes).derRepresentation) }
    private static func encode(_ bytes: Data) -> String { bytes.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
}

@MainActor enum MusicNativeHTTP { static let api=URL(string:"https://web4.ynxweb4.com/music")! }
