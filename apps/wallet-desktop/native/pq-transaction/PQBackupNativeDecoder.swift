// Original encrypted PQ backup format, opened INSIDE the Native process.
// No Keychain item/new store, JS DER, generic signing callback or account grant.
// Only an existing Main private review/current/once caller may select this body.
import Foundation
import CryptoKit
import CommonCrypto
@_silgen_name("ynx_auth_native_wipe_v1") private func nativeWipe(_ buffer: UnsafeMutableRawPointer, _ count: Int)

enum PQNativeFailure: Error { case bounds, canonical, binding, authentication, closed, purpose, duplicate, crypto(Int32, UInt32) }
enum PQNativePurpose: UInt32 { case transaction = 1, accountInitial = 2 }
#if YNX_ACCOUNT_INITIAL_NATIVE_V1
fileprivate struct PQInitialSelection {
    let message: Data, genesis: Data, independentPin: Data, height: Data
    let nativeChainID: UInt64
}
#endif

// Native owned buffer. Logical overwrite of these allocations is explicit;
// neither this nor CryptoKit claims physical erasure of internal library heaps.
final class PQNativeBytes {
    let count: Int
    fileprivate var raw: UnsafeMutableRawPointer?
    init(count: Int) throws {
        guard count > 0 && count <= 67_108_864 else { throw PQNativeFailure.bounds }
        self.count = count; raw = .allocate(byteCount: count, alignment: 16)
        raw!.initializeMemory(as: UInt8.self, repeating: 0, count: count)
    }
    convenience init(publicData: Data) throws {
        try self.init(count: publicData.count)
        publicData.withUnsafeBytes { bytes in raw!.copyMemory(from: bytes.baseAddress!, byteCount: count) }
    }
    func wipe() { if let p = raw { nativeWipe(p, count) } }
    deinit { wipe(); raw?.deallocate(); raw = nil }
}

// This is custody/data, NOT a trusted policy, Genesis admission, approval or
// Root. Full public binding is independently supplied by Main's reviewed source.
final class PQNativeOpenedAccount {
    let purpose: PQNativePurpose
    let binding: Data, network: Data, owner: Data, pkA: Data, pkB: Data
    fileprivate let keys: PQNativeBytes
    fileprivate let thread: pthread_t
    fileprivate var selected = false, retired = false, first: PQNativeFailure?
    fileprivate var closeResult: Result<Void, PQNativeFailure>?
    fileprivate var output: PQNativeBytes?
    fileprivate var outputLength = 0
    fileprivate var primitiveStatus: Int32 = -1, primitiveCleanup: UInt32 = 0
    #if YNX_ACCOUNT_INITIAL_NATIVE_V1
    fileprivate var initialSelection: PQInitialSelection?
    #endif
    fileprivate init(purpose: PQNativePurpose, binding: Data, network: Data, owner: Data, pkA: Data, pkB: Data, keys: PQNativeBytes) {
        self.purpose = purpose; self.binding = binding; self.network = network; self.owner = owner
        self.pkA = pkA; self.pkB = pkB; self.keys = keys; thread = pthread_self()
    }
    func current() throws {
        guard pthread_equal(thread, pthread_self()) != 0 && !retired && closeResult == nil else { throw PQNativeFailure.closed }
        if let cause = first { throw cause }
    }
    func retire() throws { guard pthread_equal(thread, pthread_self()) != 0 else { throw PQNativeFailure.closed }; retired = true }
    // Same first cleanup outcome is returned on repeated close. Failed signing
    // is not made successful by zeroing storage or returning an empty pointer.
    func close() -> Result<Void, PQNativeFailure> {
        guard pthread_equal(thread, pthread_self()) != 0 else { return .failure(.closed) }
        if let result = closeResult { return result }
        retired = true; keys.wipe()
        let result: Result<Void, PQNativeFailure> = first.map { .failure($0) } ?? .success(())
        closeResult = result; return result
    }
    deinit { keys.wipe() }
    func closedForNativeRelease() -> Bool { pthread_equal(thread, pthread_self()) != 0 && closeResult != nil }

    private func span(_ bytes: PQNativeBytes, offset: Int = 0, length: Int? = nil) -> YNXTransactionBytesV1 {
        YNXTransactionBytesV1(bytes: UnsafePointer(bytes.raw!.advanced(by: offset).assumingMemoryBound(to: UInt8.self)), length: length ?? bytes.count)
    }
    fileprivate static func positiveU64(_ text: String) throws -> Data {
        guard !text.isEmpty && text.utf8.count <= 20 && text.utf8.first != 48 && text.utf8.allSatisfy({ (48...57).contains($0) }), let value = UInt64(text), value > 0, String(value) == text else { throw PQNativeFailure.canonical }
        return Data(text.utf8)
    }
    // Fixed ordinary transaction producer. Genuine policy/current/review,
    // original nonce journal and independent broadcast permission remain Main's
    // real caller operands, not inferred from the public expected DTO.
    func attemptTransaction(message: Data, policy: Data, nativeChainID: UInt64, keyVersion: String, executionHeight: String) throws {
        try current(); guard purpose == .transaction else { throw PQNativeFailure.purpose }
        guard !selected else { throw PQNativeFailure.duplicate }
        guard nativeChainID > 0 && !message.isEmpty && message.count <= 8192 && !policy.isEmpty && policy.count <= 8_388_608 else { throw PQNativeFailure.bounds }
        let version = try Self.positiveU64(keyVersion), height = try Self.positiveU64(executionHeight)
        selected = true
        defer { keys.wipe() }
        do {
            let m = try PQNativeBytes(publicData: message), p = try PQNativeBytes(publicData: policy)
            let n = try PQNativeBytes(publicData: network), o = try PQNativeBytes(publicData: owner)
            let v = try PQNativeBytes(publicData: version), h = try PQNativeBytes(publicData: height)
            let a = try PQNativeBytes(publicData: pkA), b = try PQNativeBytes(publicData: pkB)
            let member = try PQNativeBytes(count: 98_304); output = member
            var request = YNXTransactionBatchRequestV1()
            request.abi_version = 1; request.struct_size = MemoryLayout<YNXTransactionBatchRequestV1>.size
            request.message_original = span(m); request.policy_original = span(p)
            request.expected = YNXTransactionExpectedV1(network_id: span(n), owner: span(o), native_chain_id: nativeChainID, key_version: span(v), execution_height: span(h), pk_a: span(a), pk_b: span(b))
            request.pkcs8_a = span(keys, length: 54); request.pkcs8_b = span(keys, offset: 54, length: 150)
            request.pk_a = span(a); request.pk_b = span(b)
            var length = 0, cleanup: UInt32 = 0
            let status = YNXTransactionBatchSignV1(&request, member.raw!.assumingMemoryBound(to: UInt8.self), member.count, &length, &cleanup)
            // Retain original public output/status BEFORE every late check.
            // No sizing call, replacement signing or generic callback signer.
            primitiveStatus = status; primitiveCleanup = cleanup; outputLength = length
            guard status == 0 && cleanup == 2 && length > 0 && length <= member.count else { throw PQNativeFailure.crypto(status, cleanup) }
            try current()
        } catch let cause as PQNativeFailure { if first == nil { first = cause }; throw cause }
        catch { if first == nil { first = .closed }; throw PQNativeFailure.closed }
    }
    #if YNX_ACCOUNT_INITIAL_NATIVE_V1
    // Dedicated birth path; all public selection bytes were captured BEFORE
    // Native private backup opening. No active policy/version/nonce override,
    // replacement message/Genesis/pin/H argument or ordinary transfer routing.
    func attemptAccountInitial() throws {
        try current(); guard purpose == .accountInitial, let original = initialSelection else { throw PQNativeFailure.purpose }
        guard !selected else { throw PQNativeFailure.duplicate }
        selected = true; defer { keys.wipe() }
        do {
            let m = try PQNativeBytes(publicData: original.message), g = try PQNativeBytes(publicData: original.genesis)
            let pin = try PQNativeBytes(publicData: original.independentPin), h = try PQNativeBytes(publicData: original.height)
            let n = try PQNativeBytes(publicData: network), o = try PQNativeBytes(publicData: owner)
            let a = try PQNativeBytes(publicData: pkA), b = try PQNativeBytes(publicData: pkB)
            func initialSpan(_ bytes: PQNativeBytes, offset: Int = 0, length: Int? = nil) -> YNXAccountInitialBytesV1 {
                YNXAccountInitialBytesV1(bytes: UnsafePointer(bytes.raw!.advanced(by: offset).assumingMemoryBound(to: UInt8.self)), length: length ?? bytes.count)
            }
            let member = try PQNativeBytes(count: 98_304); output = member
            var request = YNXAccountInitialRequestV1()
            request.abi_version = 1; request.struct_size = MemoryLayout<YNXAccountInitialRequestV1>.size
            request.message_original = initialSpan(m); request.genesis_original = initialSpan(g)
            request.expected = YNXAccountInitialExpectedV1(genesis_sha256: initialSpan(pin), network_id: initialSpan(n), owner: initialSpan(o), native_chain_id: original.nativeChainID, execution_height: initialSpan(h), pk_a: initialSpan(a), pk_b: initialSpan(b))
            request.pkcs8_a = initialSpan(keys, length: 54); request.pkcs8_b = initialSpan(keys, offset: 54, length: 150)
            request.pk_a = initialSpan(a); request.pk_b = initialSpan(b)
            var length = 0, cleanup: UInt32 = 0
            let status = YNXAccountInitialSignV1(&request, member.raw!.assumingMemoryBound(to: UInt8.self), member.count, &length, &cleanup)
            primitiveStatus = status; primitiveCleanup = cleanup; outputLength = length
            guard status == 0 && cleanup == 2 && length > 0 && length <= member.count else { throw PQNativeFailure.crypto(status, cleanup) }
            try current()
        } catch let cause as PQNativeFailure { if first == nil { first = cause }; throw cause }
        catch { if first == nil { first = .closed }; throw PQNativeFailure.closed }
    }
    #endif
    // Public-only reconciliation remains available after late lock/close/error.
    func copyOriginalOutcome() throws -> (selected: Bool, status: Int32, cleanup: UInt32, member: Data?) {
        guard pthread_equal(thread, pthread_self()) != 0 else { throw PQNativeFailure.closed }
        let member: Data?
        if primitiveStatus == 0 && primitiveCleanup == 2 && outputLength > 0, let output = output, outputLength <= output.count {
            member = Data(bytes: output.raw!, count: outputLength)
        } else { member = nil }
        return (selected, primitiveStatus, primitiveCleanup, member)
    }
    #if YNX_AUTH_PQ_CUSTODY_TEST
    func keysAreClearedForControl() -> Bool { UnsafeBufferPointer(start: keys.raw!.assumingMemoryBound(to: UInt8.self), count: keys.count).allSatisfy { $0 == 0 } }
    #if YNX_ACCOUNT_INITIAL_NATIVE_V1
    func initialOriginalsForControl() -> (Data, Data, Data, Data, UInt64)? {
        guard let s = initialSelection else { return nil }; return (s.message, s.genesis, s.independentPin, s.height, s.nativeChainID)
    }
    #endif
    #endif
}

enum PQBackupNativeDecoder {
    private static let protocolName = "YNX-BATCH/v0.1"
    private static let suite = "ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"
    #if YNX_ACCOUNT_INITIAL_NATIVE_V1
    static func openInitial(wire: Data, credential: UnsafeBufferPointer<UInt8>, expectedBinding: Data, message: Data, genesis: Data, independentPin: Data, nativeChainID: UInt64, executionHeight: String) throws -> PQNativeOpenedAccount {
        guard !message.isEmpty && message.count <= 4096 && !genesis.isEmpty && genesis.count <= 67_108_864 && independentPin.count == 32 && nativeChainID > 0 else { throw PQNativeFailure.bounds }
        let height = try PQNativeOpenedAccount.positiveU64(executionHeight)
        // This ONLY compares supplied pin to bytes. It does not authenticate
        // that pin's issuer/Root, grant admission or check on-chain occupancy.
        // Main's independently authenticated original selection owns those.
        guard Data(SHA256.hash(data: genesis)) == independentPin else { throw PQNativeFailure.binding }
        let selection = PQInitialSelection(message: message, genesis: genesis, independentPin: independentPin, height: height, nativeChainID: nativeChainID)
        let owner = try open(wire: wire, credential: credential, expectedBinding: expectedBinding, purpose: .accountInitial)
        owner.initialSelection = selection; return owner
    }
    #endif
    private static func object(_ value: Any?, _ keys: [String]) throws -> [String: Any] {
        guard let v = value as? [String: Any], Set(v.keys) == Set(keys) else { throw PQNativeFailure.canonical }; return v
    }
    private static func publicBase64(_ text: String, _ count: Int) throws -> Data {
        let bytes = Array(text.utf8), out = try PQNativeBytes(count: count)
        try bytes.withUnsafeBufferPointer { try decode($0, to: out.raw!.assumingMemoryBound(to: UInt8.self), count: count) }
        return Data(bytes: out.raw!, count: count)
    }
    // Streaming canonical base64url decode. Private plaintext is NEVER a Swift
    // String/NSDictionary, so no immutable private-DER/base64 strings escape.
    private static func decode(_ input: UnsafeBufferPointer<UInt8>, to out: UnsafeMutablePointer<UInt8>, count: Int) throws {
        guard input.count == (count * 8 + 5) / 6 else { throw PQNativeFailure.canonical }
        var bits: UInt32 = 0, width = 0, written = 0
        for byte in input {
            let digit: UInt32
            switch byte { case 65...90: digit = UInt32(byte - 65); case 97...122: digit = UInt32(byte - 97 + 26)
            case 48...57: digit = UInt32(byte - 48 + 52); case 45: digit = 62; case 95: digit = 63; default: throw PQNativeFailure.canonical }
            bits = (bits << 6) | digit; width += 6
            if width >= 8 { width -= 8; guard written < count else { throw PQNativeFailure.bounds }; out[written] = UInt8((bits >> UInt32(width)) & 255); written += 1 }
            bits &= width == 0 ? 0 : (1 << UInt32(width)) - 1
        }
        guard written == count && bits == 0 else { throw PQNativeFailure.canonical }
    }
    static func open(wire: Data, credential: UnsafeBufferPointer<UInt8>, expectedBinding: Data, purpose: PQNativePurpose) throws -> PQNativeOpenedAccount {
        guard !wire.isEmpty && wire.count <= 196_608 && !expectedBinding.isEmpty && expectedBinding.count <= 8192 && credential.count == 43 else { throw PQNativeFailure.bounds }
        let expected = try object(JSONSerialization.jsonObject(with: expectedBinding), ["protocolVersion", "suite", "chainId", "owner", "pkA", "pkB"])
        guard expected["protocolVersion"] as? String == protocolName, expected["suite"] as? String == suite,
              let chain = expected["chainId"] as? String, chain.utf8.count == 64, chain.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let owner = expected["owner"] as? String, owner.utf8.count == 42, owner.hasPrefix("0x"), owner.utf8.dropFirst(2).allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let a = expected["pkA"] as? String, let b = expected["pkB"] as? String else { throw PQNativeFailure.binding }
        let pkA = try publicBase64(a, 2592), pkB = try publicBase64(b, 64)
        let binding = Data("{\"protocolVersion\":\"\(protocolName)\",\"suite\":\"\(suite)\",\"chainId\":\"\(chain)\",\"owner\":\"\(owner)\",\"pkA\":\"\(a)\",\"pkB\":\"\(b)\"}".utf8)
        guard binding == expectedBinding else { throw PQNativeFailure.canonical }
        let e = try object(JSONSerialization.jsonObject(with: wire), ["format", "binding", "kdf", "cipher", "ciphertext"])
        let kdf = try object(e["kdf"], ["algorithm", "iterations", "salt"]), cipher = try object(e["cipher"], ["algorithm", "nonce"])
        guard e["format"] as? String == "YNX-PQ-WALLET-BACKUP/v1", let actual = e["binding"] as? [String: Any], NSDictionary(dictionary: actual).isEqual(to: expected),
              kdf["algorithm"] as? String == "PBKDF2-HMAC-SHA256", let rounds = kdf["iterations"] as? NSNumber, CFGetTypeID(rounds) != CFBooleanGetTypeID(), rounds.intValue == 600_000,
              cipher["algorithm"] as? String == "AES-256-GCM", let saltText = kdf["salt"] as? String, let nonceText = cipher["nonce"] as? String, let encryptedText = e["ciphertext"] as? String else { throw PQNativeFailure.binding }
        let salt = try publicBase64(saltText, 32), nonce = try publicBase64(nonceText, 12)
        let header = Data("{\"format\":\"YNX-PQ-WALLET-BACKUP/v1\",\"binding\":\(String(decoding: binding, as: UTF8.self)),\"kdf\":{\"algorithm\":\"PBKDF2-HMAC-SHA256\",\"iterations\":600000,\"salt\":\"\(saltText)\"},\"cipher\":{\"algorithm\":\"AES-256-GCM\",\"nonce\":\"\(nonceText)\"}}".utf8)
        guard encryptedText.utf8.count > 20 && encryptedText.utf8.count <= 253_334,
              Data((String(decoding: header.dropLast(), as: UTF8.self) + ",\"ciphertext\":\"" + encryptedText + "\"}").utf8) == wire else { throw PQNativeFailure.canonical }
        let encoded = Array(encryptedText.utf8), encryptedSize = encoded.count * 6 / 8
        let encrypted = try PQNativeBytes(count: encryptedSize)
        try encoded.withUnsafeBufferPointer { try decode($0, to: encrypted.raw!.assumingMemoryBound(to: UInt8.self), count: encryptedSize) }
        guard encryptedSize >= 16 else { throw PQNativeFailure.bounds }
        let password = try PQNativeBytes(count: 32), derived = try PQNativeBytes(count: 32)
        try decode(credential, to: password.raw!.assumingMemoryBound(to: UInt8.self), count: 32)
        let code = salt.withUnsafeBytes { s in CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password.raw!.assumingMemoryBound(to: Int8.self), 32, s.baseAddress!.assumingMemoryBound(to: UInt8.self), 32, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 600_000, derived.raw!.assumingMemoryBound(to: UInt8.self), 32) }
        guard code == kCCSuccess else { throw PQNativeFailure.authentication }
        let secret = SymmetricKey(data: Data(bytes: derived.raw!, count: 32))
        let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce), ciphertext: Data(bytes: encrypted.raw!, count: encryptedSize - 16), tag: Data(bytes: encrypted.raw!.advanced(by: encryptedSize - 16), count: 16))
        var plaintext: Data
        do { plaintext = try AES.GCM.open(box, using: secret, authenticating: header) } catch { throw PQNativeFailure.authentication }
        defer { plaintext.resetBytes(in: 0..<plaintext.count) }
        let keys = try PQNativeBytes(count: 204)
        try plaintext.withUnsafeBytes { raw in
            let bytes = raw.bindMemory(to: UInt8.self); var offset = 0
            func literal(_ text: String) throws { let publicBytes = Array(text.utf8); guard publicBytes.count <= bytes.count - offset, bytes[offset..<(offset + publicBytes.count)].elementsEqual(publicBytes) else { throw PQNativeFailure.canonical }; offset += publicBytes.count }
            try literal("{\"format\":\"YNX-PQ-WALLET-PRIVATE/v1\",\"binding\":\(String(decoding: binding, as: UTF8.self)),\"pkcs8A\":\"")
            guard bytes.count - offset >= 72 else { throw PQNativeFailure.bounds }; try decode(UnsafeBufferPointer(start: bytes.baseAddress!.advanced(by: offset), count: 72), to: keys.raw!.assumingMemoryBound(to: UInt8.self), count: 54); offset += 72
            try literal("\",\"pkcs8B\":\"")
            guard bytes.count - offset >= 200 else { throw PQNativeFailure.bounds }; try decode(UnsafeBufferPointer(start: bytes.baseAddress!.advanced(by: offset), count: 200), to: keys.raw!.advanced(by: 54).assumingMemoryBound(to: UInt8.self), count: 150); offset += 200
            try literal("\"}"); guard offset == bytes.count else { throw PQNativeFailure.canonical }
        }
        var network = Data(); for i in stride(from: 0, to: 64, by: 2) { let start = chain.index(chain.startIndex, offsetBy: i); network.append(UInt8(chain[start..<chain.index(start, offsetBy: 2)], radix: 16)!) }
        return PQNativeOpenedAccount(purpose: purpose, binding: binding, network: network, owner: Data(owner.utf8), pkA: pkA, pkB: pkB, keys: keys)
    }
}
