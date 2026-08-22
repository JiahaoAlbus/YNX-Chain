import Foundation
import XCTest
@testable import YNXWalletMacCore

final class WalletConnectV2StateStoreTests: XCTestCase {
  private let topic = String(repeating: "a", count: 64)
  private let digest = "0x" + String(repeating: "b", count: 64)
  private let account = "0x1111111111111111111111111111111111111111"
  private let now = Date(timeIntervalSince1970: 2_000_000_000)

  func testPendingProposalSurvivesRestartAndApprovesOnlyExplicitAccount() throws {
    let file = temporaryFile()
    let request = proposal(id: "proposal-1", dappClass: .external)
    let first = try WalletConnectV2StateStore(fileURL: file)
    try first.enqueue(request, now: now)

    let restarted = try WalletConnectV2StateStore(fileURL: file)
    XCTAssertEqual(try restarted.restoredPending(now: now), [request])
    let approval = try WalletConnectV2Policy.approve(
      requiredChains: [WalletConnectV2Policy.chain],
      requiredMethods: ["eth_requestAccounts", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"],
      requiredEvents: ["accountsChanged", "disconnect"],
      approvedAccount: account
    )
    let callback = try restarted.approveProposal(requestID: request.id, approval: approval, now: now)
    XCTAssertEqual(callback.result, .success("eip155:6423:\(account)"))
    XCTAssertEqual(try WalletConnectV2StateStore(fileURL: file).restoredSessions().first?.approvedAccount, account)
  }

  func testFirstPartyAndExternalRequestsUseSameApprovedAccountBoundary() throws {
    for dappClass in [WalletConnectV2DAppClass.firstParty, .external] {
      let file = temporaryFile()
      let store = try approvedStore(file: file, dappClass: dappClass)
      let request = sessionRequest(id: "accounts-\(dappClass.rawValue)", method: "eth_requestAccounts", dappClass: dappClass)
      try store.enqueue(request, now: now)
      XCTAssertThrowsError(
        try store.resolveRequest(
          requestID: request.id,
          executionResult: "[\"0x2222222222222222222222222222222222222222\"]",
          now: now
        )
      ) {
        XCTAssertEqual($0 as? WalletConnectV2StateError, .invalidExecutionResult)
      }
      XCTAssertEqual(
        try store.resolveRequest(
          requestID: request.id,
          executionResult: "[\"\(account)\"]",
          now: now
        ).result,
        .success("[\"\(account)\"]")
      )
    }
  }

  func testApprovedTopicRejectsDAppClassAndNameSubstitution() throws {
    let file = temporaryFile()
    let store = try approvedStore(file: file, dappClass: .external)
    let substitutedClass = WalletConnectV2PendingRequest(
      id: "class-substitution", topic: topic, kind: .sessionRequest,
      dappClass: .firstParty, dappName: "YNX First Party", method: "personal_sign",
      paramsDigest: digest, receivedAt: now.addingTimeInterval(-1),
      expiresAt: now.addingTimeInterval(300)
    )
    XCTAssertThrowsError(try store.enqueue(substitutedClass, now: now)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .invalidRequest)
    }
    let substitutedName = WalletConnectV2PendingRequest(
      id: "name-substitution", topic: topic, kind: .sessionRequest,
      dappClass: .external, dappName: "Different External DApp", method: "personal_sign",
      paramsDigest: digest, receivedAt: now.addingTimeInterval(-1),
      expiresAt: now.addingTimeInterval(300)
    )
    XCTAssertThrowsError(try store.enqueue(substitutedName, now: now)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .invalidRequest)
    }
    XCTAssertTrue(try WalletConnectV2StateStore(fileURL: file).restoredPending(now: now).isEmpty)
  }

  func testExistingSessionRejectsProposalIdentityReplacementOnSameTopic() throws {
    let file = temporaryFile()
    let store = try approvedStore(file: file, dappClass: .external)
    let replacementClass = proposal(id: "replacement-class", dappClass: .firstParty)
    XCTAssertThrowsError(try store.enqueue(replacementClass, now: now)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .invalidRequest)
    }
    let replacementName = WalletConnectV2PendingRequest(
      id: "replacement-name", topic: topic, kind: .sessionProposal,
      dappClass: .external, dappName: "Different External DApp",
      method: "wc_sessionPropose", paramsDigest: digest,
      receivedAt: now.addingTimeInterval(-1), expiresAt: now.addingTimeInterval(300)
    )
    XCTAssertThrowsError(try store.enqueue(replacementName, now: now)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .invalidRequest)
    }
    XCTAssertEqual(try WalletConnectV2StateStore(fileURL: file).restoredSessions().first?.dappName, "External DApp")
  }

  func testConcurrentAndPersistedSameTopicProposalsFailClosed() throws {
    let file = temporaryFile()
    let store = try WalletConnectV2StateStore(fileURL: file)
    try store.enqueue(proposal(id: "proposal-one", dappClass: .external), now: now)
    XCTAssertThrowsError(
      try store.enqueue(proposal(id: "proposal-two", dappClass: .external), now: now)
    ) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .duplicateRequest)
    }

    var root = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
    )
    var pending = try XCTUnwrap(root["pending"] as? [[String: Any]])
    var duplicateTopic = try XCTUnwrap(pending.first)
    duplicateTopic["id"] = "persisted-second-proposal"
    pending.append(duplicateTopic)
    root["pending"] = pending
    try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
      .write(to: file, options: .atomic)
    XCTAssertThrowsError(try WalletConnectV2StateStore(fileURL: file)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .corruptPersistence)
    }
  }

  func testAmbiguousDAppDisplayNamesFailClosedAtRuntimeAndRestart() throws {
    let file = temporaryFile()
    let store = try WalletConnectV2StateStore(fileURL: file)
    for (id, name) in [("leading-space", " External DApp"), ("control", "External\nDApp")] {
      let ambiguous = WalletConnectV2PendingRequest(
        id: id, topic: topic, kind: .sessionProposal, dappClass: .external,
        dappName: name, method: "wc_sessionPropose", paramsDigest: digest,
        receivedAt: now.addingTimeInterval(-1), expiresAt: now.addingTimeInterval(300)
      )
      XCTAssertThrowsError(try store.enqueue(ambiguous, now: now)) {
        XCTAssertEqual($0 as? WalletConnectV2StateError, .invalidRequest)
      }
    }

    try store.enqueue(proposal(id: "persisted-name", dappClass: .external), now: now)
    var root = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
    )
    var pending = try XCTUnwrap(root["pending"] as? [[String: Any]])
    pending[0]["dappName"] = "External DApp\nApprove"
    root["pending"] = pending
    try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
      .write(to: file, options: .atomic)
    XCTAssertThrowsError(try WalletConnectV2StateStore(fileURL: file)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .corruptPersistence)
    }
  }

  func testNonCanonicalTopicCaseFailsClosedAtRuntimeAndRestart() throws {
    let file = temporaryFile()
    let store = try WalletConnectV2StateStore(fileURL: file)
    let uppercaseTopic = String(repeating: "A", count: 64)
    let nonCanonical = WalletConnectV2PendingRequest(
      id: "uppercase-topic", topic: uppercaseTopic, kind: .sessionProposal,
      dappClass: .external, dappName: "External DApp", method: "wc_sessionPropose",
      paramsDigest: digest, receivedAt: now.addingTimeInterval(-1),
      expiresAt: now.addingTimeInterval(300)
    )
    XCTAssertThrowsError(try store.enqueue(nonCanonical, now: now)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .invalidRequest)
    }

    try store.enqueue(proposal(id: "persisted-topic", dappClass: .external), now: now)
    var root = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
    )
    var pending = try XCTUnwrap(root["pending"] as? [[String: Any]])
    pending[0]["topic"] = uppercaseTopic
    root["pending"] = pending
    try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
      .write(to: file, options: .atomic)
    XCTAssertThrowsError(try WalletConnectV2StateStore(fileURL: file)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .corruptPersistence)
    }
  }

  func testNonCanonicalDigestAndPersistedAccountCaseFailClosed() throws {
    let file = temporaryFile()
    let store = try WalletConnectV2StateStore(fileURL: file)
    let uppercaseDigest = WalletConnectV2PendingRequest(
      id: "uppercase-digest", topic: topic, kind: .sessionProposal,
      dappClass: .external, dappName: "External DApp", method: "wc_sessionPropose",
      paramsDigest: "0x" + String(repeating: "B", count: 64),
      receivedAt: now.addingTimeInterval(-1), expiresAt: now.addingTimeInterval(300)
    )
    XCTAssertThrowsError(try store.enqueue(uppercaseDigest, now: now)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .invalidRequest)
    }

    _ = try approvedStore(file: file, dappClass: .external)
    var root = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
    )
    var sessions = try XCTUnwrap(root["sessions"] as? [[String: Any]])
    sessions[0]["approvedAccount"] = "0x" + String(repeating: "A", count: 40)
    root["sessions"] = sessions
    try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
      .write(to: file, options: .atomic)
    XCTAssertThrowsError(try WalletConnectV2StateStore(fileURL: file)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .corruptPersistence)
    }
  }

  func testPersistedUnsupportedMethodFailsClosedAsCorrupt() throws {
    let file = temporaryFile()
    _ = try approvedStore(file: file, dappClass: .external)
    var root = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
    )
    var sessions = try XCTUnwrap(root["sessions"] as? [[String: Any]])
    sessions[0]["methods"] = ["eth_sign"]
    root["sessions"] = sessions
    try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
      .write(to: file, options: .atomic)
    XCTAssertThrowsError(try WalletConnectV2StateStore(fileURL: file)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .corruptPersistence)
    }
  }

  func testSignTypedDataSendTransactionAndRejectRequireTruthfulResults() throws {
    let file = temporaryFile()
    let store = try approvedStore(file: file, dappClass: .external)
    let cases = [
      ("sign", "personal_sign", "0x" + String(repeating: "1", count: 130)),
      ("typed", "eth_signTypedData_v4", "0x" + String(repeating: "2", count: 130)),
      ("send", "eth_sendTransaction", "0x" + String(repeating: "3", count: 64)),
    ]
    for (id, method, result) in cases {
      try store.enqueue(sessionRequest(id: id, method: method, dappClass: .external), now: now)
      XCTAssertThrowsError(try store.resolveRequest(requestID: id, executionResult: "0xfake", now: now))
      XCTAssertEqual(try store.resolveRequest(requestID: id, executionResult: result, now: now).result, .success(result))
    }
    let rejected = sessionRequest(id: "reject", method: "personal_sign", dappClass: .external)
    try store.enqueue(rejected, now: now)
    XCTAssertEqual(
      try store.reject(requestID: rejected.id, now: now).result,
      .rejected(code: 4001, message: "User rejected the request")
    )
  }

  func testDisconnectAndRevokeRemoveSessionAndPendingAcrossRestart() throws {
    let file = temporaryFile()
    let store = try approvedStore(file: file, dappClass: .firstParty)
    try store.enqueue(sessionRequest(id: "pending", method: "personal_sign", dappClass: .firstParty), now: now)
    XCTAssertTrue(try store.disconnect(topic: topic))
    let restarted = try WalletConnectV2StateStore(fileURL: file)
    XCTAssertTrue(restarted.restoredSessions().isEmpty)
    XCTAssertTrue(try restarted.restoredPending(now: now).isEmpty)
    XCTAssertFalse(try restarted.revoke(topic: topic))
  }

  func testExpiredDuplicateUnsupportedAndCorruptStateFailClosed() throws {
    let file = temporaryFile()
    let store = try WalletConnectV2StateStore(fileURL: file)
    let request = proposal(id: "proposal-1", dappClass: .external)
    try store.enqueue(request, now: now)
    XCTAssertThrowsError(try store.enqueue(request, now: now)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .duplicateRequest)
    }
    XCTAssertThrowsError(
      try store.enqueue(
        WalletConnectV2PendingRequest(
          id: "expired", topic: topic, kind: .sessionProposal, dappClass: .external,
          dappName: "External DApp", method: "wc_sessionPropose", paramsDigest: digest,
          receivedAt: now.addingTimeInterval(-10), expiresAt: now
        ),
        now: now
      )
    ) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .expiredRequest)
    }
    try Data("not-json".utf8).write(to: file, options: .atomic)
    XCTAssertThrowsError(try WalletConnectV2StateStore(fileURL: file)) {
      XCTAssertEqual($0 as? WalletConnectV2StateError, .corruptPersistence)
    }
  }

  private func approvedStore(file: URL, dappClass: WalletConnectV2DAppClass) throws -> WalletConnectV2StateStore {
    let store = try WalletConnectV2StateStore(fileURL: file)
    let pending = proposal(id: "proposal", dappClass: dappClass)
    try store.enqueue(pending, now: now)
    let approval = try WalletConnectV2Policy.approve(
      requiredChains: [WalletConnectV2Policy.chain],
      requiredMethods: ["eth_requestAccounts", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"],
      requiredEvents: ["accountsChanged", "disconnect"],
      approvedAccount: account
    )
    _ = try store.approveProposal(requestID: pending.id, approval: approval, now: now)
    return store
  }

  private func proposal(id: String, dappClass: WalletConnectV2DAppClass) -> WalletConnectV2PendingRequest {
    WalletConnectV2PendingRequest(
      id: id, topic: topic, kind: .sessionProposal, dappClass: dappClass,
      dappName: dappClass == .firstParty ? "YNX First Party" : "External DApp",
      method: "wc_sessionPropose", paramsDigest: digest,
      receivedAt: now.addingTimeInterval(-1), expiresAt: now.addingTimeInterval(300)
    )
  }

  private func sessionRequest(
    id: String,
    method: String,
    dappClass: WalletConnectV2DAppClass
  ) -> WalletConnectV2PendingRequest {
    WalletConnectV2PendingRequest(
      id: id, topic: topic, kind: .sessionRequest, dappClass: dappClass,
      dappName: dappClass == .firstParty ? "YNX First Party" : "External DApp",
      method: method, paramsDigest: digest,
      receivedAt: now.addingTimeInterval(-1), expiresAt: now.addingTimeInterval(300)
    )
  }

  private func temporaryFile() -> URL {
    FileManager.default.temporaryDirectory
      .appendingPathComponent("ynx-walletconnect-state-\(UUID().uuidString)")
      .appendingPathComponent("state.json")
  }
}
