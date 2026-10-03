import Foundation
import AppKit
import Security
@main struct EngineChecks {
 @MainActor static func main()throws {
  let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
  let root="/Users/huangjiahao/Desktop/YNX Final Worktrees/63-shop-connect-state/apps/shop/native/ios/YNXShop/native-session"
  let registry=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:root+"/registry.json")))
  var saved:Data?;let key=NativeWire.base64(Data([2])+Data(repeating:0,count:32));let state=try AppleNativeProductState(platform:"macos",deviceId:"qa-wk-original-device-20261003",deviceKey:key,securityLevel:"hardware-backed",read:{saved},write:{saved=$0})
  var engine:AppleNativeEngine!;var network=0,signing=0,opening=0
  engine=try AppleNativeEngine(assets:URL(fileURLWithPath:root),port:{method,args in
   switch method {
   case "config":return ["gateway":"https://wallet-auth.ynxweb4.com","registry":registry,"purpose":"Explicit controlled engine QA"]
   case "readContext":return try state.context()
   case "walletDetected":return true
   case "randomBytes":var data=Data(count:32);guard args["length"] as? Int==32,data.withUnsafeMutableBytes({SecRandomCopyBytes(kSecRandomDefault,32,$0.baseAddress!)})==errSecSuccess else{throw ShopError.security};return NativeWire.base64(data)
   case "sign":signing+=1;throw ShopError.security
   case "openWallet":opening+=1;guard let input=args["input"] as? [String:Any],let request=input["request"] as? [String:Any],let expected=args["expected"] as? [String:Any] else{throw ShopError.security};try state.checkWalletRequest(request,expected);return false
   default:break
   }
   guard let expected=args["expected"] as? [String:Any],let namespace=args["namespace"] as? String else{throw ShopError.security}
   if method=="requestRevocation"{try state.requestRevocation(namespace,expected);return NSNull()}
   if method=="revocationRequested"{return try state.revocationRequested(namespace,expected)}
   guard let key=args["key"] as? String else{throw ShopError.security}
   switch method{case "get":return try state.get(namespace,key,expected) as Any? ?? NSNull();case "set":try state.set(namespace,key,args["value"] as! String,expected);case "remove":try state.remove(namespace,key,expected);case "saveRevocationIntent":return try state.saveRevocationIntent(namespace,key,args["raw"] as! String,expected);case "finishRevocationIntent":try state.finishRevocationIntent(namespace,key,args["raw"] as! String,expected);default:throw ShopError.security};return NSNull()
  },gateway:{args in network+=1;guard args["method"] as? String=="GET",args["url"] as? String=="https://wallet-auth.ynxweb4.com/v2/product-sessions/time",let headers=args["headers"] as? [String:String],let id=headers["x-request-id"] else{throw ShopError.security};try await Task.sleep(nanoseconds:30_000_000);return ["status":200,"headers":["content-type":"application/json","x-request-id":id,"cache-control":"no-store"],"body":try NativeWire.canonical(["ok":true,"requestId":id,"schemaVersion":2,"result":["serverTime":{let f=ISO8601DateFormatter();f.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return f.string(from:Date())}()]])]},completion:{id,response in
   print("ENGINE "+id+" "+(try! NativeWire.canonical(response)))
   if id=="ready" {guard response["ok"] as? Bool==true else{print("FAIL SDK boot");exit(1)};do{try engine.dispatch("disconnect-check","disconnect",[:])}catch{print(error);exit(1)}}
   if id=="disconnect-check" {guard response["ok"] as? Bool==true,let value=response["value"] as? [String:Any],value["status"] as? String=="revoked" || value["status"] as? String=="disconnected",network==0,signing==0,opening==0 else{print("FAIL local SDK disconnect boundary");exit(1)};print("PASS actual WebKit custom-scheme ES module and synchronous protected storage ports; no network/signature/Wallet");do{try engine.dispatch("restore-check","restore",[:])}catch{print(error);exit(1)}}
   if id=="restore-check"{guard response["ok"] as? Bool==true,let restored=response["state"] as? [String:Any],restored["status"] as? String != "network-unavailable",restored["status"] as? String != "connected",network==1,signing==0,opening==0 else{print("FAIL cold restore");exit(1)};print("PASS actual SDK cold restore through asynchronous reply Gateway with exact time codec/headers");try! engine.dispatch("connect-check","connect",[:])}
   if id=="connect-check"{guard response["ok"] as? Bool==true,let value=response["value"] as? [String:Any],value["approved"] as? Bool==false,value["opened"] as? Bool==false,opening==1,signing==0 else{print("FAIL launch boundary");exit(1)};print("PASS exact SDK prepared launch remains unapproved");try! engine.dispatch("business-check","business",["method":"POST","path":"/api/orders","body":"{}","requiredScopes":["account:read","shop:orders:write"]])}
   if id=="business-check"{guard response["ok"] as? Bool==false,signing==0 else{print("FAIL business proof escaped");exit(1)};print("PASS unapproved Native state cannot release business proof");try! engine.dispatch("return-check","handleReturn",["url":"ynxshop://wallet-auth/callback?response=legacy-token"])}
   if id=="return-check"{guard let state=response["state"] as? [String:Any],state["status"] as? String != "connected",state["session"]==nil,signing==0 else{print("FAIL legacy callback");exit(1)};print("PASS legacy callback cannot become private Native authority");try! engine.dispatch("logout-check","disconnect",[:])}
   if id=="logout-check"{guard response["ok"] as? Bool==true,let value=response["value"] as? [String:Any],value["revocationConfirmed"] as? Bool==false,signing==0 else{print("FAIL logout authority claim");exit(1)};print("PASS cancellation only confirms local cleanup, no server ACK claim");engine.close();exit(0)}
  })
  Task{try? await Task.sleep(nanoseconds:15_000_000_000);print("FAIL actual WebKit SDK engine timed out");engine.close();exit(1)}
  app.run()
 }
}
