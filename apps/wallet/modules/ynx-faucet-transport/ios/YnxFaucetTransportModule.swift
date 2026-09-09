import Foundation

/// The JS-visible production constructor is permanently off in this candidate.
/// A separate native acceptance and source review must precede any activation.
final class BoundedFaucetHttpBridge: @unchecked Sendable {
  typealias Completion = (Result<FaucetHttpReply, FaucetHttpFailure>) -> Void
  typealias InitialActivitySampler = (@escaping @Sendable (Bool) -> Void) -> Void
  struct LifecycleNames: Sendable {
    let willEnterForeground: Notification.Name
    let didBecomeActive: Notification.Name
    let willResignActive: Notification.Name
    let didEnterBackground: Notification.Name
  }
  // Ticket identity crosses queues; its immutable callback is invoked only on gate.
  private final class Pending: @unchecked Sendable {
    let completion: Completion
    init(_ completion: @escaping Completion) { self.completion = completion }
  }

  private static let PRODUCTION_ENABLED = false
  private let enabled: Bool
  private let makeEngine: () throws -> BoundedFaucetHttpEngine
  private let gate = DispatchQueue(label: "com.ynx.wallet.faucet.bridge")
  private let gateKey = DispatchSpecificKey<UInt8>()
  private var engine: BoundedFaucetHttpEngine?
  private var engineCreations = 0
  private var active = false
  private var destroyed = false
  private var lifecycleRevision: UInt64 = 0
  private var pending: [String: Pending] = [:]
  private var notificationCenter: NotificationCenter?
  private var observers: [NSObjectProtocol] = []

  static func production() -> BoundedFaucetHttpBridge {
    BoundedFaucetHttpBridge(enabled: PRODUCTION_ENABLED, makeEngine: { try BoundedFaucetHttpEngine() })
  }
  private init(enabled: Bool, makeEngine: @escaping () throws -> BoundedFaucetHttpEngine) {
    self.enabled = enabled; self.makeEngine = makeEngine
    gate.setSpecific(key: gateKey, value: 1)
  }
  deinit { close() }

  /// Called at module creation. The observer is synchronous on the posting
  /// thread; no dispatch-to-main delay may leave resign-active work admitted.
  /// Only the initial UIKit state sample is scheduled onto its required thread.
  func observeLifecycle(center: NotificationCenter, names: LifecycleNames,
                        sampleInitialActivity: InitialActivitySampler) {
    withGate {
      guard !destroyed, notificationCenter == nil else { return }
      notificationCenter = center
      observers = [
        center.addObserver(forName: names.willEnterForeground, object: nil, queue: nil) { [weak self] _ in self?.suspend() },
        center.addObserver(forName: names.didBecomeActive, object: nil, queue: nil) { [weak self] _ in self?.becomeActive() },
        center.addObserver(forName: names.willResignActive, object: nil, queue: nil) { [weak self] _ in self?.suspend() },
        center.addObserver(forName: names.didEnterBackground, object: nil, queue: nil) { [weak self] _ in self?.suspend() }
      ]
      let revision = lifecycleRevision
      sampleInitialActivity { [weak self] isActive in
        self?.withGate {
          guard let self, !self.destroyed, self.lifecycleRevision == revision else { return }
          // A queued initial sample never overrides a newer native notification.
          if isActive { self.active = true; self.engine?.resume() }
          else { self.suspend() }
        }
      }
    }
  }

  func reserveTask(_ purpose: String) throws -> String {
    try withGate {
      try requireActive()
      if engine == nil {
        do { engine = try makeEngine(); engineCreations += 1 }
        catch { throw FaucetHttpFailure(code: "YNX_HTTP_UNAVAILABLE") }
        engine?.resume()
      }
      return try engine!.reserve(purpose: purpose)
    }
  }

  func request(_ input: [String: Any], completion: @escaping Completion) {
    withGate {
      do {
        try requireActive()
        guard let taskId = input["taskId"] as? String, !taskId.isEmpty, taskId.utf8.count <= 96 else {
          throw FaucetHttpFailure(code: "YNX_HTTP_INVALID_INPUT")
        }
        // Async request cannot create an engine or invent a reservation.
        guard let engine, pending[taskId] == nil else { throw FaucetHttpFailure(code: "YNX_HTTP_TASK_INVALID") }
        guard pending.count < 8 else { throw FaucetHttpFailure(code: "YNX_HTTP_CAPACITY") }
        let ticket = Pending(completion)
        pending[taskId] = ticket
        engine.request(input) { [weak self, ticket] result in
          // Engine completion holds its own registry lock. Never synchronously
          // acquire the bridge gate here: cancel uses gate -> engine ordering.
          self?.gate.async { [weak self, ticket] in self?.deliver(taskId, ticket, result) }
        }
      } catch {
        completion(.failure(error as? FaucetHttpFailure ?? FaucetHttpFailure(code: "YNX_HTTP_UNAVAILABLE")))
      }
    }
  }

  func cancel(_ taskId: String) {
    withGate {
      let ticket = pending.removeValue(forKey: taskId)
      engine?.cancel(taskId)
      ticket?.completion(.failure(FaucetHttpFailure(code: "YNX_HTTP_CANCELLED")))
    }
  }
  func suspend() {
    withGate {
      guard !destroyed else { return }
      lifecycleRevision &+= 1; active = false
      let cancelled = Array(pending.values); pending.removeAll()
      engine?.pause()
      for ticket in cancelled { ticket.completion(.failure(FaucetHttpFailure(code: "YNX_HTTP_CANCELLED"))) }
    }
  }
  func becomeActive() {
    withGate {
      guard !destroyed else { return }
      lifecycleRevision &+= 1; active = true; engine?.resume()
    }
  }
  func close() {
    withGate {
      guard !destroyed else { return }
      destroyed = true; active = false; lifecycleRevision &+= 1
      let cancelled = Array(pending.values); pending.removeAll()
      let oldEngine = engine; engine = nil
      oldEngine?.close()
      if let center = notificationCenter { for observer in observers { center.removeObserver(observer) } }
      observers.removeAll(); notificationCenter = nil
      // All state is terminal before external code can reenter this bridge.
      for ticket in cancelled { ticket.completion(.failure(FaucetHttpFailure(code: "YNX_HTTP_CANCELLED"))) }
    }
  }

  private func requireActive() throws {
    guard enabled else { throw FaucetHttpFailure(code: "YNX_HTTP_UNAVAILABLE") }
    guard !destroyed, active else { throw FaucetHttpFailure(code: "YNX_HTTP_CANCELLED") }
  }
  private func deliver(_ taskId: String, _ ticket: Pending, _ result: Result<FaucetHttpReply, FaucetHttpFailure>) {
    withGate {
      guard pending[taskId] === ticket else { return }
      pending.removeValue(forKey: taskId)
      guard !destroyed, active else { ticket.completion(.failure(FaucetHttpFailure(code: "YNX_HTTP_CANCELLED"))); return }
      ticket.completion(result)
    }
  }
  private func withGate<T>(_ body: () throws -> T) rethrows -> T {
    if DispatchQueue.getSpecific(key: gateKey) != nil { return try body() }
    return try gate.sync(execute: body)
  }

  #if YNX_FAUCET_BRIDGE_TESTS
  /// Compile-time host harness only; not exported through Expo or any JS flag.
  static func testOnly(makeEngine: @escaping () throws -> BoundedFaucetHttpEngine) -> BoundedFaucetHttpBridge {
    BoundedFaucetHttpBridge(enabled: true, makeEngine: makeEngine)
  }
  func testSnapshot() -> (active: Bool, destroyed: Bool, pending: Int, engineCreations: Int, observers: Int) {
    withGate { (active, destroyed, pending.count, engineCreations, observers.count) }
  }
  #endif
}

#if canImport(ExpoModulesCore) && canImport(UIKit)
import ExpoModulesCore
import UIKit

public class YnxFaucetTransportModule: Module {
  private let bridge = BoundedFaucetHttpBridge.production()

  public func definition() -> ModuleDefinition {
    Name("YnxFaucetTransport")
    OnCreate {
      self.bridge.observeLifecycle(center: .default, names: .init(
        willEnterForeground: UIApplication.willEnterForegroundNotification,
        didBecomeActive: UIApplication.didBecomeActiveNotification,
        willResignActive: UIApplication.willResignActiveNotification,
        didEnterBackground: UIApplication.didEnterBackgroundNotification
      ), sampleInitialActivity: { sample in
        DispatchQueue.main.async { sample(UIApplication.shared.applicationState == .active) }
      })
    }
    Function("reserveTask") { (purpose: String) throws -> String in
      do { return try self.bridge.reserveTask(purpose) }
      catch { throw FaucetTransportException((error as? FaucetHttpFailure)?.code ?? "YNX_HTTP_UNAVAILABLE") }
    }
    AsyncFunction("request") { (input: [String: Any], promise: Promise) -> Void in
      self.bridge.request(input) { result in
        switch result {
        case .success(let reply): promise.resolve(reply.fields())
        case .failure(let failure): promise.reject(failure.code, "Faucet network operation could not be completed.")
        }
      }
    }
    Function("cancel") { (taskId: String) in self.bridge.cancel(taskId) }
    OnDestroy { self.bridge.close() }
    OnAppContextDestroys { self.bridge.close() }
  }
}

private final class FaucetTransportException: Exception, @unchecked Sendable {
  private let stableCode: String
  init(_ code: String) { stableCode = code; super.init() }
  override var code: String { stableCode }
  override var reason: String { "Faucet transport is not available for this operation." }
}
#endif
