import Foundation

public enum WalletConnectV2DAppClass: String, Codable, Sendable {
  case firstParty
  case external
}

public enum WalletConnectV2RequestKind: String, Codable, Sendable {
  case sessionProposal
  case sessionRequest
}

public struct WalletConnectV2PendingRequest: Codable, Equatable, Sendable {
  public let id: String
  public let topic: String
  public let kind: WalletConnectV2RequestKind
  public let dappClass: WalletConnectV2DAppClass
  public let dappName: String
  public let method: String
  public let paramsDigest: String
  public let receivedAt: Date
  public let expiresAt: Date

  public init(
    id: String,
    topic: String,
    kind: WalletConnectV2RequestKind,
    dappClass: WalletConnectV2DAppClass,
    dappName: String,
    method: String,
    paramsDigest: String,
    receivedAt: Date,
    expiresAt: Date
  ) {
    self.id = id
    self.topic = topic
    self.kind = kind
    self.dappClass = dappClass
    self.dappName = dappName
    self.method = method
    self.paramsDigest = paramsDigest
    self.receivedAt = receivedAt
    self.expiresAt = expiresAt
  }
}

public struct WalletConnectV2PersistedSession: Codable, Equatable, Sendable {
  public let topic: String
  public let dappClass: WalletConnectV2DAppClass
  public let dappName: String
  public let approvedAccount: String
  public let methods: Set<String>
  public let events: Set<String>
  public let approvedAt: Date
}

public enum WalletConnectV2CallbackResult: Codable, Equatable, Sendable {
  case success(String)
  case rejected(code: Int, message: String)
}

public struct WalletConnectV2Callback: Codable, Equatable, Sendable {
  public let requestID: String
  public let topic: String
  public let result: WalletConnectV2CallbackResult
}

public enum WalletConnectV2StateError: String, Error, Equatable, Sendable {
  case invalidRequest = "WALLETCONNECT_REQUEST_INVALID"
  case duplicateRequest = "WALLETCONNECT_REQUEST_DUPLICATE"
  case expiredRequest = "WALLETCONNECT_REQUEST_EXPIRED"
  case sessionUnavailable = "WALLETCONNECT_SESSION_UNAVAILABLE"
  case methodNotApproved = "WALLETCONNECT_METHOD_NOT_APPROVED"
  case requestUnavailable = "WALLETCONNECT_REQUEST_UNAVAILABLE"
  case invalidExecutionResult = "WALLETCONNECT_EXECUTION_RESULT_INVALID"
  case corruptPersistence = "WALLETCONNECT_PERSISTENCE_CORRUPT"
}

public final class WalletConnectV2StateStore: @unchecked Sendable {
  private struct State: Codable {
    let schemaVersion: Int
    var pending: [WalletConnectV2PendingRequest]
    var sessions: [WalletConnectV2PersistedSession]
  }

  private let fileURL: URL
  private let lock = NSLock()
  private var state: State

  public init(fileURL: URL) throws {
    self.fileURL = fileURL
    if FileManager.default.fileExists(atPath: fileURL.path) {
      do {
        let decoded = try JSONDecoder.walletConnect.decode(State.self, from: Data(contentsOf: fileURL))
        guard Self.validPersistedState(decoded) else {
          throw WalletConnectV2StateError.corruptPersistence
        }
        state = decoded
      } catch let error as WalletConnectV2StateError {
        throw error
      } catch {
        throw WalletConnectV2StateError.corruptPersistence
      }
    } else {
      state = State(schemaVersion: 1, pending: [], sessions: [])
    }
  }

  public func restoredPending(now: Date = Date()) throws -> [WalletConnectV2PendingRequest] {
    try withLockedState { state in
      state.pending.removeAll { $0.expiresAt <= now }
      try persist(state)
      return state.pending.sorted { $0.receivedAt < $1.receivedAt }
    }
  }

  public func restoredSessions() -> [WalletConnectV2PersistedSession] {
    lock.lock()
    defer { lock.unlock() }
    return state.sessions.sorted { $0.approvedAt < $1.approvedAt }
  }

  public func enqueue(_ request: WalletConnectV2PendingRequest, now: Date = Date()) throws {
    try withLockedState { state in
      guard Self.validIdentifier(request.id),
            Self.validTopic(request.topic),
            Self.validDAppName(request.dappName),
            Self.validDigest(request.paramsDigest),
            request.receivedAt <= now,
            request.expiresAt > now else {
        throw request.expiresAt <= now
          ? WalletConnectV2StateError.expiredRequest
          : WalletConnectV2StateError.invalidRequest
      }
      guard !state.pending.contains(where: { $0.id == request.id }) else {
        throw WalletConnectV2StateError.duplicateRequest
      }
      if request.kind == .sessionProposal {
        guard request.method == "wc_sessionPropose" else {
          throw WalletConnectV2StateError.invalidRequest
        }
        if let existing = state.sessions.first(where: { $0.topic == request.topic }) {
          guard Self.matchesIdentity(request, existing) else {
            throw WalletConnectV2StateError.invalidRequest
          }
        }
      } else {
        guard WalletConnectV2Policy.supportedMethods.contains(request.method) else {
          throw WalletConnectV2StateError.methodNotApproved
        }
        guard let session = state.sessions.first(where: { $0.topic == request.topic }) else {
          throw WalletConnectV2StateError.sessionUnavailable
        }
        guard session.dappClass == request.dappClass,
              session.dappName == request.dappName else {
          throw WalletConnectV2StateError.invalidRequest
        }
        guard session.methods.contains(request.method) else {
          throw WalletConnectV2StateError.methodNotApproved
        }
      }
      state.pending.append(request)
      try persist(state)
    }
  }

  @discardableResult
  public func approveProposal(
    requestID: String,
    approval: WalletConnectV2SessionApproval,
    now: Date = Date()
  ) throws -> WalletConnectV2Callback {
    try withLockedState { state in
      guard let request = state.pending.first(where: { $0.id == requestID }),
            request.kind == .sessionProposal,
            request.expiresAt > now else {
        throw WalletConnectV2StateError.requestUnavailable
      }
      let accountParts = approval.account.split(separator: ":", maxSplits: 2).map(String.init)
      guard approval.chain == WalletConnectV2Policy.chain,
            accountParts.count == 3,
            "\(accountParts[0]):\(accountParts[1])" == WalletConnectV2Policy.chain,
            Self.validAccount(accountParts[2]),
            approval.methods.isSubset(of: WalletConnectV2Policy.supportedMethods),
            approval.events.isSubset(of: WalletConnectV2Policy.supportedEvents) else {
        throw WalletConnectV2StateError.invalidRequest
      }
      if let existing = state.sessions.first(where: { $0.topic == request.topic }) {
        guard Self.matchesIdentity(request, existing) else {
          throw WalletConnectV2StateError.invalidRequest
        }
      }
      _ = try Self.take(requestID, kind: .sessionProposal, now: now, from: &state)
      state.sessions.removeAll { $0.topic == request.topic }
      state.sessions.append(WalletConnectV2PersistedSession(
        topic: request.topic,
        dappClass: request.dappClass,
        dappName: request.dappName,
        approvedAccount: accountParts[2].lowercased(),
        methods: approval.methods,
        events: approval.events,
        approvedAt: now
      ))
      try persist(state)
      return WalletConnectV2Callback(
        requestID: request.id,
        topic: request.topic,
        result: .success(approval.account.lowercased())
      )
    }
  }

  public func resolveRequest(
    requestID: String,
    executionResult: String,
    now: Date = Date()
  ) throws -> WalletConnectV2Callback {
    try withLockedState { state in
      guard let request = state.pending.first(where: { $0.id == requestID }) else {
        throw WalletConnectV2StateError.requestUnavailable
      }
      guard request.kind == .sessionRequest,
            let session = state.sessions.first(where: { $0.topic == request.topic }),
            session.methods.contains(request.method),
            Self.validExecutionResult(executionResult, method: request.method, account: session.approvedAccount) else {
        throw WalletConnectV2StateError.invalidExecutionResult
      }
      _ = try Self.take(requestID, kind: .sessionRequest, now: now, from: &state)
      try persist(state)
      return WalletConnectV2Callback(
        requestID: request.id,
        topic: request.topic,
        result: .success(executionResult)
      )
    }
  }

  public func reject(requestID: String, now: Date = Date()) throws -> WalletConnectV2Callback {
    try withLockedState { state in
      guard let request = state.pending.first(where: { $0.id == requestID }) else {
        throw WalletConnectV2StateError.requestUnavailable
      }
      _ = try Self.take(requestID, kind: request.kind, now: now, from: &state)
      try persist(state)
      return WalletConnectV2Callback(
        requestID: request.id,
        topic: request.topic,
        result: .rejected(code: 4001, message: "User rejected the request")
      )
    }
  }

  @discardableResult
  public func disconnect(topic: String) throws -> Bool {
    try withLockedState { state in
      let existed = state.sessions.contains { $0.topic == topic }
      state.sessions.removeAll { $0.topic == topic }
      state.pending.removeAll { $0.topic == topic }
      try persist(state)
      return existed
    }
  }

  @discardableResult
  public func revoke(topic: String) throws -> Bool {
    try disconnect(topic: topic)
  }

  private func withLockedState<T>(_ operation: (inout State) throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    return try operation(&state)
  }

  private func persist(_ state: State) throws {
    do {
      try FileManager.default.createDirectory(
        at: fileURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
      )
      try JSONEncoder.walletConnect.encode(state).write(to: fileURL, options: .atomic)
    } catch {
      throw WalletConnectV2StateError.corruptPersistence
    }
  }

  private static func take(
    _ requestID: String,
    kind: WalletConnectV2RequestKind,
    now: Date,
    from state: inout State
  ) throws -> WalletConnectV2PendingRequest {
    guard let index = state.pending.firstIndex(where: { $0.id == requestID }) else {
      throw WalletConnectV2StateError.requestUnavailable
    }
    let request = state.pending[index]
    guard request.kind == kind else { throw WalletConnectV2StateError.invalidRequest }
    guard request.expiresAt > now else {
      state.pending.remove(at: index)
      throw WalletConnectV2StateError.expiredRequest
    }
    state.pending.remove(at: index)
    return request
  }

  private static func validIdentifier(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 128 && !value.contains(where: { $0.isWhitespace })
  }

  private static func validTopic(_ value: String) -> Bool {
    value.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil
  }

  private static func validDigest(_ value: String) -> Bool {
    value.range(of: "^0x[0-9a-fA-F]{64}$", options: .regularExpression) != nil
  }

  private static func validAccount(_ value: String) -> Bool {
    value.range(of: "^0x[0-9a-fA-F]{40}$", options: .regularExpression) != nil
  }

  private static func validDAppName(_ value: String) -> Bool {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return !trimmed.isEmpty && trimmed.utf8.count <= 160
  }

  private static func validPersistedState(_ state: State) -> Bool {
    guard state.schemaVersion == 1,
          Set(state.pending.map(\.id)).count == state.pending.count,
          Set(state.sessions.map(\.topic)).count == state.sessions.count,
          state.sessions.allSatisfy({ session in
            validTopic(session.topic)
              && validDAppName(session.dappName)
              && validAccount(session.approvedAccount)
              && session.methods.isSubset(of: WalletConnectV2Policy.supportedMethods)
              && session.events.isSubset(of: WalletConnectV2Policy.supportedEvents)
          }) else {
      return false
    }
    return state.pending.allSatisfy { request in
      guard validIdentifier(request.id),
            validTopic(request.topic),
            validDAppName(request.dappName),
            validDigest(request.paramsDigest),
            request.receivedAt < request.expiresAt else {
        return false
      }
      if request.kind == .sessionProposal {
        guard request.method == "wc_sessionPropose" else { return false }
        guard let existing = state.sessions.first(where: { $0.topic == request.topic }) else {
          return true
        }
        return matchesIdentity(request, existing)
      }
      guard WalletConnectV2Policy.supportedMethods.contains(request.method),
            let session = state.sessions.first(where: { $0.topic == request.topic }) else {
        return false
      }
      return matchesIdentity(request, session)
        && session.methods.contains(request.method)
    }
  }

  private static func matchesIdentity(
    _ request: WalletConnectV2PendingRequest,
    _ session: WalletConnectV2PersistedSession
  ) -> Bool {
    session.dappClass == request.dappClass && session.dappName == request.dappName
  }

  private static func validExecutionResult(_ value: String, method: String, account: String) -> Bool {
    switch method {
    case "eth_chainId":
      return value == WalletConnectV2Policy.chainHex
    case "eth_requestAccounts":
      return value.lowercased() == "[\"\(account.lowercased())\"]"
    case "personal_sign", "eth_signTypedData_v4":
      return value.range(of: "^0x[0-9a-fA-F]{130}$", options: .regularExpression) != nil
    case "eth_sendTransaction":
      return value.range(of: "^0x[0-9a-fA-F]{64}$", options: .regularExpression) != nil
    case "wallet_addEthereumChain", "wallet_switchEthereumChain":
      return value == "null"
    default:
      return false
    }
  }
}

private extension JSONEncoder {
  static var walletConnect: JSONEncoder {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }
}

private extension JSONDecoder {
  static var walletConnect: JSONDecoder {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }
}
