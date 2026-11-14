#if YNX_PRIVACY_ACCEPTANCE
import Foundation
@main struct SnowflakeRejectionReasonDeltaProbe {
 static func require(_ ok: Bool, _ label: String) throws {
  if !ok { throw NSError(domain:"P05RejectionReasonDelta",code:1,userInfo:[NSLocalizedDescriptionKey:label]) }
 }
 static func main() throws {
  guard CommandLine.arguments.count == 2 else { throw NSError(domain:"P05RejectionReasonDelta",code:64) }
  let bytes = try Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1]))
  try require(bytes.count <= 65536,"bounded actual producer capture")
  var checks = 0
  for chunk in [1,7,4096] {
   var recorder = SnowflakeSafePhaseRecorder(began:0);var events:[[String:Any]]=[];var cursor=0
   while cursor < bytes.count { let end=min(bytes.count,cursor+chunk); events += recorder.consume(bytes.subdata(in:cursor..<end),at:1);cursor=end }
   let details=events.filter{$0["phase"] as? String == "entryPolicyRejectionDetail"}
   try require(details.compactMap{$0["rejectionSite"] as? String} == ["UDP_SEND_TARGET","UDP_SEND_TARGET","NET_RESOLVE"],"actual owner fixed callee order")
   try require(details.compactMap{$0["rejectionReason"] as? String} == ["NON_PUBLIC","FAMILY","APPROVED_MAP"],"distinct actual policy reasons")
   try require(events.filter{$0["phase"] as? String == "entryPolicyRejected"}.count == 3,"same root cancellation marker preserved")
   let encoded = try JSONSerialization.data(withJSONObject:events,options:[.sortedKeys]);let text=String(decoding:encoded,as:UTF8.self)
   for secret in ["secret.invalid","10.1.2.3","2606:","SDP", "injected"] { try require(!text.contains(secret),"dynamic identity omitted") }
   checks += 1
  }
  for bad in ["YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC secret", "YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC\nSDP", "YNX_PUBLIC_REJECTION_V1 BAD_SITE NON_PUBLIC", "YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET BAD_REASON", "YNX_PUBLIC_REJECTION_V1 UDP_SEND_TARGET NON_PUBLIC\u{1b}[0m"] {
   try require(SnowflakeSafePhaseRecorder.classify(Data(bad.utf8)) == nil,"injected or unknown vocabulary rejected");checks += 1
  }
  let result:[String:Any] = ["status":"PASS","newChecks":checks,"actualOwnerProducerCapture":true,"network":"NOT_RUN","normalPrivacyAdmission":"UNCHANGED_BLOCKED"]
  print(String(decoding:try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]),as:UTF8.self))
 }
}
#endif
