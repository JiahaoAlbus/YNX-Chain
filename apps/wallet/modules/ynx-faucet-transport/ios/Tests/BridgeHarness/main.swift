import Foundation

final class Outcome: @unchecked Sendable {
  private let lock = NSLock()
  private let arrived = DispatchSemaphore(value: 0)
  private var results: [Result<FaucetHttpReply, FaucetHttpFailure>] = []
  func receive(_ result: Result<FaucetHttpReply, FaucetHttpFailure>) { lock.lock(); results.append(result); lock.unlock(); arrived.signal() }
  func wait() throws -> Result<FaucetHttpReply, FaucetHttpFailure> {
    guard arrived.wait(timeout: .now() + 4) == .success else { throw TestFailure("callback timeout") }
    lock.lock(); defer { lock.unlock() }; return results.last!
  }
  var count: Int { lock.lock(); defer { lock.unlock() }; return results.count }
}
struct TestFailure: Error { let text: String; init(_ text: String) { self.text = text } }
func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws { if try !condition() { throw TestFailure(message) } }
func code(_ result: Result<FaucetHttpReply, FaucetHttpFailure>) -> String { if case .failure(let failure) = result { return failure.code }; return "SUCCESS" }
func rejected(_ expected: String, _ body: () throws -> String) throws {
  do { _ = try body(); throw TestFailure("expected " + expected) }
  catch let error as FaucetHttpFailure { try expect(error.code == expected, "wrong error " + error.code) }
}
let environment = ProcessInfo.processInfo.environment
let base = environment["QA_LOOPBACK_BASE"]!
let observedFile = environment["QA_WIRE_OBSERVED"]!
let names = BoundedFaucetHttpBridge.LifecycleNames(willEnterForeground: .init("qa.enter"), didBecomeActive: .init("qa.active"), willResignActive: .init("qa.resign"), didEnterBackground: .init("qa.background"))
let body = "{\"requestId\":\"0123456789abcdefghijklmnopqrstuv\",\"address\":\"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80\",\"amount\":100}"
func input(_ task: String) -> [String: Any] { ["purpose": "admit", "taskId": task, "requestId": "0123456789abcdefghijklmnopqrstuv", "body": body] }
func bridge(_ route: String = "/ok", deadline: UInt64 = 15_000_000_000) -> BoundedFaucetHttpBridge {
  .testOnly(makeEngine: { try BoundedFaucetHttpEngine(admitURL: URL(string: base + route)!, rpcURL: URL(string: base + "/rpc")!, deadlineNanoseconds: deadline) })
}
func wireCount(_ route: String) -> Int {
  guard let data = try? Data(contentsOf: URL(fileURLWithPath: observedFile)), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Int] else { return 0 }
  return value[route] ?? 0
}
func waitForWire(_ route: String, _ count: Int) throws {
  let end = Date().addingTimeInterval(3)
  while Date() < end { if wireCount(route) >= count { return }; Thread.sleep(forTimeInterval: 0.005) }
  throw TestFailure("wire observation timeout: " + route)
}
func request(_ owner: BoundedFaucetHttpBridge, _ request: [String: Any]) throws -> (Result<FaucetHttpReply, FaucetHttpFailure>, Outcome) {
  let result = Outcome(); owner.request(request, completion: result.receive); return (try result.wait(), result)
}
var records: [[String: Any]] = []
@MainActor func test(_ name: String, _ body: () throws -> [String: Any]) {
  do { var fields = try body(); fields["name"] = name; fields["passed"] = true; records.append(fields) }
  catch { records.append(["name": name, "passed": false, "error": String(describing: error)]) }
}

test("immutable production off through real bridge lifecycle") {
  let b = BoundedFaucetHttpBridge.production(), center = NotificationCenter(); defer { b.close() }
  b.observeLifecycle(center: center, names: names, sampleInitialActivity: { sample in sample(true) })
  for _ in 0..<100 {
    for name in [names.willResignActive, names.willEnterForeground, names.didBecomeActive, names.didEnterBackground, names.didBecomeActive] { center.post(name: name, object: nil) }
    try rejected("YNX_HTTP_UNAVAILABLE") { try b.reserveTask("admit") }
    let (result, box) = try request(b, input("never-reserved")); try expect(code(result) == "YNX_HTTP_UNAVAILABLE", "off request enabled"); try expect(box.count == 1, "off completed twice")
    b.cancel("never-reserved")
  }
  try expect(b.testSnapshot().engineCreations == 0 && b.testSnapshot().pending == 0, "disabled created resources")
  b.close(); try expect(b.testSnapshot().observers == 0, "close leaked observers")
  return ["attempts": 100, "engineCreations": 0, "pending": 0, "publicEnabled": false]
}
test("default paused and lazy initial active sampling") {
  let b = bridge(), center = NotificationCenter(); defer { b.close() }
  try rejected("YNX_HTTP_CANCELLED") { try b.reserveTask("admit") }
  var sample: (@Sendable (Bool) -> Void)?
  b.observeLifecycle(center: center, names: names, sampleInitialActivity: { sample = $0 })
  try expect(b.testSnapshot().observers == 4 && !b.testSnapshot().active, "not initially paused")
  sample?(true); let id = try b.reserveTask("admit"); b.cancel(id)
  try expect(b.testSnapshot().engineCreations == 1, "lazy active failed")
  return ["observers": 4, "createdAfterActualSample": 1]
}
test("late initial sample cannot overwrite resign or destroy") {
  let b = bridge(), center = NotificationCenter()
  var sample: (@Sendable (Bool) -> Void)?
  b.observeLifecycle(center: center, names: names, sampleInitialActivity: { sample = $0 })
  center.post(name: names.willResignActive, object: nil); sample?(true)
  try expect(!b.testSnapshot().active, "late sample resurrected resign")
  center.post(name: names.willEnterForeground, object: nil)
  try rejected("YNX_HTTP_CANCELLED") { try b.reserveTask("admit") }
  center.post(name: names.didBecomeActive, object: nil)
  let id = try b.reserveTask("rpc"); b.cancel(id)
  b.close(); sample?(true); center.post(name: names.didBecomeActive, object: nil)
  try rejected("YNX_HTTP_CANCELLED") { try b.reserveTask("rpc") }
  try expect(b.testSnapshot().destroyed && !b.testSnapshot().active && b.testSnapshot().observers == 0, "destroy resurrected")
  return ["resignSampleDiscarded": true, "destroySampleDiscarded": true]
}
test("inactive initial sample and foreground alone never resume") {
  let b = bridge(), center = NotificationCenter(); defer { b.close() }
  b.observeLifecycle(center: center, names: names, sampleInitialActivity: { $0(false) })
  center.post(name: names.willEnterForeground, object: nil)
  try rejected("YNX_HTTP_CANCELLED") { try b.reserveTask("admit") }
  try expect(b.testSnapshot().engineCreations == 0, "inactive created engine")
  return ["engineCreations": 0]
}
test("request does not implicitly reserve or construct engine") {
  let b = bridge(); b.becomeActive(); defer { b.close() }
  let (result, _) = try request(b, input("unknown-task"))
  try expect(code(result) == "YNX_HTTP_TASK_INVALID" && b.testSnapshot().engineCreations == 0, "implicit engine")
  return ["engineCreations": 0, "code": code(result)]
}
test("reserve capacity single engine cancel before request") {
  let b = bridge(); b.becomeActive(); defer { b.close() }
  var ids: [String] = []; for _ in 0..<8 { ids.append(try b.reserveTask("admit")) }
  try expect(Set(ids).count == 8, "reservation collision")
  try rejected("YNX_HTTP_CAPACITY") { try b.reserveTask("admit") }
  for id in ids { b.cancel(id); let (result, _) = try request(b, input(id)); try expect(code(result) == "YNX_HTTP_TASK_INVALID", "cancelled id recreated") }
  let id = try b.reserveTask("admit"); b.suspend(); b.becomeActive()
  let (result, _) = try request(b, input(id)); try expect(code(result) == "YNX_HTTP_TASK_INVALID", "resumed old reservation")
  try expect(b.testSnapshot().pending == 0 && b.testSnapshot().engineCreations == 1, "capacity leak")
  return ["capacity": 8, "engineCreations": 1, "networkExpected": 0]
}
test("bridge exact request keys forwarded to actual engine parser") {
  let b = bridge(); b.becomeActive(); defer { b.close() }
  let changes: [(inout [String: Any]) -> Void] = [
    { $0["url"] = "http://127.0.0.1/forbidden" }, { $0["headers"] = [:] }, { $0["purpose"] = "rpc" },
    { $0["body"] = body + " " }, { $0["body"] = body.replacingOccurrences(of: "100}", with: "1.0}") },
    { $0["requestId"] = "mismatch" }, { $0.removeValue(forKey: "body") }
  ]
  for change in changes { let id = try b.reserveTask("admit"); var value = input(id); change(&value); let (result, box) = try request(b, value); try expect(code(result) == "YNX_HTTP_INVALID_INPUT", "invalid shape accepted"); try expect(box.count == 1, "invalid completion repeated") }
  try expect(b.testSnapshot().pending == 0, "invalid shape ticket leaked")
  return ["invalidShapes": changes.count, "networkExpected": 0]
}
test("actual bridge streamed POST and exact six response fields") {
  let b = bridge(); b.becomeActive(); defer { b.close() }
  let id = try b.reserveTask("admit"), (result, box) = try request(b, input(id))
  let reply = try result.get(), fields = reply.fields()
  try expect(Set(fields.keys) == Set(["url", "redirected", "status", "contentType", "cacheControl", "body"]), "wrong response fields")
  try expect(reply.status == 201 && reply.body == "{\"ok\":true}", "wrong wire response")
  b.cancel(id); let (duplicate, _) = try request(b, input(id)); try expect(code(duplicate) == "YNX_HTTP_TASK_INVALID", "completed id reused")
  try expect(box.count == 1 && b.testSnapshot().pending == 0, "completion not singular")
  return ["status": reply.status, "responseFields": fields.keys.sorted(), "completionCount": box.count]
}
test("actual bridge RPC envelope") {
  let b = bridge(); b.becomeActive(); defer { b.close() }
  let id = try b.reserveTask("rpc")
  let (result, _) = try request(b, ["purpose": "rpc", "taskId": id, "rpcId": id, "method": "eth_chainId", "params": [String]()])
  let reply = try result.get(); let parsed = try JSONSerialization.jsonObject(with: Data(reply.body.utf8)) as! [String: Any]
  try expect(parsed["id"] as? String == id && parsed["result"] as? String == "0x1917", "RPC envelope not exact")
  return ["method": "eth_chainId", "status": reply.status]
}
for (name, notification) in [("resign", names.willResignActive), ("foreground", names.willEnterForeground), ("background", names.didEnterBackground)] {
  test("native notification cancels observed POST: " + name) {
    let route = "/slow-" + name, b = bridge(route), center = NotificationCenter(); defer { b.close() }
    b.observeLifecycle(center: center, names: names, sampleInitialActivity: { $0(true) })
    let id = try b.reserveTask("admit"), box = Outcome(); b.request(input(id), completion: box.receive)
    try waitForWire(route, 1); center.post(name: notification, object: nil)
    try expect(code(try box.wait()) == "YNX_HTTP_CANCELLED", "notification did not cancel")
    try expect(!b.testSnapshot().active && b.testSnapshot().pending == 0, "notification not synchronous")
    center.post(name: names.didBecomeActive, object: nil); Thread.sleep(forTimeInterval: 0.65)
    try expect(box.count == 1, "late response delivered after new active")
    return ["wireMayHaveBeenProcessed": true, "completionCount": box.count, "pending": b.testSnapshot().pending]
  }
}
test("close cancels observed POST and closes lifecycle observers") {
  let route = "/slow-close", b = bridge(route), center = NotificationCenter()
  b.observeLifecycle(center: center, names: names, sampleInitialActivity: { $0(true) })
  let id = try b.reserveTask("admit"), box = Outcome(); b.request(input(id), completion: box.receive)
  try waitForWire(route, 1); b.close(); try expect(code(try box.wait()) == "YNX_HTTP_CANCELLED", "close did not cancel")
  Thread.sleep(forTimeInterval: 0.65); try expect(box.count == 1 && b.testSnapshot().pending == 0 && b.testSnapshot().observers == 0, "close retained state")
  return ["completionCount": box.count, "observers": 0, "pending": 0]
}
test("native deadline retires bridge pending ticket") {
  let b = bridge("/slow-deadline", deadline: 250_000_000); b.becomeActive(); defer { b.close() }
  let id = try b.reserveTask("admit"), (result, box) = try request(b, input(id))
  try expect(code(result) == "YNX_HTTP_TIMEOUT" && b.testSnapshot().pending == 0, "timeout ticket leaked")
  Thread.sleep(forTimeInterval: 0.65); try expect(box.count == 1, "late timeout response")
  return ["code": code(result), "completionCount": box.count, "pending": 0]
}
let passed = records.allSatisfy { $0["passed"] as? Bool == true }
let result: [String: Any] = ["passed": passed, "cases": records.count, "tests": records, "actualFoundationBridgeCore": true,
 "realURLSessionEngine": true, "productionEnabled": false, "macOSFoundationOnly": true, "iosSDKCompiled": false,
 "expoUIKitAdapterCompiled": false, "iosNativeAcceptanceVerified": false, "publicEndpointUsed": false]
let output = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
try output.write(to: URL(fileURLWithPath: environment["QA_BRIDGE_RESULT"]!))
print(String(data: output, encoding: .utf8)!)
if !passed { exit(1) }
