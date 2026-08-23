import Combine
import Foundation
import WalletConnectNetworking
import WalletConnectPairing
import WalletConnectSign

public enum WalletConnectRelayRuntimeError: String, Error, Equatable, Sendable {
  case invalidProjectID = "WALLETCONNECT_PROJECT_ID_UNAVAILABLE"
  case invalidAppGroup = "WALLETCONNECT_APP_GROUP_UNAVAILABLE"
  case signerUnavailable = "WALLETCONNECT_SIGNER_UNAVAILABLE"
  case accountUnavailable = "WALLETCONNECT_ACCOUNT_UNAVAILABLE"
  case sdkAlreadyConfigured = "WALLETCONNECT_SDK_ALREADY_CONFIGURED"
  case proposalUnavailable = "WALLETCONNECT_PROPOSAL_UNAVAILABLE"
  case requestUnavailable = "WALLETCONNECT_REQUEST_UNAVAILABLE"
  case sessionUnavailable = "WALLETCONNECT_SESSION_UNAVAILABLE"
  case unsupportedChain = "WALLETCONNECT_CHAIN_UNSUPPORTED"
  case unsupportedMethod = "WALLETCONNECT_METHOD_UNSUPPORTED"
  case invalidParameters = "WALLETCONNECT_PARAMETERS_INVALID"
  case invalidExecutionResult = "WALLETCONNECT_EXECUTION_RESULT_INVALID"
}

public struct WalletConnectRelayConfiguration: Equatable, Sendable {
  public let projectID: String
  public let appGroup: String
  public let relayHost: String

  public init(
    projectID: String,
    appGroup: String,
    relayHost: String = "relay.walletconnect.org"
  ) {
    self.projectID = projectID
    self.appGroup = appGroup
    self.relayHost = relayHost
  }
}

public protocol WalletConnectNativeSigner: AnyObject {
  /// The only account that may be exposed to a DApp. The implementation must
  /// resolve it from the existing native wallet signer, never from chat or a
  /// repository private-key value.
  var approvedAccount: String { get }
  var walletConnectCryptoProvider: CryptoProvider { get }

  /// Performs the explicit, user-confirmed request through the existing native
  /// signer. Implementations must reject widened chain/account/transaction data.
  func executeWalletConnectRequest(
    method: String,
    params: AnyCodable,
    chainID: String
  ) async throws -> AnyCodable
}

/// Registration point for the existing native signer bridge. The repository
/// deliberately provides no fake signer and stores no raw account secret.
@MainActor
public enum WalletConnectNativeSignerRegistry {
  public static var current: WalletConnectNativeSigner?
}

public struct WalletConnectProposalViewState: Identifiable, Equatable, Sendable {
  public let id: String
  public let dappName: String
  public let dappURL: String
  public let chains: [String]
  public let methods: [String]
  public let events: [String]
}

public struct WalletConnectRequestViewState: Identifiable, Equatable, Sendable {
  public let id: String
  public let topic: String
  public let dappName: String
  public let chainID: String
  public let method: String
  public let paramsJSON: String
}

public struct WalletConnectSessionViewState: Identifiable, Equatable, Sendable {
  public var id: String { topic }
  public let topic: String
  public let dappName: String
  public let account: String
  public let expiresAt: Date
}

/// Real Reown WalletKit adapter shared by the macOS and iOS application targets.
/// It owns transport and SDK state, while key authority stays behind the injected
/// native signer. Merely constructing this type never fabricates an account,
/// approval, signature, transaction, callback, or public-runtime success.
@MainActor
public final class WalletConnectRelayRuntime: ObservableObject {
  @Published public private(set) var status = "Protected WalletConnect configuration required"
  @Published public private(set) var relayConnected = false
  @Published public private(set) var proposals: [WalletConnectProposalViewState] = []
  @Published public private(set) var requests: [WalletConnectRequestViewState] = []
  @Published public private(set) var sessions: [WalletConnectSessionViewState] = []

  private static var configured = false

  private let configuration: WalletConnectRelayConfiguration
  private let signer: WalletConnectNativeSigner
  private let client: SignClient
  private var proposalObjects: [String: Session.Proposal] = [:]
  private var requestObjects: [String: Request] = [:]
  private var cancellables = Set<AnyCancellable>()

  public init(
    configuration: WalletConnectRelayConfiguration,
    signer: WalletConnectNativeSigner
  ) throws {
    let normalizedProjectID = configuration.projectID.trimmingCharacters(in: .whitespacesAndNewlines)
    let normalizedGroup = configuration.appGroup.trimmingCharacters(in: .whitespacesAndNewlines)
    guard normalizedProjectID.range(
      of: "^[0-9a-fA-F]{32}$",
      options: .regularExpression
    ) != nil else {
      throw WalletConnectRelayRuntimeError.invalidProjectID
    }
    guard normalizedGroup.range(
      of: "^group\\.[A-Za-z0-9.-]{3,120}$",
      options: .regularExpression
    ) != nil else {
      throw WalletConnectRelayRuntimeError.invalidAppGroup
    }
    let normalizedAccount = signer.approvedAccount.lowercased()
    guard normalizedAccount.range(
      of: "^0x[0-9a-f]{40}$",
      options: .regularExpression
    ) != nil else {
      throw WalletConnectRelayRuntimeError.accountUnavailable
    }
    guard !Self.configured else {
      throw WalletConnectRelayRuntimeError.sdkAlreadyConfigured
    }

    self.configuration = WalletConnectRelayConfiguration(
      projectID: normalizedProjectID.lowercased(),
      appGroup: normalizedGroup,
      relayHost: configuration.relayHost
    )
    self.signer = signer

    Networking.configure(
      relayHost: configuration.relayHost,
      groupIdentifier: normalizedGroup,
      projectId: normalizedProjectID.lowercased(),
      socketFactory: WalletConnectURLSessionSocketFactory()
    )
    let redirect = try AppMetadata.Redirect(
      native: "ynxwallet://",
      universal: nil,
      linkMode: false
    )
    let metadata = AppMetadata(
      name: "YNX Wallet",
      description: "YNX Wallet for YNX Testnet",
      url: "https://ynxweb4.com",
      icons: [],
      redirect: redirect
    )
    Pair.configure(metadata: metadata)
    Sign.configure(crypto: signer.walletConnectCryptoProvider)
    Self.configured = true
    client = Sign.instance
    subscribe()
    restoreSDKState()
  }

  public func pair(deepLink: String) async throws {
    let pairing = try WalletConnectV2Policy.parseDeepLink(
      deepLink,
      projectID: configuration.projectID
    )
    let uri = try WalletConnectURI(uriString: pairing.uri)
    status = "Pairing with WalletConnect relay…"
    try await Pair.instance.pair(uri: uri)
    status = "Pairing submitted · awaiting proposal"
  }

  public func approveProposal(id: String) async throws {
    guard let proposal = proposalObjects[id] else {
      throw WalletConnectRelayRuntimeError.proposalUnavailable
    }
    let chain = try requiredChain()
    let account = try approvedAccount(chain: chain)
    let namespaces: [String: SessionNamespace]
    do {
      namespaces = try AutoNamespaces.build(
        sessionProposal: proposal,
        chains: [chain],
        methods: Array(WalletConnectV2Policy.supportedMethods),
        events: Array(WalletConnectV2Policy.supportedEvents),
        accounts: [account]
      )
    } catch let error as AutoNamespacesError {
      try await client.rejectSession(
        proposalId: proposal.id,
        reason: RejectionReason(from: error)
      )
      removeProposal(id)
      throw error
    }
    _ = try await client.approve(
      proposalId: proposal.id,
      namespaces: namespaces
    )
    removeProposal(id)
    restoreSDKState()
    status = "Session approved for YNX Testnet"
  }

  public func rejectProposal(id: String) async throws {
    guard let proposal = proposalObjects[id] else {
      throw WalletConnectRelayRuntimeError.proposalUnavailable
    }
    try await client.rejectSession(proposalId: proposal.id, reason: .userRejected)
    removeProposal(id)
    status = "Proposal rejected · no authority created"
  }

  public func approveRequest(id: String) async throws {
    guard let request = requestObjects[id] else {
      throw WalletConnectRelayRuntimeError.requestUnavailable
    }
    try validate(request)
    let response: AnyCodable
    switch request.method {
    case "eth_chainId":
      response = AnyCodable(WalletConnectV2Policy.chainHex)
    case "eth_requestAccounts":
      response = AnyCodable([signer.approvedAccount.lowercased()])
    case "wallet_addEthereumChain", "wallet_switchEthereumChain":
      do {
        try WalletConnectV2Policy.validateChainManagementRequest(
          method: request.method,
          paramsJSON: request.params.stringRepresentation
        )
      } catch WalletConnectV2PolicyError.unsupportedNamespace {
        throw WalletConnectRelayRuntimeError.unsupportedChain
      } catch {
        throw WalletConnectRelayRuntimeError.invalidParameters
      }
      response = AnyCodable(Optional<String>.none)
    case "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction":
      response = try await signer.executeWalletConnectRequest(
        method: request.method,
        params: request.params,
        chainID: request.chainId.absoluteString
      )
      guard Self.validExecutionResult(response, method: request.method) else {
        throw WalletConnectRelayRuntimeError.invalidExecutionResult
      }
    default:
      throw WalletConnectRelayRuntimeError.unsupportedMethod
    }
    try await client.respond(
      topic: request.topic,
      requestId: request.id,
      response: .response(response)
    )
    removeRequest(id)
    status = "Request approved and response sent"
  }

  public func rejectRequest(id: String) async throws {
    guard let request = requestObjects[id] else {
      throw WalletConnectRelayRuntimeError.requestUnavailable
    }
    try await client.respond(
      topic: request.topic,
      requestId: request.id,
      response: .error(JSONRPCError(code: 4001, message: "User rejected the request"))
    )
    removeRequest(id)
    status = "Request rejected · no authority created"
  }

  public func disconnect(topic: String) async throws {
    guard sessions.contains(where: { $0.topic == topic }) else {
      throw WalletConnectRelayRuntimeError.sessionUnavailable
    }
    try await client.disconnect(topic: topic)
    requestObjects = requestObjects.filter { $0.value.topic != topic }
    restoreSDKState()
    status = "Session disconnected and revoked"
  }

  private func subscribe() {
    client.socketConnectionStatusPublisher
      .receive(on: DispatchQueue.main)
      .sink { [weak self] socketStatus in
        guard let self else { return }
        relayConnected = socketStatus == .connected
        status = relayConnected ? "WalletConnect relay connected" : "WalletConnect relay disconnected"
      }
      .store(in: &cancellables)

    client.sessionProposalPublisher
      .receive(on: DispatchQueue.main)
      .sink { [weak self] (proposal, _) in self?.receive(proposal) }
      .store(in: &cancellables)

    client.sessionRequestPublisher
      .receive(on: DispatchQueue.main)
      .sink { [weak self] (request, _) in self?.receive(request) }
      .store(in: &cancellables)

    client.sessionsPublisher
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in self?.restoreSDKState() }
      .store(in: &cancellables)

    client.sessionDeletePublisher
      .receive(on: DispatchQueue.main)
      .sink { [weak self] (topic, _) in
        self?.requestObjects = self?.requestObjects.filter { $0.value.topic != topic } ?? [:]
        self?.restoreSDKState()
      }
      .store(in: &cancellables)
  }

  private func receive(_ proposal: Session.Proposal) {
    proposalObjects[proposal.id] = proposal
    proposals = proposalObjects.values.map(Self.proposalViewState).sorted { $0.id < $1.id }
    status = "WalletConnect proposal requires approval"
  }

  private func receive(_ request: Request) {
    do {
      try validate(request)
    } catch {
      status = "WalletConnect request rejected by session policy"
      let responseError = Self.jsonRPCError(for: error)
      Task { [weak self] in
        guard let self else { return }
        try? await self.client.respond(
          topic: request.topic,
          requestId: request.id,
          response: .error(responseError)
        )
      }
      return
    }
    let id = request.id.string
    requestObjects[id] = request
    requests = requestObjects.values.map { request in
      WalletConnectRequestViewState(
        id: request.id.string,
        topic: request.topic,
        dappName: client.getSessions().first(where: { $0.topic == request.topic })?.peer.name ?? "Unknown DApp",
        chainID: request.chainId.absoluteString,
        method: request.method,
        paramsJSON: request.params.stringRepresentation
      )
    }.sorted { $0.id < $1.id }
    status = "WalletConnect request requires explicit confirmation"
  }

  private func restoreSDKState() {
    for pending in client.getPendingProposals() {
      proposalObjects[pending.proposal.id] = pending.proposal
    }
    for pending in client.getPendingRequests() {
      requestObjects[pending.request.id.string] = pending.request
    }
    proposals = proposalObjects.values.map(Self.proposalViewState).sorted { $0.id < $1.id }
    requests = requestObjects.values.map { request in
      WalletConnectRequestViewState(
        id: request.id.string,
        topic: request.topic,
        dappName: client.getSessions().first(where: { $0.topic == request.topic })?.peer.name ?? "Unknown DApp",
        chainID: request.chainId.absoluteString,
        method: request.method,
        paramsJSON: request.params.stringRepresentation
      )
    }.sorted { $0.id < $1.id }
    sessions = client.getSessions().filter { session in
      (try? Self.validateRestoredSession(session, approvedAccount: signer.approvedAccount)) != nil
    }.map { session in
      WalletConnectSessionViewState(
        topic: session.topic,
        dappName: session.peer.name,
        account: session.accounts.first(where: {
          $0.blockchain.absoluteString == WalletConnectV2Policy.chain
        })?.address ?? "",
        expiresAt: session.expiryDate
      )
    }.filter { !$0.account.isEmpty }.sorted { $0.topic < $1.topic }
  }

  private func validate(_ request: Request) throws {
    guard request.chainId.absoluteString == WalletConnectV2Policy.chain else {
      throw WalletConnectRelayRuntimeError.unsupportedChain
    }
    guard let session = client.getSessions().first(where: { $0.topic == request.topic }) else {
      throw WalletConnectRelayRuntimeError.sessionUnavailable
    }
    do {
      try WalletConnectV2Policy.authorizeSessionRequest(
        method: request.method,
        chainID: request.chainId.absoluteString,
        surfaces: Self.sessionSurfaces(session),
        approvedAccount: signer.approvedAccount
      )
    } catch WalletConnectV2PolicyError.methodNotApproved {
      throw WalletConnectRelayRuntimeError.unsupportedMethod
    } catch WalletConnectV2PolicyError.unsupportedNamespace {
      throw WalletConnectRelayRuntimeError.unsupportedChain
    } catch {
      throw WalletConnectRelayRuntimeError.sessionUnavailable
    }
  }

  private static func sessionSurfaces(_ session: Session) -> [WalletConnectV2SessionSurface] {
    session.namespaces.values.map { namespace in
      WalletConnectV2SessionSurface(
        chains: Set(
          (namespace.chains ?? []).map(\.absoluteString)
            + namespace.accounts.map { $0.blockchain.absoluteString }
        ),
        accounts: Set(namespace.accounts.map { $0.absoluteString.lowercased() }),
        methods: namespace.methods,
        events: namespace.events
      )
    }
  }

  private static func validateRestoredSession(
    _ session: Session,
    approvedAccount: String
  ) throws {
    try WalletConnectV2Policy.validateRestoredSession(
      surfaces: sessionSurfaces(session),
      approvedAccount: approvedAccount
    )
  }

  private static func jsonRPCError(for error: Error) -> JSONRPCError {
    switch error {
    case WalletConnectRelayRuntimeError.unsupportedMethod:
      return JSONRPCError(code: 4200, message: "Method not approved for this session")
    case WalletConnectRelayRuntimeError.unsupportedChain:
      return JSONRPCError(code: 4901, message: "YNX Testnet chain not approved")
    case WalletConnectRelayRuntimeError.invalidParameters:
      return JSONRPCError(code: -32602, message: "WalletConnect request parameters are invalid")
    default:
      return JSONRPCError(code: 4100, message: "Session authority unavailable")
    }
  }

  private func approvedAccount(chain: Blockchain) throws -> Account {
    guard let account = Account(
      blockchain: chain,
      address: signer.approvedAccount.lowercased()
    ) else {
      throw WalletConnectRelayRuntimeError.accountUnavailable
    }
    return account
  }

  private func requiredChain() throws -> Blockchain {
    guard let chain = Blockchain(WalletConnectV2Policy.chain) else {
      throw WalletConnectRelayRuntimeError.unsupportedChain
    }
    return chain
  }

  private func removeProposal(_ id: String) {
    proposalObjects.removeValue(forKey: id)
    proposals = proposalObjects.values.map(Self.proposalViewState).sorted { $0.id < $1.id }
  }

  private func removeRequest(_ id: String) {
    requestObjects.removeValue(forKey: id)
    requests = requests.filter { $0.id != id }
  }

  private static func proposalViewState(_ proposal: Session.Proposal) -> WalletConnectProposalViewState {
    let required = Array(proposal.requiredNamespaces.values)
    return WalletConnectProposalViewState(
      id: proposal.id,
      dappName: proposal.proposer.name,
      dappURL: proposal.proposer.url,
      chains: required.flatMap { $0.chains ?? [] }.map(\.absoluteString).sorted(),
      methods: Array(required.reduce(into: Set<String>()) { $0.formUnion($1.methods) }).sorted(),
      events: Array(required.reduce(into: Set<String>()) { $0.formUnion($1.events) }).sorted()
    )
  }

  private static func validExecutionResult(_ result: AnyCodable, method: String) -> Bool {
    guard let value = try? result.get(String.self) else { return false }
    switch method {
    case "personal_sign", "eth_signTypedData_v4":
      return value.range(of: "^0x[0-9a-fA-F]{130}$", options: .regularExpression) != nil
    case "eth_sendTransaction":
      return value.range(of: "^0x[0-9a-fA-F]{64}$", options: .regularExpression) != nil
    default:
      return false
    }
  }
}

private final class WalletConnectURLSessionSocketFactory: WebSocketFactory {
  func create(with url: URL) -> WebSocketConnecting {
    WalletConnectURLSessionSocket(request: URLRequest(url: url))
  }
}

private final class WalletConnectURLSessionSocket: NSObject, WebSocketConnecting, URLSessionWebSocketDelegate {
  var request: URLRequest
  var onConnect: (() -> Void)?
  var onDisconnect: ((Error?) -> Void)?
  var onText: ((String) -> Void)?

  private let lock = NSLock()
  private var connected = false
  private var session: URLSession?
  private var task: URLSessionWebSocketTask?

  var isConnected: Bool {
    lock.lock()
    defer { lock.unlock() }
    return connected
  }

  init(request: URLRequest) {
    self.request = request
    super.init()
  }

  func connect() {
    guard task == nil else { return }
    let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    let task = session.webSocketTask(with: request)
    self.session = session
    self.task = task
    task.resume()
    receiveNext()
  }

  func disconnect() {
    task?.cancel(with: .normalClosure, reason: nil)
    finish(error: nil)
  }

  func write(string: String, completion: (() -> Void)?) {
    guard let task else {
      completion?()
      return
    }
    task.send(.string(string)) { _ in completion?() }
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    setConnected(true)
    onConnect?()
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    finish(error: nil)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: Error?
  ) {
    guard error != nil else { return }
    finish(error: error)
  }

  private func receiveNext() {
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(.string(let text)):
        onText?(text)
        receiveNext()
      case .success(.data(let data)):
        if let text = String(data: data, encoding: .utf8) { onText?(text) }
        receiveNext()
      case .failure(let error):
        finish(error: error)
      @unknown default:
        finish(error: nil)
      }
    }
  }

  private func setConnected(_ value: Bool) {
    lock.lock()
    connected = value
    lock.unlock()
  }

  private func finish(error: Error?) {
    let wasConnected = isConnected
    setConnected(false)
    task = nil
    session?.invalidateAndCancel()
    session = nil
    if wasConnected || error != nil { onDisconnect?(error) }
  }
}
