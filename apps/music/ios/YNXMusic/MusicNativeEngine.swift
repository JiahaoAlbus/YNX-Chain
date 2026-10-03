// Inherited owned Video native boundary, specialized for the original Music tuple.
import CryptoKit
import Foundation
import WebKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor final class MusicNativeEngine: NSObject, WKUIDelegate, WKNavigationDelegate, WKURLSchemeHandler, WKScriptMessageHandlerWithReply {
    enum Failure: Error { case invalidSource, unavailable, retired, timedOut, rejected(String) }
    struct Identity: Equatable {
        let account, binding, original: String
        let expiresAt: Date
        let context: MusicNativeState.Context
    }
    typealias Sender = (URLRequest,Int) async throws -> (Data,HTTPURLResponse)
    private struct Waiter { let epoch: UInt64; let method: String; let continuation: CheckedContinuation<[String:Any],Error>; let timeout: Task<Void,Never> }
    static let sourceSHA = "57c9464b77146041613433c0dce1bd572ad041a44188fd9ca69e03665dcecacc"
    static let sdkSHA = "e0147cf9f324f4eca8f98f7ca3a154d1cfe130fbb072314924ceb57441048575"
    static let index = URL(string:"ynx-music-native://engine/index.html")!
    private let state: MusicNativeState
    private let key: MusicDeviceSigner
    private let files: [String:Data]
    private let registry: [String:Any]
    private let send: Sender
    private let walletDetected: () -> Bool
    private let openWallet: (URL) async -> Bool
    private var web: WKWebView!
    private var ready: Result<Void,Error>?
    private var readyWaiters: [String:CheckedContinuation<Void,Error>] = [:]
    private var waiters: [String:Waiter] = [:]
    private(set) var epoch: UInt64 = 0
    private(set) var identity: Identity?
    private(set) var lastStatus = ""
    private(set) var lastFailure = ""
    private var denied=true
    private var closed=false
    private var expiration: Task<Void,Never>?
    var onChange: (() -> Void)?

    static func live() throws -> MusicNativeEngine {
        #if os(iOS)
        let platform="ios"
        #else
        let platform="macos"
        #endif
        guard Bundle.main.bundleIdentifier==MusicNativeState.application,
              let assets=Bundle.main.url(forResource:"native-session",withExtension:nil) else { throw Failure.invalidSource }
        let key=MusicDeviceSigner.shared,custody=try MusicNativeCustody(platform:platform)
        let state=try MusicNativeState.open(platform:platform,key:key,custody:custody)
        let transport=MusicNativeTransport()
        return try MusicNativeEngine(state:state,key:key,assets:assets,send:transport.send,walletDetected:{
            let url=URL(string:"ynxwallet://authorize")!
            #if os(iOS)
            return UIApplication.shared.canOpenURL(url)
            #else
            return NSWorkspace.shared.urlForApplication(toOpen:url) != nil
            #endif
        },openWallet:{url in
            #if os(iOS)
            return await UIApplication.shared.open(url)
            #else
            return NSWorkspace.shared.open(url)
            #endif
        })
    }
    init(state: MusicNativeState,key: MusicDeviceSigner,assets: URL,send: @escaping Sender,walletDetected: @escaping () -> Bool,openWallet: @escaping (URL) async -> Bool) throws {
        self.state=state;self.key=key;self.send=send;self.walletDetected=walletDetected;self.openWallet=openWallet
        let manifest=try Data(contentsOf:assets.appendingPathComponent("source.json"))
        guard MusicNativeState.hash(manifest)==Self.sourceSHA,
              let record=try JSONSerialization.jsonObject(with:manifest) as? [String:Any],
              record["sdkSourceCommit"] as? String=="5c5e8a234206e306b6044deb6e938c1763ac7005",record["sdkArtifactSHA256"] as? String==Self.sdkSHA,
              let pins=record["files"] as? [[String:Any]],pins.count==5 else { throw Failure.invalidSource }
        var loaded: [String:Data]=[:]
        let names=Set(["index.html","client.mjs","media-native-consumer.mjs","wallet-auth-native-consumer.mjs","registry.json"])
        for pin in pins {
            guard let name=pin["path"] as? String,names.contains(name),loaded[name]==nil else { throw Failure.invalidSource }
            let bytes=try Data(contentsOf:assets.appendingPathComponent(name))
            guard bytes.count==pin["bytes"] as? Int,MusicNativeState.hash(bytes)==pin["sha256"] as? String else { throw Failure.invalidSource };loaded[name]=bytes
        }
        guard Set(loaded.keys)==names,MusicNativeState.hash(loaded["wallet-auth-native-consumer.mjs"]!)==Self.sdkSHA,
              let registry=try JSONSerialization.jsonObject(with:loaded["registry.json"]!) as? [String:Any] else { throw Failure.invalidSource }
        self.files=loaded;self.registry=registry;super.init()
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
        config.preferences.javaScriptCanOpenWindowsAutomatically=false
        config.setURLSchemeHandler(self,forURLScheme:"ynx-music-native")
        config.userContentController.addScriptMessageHandler(self,contentWorld:.page,name:"musicNative")
        web=WKWebView(frame:.zero,configuration:config);web.uiDelegate=self;web.navigationDelegate=self
        web.load(URLRequest(url:Self.index))
    }
    private func valid(_ frame: WKFrameInfo) -> Bool { !closed && frame.isMainFrame && frame.request.url==Self.index }
    func webView(_ webView: WKWebView,decidePolicyFor navigationAction: WKNavigationAction,decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) { decisionHandler(!closed && navigationAction.request.url==Self.index ? .allow : .cancel) }
    func webView(_ webView: WKWebView,didFail navigation: WKNavigation!,withError error: Error) { boot(.failure(error)) }
    func webView(_ webView: WKWebView,didFailProvisionalNavigation navigation: WKNavigation!,withError error: Error) { boot(.failure(error)) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { close() }
    func webView(_ webView: WKWebView,start urlSchemeTask: WKURLSchemeTask) {
        let request=urlSchemeTask.request
        guard !closed,request.httpMethod=="GET",let url=request.url,url.scheme=="ynx-music-native",url.host=="engine",url.query==nil,url.fragment==nil,url.user==nil,url.password==nil,url.port==nil,
              url.path=="/"+url.lastPathComponent,let bytes=files[url.lastPathComponent],url.lastPathComponent != "registry.json" else { urlSchemeTask.didFailWithError(Failure.invalidSource);return }
        let response=URLResponse(url:url,mimeType:url.pathExtension=="html" ? "text/html" : "text/javascript",expectedContentLength:bytes.count,textEncodingName:"utf-8")
        urlSchemeTask.didReceive(response);urlSchemeTask.didReceive(bytes);urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView,stop urlSchemeTask: WKURLSchemeTask) {}
    func webView(_ webView: WKWebView,runJavaScriptTextInputPanelWithPrompt prompt: String,defaultText: String?,initiatedByFrame frame: WKFrameInfo,completionHandler: @escaping (String?) -> Void) {
        do {
            guard valid(frame),prompt=="YNX_MUSIC_NATIVE_V2",let raw=defaultText,raw.utf8.count<=131072 else { throw Failure.invalidSource }
            let input=try MusicNativeState.object(raw)
            guard Set(input.keys)==Set(["name","args"]),let name=input["name"] as? String,let args=input["args"] as? [String:Any] else { throw Failure.invalidSource }
            let value=try synchronous(name,args)
            completionHandler(try MusicNativeState.canonical(["ok":true,"value":value]))
        } catch { completionHandler("{\"ok\":false,\"code\":\"NATIVE_PORT_REJECTED\"}") }
    }
    private func synchronous(_ name: String,_ args: [String:Any]) throws -> Any {
        guard !closed else { throw Failure.unavailable }
        if name=="config" { return ["platform":try state.context().platform,"registry":registry] }
        if name=="readContext" { return try state.context().object() }
        if name=="walletDetected" { return walletDetected() }
        if name=="randomBytes" {
            guard args["length"] as? Int==32 else { throw Failure.rejected("random length") }
            var bytes=[UInt8](repeating:0,count:32)
            guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else { throw Failure.unavailable };return MusicNativeState.encode(Data(bytes))
        }
        guard let object=args["expected"] as? [String:Any] else { throw Failure.rejected("context") }
        let expected=try MusicNativeState.Context.from(object)
        if name=="sign" {
            guard let input=args["input"] as? [String:Any] else { throw Failure.rejected("input") }
            if denied { try state.requestCurrentRevocation(expected) }
            return try state.sign(input,expected,key.signProtocolBytes)
        }
        guard let namespace=args["namespace"] as? String else { throw Failure.rejected("namespace") }
        if name=="requestRevocation" { denied=true;identity=nil;expiration?.cancel();try state.requestRevocation(namespace,expected);onChange?();return NSNull() }
        if name=="revocationRequested" { return try state.revocationRequested(namespace,expected) }
        guard let storageKey=args["key"] as? String else { throw Failure.rejected("key") }
        switch name {
        case "get": return try state.get(namespace,storageKey,expected) as Any? ?? NSNull()
        case "set": guard let value=args["value"] as? String else { throw Failure.rejected("value") };try state.set(namespace,storageKey,value,expected)
        case "remove": try state.remove(namespace,storageKey,expected)
        case "saveRevocationIntent": guard let raw=args["raw"] as? String else { throw Failure.rejected("intent") };return try state.saveRevocationIntent(namespace,storageKey,raw,expected)
        case "finishRevocationIntent": guard let raw=args["raw"] as? String else { throw Failure.rejected("intent") };try state.finishRevocationIntent(namespace,storageKey,raw,expected)
        default: throw Failure.rejected("port")
        }
        return NSNull()
    }
    func userContentController(_ userContentController: WKUserContentController,didReceive message: WKScriptMessage,replyHandler: @escaping (Any?,String?) -> Void) {
        guard valid(message.frameInfo),message.name=="musicNative",let input=message.body as? [String:Any],Set(input.keys)==Set(["name","args"]),let name=input["name"] as? String,let args=input["args"] as? [String:Any],let bytes=try? JSONSerialization.data(withJSONObject:input),bytes.count<=2_097_152 else { replyHandler(["ok":false,"code":"NATIVE_PORT_REJECTED"],nil);return }
        if name=="complete" {
            do { guard let id=args["id"] as? String,let result=args["result"] as? [String:Any] else { throw Failure.invalidSource };try complete(id,result);replyHandler(["ok":true,"value":NSNull()],nil) }
            catch { replyHandler(["ok":false,"code":"NATIVE_RESULT_REJECTED"],nil) };return
        }
        let captured=epoch
        Task { @MainActor in
            do {
                let value: Any
                if name=="fetch" { value=try await gatewayFetch(args,captured) }
                else if name=="openWallet" {
                    guard !denied,let object=args["expected"] as? [String:Any],let input=args["input"] as? [String:Any],Set(input.keys)==Set(["request","url"]),let request=input["request"] as? [String:Any],let text=input["url"] as? String,text.count<=32768,let url=URL(string:text),text.hasPrefix("ynxwallet://authorize?request="),let encoded=text.components(separatedBy:"?request=").last,MusicNativeState.matches(encoded,"^[A-Za-z0-9_-]+$"),let bytes=MusicNativeState.decode(encoded),MusicNativeState.encode(bytes)==encoded,let raw=String(data:bytes,encoding:.utf8),try MusicNativeState.canonical(MusicNativeState.object(raw))==MusicNativeState.canonical(request),text=="ynxwallet://authorize?request="+encoded else { throw Failure.rejected("Wallet request") }
                    let expected=try MusicNativeState.Context.from(object)
                    try state.withSigningContext(expected) { try state.checkWalletRequest(request,expected) }
                    try requireEpoch(captured);value=["opened":await openWallet(url)];try requireEpoch(captured)
                } else { throw Failure.rejected("async port") }
                try requireEpoch(captured);replyHandler(["ok":true,"value":value],nil)
            } catch { replyHandler(["ok":false,"code":"NATIVE_PORT_REJECTED"],nil) }
        }
    }
    private func gatewayFetch(_ args: [String:Any],_ captured: UInt64) async throws -> Any {
        guard let text=args["url"] as? String,let url=URL(string:text),let method=args["method"] as? String,let headers=args["headers"] as? [String:String],Set(args.keys)==Set(["url","method","headers","body"]) else { throw Failure.rejected("fetch") }
        let gateway=text=="https://wallet-auth.ynxweb4.com"+url.path && ((method=="GET" && url.path=="/v2/product-sessions/time") || (method=="POST" && ["/v2/product-sessions/challenge","/v2/product-sessions/complete","/v2/product-sessions/introspect","/v2/product-sessions/revoke"].contains(url.path)))
        let account=method=="GET" && text==MusicNativeHTTP.api.absoluteString+"/api/me"
        guard gateway || account else { throw Failure.rejected("endpoint") }
        let allowed=Set(["accept","content-type","x-request-id","x-ynx-product-session-proof-v2","x-ynx-music-business-proof-v2"])
        var request=URLRequest(url:url);request.httpMethod=method
        var seen=Set<String>()
        for (key,value) in headers { guard allowed.contains(key.lowercased()),seen.insert(key.lowercased()).inserted,!value.contains("\r"),!value.contains("\n") else { throw Failure.rejected("header") };request.setValue(value,forHTTPHeaderField:key) }
        let body=args["body"] as? String ?? "";guard body.utf8.count<=1_048_576,method != "GET" || body.isEmpty else { throw Failure.rejected("body") }
        if method=="POST" { request.httpBody=Data(body.utf8) }
        try requireEpoch(captured);let (bytes,response)=try await send(request,2_097_152);try requireEpoch(captured)
        guard response.url==url,!((300..<400).contains(response.statusCode)),let text=String(data:bytes,encoding:.utf8) else { throw Failure.rejected("response") }
        var replyHeaders: [String:String]=[:]
        for name in ["Content-Type","Cache-Control","X-Request-Id","Content-Length"] { if let value=response.value(forHTTPHeaderField:name) { replyHeaders[name]=value } }
        return ["status":response.statusCode,"headers":replyHeaders,"body":text]
    }
    private func boot(_ result: Result<Void,Error>) { guard ready==nil else { return };ready=result;let waiting=readyWaiters;readyWaiters.removeAll();for continuation in waiting.values { continuation.resume(with:result) } }
    private func ensureReady() async throws {
        if let ready { return try ready.get() }
        let id=UUID().uuidString
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void,Error>) in
            readyWaiters[id]=continuation
            Task { @MainActor [weak self] in try? await Task.sleep(nanoseconds:15_000_000_000);guard let self,let waiting=self.readyWaiters.removeValue(forKey:id) else { return };waiting.resume(throwing:Failure.timedOut) }
        }
    }
    private func complete(_ id: String,_ result: [String:Any]) throws {
        if id=="ready" { boot(result["ok"] as? Bool==true ? .success(()) : .failure(Failure.unavailable));return }
        guard let waiter=waiters.removeValue(forKey:id) else { return };waiter.timeout.cancel()
        do {
            try requireEpoch(waiter.epoch)
            lastStatus=(result["value"] as? [String:Any])?["status"] as? String ?? ""
            lastFailure=result["code"] as? String ?? ""
            if let wrapper=result["state"] as? [String:Any] { try publish(wrapper) }
            guard result["ok"] as? Bool==true else { throw Failure.rejected(result["code"] as? String ?? "SDK") }
            waiter.continuation.resume(returning:result["value"] as? [String:Any] ?? [:])
        } catch { if epoch==waiter.epoch { lastFailure=String(describing:error);if waiter.method != "prepareRequest" { identity=nil;onChange?() } };waiter.continuation.resume(throwing:error) }
    }
    private func publish(_ wrapper: [String:Any]) throws {
        guard !denied,wrapper["businessVerified"] as? Bool==true,let current=wrapper["state"] as? [String:Any],current["status"] as? String=="connected",let session=current["session"] as? [String:Any] else { identity=nil;expiration?.cancel();onChange?();return }
        let context=try state.context()
        guard session["version"] as? String=="2",session["platform"] as? String==context.platform,session["applicationId"] as? String==MusicNativeState.application,session["bundleId"] as? String==MusicNativeState.application,session["packageId"] is NSNull,session["productId"] as? String=="music",session["clientId"] as? String=="ynx-music-v1",session["chainId"] as? String=="ynx_6423-1",session["origin"] as? String=="app://\(context.platform)/com.ynxweb4.music",session["callback"] as? String=="ynxmusic://auth/callback",session["deviceId"] as? String==context.deviceId,session["deviceKey"] as? String==context.deviceKey,session["deviceAlgorithm"] as? String=="p256-sha256",session["scopes"] as? [String]==MusicNativeState.scopes,
              let account=session["account"] as? String,MusicNativeState.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$"),context.account==nil || context.account==account,
              let binding=session["sessionBinding"] as? String,MusicNativeState.matches(binding,"^[0-9a-f]{64}$"),let raw=session["expiresAt"] as? String,let expires=Self.date(raw),expires>Date() else { throw Failure.rejected("original identity") }
        identity=Identity(account:account,binding:binding,original:try MusicNativeState.canonical(session),expiresAt:expires,context:context)
        expiration?.cancel();let captured=identity
        expiration=Task { @MainActor [weak self] in try? await Task.sleep(nanoseconds:UInt64(max(0,expires.timeIntervalSinceNow)*1_000_000_000));guard !Task.isCancelled,let self,self.identity==captured else { return };self.identity=nil;self.onChange?() }
        onChange?()
    }
    func require(_ original: Identity,_ captured: UInt64) throws {
        try requireEpoch(captured);guard !denied,identity==original,original.expiresAt>Date(),try state.context()==original.context else { throw Failure.retired }
    }
    func sendBusiness(_ request: URLRequest,_ limit: Int,_ original: Identity,_ captured: UInt64) async throws -> (Data,HTTPURLResponse) {
        guard let url=request.url,url.absoluteString==MusicNativeHTTP.api.absoluteString+url.path.replacingOccurrences(of:"/music",with:"",options:.anchored),url.query==nil,url.fragment==nil,
              request.value(forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2") != nil,
              request.value(forHTTPHeaderField:"X-YNX-Music-Business-Proof-V2") != nil else { throw Failure.rejected("business endpoint") }
        try require(original,captured);let result=try await send(request,limit);try require(original,captured)
        guard result.1.url==url else { throw Failure.rejected("business response") };return result
    }
    func retireLocally() throws {
        denied=true;identity=nil;epoch &+= 1;expiration?.cancel()
        try state.requestCurrentRevocation(state.context());onChange?()
    }
    func request(path: String,method: String,body: Data?,contentType: String,idempotency: String?) async throws -> Data {
        guard path.hasPrefix("api/"),!path.contains("?"),!path.contains("#"),!path.contains("%"),!path.contains(".."),!path.contains("\\"),!path.contains("\r"),!path.contains("\n"),let original=identity else { throw Failure.retired }
        let bytes=body ?? Data(),captured=epoch,route="/"+path
        guard bytes.count<=64*1024*1024,method != "GET" || bytes.isEmpty else { throw Failure.rejected("body") }
        let proof=try await dispatch("prepareRequest",["method":method,"path":route,"bodyDigest":MusicNativeState.hash(bytes),"bodyBytes":bytes.count])
        try require(original,captured)
        guard proof["account"] as? String==original.account,proof["sessionBinding"] as? String==original.binding,proof["bodyDigest"] as? String==MusicNativeState.hash(bytes),proof["bodyBytes"] as? Int==bytes.count,let identityHeader=proof["identityHeader"] as? String,let actionHeader=proof["actionHeader"] as? String else { throw Failure.rejected("proof") }
        var request=URLRequest(url:MusicNativeHTTP.api.appending(path:path));request.httpMethod=method;request.httpBody=body
        request.setValue(identityHeader,forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2");request.setValue(actionHeader,forHTTPHeaderField:"X-YNX-Music-Business-Proof-V2")
        request.setValue(contentType,forHTTPHeaderField:"Content-Type")
        if let idempotency { guard MusicNativeState.matches(idempotency,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$") else { throw Failure.rejected("request key") };request.setValue(idempotency,forHTTPHeaderField:"Idempotency-Key") }
        let (data,response)=try await sendBusiness(request,64*1024*1024,original,captured)
        if response.statusCode==401 { try rejected(original);throw URLError(.userAuthenticationRequired) }
        guard (200..<300).contains(response.statusCode) else { throw URLError(.badServerResponse) }
        return data
    }
    func suspend() { epoch &+= 1;denied=true;identity=nil;expiration?.cancel();onChange?() }
    private func requireEpoch(_ captured: UInt64) throws { guard !closed,epoch==captured else { throw Failure.retired };try Task.checkCancellation() }
    func dispatch(_ method: String,_ args: [String:Any]=[:]) async throws -> [String:Any] {
        guard ["connect","restore","handleReturn","disconnect","prepareRequest"].contains(method),!closed else { throw Failure.unavailable }
        if method != "prepareRequest" { epoch &+= 1;identity=nil;expiration?.cancel();denied=method=="disconnect";if denied { try state.requestCurrentRevocation(state.context()) };onChange?() }
        let captured=epoch;try await ensureReady();try requireEpoch(captured)
        let id=UUID().uuidString,encoded=try MusicNativeState.canonical([id,method,args])
        return try await withCheckedThrowingContinuation { continuation in
            let timeout=Task { @MainActor [weak self] in try? await Task.sleep(nanoseconds:30_000_000_000);guard !Task.isCancelled,let self,let old=self.waiters.removeValue(forKey:id) else { return };if self.epoch==old.epoch { self.denied=true;self.identity=nil;try? self.state.requestCurrentRevocation(self.state.context());self.onChange?() };old.continuation.resume(throwing:Failure.timedOut) }
            waiters[id]=Waiter(epoch:captured,method:method,continuation:continuation,timeout:timeout)
            web.evaluateJavaScript("void NativeClient.dispatch(...\(encoded))") { [weak self] _,error in
                guard let error,let self,let old=self.waiters.removeValue(forKey:id) else { return };old.timeout.cancel();old.continuation.resume(throwing:error)
            }
        }
    }
    func rejected(_ original: Identity) throws {
        guard identity==original else { return };denied=true;identity=nil;epoch &+= 1;expiration?.cancel();try state.requestCurrentRevocation(original.context);onChange?()
    }
    func close() {
        guard !closed else { return };closed=true;denied=true;identity=nil;epoch &+= 1;expiration?.cancel()
        web?.stopLoading();web?.configuration.userContentController.removeScriptMessageHandler(forName:"musicNative",contentWorld:.page)
        for old in waiters.values { old.timeout.cancel();old.continuation.resume(throwing:Failure.retired) };waiters.removeAll();boot(.failure(Failure.retired));onChange?()
    }
    private static func date(_ text: String) -> Date? { let iso=ISO8601DateFormatter();iso.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return iso.date(from:text) ?? ISO8601DateFormatter().date(from:text) }
}
