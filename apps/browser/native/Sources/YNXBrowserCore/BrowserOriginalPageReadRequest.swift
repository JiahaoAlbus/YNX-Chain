import Foundation

/// Comparison DATA supplied by the original qualified Source. Public construction deliberately
/// grants nothing: do not obtain these expected values by copying the untrusted request itself.
public struct BrowserOriginalPageReadExpectedData: Sendable {
    public let runID: String
    public let session: BrowserOriginalPageReadRequest.Session
    public let taskID: String, account: String, holder: String
    public let revision: UInt64, generation: UInt64
    public let references: [BrowserPageSelectionReference]
    public let queryOriginal: Bool
    public let authorizationRef: String
    public init(runID: String, session: BrowserOriginalPageReadRequest.Session, taskID: String, account: String, holder: String,
                revision: UInt64, generation: UInt64, references: [BrowserPageSelectionReference], queryOriginal: Bool, authorizationRef: String) {
        self.runID = runID; self.session = session; self.taskID = taskID; self.account = account; self.holder = holder
        self.revision = revision; self.generation = generation; self.references = references
        self.queryOriginal = queryOriginal; self.authorizationRef = authorizationRef
    }
}

/// The EXISTING P08 YNX_AI_BROWSER_PAGE_READ_REQUEST_V1, not a portable Auth schema/operation.
/// Parsing and field comparison never authenticate a caller, register a Source or authorize egress.
public struct BrowserOriginalPageReadRequest: Sendable {
    public static let maximumBytes = 32 * 1024
    public static let maximumReferences = 16 // Existing P08 V1 DATA bound; no UI actor access in decode.
    public let rawBytes: Data
    public let runID: String
    public let session: Session
    public let task: Task
    public let references: [BrowserPageSelectionReference]
    public let queryOriginal: Bool
    public let authorizationRef: String
    public struct Session: Sendable {
        public let id: String, account: String, deviceID: String
        public let productClientID: String, bundleID: String, sessionBinding: String
        public init(id: String, account: String, deviceID: String, productClientID: String = "", bundleID: String = "", sessionBinding: String = "") {
            self.id = id; self.account = account; self.deviceID = deviceID
            self.productClientID = productClientID; self.bundleID = bundleID; self.sessionBinding = sessionBinding
        }
        func matches(_ other: Self) -> Bool {
            zip([id, account, deviceID, productClientID, bundleID, sessionBinding],
                [other.id, other.account, other.deviceID, other.productClientID, other.bundleID, other.sessionBinding]).allSatisfy { exact($0, $1) }
        }
    }
    public struct Task: Sendable {
        public let id: String, account: String, holder: String
        public let revision: UInt64, generation: UInt64
    }
    private init(rawBytes: Data, runID: String, session: Session, task: Task, references: [BrowserPageSelectionReference], queryOriginal: Bool, authorizationRef: String) {
        self.rawBytes = rawBytes; self.runID = runID; self.session = session; self.task = task
        self.references = references; self.queryOriginal = queryOriginal; self.authorizationRef = authorizationRef
    }
    public static func decode(_ raw: Data) throws -> Self {
        guard !raw.isEmpty, raw.count <= maximumBytes else { throw BrowserPageSelectionError.limit }
        let owned = Data([UInt8](raw)) // Preserve exact original bytes; no canonical re-encoding.
        guard String(data: owned, encoding: .utf8) != nil else { throw BrowserPageSelectionError.invalid }
        var parser = PageRequestJSONParser(owned)
        let root = try parser.parse().object(allowed: ["schema","runId","session","task","references","queryOriginal","authorizationRef"])
        guard try root.requiredString("schema") == "YNX_AI_BROWSER_PAGE_READ_REQUEST_V1" else { throw BrowserPageSelectionError.invalid }
        let run = try root.requiredString("runId")
        guard run.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else { throw BrowserPageSelectionError.invalid }
        let s = try root.required("session").object(allowed: ["id","account","deviceId","productClientId","bundleId","sessionBinding"])
        let session = try Session(id: s.nonemptyString("id"), account: s.nonemptyString("account"), deviceID: s.nonemptyString("deviceId"),
            productClientID: s.optionalString("productClientId"), bundleID: s.optionalString("bundleId"), sessionBinding: s.optionalString("sessionBinding"))
        let t = try root.required("task").object(allowed: ["id","account","conversationId","holder","revision","generation","status","createdAt","updatedAt","cancelledAt","agentConfigurationId","agentConfigurationRevision"])
        let task = try Task(id: t.nonemptyString("id"), account: t.nonemptyString("account"), holder: t.nonemptyString("holder"),
            revision: t.required("revision").uint64(positive: true), generation: t.required("generation").uint64(positive: true))
        for field in ["conversationId","status","createdAt","updatedAt","cancelledAt","agentConfigurationId"] { _ = try t.optionalString(field) }
        if let revision = t["agentConfigurationRevision"] { _ = try revision.uint64(positive: false) }
        guard exact(session.account, task.account), exact(session.deviceID, task.holder) else { throw BrowserPageSelectionError.denied }
        guard case .array(let refs) = try root.required("references"), (1...maximumReferences).contains(refs.count) else { throw BrowserPageSelectionError.invalid }
        let references = try refs.map { value -> BrowserPageSelectionReference in
            let object = try value.object(allowed: ["selectionId","version"])
            let reference = try BrowserPageSelectionReference(selectionID: object.requiredString("selectionId"), version: object.requiredString("version"))
            guard reference.parsedID != nil else { throw BrowserPageSelectionError.invalid }; return reference
        }
        guard Set(references.map(\.selectionID)).count == references.count else { throw BrowserPageSelectionError.invalid }
        guard case .boolean(let query) = try root.required("queryOriginal") else { throw BrowserPageSelectionError.invalid }
        let authorization = try root.optionalString("authorizationRef")
        guard authorization.utf8.count <= 256, query || !authorization.isEmpty else { throw BrowserPageSelectionError.invalid }
        return Self(rawBytes: owned, runID: run, session: session, task: task, references: references, queryOriginal: query, authorizationRef: authorization)
    }
    /// Exact DATA matching only, with no Unicode-normalization aliases. Realm/tenant are absent
    /// from this product request; the original Source must check them in its opaque context.
    public func requireMatches(_ expected: BrowserOriginalPageReadExpectedData) throws {
        guard expected.revision > 0, expected.generation > 0 else { throw BrowserPageSelectionError.invalid }
        guard exact(runID, expected.runID), session.matches(expected.session), exact(task.id, expected.taskID),
              exact(task.account, expected.account), exact(task.holder, expected.holder), task.revision == expected.revision,
              task.generation == expected.generation, references == expected.references, queryOriginal == expected.queryOriginal,
              exact(authorizationRef, expected.authorizationRef) else { throw BrowserPageSelectionError.denied }
    }
    @MainActor public func resolve(in store: BrowserPageSelectionStore, ownedProfileID: String, expected: BrowserOriginalPageReadExpectedData) throws -> [BrowserPageSource] {
        try requireMatches(expected)
        return try store.resolveSelectedPageReferences(references, taskID: task.id, profileID: ownedProfileID)
    }
    @MainActor public func borrow(in store: BrowserPageSelectionStore, ownedProfileID: String, expected: BrowserOriginalPageReadExpectedData,
        currentDocument: @escaping @MainActor (UUID) -> BrowserPageDocument?) throws -> BrowserPageSelectionBorrow {
        try requireMatches(expected)
        return try store.borrowSelectedPages(references, taskID: task.id, profileID: ownedProfileID, currentDocument: currentDocument)
    }
    @MainActor public func read(in store: BrowserPageSelectionStore, ownedProfileID: String, expected: BrowserOriginalPageReadExpectedData,
        currentDocument: @MainActor (UUID) -> BrowserPageDocument?, extract: @MainActor (BrowserPageSource) async throws -> BrowserPageContent) async throws -> BrowserPageReadBatch {
        try requireMatches(expected)
        return try await store.readSelectedPageReferences(references, taskID: task.id, profileID: ownedProfileID, currentDocument: currentDocument, extract: extract)
    }
}

private func exact(_ a: String, _ b: String) -> Bool { a.utf8.elementsEqual(b.utf8) }

private indirect enum PageRequestJSONValue {
    case object([String: PageRequestJSONValue]), array([PageRequestJSONValue]), string(String), number(String), boolean(Bool), null
    func object(allowed: Set<String>) throws -> [String:Self] {
        guard case .object(let value) = self, Set(value.keys).isSubset(of: allowed) else { throw BrowserPageSelectionError.invalid }; return value
    }
    func uint64(positive: Bool) throws -> UInt64 {
        guard case .number(let raw) = self, !raw.isEmpty, raw.utf8.allSatisfy({ (48...57).contains($0) }),
              let value = UInt64(raw), !positive || value > 0 else { throw BrowserPageSelectionError.invalid }; return value
    }
}
private extension Dictionary where Key == String, Value == PageRequestJSONValue {
    func required(_ name: String) throws -> Value { guard let value = self[name] else { throw BrowserPageSelectionError.invalid }; return value }
    func requiredString(_ name: String) throws -> String { guard case .string(let value) = try required(name) else { throw BrowserPageSelectionError.invalid }; return value }
    func nonemptyString(_ name: String) throws -> String { let value = try requiredString(name); guard !value.isEmpty else { throw BrowserPageSelectionError.invalid }; return value }
    func optionalString(_ name: String) throws -> String { self[name] == nil ? "" : try requiredString(name) }
}

/// Bounded strict JSON scanner. JSONDecoder alone accepts duplicate object keys, so duplicates
/// (including escaped spellings) are rejected before any DATA model or DOM access is possible.
private struct PageRequestJSONParser {
    private let bytes: [UInt8]
    private var index = 0, tokens = 0
    init(_ data: Data) { bytes = [UInt8](data) }
    mutating func parse() throws -> PageRequestJSONValue {
        let value = try value(depth: 0); whitespace(); guard index == bytes.count else { throw BrowserPageSelectionError.invalid }; return value
    }
    private mutating func whitespace() { while index < bytes.count && [UInt8(32),9,10,13].contains(bytes[index]) { index += 1 } }
    private mutating func consume(_ byte: UInt8) -> Bool { whitespace(); guard index < bytes.count, bytes[index] == byte else { return false }; index += 1; return true }
    private mutating func value(depth: Int) throws -> PageRequestJSONValue {
        whitespace(); tokens += 1
        guard depth <= 16, tokens <= 4096, index < bytes.count else { throw BrowserPageSelectionError.invalid }
        switch bytes[index] {
        case 123:
            index += 1; var object: [String:PageRequestJSONValue] = [:]
            if consume(125) { return .object(object) }
            while true {
                whitespace(); let key = try string()
                guard object[key] == nil, consume(58) else { throw BrowserPageSelectionError.invalid }
                object[key] = try value(depth: depth + 1)
                if consume(125) { return .object(object) }; guard consume(44) else { throw BrowserPageSelectionError.invalid }
            }
        case 91:
            index += 1; var array: [PageRequestJSONValue] = []
            if consume(93) { return .array(array) }
            while true { array.append(try value(depth: depth + 1)); if consume(93) { return .array(array) }; guard consume(44) else { throw BrowserPageSelectionError.invalid } }
        case 34: return .string(try string())
        case 116: try literal("true"); return .boolean(true)
        case 102: try literal("false"); return .boolean(false)
        case 110: try literal("null"); return .null
        case 45,48...57: return .number(try number())
        default: throw BrowserPageSelectionError.invalid
        }
    }
    private mutating func literal(_ text: String) throws {
        for byte in text.utf8 { guard index < bytes.count, bytes[index] == byte else { throw BrowserPageSelectionError.invalid }; index += 1 }
    }
    private mutating func string() throws -> String {
        guard index < bytes.count, bytes[index] == 34 else { throw BrowserPageSelectionError.invalid }
        let start = index; index += 1
        while index < bytes.count {
            let byte = bytes[index]; index += 1
            if byte == 34 { return try JSONDecoder().decode(String.self, from: Data(bytes[start..<index])) }
            guard byte >= 32 else { throw BrowserPageSelectionError.invalid }
            if byte == 92 {
                guard index < bytes.count else { throw BrowserPageSelectionError.invalid }; let escape = bytes[index]; index += 1
                if escape == 117 {
                    let scalar = try hex4()
                    if (0xD800...0xDBFF).contains(scalar) {
                        guard index + 2 <= bytes.count, bytes[index] == 92, bytes[index + 1] == 117 else { throw BrowserPageSelectionError.invalid }; index += 2
                        guard (0xDC00...0xDFFF).contains(try hex4()) else { throw BrowserPageSelectionError.invalid }
                    } else { guard !(0xDC00...0xDFFF).contains(scalar) else { throw BrowserPageSelectionError.invalid } }
                } else { guard [UInt8(34),92,47,98,102,110,114,116].contains(escape) else { throw BrowserPageSelectionError.invalid } }
            }
        }
        throw BrowserPageSelectionError.invalid
    }
    private mutating func hex4() throws -> UInt16 {
        guard index + 4 <= bytes.count else { throw BrowserPageSelectionError.invalid }; var result: UInt16 = 0
        for _ in 0..<4 {
            let c = bytes[index]; index += 1; let value: UInt16
            if (48...57).contains(c) { value = UInt16(c - 48) }
            else if (65...70).contains(c) { value = UInt16(c - 65 + 10) }
            else if (97...102).contains(c) { value = UInt16(c - 97 + 10) }
            else { throw BrowserPageSelectionError.invalid }
            result = result * 16 + value
        }
        return result
    }
    private mutating func number() throws -> String {
        let start = index
        if bytes[index] == 45 { index += 1 }
        guard index < bytes.count else { throw BrowserPageSelectionError.invalid }
        if bytes[index] == 48 { index += 1 }
        else { guard (49...57).contains(bytes[index]) else { throw BrowserPageSelectionError.invalid }; while index < bytes.count && (48...57).contains(bytes[index]) { index += 1 } }
        if index < bytes.count && bytes[index] == 46 { index += 1; let begin = index; while index < bytes.count && (48...57).contains(bytes[index]) { index += 1 }; guard index > begin else { throw BrowserPageSelectionError.invalid } }
        if index < bytes.count && [UInt8(69),101].contains(bytes[index]) {
            index += 1; if index < bytes.count && [UInt8(43),45].contains(bytes[index]) { index += 1 }
            let begin = index; while index < bytes.count && (48...57).contains(bytes[index]) { index += 1 }; guard index > begin else { throw BrowserPageSelectionError.invalid }
        }
        return String(decoding: bytes[start..<index], as: UTF8.self)
    }
}
