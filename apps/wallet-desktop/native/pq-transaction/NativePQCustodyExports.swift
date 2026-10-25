// Private same-process Native binding for original Main. No DER function,
// arbitrary signer, public provider, replacement vault or implicit Source.
import Foundation
private let custodyLock = NSLock()
private var custodyOwners: [UInt64: PQNativeOpenedAccount] = [:]
private var custodyNextID: UInt64 = 1
private func failureCode(_ cause: Error) -> Int32 {
    guard let error = cause as? PQNativeFailure else { return 1 }
    switch error { case .bounds: return 2; case .canonical: return 3; case .binding: return 4; case .authentication: return 5
    case .closed: return 6; case .purpose: return 7; case .duplicate: return 8; case .crypto(let code, _): return 100 + max(0, min(code, 10)) }
}
private func owned(_ id: UInt64) throws -> PQNativeOpenedAccount {
    custodyLock.lock(); defer { custodyLock.unlock() }
    guard id != 0, let owner = custodyOwners[id] else { throw PQNativeFailure.closed }; return owner
}
private func readPublic(_ bytes: UnsafePointer<UInt8>?, _ count: Int, _ maximum: Int) throws -> Data {
    guard let bytes = bytes, count > 0 && count <= maximum else { throw PQNativeFailure.bounds }
    return Data(bytes: bytes, count: count)
}
private func overlap(_ a: UnsafeRawPointer, _ n: Int, _ b: UnsafeRawPointer, _ m: Int) -> Bool {
    let x = UInt(bitPattern: a), y = UInt(bitPattern: b)
    let (endX, overflowX) = x.addingReportingOverflow(UInt(n)), (endY, overflowY) = y.addingReportingOverflow(UInt(m))
    return overflowX || overflowY || (n > 0 && m > 0 && x < endY && y < endX)
}
private func installOwner(_ owner: PQNativeOpenedAccount, _ output: UnsafeMutablePointer<UInt64>) -> Int32 {
    custodyLock.lock(); defer { custodyLock.unlock() }
    guard custodyOwners.count < 256 && custodyNextID < UInt64.max else { _ = owner.close(); return 2 }
    let id = custodyNextID; custodyNextID += 1; custodyOwners[id] = owner; output.pointee = id; return 0
}
@_cdecl("ynx_auth_pq_native_open_v1")
func nativePQOpen(_ wire: UnsafePointer<UInt8>?, _ wireCount: Int, _ credential: UnsafePointer<UInt8>?, _ credentialCount: Int, _ binding: UnsafePointer<UInt8>?, _ bindingCount: Int, _ purpose: UInt32, _ output: UnsafeMutablePointer<UInt64>?) -> Int32 {
    guard let output = output, UInt(bitPattern: output) % 8 == 0, output.pointee == 0,
          let credential = credential, credentialCount == 43,
          let wire = wire, wireCount > 0 && wireCount <= 196608,
          let binding = binding, bindingCount > 0 && bindingCount <= 8192 else { return 1 }
    guard !overlap(output, 8, wire, wireCount), !overlap(output, 8, credential, credentialCount), !overlap(output, 8, binding, bindingCount) else { return 1 }
    // Ordinary898 works independently. Do not decrypt secrets for an unavailable
    // birth build role or silently send account-initial through ordinary TX.
    guard purpose == PQNativePurpose.transaction.rawValue else { return 7 }
    do {
        let owner = try PQBackupNativeDecoder.open(wire: Data(bytes: wire, count: wireCount), credential: UnsafeBufferPointer(start: credential, count: credentialCount), expectedBinding: Data(bytes: binding, count: bindingCount), purpose: .transaction)
        return installOwner(owner, output)
    } catch { return failureCode(error) }
}
@_cdecl("ynx_auth_pq_native_current_v1")
func nativePQCurrent(_ id: UInt64) -> Int32 { do { try owned(id).current(); return 0 } catch { return failureCode(error) } }
@_cdecl("ynx_auth_pq_native_retire_v1")
func nativePQRetire(_ id: UInt64) -> Int32 { do { try owned(id).retire(); return 0 } catch { return failureCode(error) } }
@_cdecl("ynx_auth_pq_native_transaction_once_v1")
func nativePQTransaction(_ id: UInt64, _ message: UnsafePointer<UInt8>?, _ messageCount: Int, _ policy: UnsafePointer<UInt8>?, _ policyCount: Int, _ chainID: UInt64, _ keyVersion: UnsafePointer<UInt8>?, _ versionCount: Int, _ height: UnsafePointer<UInt8>?, _ heightCount: Int) -> Int32 {
    do {
        let owner = try owned(id); try owner.current()
        let m = try readPublic(message, messageCount, 8192), p = try readPublic(policy, policyCount, 8388608)
        let v = try readPublic(keyVersion, versionCount, 20), h = try readPublic(height, heightCount, 20)
        guard let version = String(data: v, encoding: .ascii), let execution = String(data: h, encoding: .ascii) else { return 3 }
        try owner.attemptTransaction(message: m, policy: p, nativeChainID: chainID, keyVersion: version, executionHeight: execution); return 0
    } catch { return failureCode(error) }
}
@_cdecl("ynx_auth_pq_native_copy_outcome_v1")
func nativePQOutcome(_ id: UInt64, _ buffer: UnsafeMutablePointer<UInt8>?, _ capacity: Int, _ length: UnsafeMutablePointer<Int>?, _ status: UnsafeMutablePointer<Int32>?, _ cleanup: UnsafeMutablePointer<UInt32>?, _ selected: UnsafeMutablePointer<UInt32>?) -> Int32 {
    guard capacity >= 0 && capacity <= 98304, let length = length, let status = status, let cleanup = cleanup, let selected = selected,
          UInt(bitPattern: length) % UInt(MemoryLayout<Int>.alignment) == 0, UInt(bitPattern: status) % 4 == 0, UInt(bitPattern: cleanup) % 4 == 0, UInt(bitPattern: selected) % 4 == 0,
          (buffer == nil && capacity == 0) || (buffer != nil && capacity > 0) else { return 1 }
    var sinks: [(UnsafeRawPointer, Int)] = [(UnsafeRawPointer(length), MemoryLayout<Int>.size), (UnsafeRawPointer(status), 4), (UnsafeRawPointer(cleanup), 4), (UnsafeRawPointer(selected), 4)]
    if let buffer = buffer { sinks.append((UnsafeRawPointer(buffer), capacity)) }
    for i in sinks.indices { for j in sinks.indices where j > i { if overlap(sinks[i].0, sinks[i].1, sinks[j].0, sinks[j].1) { return 1 } } }
    do {
        let result = try owned(id).copyOriginalOutcome(), n = result.member?.count ?? 0
        guard buffer == nil || capacity >= n else { return 2 }
        if let bytes = result.member, let buffer = buffer { bytes.copyBytes(to: buffer, count: n) }
        // Metadata and public bytes belong to the SAME retained original call.
        length.pointee = n; status.pointee = result.status; cleanup.pointee = result.cleanup; selected.pointee = result.selected ? 1 : 0; return 0
    } catch { return failureCode(error) }
}
@_cdecl("ynx_auth_pq_native_close_v1")
func nativePQClose(_ id: UInt64) -> Int32 { do { switch try owned(id).close() { case .success: return 0; case .failure(let cause): return failureCode(cause) } } catch { return failureCode(error) } }
@_cdecl("ynx_auth_pq_native_release_closed_v1")
func nativePQRelease(_ id: UInt64) -> Int32 {
    do { let owner = try owned(id); guard owner.closedForNativeRelease() else { return 6 }
        custodyLock.lock(); defer { custodyLock.unlock() }; guard custodyOwners[id] === owner else { return 6 }; custodyOwners.removeValue(forKey: id); return 0
    } catch { return failureCode(error) }
}
@_cdecl("ynx_auth_pq_native_capabilities_v1")
func nativePQCapabilities() -> UInt32 {
    #if YNX_ACCOUNT_INITIAL_NATIVE_V1
    return 3
    #else
    return 1
    #endif
}
@_cdecl("ynx_auth_pq_native_open_initial_v1")
func nativePQOpenInitial(_ wire: UnsafePointer<UInt8>?, _ wireCount: Int, _ credential: UnsafePointer<UInt8>?, _ credentialCount: Int, _ binding: UnsafePointer<UInt8>?, _ bindingCount: Int, _ message: UnsafePointer<UInt8>?, _ messageCount: Int, _ genesis: UnsafePointer<UInt8>?, _ genesisCount: Int, _ pin: UnsafePointer<UInt8>?, _ pinCount: Int, _ chainID: UInt64, _ height: UnsafePointer<UInt8>?, _ heightCount: Int, _ output: UnsafeMutablePointer<UInt64>?) -> Int32 {
    #if YNX_ACCOUNT_INITIAL_NATIVE_V1
    guard let output = output, UInt(bitPattern: output) % 8 == 0, output.pointee == 0,
          let credential = credential, credentialCount == 43 else { return 1 }
    let inputs: [(UnsafePointer<UInt8>?, Int, Int)] = [(wire, wireCount, 196608), (credential, credentialCount, 43), (binding, bindingCount, 8192), (message, messageCount, 4096), (genesis, genesisCount, 67108864), (pin, pinCount, 32), (height, heightCount, 20)]
    for (pointer, count, maximum) in inputs { guard let pointer = pointer, count > 0 && count <= maximum, !overlap(output, 8, pointer, count) else { return 1 } }
    guard pinCount == 32 else { return 2 }
    do {
        let h = try readPublic(height, heightCount, 20); guard let execution = String(data: h, encoding: .ascii) else { return 3 }
        let owner = try PQBackupNativeDecoder.openInitial(wire: readPublic(wire, wireCount, 196608), credential: UnsafeBufferPointer(start: credential, count: credentialCount), expectedBinding: readPublic(binding, bindingCount, 8192), message: readPublic(message, messageCount, 4096), genesis: readPublic(genesis, genesisCount, 67108864), independentPin: readPublic(pin, pinCount, 32), nativeChainID: chainID, executionHeight: execution)
        return installOwner(owner, output)
    } catch { return failureCode(error) }
    #else
    return 7
    #endif
}
@_cdecl("ynx_auth_pq_native_account_initial_once_v1")
func nativePQAccountInitial(_ id: UInt64) -> Int32 {
    #if YNX_ACCOUNT_INITIAL_NATIVE_V1
    do { try owned(id).attemptAccountInitial(); return 0 } catch { return failureCode(error) }
    #else
    return 7
    #endif
}
