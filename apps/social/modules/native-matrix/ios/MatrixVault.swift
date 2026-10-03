import Foundation
import Security
import CryptoKit
import MatrixRustSDK
import SQLite3

enum MatrixBridgeFailure: Error { case denied(String) }

// Native custody only. No JS method installs access tokens or SDK store keys.
public final class MatrixVault: ClientSessionDelegate, @unchecked Sendable {
  let account: String
  let hs: String
  let mxid: String
  let device: String
  let namespace: String
  let root: URL
  let staging: URL
  private let lock = NSRecursiveLock()
  private(set) var persistenceFailed = false

  public init(account: String, homeserver: String, userId: String, deviceId: String) throws {
    self.account = account; hs = homeserver; mxid = userId; device = deviceId
    let bytes = try JSONSerialization.data(withJSONObject: [account, homeserver, userId, deviceId])
    namespace = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    root = base.appendingPathComponent("matrix-rust-v1").appendingPathComponent(namespace)
    staging = FileManager.default.temporaryDirectory.appendingPathComponent("matrix-staging").appendingPathComponent(namespace)
  }

  private func query(_ name: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.ynx.social.matrix.v1",
      kSecAttrAccount as String: namespace + ":" + name]
  }

  private func read(_ name: String) throws -> Data? {
    var request = query(name)
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw MatrixBridgeFailure.denied("MATRIX_NATIVE_VAULT_UNAVAILABLE") }
    return data
  }

  private func write(_ name: String, _ bytes: Data) throws {
    let request = query(name)
    let status = SecItemUpdate(request as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
    if status == errSecItemNotFound {
      var insert = request
      insert[kSecValueData as String] = bytes
      insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw MatrixBridgeFailure.denied("MATRIX_NATIVE_VAULT_WRITE_FAILED") }
    } else if status != errSecSuccess { throw MatrixBridgeFailure.denied("MATRIX_NATIVE_VAULT_WRITE_FAILED") }
  }

  func passphrase() throws -> String {
    lock.lock(); defer { lock.unlock() }
    if let data = try read("store-key"), let value = String(data: data, encoding: .utf8) { return value }
    guard !FileManager.default.fileExists(atPath: root.path) else { throw MatrixBridgeFailure.denied("MATRIX_NATIVE_KEY_MISSING_PRESERVE_STORE") }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw MatrixBridgeFailure.denied("MATRIX_NATIVE_RANDOM_FAILED") }
    let value = Data(bytes).base64EncodedString()
    try write("store-key", Data(value.utf8))
    return value
  }

  // Only native canonical enrollment can construct the SDK client for a new
  // approved device using this store, then persist its actual returned session.
  public func configuredSDKStore() throws -> SqliteStoreBuilder {
    SqliteStoreBuilder(dataPath: root.appendingPathComponent("data").path, cachePath: root.appendingPathComponent("cache").path)
      .passphrase(passphrase: try passphrase())
  }

  private func requireOriginalCryptoStore() throws {
    let file = root.appendingPathComponent("data/matrix-sdk-crypto.sqlite3")
    guard FileManager.default.fileExists(atPath: file.path) else { throw MatrixBridgeFailure.denied("MATRIX_ORIGINAL_CRYPTO_STORE_REQUIRED") }
    var db: OpaquePointer?
    guard sqlite3_open_v2(file.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
      if let db { sqlite3_close(db) }
      throw MatrixBridgeFailure.denied("MATRIX_ORIGINAL_CRYPTO_STORE_REQUIRED")
    }
    defer { sqlite3_close(db) }
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, "SELECT length(value) FROM kv WHERE key = 'account'", -1, &statement, nil) == SQLITE_OK else {
      throw MatrixBridgeFailure.denied("MATRIX_ORIGINAL_CRYPTO_ACCOUNT_REQUIRED")
    }
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW, sqlite3_column_int64(statement, 0) > 0 else {
      throw MatrixBridgeFailure.denied("MATRIX_ORIGINAL_CRYPTO_ACCOUNT_REQUIRED")
    }
  }

  // A's native integration imports only an already verified original SDK
  // session with its existing crypto store. Never a Wallet ProductSession.
  public func installOriginalSession(_ session: Session) throws {
    lock.lock(); defer { lock.unlock() }
    try requireOriginalCryptoStore()
    guard session.userId == mxid, session.deviceId == device,
      session.homeserverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == hs.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
      FileManager.default.fileExists(atPath: root.appendingPathComponent("data").path) else {
      throw MatrixBridgeFailure.denied("MATRIX_ORIGINAL_CRYPTO_STORE_REQUIRED")
    }
    _ = try passphrase()
    let object: [String: Any] = ["accessToken": session.accessToken, "refreshToken": session.refreshToken as Any? ?? NSNull(),
      "userId": session.userId, "deviceId": session.deviceId, "homeserverUrl": session.homeserverUrl,
      "oauthData": session.oauthData as Any? ?? NSNull(), "nativeSync": session.slidingSyncVersion == .native]
    try write("session", JSONSerialization.data(withJSONObject: object))
  }

  public func retrieveSessionFromKeychain(userId: String) throws -> Session {
    lock.lock(); defer { lock.unlock() }
    try requireOriginalCryptoStore()
    guard userId == mxid, let bytes = try read("session"),
      let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
      let access = object["accessToken"] as? String, let user = object["userId"] as? String,
      let dev = object["deviceId"] as? String, let homeserver = object["homeserverUrl"] as? String,
      let native = object["nativeSync"] as? Bool, user == mxid, dev == device, homeserver == hs,
      FileManager.default.fileExists(atPath: root.appendingPathComponent("data").path) else {
      throw MatrixBridgeFailure.denied("MATRIX_NATIVE_CANONICAL_ENROLLMENT_REQUIRED")
    }
    return Session(accessToken: access, refreshToken: object["refreshToken"] as? String, userId: user, deviceId: dev,
      homeserverUrl: homeserver, oauthData: object["oauthData"] as? String, slidingSyncVersion: native ? .native : .none)
  }

  public func saveSessionInKeychain(session: Session) {
    do { try installOriginalSession(session) } catch { lock.lock(); persistenceFailed = true; lock.unlock() }
  }

  private func journal() throws -> [String: [String: String]] {
    guard let bytes = try read("send-journal") else { return [:] }
    guard let value = try JSONSerialization.jsonObject(with: bytes) as? [String: [String: String]] else { throw MatrixBridgeFailure.denied("MATRIX_SEND_JOURNAL_CORRUPT") }
    return value
  }

  func reserve(intent: String, room: String, kind: String, body: String) throws {
    lock.lock(); defer { lock.unlock() }
    guard intent.range(of: "^native-matrix-[a-f0-9]{32}$", options: .regularExpression) != nil else { throw MatrixBridgeFailure.denied("MATRIX_ORIGINAL_INTENT_REQUIRED") }
    var entries = try journal()
    guard entries[intent] == nil else { throw MatrixBridgeFailure.denied("MATRIX_ORIGINAL_SEND_NEEDS_RECONCILIATION") }
    entries[intent] = ["roomId": room, "kind": kind, "body": body, "state": "unknown"]
    try write("send-journal", JSONSerialization.data(withJSONObject: entries))
  }

  func correlate(intent: String, transaction: String) throws {
    lock.lock(); defer { lock.unlock() }
    var entries = try journal()
    guard var entry = entries[intent], entry["transactionId"] == nil || entry["transactionId"] == transaction else { throw MatrixBridgeFailure.denied("MATRIX_QUEUE_CORRELATION_CONFLICT") }
    entry["transactionId"] = transaction; entry["state"] = "queued"; entries[intent] = entry
    try write("send-journal", JSONSerialization.data(withJSONObject: entries))
  }

  func receipt(room: String, transaction: String, event: String) throws -> String? {
    lock.lock(); defer { lock.unlock() }
    var entries = try journal()
    guard let id = entries.first(where: { $0.value["roomId"] == room && $0.value["transactionId"] == transaction })?.key else { return nil }
    entries[id]?["eventId"] = event; entries[id]?["state"] = "sdk-sent-needs-readback"
    try write("send-journal", JSONSerialization.data(withJSONObject: entries))
    return id
  }
}
