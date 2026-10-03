import Foundation
import MatrixRustSDK

// Native-only adapter, awaiting current-handle module registration. The required
// reviewer checks canonical authority, encrypted room and original accepted peer.
// No JS descriptor, remote URL, token, key or passphrase is a download argument.
actor MatrixReceivedMedia {
  private let client: Client
  private let root: URL
  private let maximumBytes: UInt64
  private let review: @Sendable (String, String?) async throws -> Void
  private var epoch: UInt64 = 0
  private var handles: [String: MediaFileHandle] = [:]

  init(client: Client, root: URL, maximumBytes: UInt64 = 32 * 1024 * 1024,
       review: @escaping @Sendable (String, String?) async throws -> Void) {
    self.client = client; self.root = root; self.maximumBytes = maximumBytes; self.review = review
  }

  func open(timeline: Timeline, roomId: String, eventId: String) async throws -> [String: Any] {
    guard roomId.hasPrefix("!"), eventId.hasPrefix("$"), maximumBytes > 0 else { throw failure("MATRIX_MEDIA_EVENT_REQUIRED") }
    let attempt = epoch
    try await review(roomId, nil)
    let item = try await timeline.getEventTimelineItemByEventId(eventId: eventId)
    guard item.isRemote, case .eventId(let originalId) = item.eventOrTransactionId,
          originalId == eventId else { throw failure("MATRIX_MEDIA_REMOTE_EVENT_REQUIRED") }
    try await review(roomId, item.sender)
    guard epoch == attempt else { throw failure("MATRIX_MEDIA_RETIRED") }
    guard case .msgLike(let content) = item.content, case .message(let message) = content.kind,
          !message.isEdited else { throw failure("MATRIX_MEDIA_ORIGINAL_MESSAGE_REQUIRED") }
    let source: MediaSource
    let filename: String
    let mime: String
    let declared: UInt64?
    switch message.msgType {
    case .image(let image):
      source = image.source; filename = image.filename
      mime = image.info?.mimetype ?? "application/octet-stream"; declared = image.info?.size
    case .file(let file):
      source = file.source; filename = file.filename
      mime = file.info?.mimetype ?? "application/octet-stream"; declared = file.info?.size
    default: throw failure("MATRIX_MEDIA_TYPE_NOT_SUPPORTED")
    }
    guard mime.range(of: "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$", options: .regularExpression) != nil,
          !filename.contains("\0") else { throw failure("MATRIX_MEDIA_METADATA_INVALID") }
    if let declared, declared == 0 || declared > maximumBytes { throw failure("MATRIX_MEDIA_TOO_LARGE") }
    guard let original = item.lazyProvider.debugInfo().originalJson,
          let data = original.data(using: .utf8),
          let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          raw["event_id"] as? String == eventId, raw["sender"] as? String == item.sender,
          let originalContent = raw["content"] as? [String: Any], originalContent["url"] == nil,
          let encrypted = originalContent["file"] as? [String: Any],
          encrypted["v"] as? String == "v2", let mxc = encrypted["url"] as? String, mxc.hasPrefix("mxc://"),
          let serializedData = source.toJson().data(using: .utf8),
          let serialized = try JSONSerialization.jsonObject(with: serializedData) as? [String: Any]
    else { throw failure("MATRIX_MEDIA_ENCRYPTED_FILE_REQUIRED") }
    let sdkFile = serialized["file"] as? [String: Any] ?? serialized
    guard try canonical(encrypted) == canonical(sdkFile), source.url() == mxc else {
      throw failure("MATRIX_MEDIA_DESCRIPTOR_MISMATCH")
    }
    try await review(roomId, item.sender)
    guard epoch == attempt else { throw failure("MATRIX_MEDIA_RETIRED") }
    let directory = root.standardizedFileURL.resolvingSymlinksInPath()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete])
    // SDK-managed temporary plaintext only. Never persist/copy, use the original
    // filename as a path, or launch/share with another application automatically.
    let handle = try await client.getMediaFile(mediaSource: source, filename: nil, mimeType: mime,
      useCache: false, tempDir: directory.path)
    try await review(roomId, item.sender)
    guard epoch == attempt else { throw failure("MATRIX_MEDIA_RETIRED") }
    let file = URL(fileURLWithPath: try handle.path()).standardizedFileURL.resolvingSymlinksInPath()
    let metadata = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard file.deletingLastPathComponent() == directory, metadata.isRegularFile == true,
          let size = metadata.fileSize, size > 0, UInt64(size) <= maximumBytes,
          declared == nil || UInt64(size) == declared else { throw failure("MATRIX_MEDIA_FILE_INVALID") }
    let token = UUID().uuidString
    handles[token] = handle // SDK deletes plaintext when the final handle is freed.
    return ["leaseId": token, "eventId": eventId, "roomId": roomId, "filename": filename,
      "mimeType": mime, "bytes": size, "uri": file.absoluteString,
      "imagePreview": ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(mime)]
  }

  func release(leaseId: String) { handles.removeValue(forKey: leaseId) }
  func close() { epoch &+= 1; handles.removeAll() }

  private func canonical(_ object: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  }
  private func failure(_ reason: String) -> NSError {
    NSError(domain: "YNXSocialMatrix", code: 409, userInfo: [NSLocalizedDescriptionKey: reason])
  }
}
