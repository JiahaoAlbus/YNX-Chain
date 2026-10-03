import Foundation
@main struct StateChecks {
 @MainActor static func main()throws {
  var saved:Data?;var fail=false;var checks=0
  func ok(_ condition:Bool,_ name:String){precondition(condition,name);checks+=1;print("PASS "+name)}
  func rejects(_ name:String,_ operation:()throws->Void){do{try operation();fatalError(name)}catch{checks+=1;print("PASS "+name)}}
  let key=NativeWire.base64(Data([2])+Data(repeating:0,count:32)),account="ynx1"+String(repeating:"q",count:38),other="ynx1"+String(repeating:"p",count:38)
  let state=try AppleNativeProductState(platform:"macos",deviceId:"qa-original-device-20261003",deviceKey:key,securityLevel:"hardware-backed",read:{saved},write:{if fail{throw ShopError.security};saved=$0})
  let original=try state.context(),namespace="ynx.native-product-session.v2:"+String(repeating:"a",count:64),root=state.root
  ok(original["account"] is NSNull,"initial null-account context stays original")
  try state.set(namespace,root+":pending","original pending",original)
  let cold=try AppleNativeProductState(platform:"macos",deviceId:"ignored-new-device",deviceKey:key,securityLevel:"hardware-backed",read:{saved},write:{saved=$0})
  ok(try NativeWire.canonical(cold.context())==NativeWire.canonical(original),"cold restore retains original device and generation")
  rejects("wrong product key refused"){try state.set(namespace,"ynx.product-session.v2:seller:macos","bad",original)}
  var session=state.tuple();session.merge(["deviceId":original["deviceId"]!,"deviceKey":key,"deviceAlgorithm":"p256-sha256","scopes":AppleNativeProductState.scopes,"account":account,"sessionBinding":String(repeating:"b",count:64),"version":"2","expiresAt":"2099-01-01T00:00:00.000Z"]){_,new in new}
  let intent:[String:Any]=["version":1,"intentId":String(repeating:"I",count:43),"scope":try state.scope(original),"session":NSNull()]
  let first=try NativeWire.canonical(intent);ok(try state.saveRevocationIntent(namespace,root+":revoke",first,original)==first,"original null-target intent persisted")
  var upgraded=intent;upgraded["session"]=session;let target=try NativeWire.canonical(upgraded)
  ok(try state.saveRevocationIntent(namespace,root+":revoke",target,original)==target,"same intent may acquire its original verified target")
  var replacement=upgraded;replacement["intentId"]=String(repeating:"J",count:43)
  ok(try state.saveRevocationIntent(namespace,root+":revoke",NativeWire.canonical(replacement),original)==target,"new intent cannot overwrite original target")
  try state.set(namespace,root,NativeWire.canonical(session),original);try state.requestCurrentRevocation()
  rejects("negative authority refuses OS opening"){try state.permitOpen(original)}
  var proof=state.tuple();proof.removeValue(forKey:"chainId");proof.removeValue(forKey:"platform");proof.merge(["deviceId":original["deviceId"]!,"deviceKey":key,"account":account,"sessionBinding":String(repeating:"b",count:64),"method":"POST","path":"/v2/product-sessions/revoke","bodyDigest":NativeWire.hash("{}")]){_,new in new}
  func input(_ subject:[String:Any])->[String:Any]{["algorithm":"p256-sha256","deviceKey":key,"purpose":"http-proof","payload":NativeWire.base64(Data(("YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"+(try! NativeWire.canonical(subject))).utf8))]}
  var signing=0
  let result=try state.sign(input(proof),original,revokeOnly:true){bytes in signing+=1;precondition(String(data:bytes,encoding:.utf8)=="YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"+(try! NativeWire.canonical(proof)));return "controlled-port-receipt"}
  ok(result=="controlled-port-receipt" && signing==1,"only persisted original revoke target releases unchanged signing bytes")
  var business=proof;business["path"]="/api/profile"
  rejects("logout blocks business before signer"){_ = try state.sign(input(business),original,revokeOnly:false){_ in signing+=1;return "bad"}}
  var wrong=proof;wrong["account"]=other
  rejects("wrong account revoke refused before signer"){_ = try state.sign(input(wrong),original,revokeOnly:true){_ in signing+=1;return "bad"}}
  ok(signing==1,"denials never reach signer")
  var newer=session;newer["sessionBinding"]=String(repeating:"c",count:64);try state.set(namespace,root,NativeWire.canonical(newer),original)
  try state.finishRevocationIntent(namespace,root+":revoke",target,original)
  ok(try state.get(namespace,root,original)==NativeWire.canonical(newer) && state.get(namespace,root+":pending",original)=="original pending","old-target cleanup preserves newer grant and pending record")
  rejects("old intent cleanup cannot repeat"){try state.finishRevocationIntent(namespace,root+":revoke",target,original)}
  try state.selectAccount(account);rejects("changed generation fences old context"){_ = try state.get(namespace,root,original)}
  let selected=try state.context();ok((selected["generation"] as? NSNumber)?.intValue==2,"explicit public account selection increments generation")
  fail=true;rejects("failed durable write rejected"){try state.set("ynx.native-product-session.v2:"+String(repeating:"d",count:64),root+":pending","attempt",selected)}
  fail=false;rejects("uncertain write poisons live runtime"){_ = try state.context()}
  rejects("iOS tuple cannot claim registered macOS grant"){_ = try AppleNativeProductState(platform:"ios",deviceId:"qa-original-device-20261003",deviceKey:key,securityLevel:"hardware-backed",read:{nil},write:{_ in})}
  rejects("Foundation floating values cannot silently alter signed protocol bytes"){_ = try NativeWire.canonical(["fraction":1.25])}
  let wire:[String:Any]=["z":"</script>/\u{2028}\u{2029}\n","😀":"non-bmp","a":"\"\\\u{0001}"]
  let vector:[String:Any]=["context":original,"scope":try cold.scope(original),"canonical":try NativeWire.canonical(wire),"wire":wire]
  try Data(try NativeWire.canonical(vector).utf8).write(to:URL(fileURLWithPath:"/tmp/ynx-commerce-apple-native-20261003/vector.json"))
  print("\(checks) original-source state checks PASS; controlled persistence/signer only, no device or Wallet approval")
 }
}
