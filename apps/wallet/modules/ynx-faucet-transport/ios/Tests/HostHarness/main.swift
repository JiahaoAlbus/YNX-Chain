import Foundation

struct HarnessFailure: Error { let reason: String }
func expect(_ value: @autoclosure () throws -> Bool, _ reason: String) throws {
  if try !value() { throw HarnessFailure(reason: reason) }
}
final class Mailbox {
  let condition = NSCondition()
  var values: [Result<FaucetHttpReply, FaucetHttpFailure>] = []
  func receive(_ result: Result<FaucetHttpReply, FaucetHttpFailure>) {
    condition.lock(); values.append(result); condition.broadcast(); condition.unlock()
  }
  func wait(_ count: Int = 1, seconds: Double = 4) throws -> [Result<FaucetHttpReply, FaucetHttpFailure>] {
    condition.lock(); defer { condition.unlock() }
    let until = Date().addingTimeInterval(seconds)
    while values.count < count { if !condition.wait(until: until) { throw HarnessFailure(reason: "callback timeout") } }
    return values
  }
  var count: Int { condition.lock(); defer { condition.unlock() }; return values.count }
}
let base = ProcessInfo.processInfo.environment["QA_LOOPBACK_BASE"]!
let output = ProcessInfo.processInfo.environment["QA_HOST_RESULT"]!
guard let baseURL = URL(string: base), baseURL.host == "127.0.0.1", baseURL.scheme == "http" else { fatalError("loopback required") }
let requestID = "0123456789abcdefghijklmnopqrstuv"
let body = "{\"requestId\":\"\(requestID)\",\"address\":\"ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80\",\"amount\":100}"
var results: [[String: Any]] = []
func engine(_ route: String, deadline: UInt64 = 15_000_000_000, now: @escaping () -> UInt64 = { DispatchTime.now().uptimeNanoseconds }) throws -> BoundedFaucetHttpEngine {
  let result = try BoundedFaucetHttpEngine(admitURL: URL(string: base + route)!, rpcURL: URL(string: base + route)!, now: now, deadlineNanoseconds: deadline)
  result.resume(); return result
}
func input(_ id: String) -> [String: Any] { ["purpose":"admit", "taskId":id, "requestId":requestID, "body":body] }
func perform(_ engine: BoundedFaucetHttpEngine, _ options: [String: Any]) throws -> Result<FaucetHttpReply, FaucetHttpFailure> {
  let mailbox = Mailbox(); engine.request(options, completion: mailbox.receive)
  return try mailbox.wait()[0]
}
func code(_ result: Result<FaucetHttpReply, FaucetHttpFailure>) -> String? { if case .failure(let error) = result { return error.code }; return nil }
func test(_ name: String, _ operation: () throws -> [String: Any]) {
  do { var value = try operation(); value["name"] = name; value["passed"] = true; results.append(value); print("PASS \(name)") }
  catch { results.append(["name":name,"passed":false,"error":String(describing:error)]); print("FAIL \(name): \(error)") }
}

test("one-use-stream-and-offset") {
  let supplier = FaucetOneUseUploadBody(Data(body.utf8)); let stream = supplier.take(offset: 0)!
  stream.open(); var buffer = [UInt8](repeating:0,count:1024); let n = stream.read(&buffer,maxLength:buffer.count)
  try expect(Data(buffer.prefix(n)) == Data(body.utf8), "exact original stream bytes")
  try expect(supplier.take(offset:0) == nil, "replacement stream must be nil")
  supplier.close(); try expect(supplier.take(offset:0) == nil, "close cannot reset")
  let offset = FaucetOneUseUploadBody(Data(body.utf8)); try expect(offset.take(offset:1) == nil, "resumed offset forbidden")
  try expect(offset.take(offset:0) == nil, "failed offset cannot reset")
  return ["exactBytes":n,"replacementNil":true,"nonzeroOffsetNil":true]
}

test("initially-paused-and-reservation-churn") {
  let e = try BoundedFaucetHttpEngine(admitURL:URL(string:base+"/must-not-arrive")!,rpcURL:URL(string:base+"/must-not-arrive")!)
  defer{e.close()}
  do {_ = try e.reserve(purpose:"admit");throw HarnessFailure(reason:"initial engine treated as foreground")}catch let error as FaucetHttpFailure {try expect(error.code == "YNX_HTTP_CANCELLED","initial pause")}
  e.resume();var prior=""
  for _ in 0..<5000 {let id=try e.reserve(purpose:"admit");try expect(id != prior,"ID reused");e.cancel(id);prior=id}
  let current=try e.reserve(purpose:"admit");e.cancel(current)
  return ["initiallyPaused":true,"reserveCancelIterations":5000,"networkExpected":0]
}

test("reservation-capacity-cancel-before-start") {
  let e = try engine("/must-not-arrive"); defer {e.close()}
  var ids:[String]=[];for _ in 0..<8 {ids.append(try e.reserve(purpose:"admit"))}
  do {_ = try e.reserve(purpose:"admit");throw HarnessFailure(reason:"ninth reservation accepted")}catch let error as FaucetHttpFailure {try expect(error.code == "YNX_HTTP_CAPACITY","capacity")}
  e.cancel(ids[0]); e.cancel(ids[0]); e.cancel("unknown")
  try expect(code(try perform(e,input(ids[0]))) == "YNX_HTTP_TASK_INVALID","cancel before request")
  e.cancelAll(); let fresh = try e.reserve(purpose:"admit");try expect(!ids.contains(fresh),"ID reused")
  e.pause(); do {_ = try e.reserve(purpose:"admit");throw HarnessFailure(reason:"paused accepted")}catch let error as FaucetHttpFailure {try expect(error.code == "YNX_HTTP_CANCELLED","pause")}
  e.resume(); let next = try e.reserve(purpose:"admit");e.cancel(next);e.close()
  do {_ = try e.reserve(purpose:"admit");throw HarnessFailure(reason:"closed accepted")}catch let error as FaucetHttpFailure {try expect(error.code == "YNX_HTTP_UNAVAILABLE","close")}
  return ["networkExpected":0,"capacity":8]
}

test("deadline-expired-reservation") {
  let e = try engine("/must-not-arrive",deadline:80_000_000);defer{e.close()}
  let id = try e.reserve(purpose:"admit");Thread.sleep(forTimeInterval:0.15)
  try expect(code(try perform(e,input(id))) == "YNX_HTTP_TASK_INVALID","expired reservation revived")
  return ["networkExpected":0]
}

test("invalid-exact-request-shapes") {
  let e=try engine("/must-not-arrive");defer{e.close()};var count=0
  let variants:[(inout [String:Any])->Void] = [
    {$0["extra"]="x"}, {$0["requestId"]="different"}, {$0["purpose"]="rpc"},
    {$0["body"]=" "+body}, {$0["body"]=body.replacingOccurrences(of:"100}",with:"9007199254740992}")},
    {$0["body"]=body.replacingOccurrences(of:"100}",with:"1e2}")},
    {$0["body"]=body.replacingOccurrences(of:"100}",with:"100,\"amount\":100}")},
    {$0["body"]=body.replacingOccurrences(of:"100}",with:"0}")},
    {$0["body"]=body.replacingOccurrences(of:requestID,with:"\\u0030"+String(requestID.dropFirst()))}
  ]
  for change in variants {let id=try e.reserve(purpose:"admit");var x=input(id);change(&x);try expect(code(try perform(e,x)) == "YNX_HTTP_INVALID_INPUT","bad admission accepted");count+=1}
  for method in ["eth_sendRawTransaction","eth_accounts"] {let id=try e.reserve(purpose:"rpc");try expect(code(try perform(e,["purpose":"rpc","taskId":id,"rpcId":"x","method":method,"params":[]])) == "YNX_HTTP_INVALID_INPUT","bad RPC accepted");count+=1}
  return ["rejected":count,"networkExpected":0]
}

test("actual-streamed-upload-exact-body") {
  let e=try engine("/ok");defer{e.close()};let id=try e.reserve(purpose:"admit")
  let reply=try perform(e,input(id)).get();try expect(reply.status==201 && reply.body=="{\"ok\":true}","bad reply")
  try expect(reply.url==base+"/ok" && reply.fields().count==6,"exact result fields")
  try expect(code(try perform(e,input(id))) == "YNX_HTTP_TASK_INVALID","used id repeated")
  return ["status":reply.status,"bodyBytes":reply.body.utf8.count]
}
for status in [409,429,503] {
  test("actual-http-status-\(status)") {let e=try engine("/status/\(status)");defer{e.close()};let id=try e.reserve(purpose:"admit");let reply=try perform(e,input(id)).get();try expect(reply.status==status,"status normalized");return ["status":reply.status]}
}
for status in [301,302,303,307,308] {
  test("no-follow-\(status)") {let e=try engine("/redirect/\(status)");defer{e.close()};let id=try e.reserve(purpose:"admit");let c=code(try perform(e,input(id)));try expect(c=="YNX_HTTP_REDIRECT","redirect followed or wrong result");return ["code":c!]}
}
for (route,expected) in [("/oversized-length","YNX_HTTP_RESPONSE_TOO_LARGE"),("/oversized-chunked","YNX_HTTP_RESPONSE_TOO_LARGE"),("/invalid-utf8","YNX_HTTP_ENCODING"),("/gzip","YNX_HTTP_ENCODING"),("/wrong-content-type","YNX_HTTP_METADATA"),("/missing-no-store","YNX_HTTP_METADATA"),("/duplicate-content-type","YNX_HTTP_METADATA"),("/large-header","YNX_HTTP_METADATA"),("/partial","YNX_HTTP_NETWORK")] {
  test(route) {let e=try engine(route);defer{e.close()};let id=try e.reserve(purpose:"admit");let c=code(try perform(e,input(id)));try expect(c==expected,"wrong failure \(String(describing:c))");return ["code":c!]}
}

test("exact-16KiB-chunked") {let e=try engine("/exact-cap");defer{e.close()};let id=try e.reserve(purpose:"admit");let r=try perform(e,input(id)).get();try expect(r.body.utf8.count==16384,"wrong cumulative byte cap");return ["bytes":r.body.utf8.count]}
test("unknown-transfer-encoding") {let e=try engine("/unknown-transfer-encoding");defer{e.close()};let id=try e.reserve(purpose:"admit");let c=code(try perform(e,input(id)));try expect(c=="YNX_HTTP_METADATA" || c=="YNX_HTTP_NETWORK","unknown transfer coding accepted");return ["code":c!]}
test("identity-transfer-representation") {let e=try engine("/identity-transfer-encoding");defer{e.close()};let id=try e.reserve(purpose:"admit");let r=try perform(e,input(id)).get();try expect(r.body=="{\"ok\":true}","identity representation failed");return ["status":r.status,"rawChunkedAndIdentityIndistinguishableInFoundation":true]}
test("conflicting-content-length-and-transfer-encoding") {let e=try engine("/conflicting-framing");defer{e.close()};let id=try e.reserve(purpose:"admit");let c=code(try perform(e,input(id)));try expect(c=="YNX_HTTP_METADATA" || c=="YNX_HTTP_NETWORK","ambiguous framing accepted");return ["code":c!]}
test("unicode-valid-response") {let e=try engine("/unicode");defer{e.close()};let id=try e.reserve(purpose:"admit");let r=try perform(e,input(id)).get();try expect(r.body=="{\"message\":\"测试钱包\"}","unicode corrupt");return ["bytes":r.body.utf8.count]}
test("no-cookie-reuse") {let e=try engine("/cookie");defer{e.close()};for _ in 0..<2 {let id=try e.reserve(purpose:"admit");_ = try perform(e,input(id)).get()};return ["requests":2]}
test("no-http-auth-retry") {let e=try engine("/auth");defer{e.close()};let id=try e.reserve(purpose:"admit");let c=code(try perform(e,input(id)));try expect(c=="YNX_HTTP_NETWORK","credential challenge accepted");return ["code":c!]}
test("connection-close-no-body-replay") {let e=try engine("/drop");defer{e.close()};let id=try e.reserve(purpose:"admit");let c=code(try perform(e,input(id)));try expect(c=="YNX_HTTP_NETWORK","dropped response accepted");return ["code":c!]}
test("retry-after-zero-no-replacement-body") {
 let e=try engine("/retry-after");defer{e.close()};let id=try e.reserve(purpose:"admit")
 switch try perform(e,input(id)) {
 case .success(let reply):try expect(reply.status==503,"retry-after status changed");return ["status":reply.status]
 case .failure(let error):try expect(error.code=="YNX_HTTP_NETWORK","unexpected retry-after error");return ["code":error.code,"replacementRefused":true]
 }
}
test("cancel-live-task-no-late-success") {
 let e=try engine("/slow");defer{e.close()};let id=try e.reserve(purpose:"admit");let box=Mailbox();e.request(input(id),completion:box.receive)
 Thread.sleep(forTimeInterval:0.1);e.cancel(id);try expect(code(try box.wait()[0])=="YNX_HTTP_CANCELLED","cancel lost")
 Thread.sleep(forTimeInterval:0.65);try expect(box.count==1,"late completion escaped");return ["callbacks":box.count,"postMayAlreadyBeObserved":true]
}
test("deadline-live-task-no-late-success") {
 let e=try engine("/drip",deadline:180_000_000);defer{e.close()};let id=try e.reserve(purpose:"admit");let box=Mailbox();e.request(input(id),completion:box.receive)
 try expect(code(try box.wait()[0])=="YNX_HTTP_TIMEOUT","deadline lost");Thread.sleep(forTimeInterval:0.3);try expect(box.count==1,"late deadline callback");return ["callbacks":box.count]
}
test("concurrent-duplicate-task-one-start") {
 let e=try engine("/concurrent");defer{e.close()};let id=try e.reserve(purpose:"admit");let box=Mailbox()
 DispatchQueue.concurrentPerform(iterations:20){_ in e.request(input(id),completion:box.receive)}
 let replies=try box.wait(20);try expect(replies.filter{code($0)==nil}.count==1,"duplicate successes")
 try expect(replies.filter{code($0)=="YNX_HTTP_TASK_INVALID"}.count==19,"duplicate replay not rejected")
 return ["callbacks":replies.count,"successes":1,"taskInvalid":19]
}
test("all-five-rpc-methods") {
 let e=try engine("/rpc");defer{e.close()}
 for method in ["eth_chainId","ynx_getFaucetModel","ynx_getDurabilityModel","ynx_getTransactionDurability","eth_getTransactionReceipt"] {
  let id=try e.reserve(purpose:"rpc"), params=method=="ynx_getTransactionDurability"||method=="eth_getTransactionReceipt" ? ["0x"+String(repeating:"a",count:64)] : []
  let r=try perform(e,["purpose":"rpc","taskId":id,"rpcId":"correlation_1","method":method,"params":params]).get();try expect(r.status==200,"RPC failed")
 }
 return ["methods":5]
}
let passed=results.allSatisfy{$0["passed"] as? Bool == true}
let report:[String:Any] = ["passed":passed,"cases":results.count,"tests":results,"macOSFoundationOnly":true,"iosSDKCompiled":false,"iosNativeAcceptanceVerified":false,"productionEnabled":false,"publicEndpointUsed":false,"wireExactlyOnceClaimed":false]
try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:output))
exit(passed ? 0 : 1)
