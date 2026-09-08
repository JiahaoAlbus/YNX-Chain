import Foundation

struct FaucetHttpFailure: Error, Sendable {
  let code: String
}

struct FaucetHttpReply: Sendable {
  let url: String
  let status: Int
  let contentType: String
  let cacheControl: String
  let body: String

  func fields() -> [String: Any] {
    ["url": url, "redirected": false, "status": status,
     "contentType": contentType, "cacheControl": cacheControl, "body": body]
  }
}

/// Used by the real URLSession delegate and tested independently for replacement
/// and nonzero-offset requests. Closing never resets the supplier for reuse.
final class FaucetOneUseUploadBody {
  private let monitor = NSLock()
  private var data: Data
  private var used = false
  private var stream: InputStream?
  init(_ data: Data) { self.data = data }
  func take(offset: Int64) -> InputStream? {
    monitor.lock(); defer { monitor.unlock() }
    guard !used else { return nil }
    used = true
    guard offset == 0 else { data.removeAll(); return nil }
    let result = InputStream(data: data); stream = result; return result
  }
  func close() {
    monitor.lock(); defer { monitor.unlock() }
    used = true; stream?.close(); stream = nil; data.removeAll()
  }
}

/// Internal Foundation engine only. The Expo bridge remains disabled until
/// separate iOS native acceptance. No caller-supplied URL reaches an Expo API.
/// A supplied body stream is never replaced. This does not promise wire exactly
/// once: a server may have processed bytes before cancellation or connection loss.
final class BoundedFaucetHttpEngine: @unchecked Sendable {
  typealias Completion = (Result<FaucetHttpReply, FaucetHttpFailure>) -> Void
  private final class Entry {
    let purpose: String
    let deadline: UInt64
    var started = false
    var task: URLSessionUploadTask?
    var completion: Completion?
    var requestBody = Data()
    var uploadBody: FaucetOneUseUploadBody?
    var replyBody = Data()
    var response: HTTPURLResponse?
    var contentType = ""
    var cacheControl = ""
    var declaredLength: Int?
    init(purpose: String, deadline: UInt64) { self.purpose = purpose; self.deadline = deadline }
  }

  private let monitor = NSRecursiveLock()
  private let prefix = UUID().uuidString
  private let admitURL: URL
  private let rpcURL: URL
  private let now: () -> UInt64
  private let deadlineNanoseconds: UInt64
  private var sequence: UInt64 = 0
  private var entries: [String: Entry] = [:]
  private var tasks: [Int: String] = [:]
  private var closed = false
  private var paused = true
  private var session: URLSession?
  private var deadlineTimer: DispatchSourceTimer?
  private let callbacks = OperationQueue()
  private let timers = DispatchQueue(label: "com.ynx.wallet.faucet.deadlines")
  private let delegate = Delegate()
  private static let responseCap = 16_384

  init(admitURL: URL = URL(string: "https://faucet.ynxweb4.com/request")!,
       rpcURL: URL = URL(string: "https://rpc.ynxweb4.com/evm")!,
       now: @escaping () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
       deadlineNanoseconds: UInt64 = 15_000_000_000) throws {
    guard Self.endpointAllowed(admitURL, expected: "https://faucet.ynxweb4.com/request"),
          Self.endpointAllowed(rpcURL, expected: "https://rpc.ynxweb4.com/evm"),
          deadlineNanoseconds > 0, deadlineNanoseconds <= 15_000_000_000 else {
      throw FaucetHttpFailure(code: "YNX_HTTP_INVALID_INPUT")
    }
    self.admitURL = admitURL; self.rpcURL = rpcURL
    self.now = now; self.deadlineNanoseconds = deadlineNanoseconds
    callbacks.maxConcurrentOperationCount = 1
    callbacks.name = "com.ynx.wallet.faucet.callbacks"
    delegate.owner = self
    // One rescheduled native timer per engine, not one cancelled work item per
    // reservation: reserve/cancel churn cannot leave thousands of delayed jobs.
    let timer = DispatchSource.makeTimerSource(queue: timers)
    timer.setEventHandler { [weak self] in self?.expireReservations() }
    timer.schedule(deadline: .distantFuture)
    deadlineTimer = timer
    timer.resume()
  }

  deinit { close() }

  func reserve(purpose: String) throws -> String {
    try locked {
      guard purpose == "admit" || purpose == "rpc" else { throw failure("YNX_HTTP_INVALID_INPUT") }
      guard !closed else { throw failure("YNX_HTTP_UNAVAILABLE") }
      guard !paused else { throw failure("YNX_HTTP_CANCELLED") }
      guard entries.count < 8, sequence < UInt64.max else { throw failure("YNX_HTTP_CAPACITY") }
      let time = now()
      guard time <= UInt64.max - deadlineNanoseconds else { throw failure("YNX_HTTP_TIMEOUT") }
      sequence += 1
      let id = "\(prefix)-\(sequence)"
      let entry = Entry(purpose: purpose, deadline: time + deadlineNanoseconds)
      entries[id] = entry
      scheduleDeadline()
      return id
    }
  }

  /// Claim and resume are under the same registry lock as cancel. A cancelled,
  /// timed-out, already-used or unknown ID never creates another request.
  func request(_ input: [String: Any], completion: @escaping Completion) {
    locked {
      guard let id = input["taskId"] as? String, !id.isEmpty, id.utf8.count <= 96 else {
        completion(.failure(failure("YNX_HTTP_INVALID_INPUT"))); return
      }
      guard let entry = entries[id], !entry.started else {
        completion(.failure(failure("YNX_HTTP_TASK_INVALID"))); return
      }
      entry.started = true; entry.completion = completion
      do {
        try active(id, entry)
        guard input["purpose"] as? String == entry.purpose else { throw failure("YNX_HTTP_INVALID_INPUT") }
        entry.requestBody = try encode(input, purpose: entry.purpose)
        entry.uploadBody = FaucetOneUseUploadBody(entry.requestBody)
        let url = entry.purpose == "admit" ? admitURL : rpcURL
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 5)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.setValue(String(entry.requestBody.count), forHTTPHeaderField: "Content-Length")
        // This API ignores request.httpBody/httpBodyStream. Only the one-use
        // delegate supplier below is permitted to furnish upload bytes.
        let task = getSession().uploadTask(withStreamedRequest: request)
        entry.task = task; tasks[task.taskIdentifier] = id
        try active(id, entry)
        task.resume()
      } catch {
        finish(id, entry, .failure(error as? FaucetHttpFailure ?? failure("YNX_HTTP_INVALID_INPUT")))
      }
    }
  }

  func cancel(_ taskId: String) {
    locked { if let entry = entries[taskId] { finish(taskId, entry, .failure(failure("YNX_HTTP_CANCELLED"))) } }
  }

  func cancelAll() {
    locked { for (id, entry) in Array(entries) { finish(id, entry, .failure(failure("YNX_HTTP_CANCELLED"))) } }
  }

  func pause() { locked { paused = true; cancelAll() } }
  func resume() { locked { if !closed { paused = false } } }
  func close() {
    locked {
      guard !closed else { return }
      closed = true; cancelAll()
      session?.invalidateAndCancel(); session = nil
      deadlineTimer?.cancel(); deadlineTimer = nil
    }
  }

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    monitor.lock(); defer { monitor.unlock() }; return try body()
  }

  private func failure(_ code: String) -> FaucetHttpFailure { FaucetHttpFailure(code: code) }
  private func scheduleDeadline() {
    guard !closed else { return }
    guard let next = entries.values.map(\.deadline).min() else {
      deadlineTimer?.schedule(deadline: .distantFuture); return
    }
    let time = now(), remaining = next > time ? next - time : 0
    deadlineTimer?.schedule(deadline: .now() + .nanoseconds(Int(min(remaining, deadlineNanoseconds))), leeway: .nanoseconds(0))
  }
  private func expireReservations() {
    locked {
      guard !closed else { return }
      let time = now()
      for (id, entry) in Array(entries) where time >= entry.deadline {
        finish(id, entry, .failure(failure("YNX_HTTP_TIMEOUT")))
      }
      scheduleDeadline()
    }
  }
  private func active(_ id: String, _ entry: Entry) throws {
    guard entries[id] === entry, !closed, !paused else { throw failure("YNX_HTTP_CANCELLED") }
    guard now() < entry.deadline else { throw failure("YNX_HTTP_TIMEOUT") }
  }

  private func locate(_ task: URLSessionTask) -> (String, Entry)? {
    guard let id = tasks[task.taskIdentifier], let entry = entries[id], entry.task === task else { return nil }
    return (id, entry)
  }

  private func finish(_ id: String, _ entry: Entry, _ result: Result<FaucetHttpReply, FaucetHttpFailure>) {
    locked {
      guard entries[id] === entry else { return }
      let final: Result<FaucetHttpReply, FaucetHttpFailure> = now() >= entry.deadline
        ? .failure(failure("YNX_HTTP_TIMEOUT")) : result
      entries.removeValue(forKey: id)
      if let task = entry.task { tasks.removeValue(forKey: task.taskIdentifier) }
      scheduleDeadline()
      let completion = entry.completion; entry.completion = nil
      entry.uploadBody?.close(); entry.uploadBody = nil
      if case .failure = final { entry.task?.cancel() }
      entry.task = nil; entry.requestBody.removeAll(); entry.replyBody.removeAll()
      // Terminal state is established before cancellation/caller code. The
      // recursive lock makes delivery linearize against another thread's cancel;
      // a cancel after delivery cannot undo a server's already-observed response.
      completion?(final)
    }
  }

  private func getSession() -> URLSession {
    if let session { return session }
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil; config.httpShouldSetCookies = false
    config.urlCredentialStorage = nil; config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    config.timeoutIntervalForRequest = 5; config.timeoutIntervalForResource = 15
    config.waitsForConnectivity = false
    config.httpMaximumConnectionsPerHost = 8
    let newSession = URLSession(configuration: config, delegate: delegate, delegateQueue: callbacks)
    session = newSession; return newSession
  }

  private func supply(_ task: URLSessionTask, offset: Int64,
                      completion: (InputStream?) -> Void) {
    locked {
      guard let (id, entry) = locate(task) else { completion(nil); task.cancel(); return }
      do {
        try active(id, entry)
        guard let stream = entry.uploadBody?.take(offset: offset) else { throw failure("YNX_HTTP_NETWORK") }
        completion(stream)
      } catch {
        finish(id, entry, .failure(error as? FaucetHttpFailure ?? failure("YNX_HTTP_NETWORK")))
        completion(nil)
      }
    }
  }

  private func received(_ task: URLSessionDataTask, response: URLResponse,
                        completion: (URLSession.ResponseDisposition) -> Void) {
    locked {
      guard let (id, entry) = locate(task) else { completion(.cancel); return }
      do {
        try active(id, entry)
        guard let http = response as? HTTPURLResponse else { throw failure("YNX_HTTP_METADATA") }
        guard !(300...399).contains(http.statusCode) else { throw failure("YNX_HTTP_REDIRECT") }
        let url = entry.purpose == "admit" ? admitURL : rpcURL
        guard (100...599).contains(http.statusCode), http.url?.absoluteString == url.absoluteString else {
          throw failure("YNX_HTTP_METADATA")
        }
        func header(_ name: String) throws -> String {
          let value = http.value(forHTTPHeaderField: name) ?? ""
          guard value.utf16.count <= 256, !value.contains("\r"), !value.contains("\n") else { throw failure("YNX_HTTP_METADATA") }
          return value
        }
        let type = try header("Content-Type")
        guard Self.matches(type, "(?i)application/json(?:;[ \\t]*charset=utf-8)?") else { throw failure("YNX_HTTP_METADATA") }
        let encoding = try header("Content-Encoding")
        guard encoding.isEmpty || encoding.lowercased() == "identity" else { throw failure("YNX_HTTP_ENCODING") }
        let cache = try header("Cache-Control")
        guard entry.purpose != "admit" || cache == "no-store" else { throw failure("YNX_HTTP_METADATA") }
        let transfer = try header("Transfer-Encoding")
        // Darwin Foundation exposes a decoded chunked response as "Identity".
        // Its parsed headers cannot distinguish this from wire identity. Accept
        // only these known representations, retain the cumulative decoded-byte
        // cap, and do not claim access to unmodified wire transfer headers.
        guard transfer.isEmpty || ["chunked", "identity"].contains(transfer.lowercased()) else { throw failure("YNX_HTTP_METADATA") }
        let length = try header("Content-Length")
        if !length.isEmpty {
          guard Self.matches(length, "[0-9]{1,20}"), transfer.isEmpty else { throw failure("YNX_HTTP_METADATA") }
          guard let number = UInt64(length), number <= UInt64(Self.responseCap) else { throw failure("YNX_HTTP_RESPONSE_TOO_LARGE") }
          entry.declaredLength = Int(number)
        }
        entry.response = http; entry.contentType = type; entry.cacheControl = cache
        entry.replyBody.reserveCapacity(Self.responseCap)
        completion(.allow)
      } catch {
        finish(id, entry, .failure(error as? FaucetHttpFailure ?? failure("YNX_HTTP_METADATA")))
        completion(.cancel)
      }
    }
  }

  private func received(_ task: URLSessionDataTask, data: Data) {
    locked {
      guard let (id, entry) = locate(task) else { return }
      do {
        try active(id, entry)
        guard entry.response != nil else { throw failure("YNX_HTTP_METADATA") }
        guard data.count <= Self.responseCap - entry.replyBody.count else { throw failure("YNX_HTTP_RESPONSE_TOO_LARGE") }
        entry.replyBody.append(data)
      } catch { finish(id, entry, .failure(error as? FaucetHttpFailure ?? failure("YNX_HTTP_NETWORK"))) }
    }
  }

  private func completed(_ task: URLSessionTask, error: Error?) {
    locked {
      guard let (id, entry) = locate(task) else { return }
      do {
        try active(id, entry)
        if let error {
          let ns = error as NSError
          throw failure(ns.domain == NSURLErrorDomain && ns.code == NSURLErrorTimedOut ? "YNX_HTTP_TIMEOUT" : "YNX_HTTP_NETWORK")
        }
        guard let response = entry.response else { throw failure("YNX_HTTP_METADATA") }
        if let length = entry.declaredLength, length != entry.replyBody.count { throw failure("YNX_HTTP_NETWORK") }
        guard let body = String(data: entry.replyBody, encoding: .utf8) else { throw failure("YNX_HTTP_ENCODING") }
        finish(id, entry, .success(FaucetHttpReply(url: response.url!.absoluteString,
          status: response.statusCode, contentType: entry.contentType, cacheControl: entry.cacheControl, body: body)))
      } catch { finish(id, entry, .failure(error as? FaucetHttpFailure ?? failure("YNX_HTTP_NETWORK"))) }
    }
  }

  private func reject(_ task: URLSessionTask, code: String) {
    locked {
      if let (id, entry) = locate(task) { finish(id, entry, .failure(failure(code))) }
      else { task.cancel() }
    }
  }

  private func challenge(_ task: URLSessionTask, challenge: URLAuthenticationChallenge,
                         completion: (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    locked {
      guard let (id, entry) = locate(task) else { completion(.cancelAuthenticationChallenge, nil); task.cancel(); return }
      do {
        try active(id, entry)
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else {
          throw failure("YNX_HTTP_NETWORK")
        }
        completion(.performDefaultHandling, nil)
      } catch {
        finish(id, entry, .failure(error as? FaucetHttpFailure ?? failure("YNX_HTTP_NETWORK")))
        completion(.cancelAuthenticationChallenge, nil)
      }
    }
  }

  private static func matches(_ value: String, _ pattern: String) -> Bool {
    guard let regex = try? NSRegularExpression(pattern: "\\A(?:" + pattern + ")\\z") else { return false }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return regex.firstMatch(in: value, range: range)?.range == range
  }

  private static func endpointAllowed(_ url: URL, expected: String) -> Bool {
    if url.absoluteString == expected { return true }
    #if YNX_FAUCET_HOST_TESTS
    // Compile-time host harness only; no runtime production enable switch.
    if let c = URLComponents(url: url, resolvingAgainstBaseURL: false), c.scheme == "http",
       c.host == "127.0.0.1", c.port != nil, c.user == nil, c.password == nil,
       c.query == nil, c.fragment == nil { return true }
    #endif
    return false
  }

  private func encode(_ input: [String: Any], purpose: String) throws -> Data {
    let body: String
    if purpose == "admit" {
      guard Set(input.keys) == Set(["purpose", "taskId", "requestId", "body"]),
            let original = input["body"] as? String, original.utf8.count <= 1024,
            let requestID = input["requestId"] as? String,
            Self.matches(original, "\\{\"requestId\":\"[A-Za-z0-9_-]{32,128}\",\"address\":\"ynx1[0-9a-z]{1,86}\",\"amount\":[1-9][0-9]{0,15}\\}"),
            Self.matches(requestID, "[A-Za-z0-9_-]{32,128}"),
            original.hasPrefix("{\"requestId\":\"" + requestID + "\","),
            let amountStart = original.range(of: ",\"amount\":")?.upperBound,
            let amount = UInt64(original[amountStart..<original.index(before: original.endIndex)]),
            amount <= 9_007_199_254_740_991 else { throw failure("YNX_HTTP_INVALID_INPUT") }
      body = original
    } else {
      guard Set(input.keys) == Set(["purpose", "taskId", "rpcId", "method", "params"]),
            let rpcID = input["rpcId"] as? String, Self.matches(rpcID, "[A-Za-z0-9_-]{1,96}"),
            let method = input["method"] as? String, let params = input["params"] as? [String] else { throw failure("YNX_HTTP_INVALID_INPUT") }
      if ["eth_chainId", "ynx_getFaucetModel", "ynx_getDurabilityModel"].contains(method) {
        guard params.isEmpty else { throw failure("YNX_HTTP_INVALID_INPUT") }
      } else if ["ynx_getTransactionDurability", "eth_getTransactionReceipt"].contains(method) {
        guard params.count == 1, Self.matches(params[0], "0x[0-9a-f]{64}") else { throw failure("YNX_HTTP_INVALID_INPUT") }
      } else { throw failure("YNX_HTTP_INVALID_INPUT") }
      let encodedParams = params.isEmpty ? "[]" : "[\"" + params[0] + "\"]"
      body = "{\"jsonrpc\":\"2.0\",\"id\":\"" + rpcID + "\",\"method\":\"" + method + "\",\"params\":" + encodedParams + "}"
    }
    let bytes = Data(body.utf8)
    guard bytes.count <= 1024 else { throw failure("YNX_HTTP_INVALID_INPUT") }
    return bytes
  }

  private final class Delegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    weak var owner: BoundedFaucetHttpEngine?
    func urlSession(_ session: URLSession, task: URLSessionTask, needNewBodyStream completionHandler: @escaping (InputStream?) -> Void) {
      guard let owner else { completionHandler(nil); task.cancel(); return }
      owner.supply(task, offset: 0, completion: completionHandler)
    }
    @available(iOS 17.0, macOS 14.0, *)
    func urlSession(_ session: URLSession, task: URLSessionTask, needNewBodyStreamFrom offset: Int64, completionHandler: @escaping (InputStream?) -> Void) {
      guard let owner else { completionHandler(nil); task.cancel(); return }
      owner.supply(task, offset: offset, completion: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
      owner?.reject(task, code: "YNX_HTTP_REDIRECT"); completionHandler(nil)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
      guard let owner else { completionHandler(.cancelAuthenticationChallenge, nil); task.cancel(); return }
      // System TLS trust evaluation only; never substitute a trust credential.
      owner.challenge(task, challenge: challenge, completion: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willBeginDelayedRequest request: URLRequest, completionHandler: @escaping (URLSession.DelayedRequestDisposition, URLRequest?) -> Void) {
      owner?.reject(task, code: "YNX_HTTP_NETWORK"); completionHandler(.cancel, nil)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
      guard let owner else { completionHandler(.cancel); return }
      owner.received(dataTask, response: response, completion: completionHandler)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) { owner?.received(dataTask, data: data) }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { owner?.completed(task, error: error) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, willCacheResponse proposedResponse: CachedURLResponse, completionHandler: @escaping (CachedURLResponse?) -> Void) { completionHandler(nil) }
  }
}
