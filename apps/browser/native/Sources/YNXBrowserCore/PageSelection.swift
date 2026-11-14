import CryptoKit
import Foundation

public struct BrowserPageDocument: Equatable, Sendable {
    public let tabID: UUID
    public let profileID: String
    public let generation: UInt64
    public let origin: String
    public let isPrivate: Bool

    public init(tabID: UUID, profileID: String, generation: UInt64, origin: String, isPrivate: Bool) {
        self.tabID = tabID
        self.profileID = profileID
        self.generation = generation
        self.origin = origin
        self.isPrivate = isPrivate
    }
}

public struct BrowserPageContent: Equatable, Sendable {
    public let url: String
    public let title: String
    public let text: String

    public init(url: String, title: String, text: String) {
        self.url = url
        self.title = title
        self.text = text
    }
}

/// A local UI confirmation, never an Auth grant or permission to disclose to a remote provider.
public struct BrowserPageConfirmation: Sendable {
    public let document: BrowserPageDocument
    public let taskID: String
    public let allowedFields: [String]
    public let content: BrowserPageContent
    public let confirmed: Bool

    public init(document: BrowserPageDocument, taskID: String, allowedFields: [String], content: BrowserPageContent, confirmed: Bool) {
        self.document = document
        self.taskID = taskID
        self.allowedFields = allowedFields
        self.content = content
        self.confirmed = confirmed
    }
}

public struct BrowserPageBinding: Equatable, Sendable {
    public let bytes: Int
    public let sha3_512: String
    public let sha512: String

    public static func digest(_ data: Data) -> BrowserPageBinding {
        BrowserPageBinding(bytes: data.count, sha3_512: BrowserSHA3_512.hash(data), sha512: SHA512.hash(data: data).map { String(format: "%02x", $0) }.joined())
    }
}

public struct BrowserPageSource: Equatable, Sendable {
    public let selectionID: UUID
    public let document: BrowserPageDocument
    public let taskID: String
    public let fields: [String]
    public let binding: BrowserPageBinding
}

public enum BrowserPageSelectionError: String, Error, Equatable, LocalizedError, Sendable {
    case denied = "DENIED"
    case invalid = "INVALID"
    case limit = "LIMIT"
    case stale = "STALE"
    case unavailable = "UNAVAILABLE"

    public var errorDescription: String? { rawValue }
}

/// Ephemeral snapshots owned by the Browser UI. No network, persistence, or credential access.
/// The caller must obtain real resource/disclosure grants before handing bytes to an Agent/provider.
@MainActor public final class BrowserPageSelectionStore {
    public static let maximumTextCharacters = 50_000
    public static let maximumSelectedPages = 16
    private struct Entry { let source: BrowserPageSource; let bytes: Data }
    private var entries: [UUID: Entry] = [:]
    private var invalidated: Set<UUID> = []
    private var invalidatedOrder: [UUID] = []
    private var invalidatedSources: [UUID: BrowserPageSource] = [:] // Metadata only, never snapshot bytes.
    private var pageBorrows: [UUID: WeakBrowserPageSelectionBorrow] = [:]
    private static let fields: Set<String> = ["url", "title", "text"]

    public init() {}

    /// Select only individually confirmed, current ordinary pages. Validation is atomic for a batch.
    public func selectPages(_ confirmations: [BrowserPageConfirmation]) throws -> [BrowserPageSource] {
        guard !confirmations.isEmpty else { throw BrowserPageSelectionError.invalid }
        guard confirmations.count + entries.count <= Self.maximumSelectedPages else { throw BrowserPageSelectionError.limit }
        guard Set(confirmations.map { $0.document.tabID }).count == confirmations.count else { throw BrowserPageSelectionError.invalid }
        let proposed = try confirmations.map { confirmation -> Entry in
            guard confirmation.confirmed, !confirmation.document.isPrivate else { throw BrowserPageSelectionError.denied }
            guard !confirmation.taskID.isEmpty, confirmation.taskID.utf8.count <= 1024,
                  !confirmation.document.profileID.isEmpty,
                  !confirmation.allowedFields.isEmpty,
                  Set(confirmation.allowedFields).count == confirmation.allowedFields.count,
                  Set(confirmation.allowedFields).isSubset(of: Self.fields) else { throw BrowserPageSelectionError.invalid }
            let fields = confirmation.allowedFields.sorted()
            let bytes = try Self.snapshotBytes(document: confirmation.document, taskID: confirmation.taskID, fields: fields, content: confirmation.content)
            let source = BrowserPageSource(selectionID: UUID(), document: confirmation.document, taskID: confirmation.taskID, fields: fields, binding: .digest(bytes))
            return Entry(source: source, bytes: bytes)
        }
        for entry in proposed { entries[entry.source.selectionID] = entry }
        return proposed.map(\.source)
    }

    /// Internal whole-batch preflight/final fence; returns no content and adds no authority.
    func requireSelectedPageSource(_ source: BrowserPageSource) throws {
        guard !invalidated.contains(source.selectionID) else { throw BrowserPageSelectionError.stale }
        guard let entry = entries[source.selectionID], entry.source == source else { throw BrowserPageSelectionError.denied }
    }

    func resolvePageReference(_ reference: BrowserPageSelectionReference, taskID: String, profileID: String, includeInvalidated: Bool) throws -> BrowserPageSource {
        guard let id = reference.parsedID else { throw BrowserPageSelectionError.invalid }
        guard let source = entries[id]?.source ?? invalidatedSources[id] else {
            if invalidated.contains(id) { throw BrowserPageSelectionError.stale }
            throw BrowserPageSelectionError.denied
        }
        guard !source.document.isPrivate, source.taskID.utf8.elementsEqual(taskID.utf8), source.document.profileID.utf8.elementsEqual(profileID.utf8) else { throw BrowserPageSelectionError.denied }
        guard source.binding.sha512 == reference.version else { throw BrowserPageSelectionError.stale }
        if !includeInvalidated { try requireSelectedPageSource(source) }
        return source
    }
    func trackPageBorrow(_ borrow: BrowserPageSelectionBorrow) throws {
        pageBorrows = pageBorrows.filter { $0.value.value != nil }
        guard pageBorrows.count < Self.maximumPageBorrows else { throw BrowserPageSelectionError.limit }
        pageBorrows[borrow.registryID] = WeakBrowserPageSelectionBorrow(borrow)
    }
    func forgetPageBorrow(_ borrow: BrowserPageSelectionBorrow) { pageBorrows.removeValue(forKey: borrow.registryID) }
    private func revokePageBorrows(tabID: UUID? = nil) {
        let live = pageBorrows.values.compactMap(\.value)
        for borrow in live where tabID == nil || borrow.affected(tabID: tabID!) { borrow.end(.stale) }
        pageBorrows = pageBorrows.filter { $0.value.value != nil }
    }
    private func trimInvalidatedMetadata() {
        if invalidatedOrder.count > 256 {
            let old = invalidatedOrder.prefix(invalidatedOrder.count - 256)
            for id in old { invalidated.remove(id); invalidatedSources.removeValue(forKey: id) }
            invalidatedOrder.removeFirst(invalidatedOrder.count - 256)
        }
        invalidatedSources = invalidatedSources.filter { invalidated.contains($0.key) }
        // Source metadata can itself contain user-chosen strings; bound total retained bytes too.
        var total = 0
        for (id, source) in invalidatedSources {
            total += source.document.origin.utf8.count + source.document.profileID.utf8.count + source.taskID.utf8.count + 512
            if total > 262144 { invalidatedSources.removeValue(forKey: id) }
        }
    }

    /// Compare a fresh extraction of the SAME selected fields; return only the original snapshot.
    /// The UI must check document identity again after its async WKWebView extraction completes.
    public func readSelectedPage(_ source: BrowserPageSource, currentDocument: BrowserPageDocument?, currentContent: BrowserPageContent?) throws -> Data {
        guard !invalidated.contains(source.selectionID) else { throw BrowserPageSelectionError.stale }
        guard let entry = entries[source.selectionID], entry.source == source else { throw BrowserPageSelectionError.denied }
        guard let currentDocument, let currentContent else { throw BrowserPageSelectionError.unavailable }
        guard currentDocument == source.document, !currentDocument.isPrivate else { throw BrowserPageSelectionError.stale }
        let currentBytes: Data
        do { currentBytes = try Self.snapshotBytes(document: currentDocument, taskID: source.taskID, fields: source.fields, content: currentContent) }
        catch { throw BrowserPageSelectionError.stale }
        guard BrowserPageBinding.digest(currentBytes) == source.binding else { throw BrowserPageSelectionError.stale }
        return entry.bytes
    }

    /// Render only the exact confirmed fields from bytes returned by readSelectedPage. This is
    /// a local human preview, never a grant or a request to reread a different/live document.
    public static func previewFields(_ bytes: Data, source: BrowserPageSource) throws -> [String: String] {
        guard bytes.count <= 1_048_576, BrowserPageBinding.digest(bytes) == source.binding,
              let payload = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              payload["schema"] as? String == "YNX_BROWSER_SELECTED_PAGE_V1",
              payload["tabID"] as? String == source.document.tabID.uuidString,
              payload["profileID"] as? String == source.document.profileID,
              payload["generation"] as? String == String(source.document.generation),
              payload["origin"] as? String == source.document.origin,
              payload["taskID"] as? String == source.taskID,
              payload["fields"] as? [String] == source.fields,
              let content = payload["content"] as? [String: String],
              Set(content.keys) == Set(source.fields) else { throw BrowserPageSelectionError.denied }
        return content
    }

    /// Call before allowing main-document navigation, on close, process termination, or profile change.
    public func invalidate(tabID: UUID) {
        let ids = entries.values.filter { $0.source.document.tabID == tabID }.map { $0.source.selectionID }
        for id in ids {
            if let entry = entries.removeValue(forKey: id) { invalidatedSources[id] = entry.source }
            if invalidated.insert(id).inserted { invalidatedOrder.append(id) }
        }
        // Tombstones retain no content and are bounded. Older missing selections remain denied.
        trimInvalidatedMetadata(); revokePageBorrows(tabID: tabID)
    }

    public func removeAll() {
        for (id, entry) in entries {
            if invalidated.insert(id).inserted { invalidatedOrder.append(id) }
            invalidatedSources[id] = entry.source
        }
        entries.removeAll()
        trimInvalidatedMetadata(); revokePageBorrows()
    }

    private static func snapshotBytes(document: BrowserPageDocument, taskID: String, fields: [String], content: BrowserPageContent) throws -> Data {
        guard document.profileID.utf8.count <= 1024,
              let origin = canonicalOrigin(document.origin), origin == document.origin else { throw BrowserPageSelectionError.invalid }
        var values: [String: String] = [:]
        for field in fields {
            switch field {
            case "url":
                guard content.url.utf8.count <= 8192, canonicalOrigin(content.url) == origin else { throw BrowserPageSelectionError.invalid }
                values[field] = content.url
            case "title":
                guard content.title.count <= 4096 else { throw BrowserPageSelectionError.limit }
                values[field] = content.title
            case "text":
                guard content.text.count <= maximumTextCharacters else { throw BrowserPageSelectionError.limit }
                values[field] = content.text
            default: throw BrowserPageSelectionError.invalid
            }
        }
        // Metadata, selected field names and exact UTF-8 content are all covered by both digests.
        let payload: [String: Any] = [
            "schema": "YNX_BROWSER_SELECTED_PAGE_V1", "tabID": document.tabID.uuidString,
            "profileID": document.profileID, "generation": String(document.generation),
            "origin": origin, "taskID": taskID, "fields": fields, "content": values
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard data.count <= 1_048_576 else { throw BrowserPageSelectionError.limit }
        return data
    }

    public static func canonicalOrigin(_ value: String) -> String? {
        guard let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil, components.password == nil else { return nil }
        let normalizedHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
        let port = components.port
        if let port, !(1...65535).contains(port) { return nil }
        let standard = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
        return "\(scheme)://\(normalizedHost)\(port != nil && !standard ? ":\(port!)" : "")"
    }

    /// Evaluate the function with a JSON array of confirmed fields, in the main frame and an
    /// isolated WKContentWorld. It does not traverse frames, shadow roots, inputs, or hidden DOM.
    public static let extractionScript = #"""
    (allowedFields) => {
      if (window !== window.top) throw new Error('Main document required');
      if (!Array.isArray(allowedFields) || !allowedFields.length ||
          allowedFields.some(f => !['url','title','text'].includes(f)) ||
          new Set(allowedFields).size !== allowedFields.length) throw new Error('Invalid fields');
      const result = {url: '', title: '', text: ''};
      if (allowedFields.includes('url')) result.url = location.href;
      if (allowedFields.includes('title')) result.title = document.title.slice(0, 4096);
      if (allowedFields.includes('text') && document.body) {
        const excluded = 'script,style,noscript,template,iframe,frame,object,embed,input,textarea,select,option,button,form,[contenteditable],[hidden],[inert],[aria-hidden="true"]';
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent || parent.closest(excluded) || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
            for (let element = parent; element; element = element.parentElement) {
              const style = getComputedStyle(element);
              if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return NodeFilter.FILTER_REJECT;
            }
            if (!parent.getClientRects().length) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        const parts = []; let length = 0; let node;
        while ((node = walker.nextNode()) && length < 50000) {
          const remaining = 50000 - length - (parts.length ? 1 : 0);
          if (remaining <= 0) break;
          const text = node.textContent.trim().slice(0, remaining);
          parts.push(text); length += text.length + (parts.length > 1 ? 1 : 0);
        }
        result.text = parts.join('\n');
      }
      return result;
    }
    """#
}

// SHA3-512, FIPS 202 sections 3, 4 and 6.1: Keccak-f[1600], 72-byte rate,
// 0x06 domain suffix + pad10*1. No custom primitive or signature/authorization role.
// https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.202.pdf
enum BrowserSHA3_512 {
    static func hash(_ data: Data) -> String {
        BrowserSHA3.digest(data, rate: 72, output: 64).map { String(format: "%02x", $0) }.joined()
    }
}

enum BrowserSHA3 {
    static func hash256(_ data: Data) -> [UInt8] {
        digest(data, rate: 136, output: 32)
    }

    fileprivate static func digest(_ data: Data, rate: Int, output: Int) -> [UInt8] {
        var state = [UInt64](repeating: 0, count: 25)
        var padded = [UInt8](data)
        padded.append(0x06)
        while padded.count % rate != 0 { padded.append(0) }
        padded[padded.count - 1] |= 0x80
        for offset in stride(from: 0, to: padded.count, by: rate) {
            for byte in 0..<rate { state[byte / 8] ^= UInt64(padded[offset + byte]) << UInt64(8 * (byte % 8)) }
            permute(&state)
        }
        return (0..<output).map { UInt8(truncatingIfNeeded: state[$0 / 8] >> UInt64(8 * ($0 % 8))) }
    }

    private static func rotate(_ value: UInt64, _ count: Int) -> UInt64 {
        count == 0 ? value : (value << count) | (value >> (64 - count))
    }

    private static func permute(_ a: inout [UInt64]) {
        let offsets = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]
        let constants: [UInt64] = [
            0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
            0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
            0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
            0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
            0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
            0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008
        ]
        for constant in constants {
            let c = (0..<5).map { x in a[x] ^ a[x+5] ^ a[x+10] ^ a[x+15] ^ a[x+20] }
            let d = (0..<5).map { x in c[(x+4)%5] ^ rotate(c[(x+1)%5], 1) }
            for y in 0..<5 { for x in 0..<5 { a[x+5*y] ^= d[x] } }
            var b = [UInt64](repeating: 0, count: 25)
            for y in 0..<5 { for x in 0..<5 { b[y+5*((2*x+3*y)%5)] = rotate(a[x+5*y], offsets[x+5*y]) } }
            for y in 0..<5 { for x in 0..<5 { a[x+5*y] = b[x+5*y] ^ ((~b[(x+1)%5+5*y]) & b[(x+2)%5+5*y]) } }
            a[0] ^= constant
        }
    }
}
