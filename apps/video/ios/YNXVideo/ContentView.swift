import AVKit
import CryptoKit
import Security
import SwiftUI

struct VideoRecord: Identifiable, Decodable {
    struct Variant: Decodable { let name: String; let object_key: String; let mime: String }
    struct Caption: Decodable { let language:String; let label:String; let object_key:String; let human_approved:Bool }
    let id: String
    let channel_id: String
    let title: String
    let description: String
    let status: String
    let visibility: String
    let variants: [Variant]?
    let captions: [Caption]?
}

@MainActor final class VideoModel: ObservableObject {
    enum LoadState { case loading, loaded, library(String,[String]), empty, failure(String), offline, unavailable }
    static let supported = ["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"]
    @Published var locale: String
    @Published var aiLocale: String
    @Published var state: LoadState = .loading
    @Published var videos: [VideoRecord] = []
    @Published var selected: VideoRecord?
    @Published var operationMessage = ""
    private var catalog: [String:[String:String]] = [:]
    private var gatewaySession: String?
    let gateway = URL(string: UserDefaults.standard.string(forKey: "ynx.video.gateway") ?? "http://127.0.0.1:8423")!

    init() {
        let system = Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
        locale = UserDefaults.standard.string(forKey: "ynx.video.locale") ?? Self.supported.first(where: { system.hasPrefix($0) }) ?? "en"
        aiLocale = UserDefaults.standard.string(forKey: "ynx.video.ai-locale") ?? locale
        if let url = Bundle.main.url(forResource: "catalog", withExtension: "json"), let data = try? Data(contentsOf: url), let decoded = try? JSONDecoder().decode([String:[String:String]].self, from: data) { catalog = decoded }
    }

    func text(_ key: String) -> String { catalog[locale]?[key].flatMap { $0.isEmpty ? nil : $0 } ?? catalog["en"]?[key] ?? "[\(key)]" }
    func choose(_ value: String) { locale=value; UserDefaults.standard.set(value,forKey:"ynx.video.locale") }
    func chooseAI(_ value: String) { aiLocale=value; UserDefaults.standard.set(value,forKey:"ynx.video.ai-locale") }
    func format(number:Int)->String { number.formatted(.number.locale(Locale(identifier:locale))) }
    func format(date:Date)->String { date.formatted(.dateTime.locale(Locale(identifier:locale)).year().month().day().hour().minute()) }
    func format(currency:Decimal)->String { currency.formatted(.currency(code:"CNY").locale(Locale(identifier:locale))) }
    func plural(one:String,many:String,count:Int)->String { "\(format(number:count)) \(count == 1 ? one : many)" }

    func load(query: String = "") async {
        state = .loading
        var request = URLRequest(url: gateway.appending(path: "/v1/videos").appending(queryItems: [URLQueryItem(name:"q",value:query)]))
        request.setValue("application/json",forHTTPHeaderField:"Accept")
        if let gatewaySession { request.setValue(gatewaySession,forHTTPHeaderField:"X-YNX-App-Session") }
        do {
            let (data,response)=try await URLSession.shared.data(for:request)
            guard let http=response as? HTTPURLResponse else { state = .unavailable; return }
            guard http.statusCode == 200 else { state = http.statusCode == 401 ? .unavailable : .failure("HTTP \(http.statusCode)"); return }
            videos=try JSONDecoder().decode([VideoRecord].self,from:data); state=videos.isEmpty ? .empty : .loaded
        } catch let error as URLError where error.code == .notConnectedToInternet { state = .offline }
        catch { state = .failure(error.localizedDescription) }
    }

    func loadLibrary(_ path:String,label:String) async {
        state = .loading
        var request=URLRequest(url:gateway.appending(path:path));request.setValue("application/json",forHTTPHeaderField:"Accept");if let gatewaySession{request.setValue(gatewaySession,forHTTPHeaderField:"X-YNX-App-Session")}
        do { let(data,response)=try await URLSession.shared.data(for:request);guard let http=response as? HTTPURLResponse,http.statusCode==200 else{state = .unavailable;return};guard let array=try JSONSerialization.jsonObject(with:data) as? [[String:Any]] else{state = .failure("Invalid service response");return};let rows=array.map{String(describing:$0["Name"] ?? $0["name"] ?? $0["VideoID"] ?? $0["video_id"] ?? "record")};state=rows.isEmpty ? .empty:.library(label,rows) }
        catch let error as URLError where error.code == .notConnectedToInternet { state = .offline }
        catch { state = .failure(error.localizedDescription) }
    }

    func walletURL() -> URL? {
        let now=Date(), expires=now.addingTimeInterval(300)
        let iso=ISO8601DateFormatter(); iso.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        let nonce=random(24), key=ProductDeviceKey.shared.compressedPublicKey ?? "unavailable"
        let request: [String:Any] = ["bundleId":"com.ynxweb4.video","callback":"ynxvideo://wallet-auth/callback","chainId":"ynx_6423-1","expiresAt":iso.string(from:expires),"issuedAt":iso.string(from:now),"nonce":nonce,"productClientId":"ynx-video-mobile-v1","productDeviceAlgorithm":"p256-sha256","productDeviceKey":key,"purpose":text("privacy"),"requestingProduct":"ynx-video","scopes":["video.comment","video.history","video.read","video.report","video.subscribe"],"version":"1"]
        guard JSONSerialization.isValidJSONObject(request), let data=try? JSONSerialization.data(withJSONObject:request,options:[.sortedKeys]) else{return nil}
        let encoded=data.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
        return URL(string:"ynxwallet://authorize?request=\(encoded)")
    }

    func handle(url: URL) { guard url.scheme=="ynxvideo",url.host=="wallet-auth" else{return}; gatewaySession=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name=="gateway_session"})?.value; state = gatewaySession == nil ? .unavailable : .loading; if gatewaySession != nil { Task{await load()} } }
    func mutate(_ path:String,body:[String:Any]) async { do { var request=URLRequest(url:gateway.appending(path:path));request.httpMethod="POST";request.httpBody=try JSONSerialization.data(withJSONObject:body);request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.setValue(UUID().uuidString,forHTTPHeaderField:"Idempotency-Key");if let gatewaySession{request.setValue(gatewaySession,forHTTPHeaderField:"X-YNX-App-Session")};let(_,response)=try await URLSession.shared.data(for:request);guard let http=response as? HTTPURLResponse,http.statusCode>=200,http.statusCode<300 else{operationMessage=text("unavailable");return};operationMessage=text("loading") } catch { operationMessage=error.localizedDescription } }
    func transcript(_ track:VideoRecord.Caption) async ->String { guard track.human_approved else{return text("unavailable")};do{let(data,response)=try await URLSession.shared.data(from:gateway.appending(path:"/media/\(track.object_key)"));guard (response as? HTTPURLResponse)?.statusCode==200 else{return text("unavailable")};return String(decoding:data,as:UTF8.self).split(separator:"\n").filter{!$0.contains("-->")&&$0!="WEBVTT"}.joined(separator:"\n")}catch{return error.localizedDescription} }
    private func random(_ count:Int)->String { var bytes=[UInt8](repeating:0,count:count); _=SecRandomCopyBytes(kSecRandomDefault,count,&bytes); return Data(bytes).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
}

final class ProductDeviceKey {
    static let shared=ProductDeviceKey()
    private let key: P256.Signing.PrivateKey?
    private init(){
        let service="com.ynxweb4.video.product-device",account="wallet-auth-v1"
        let query:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:account,kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var item:CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary,&item)==errSecSuccess,let data=item as? Data,let restored=try? P256.Signing.PrivateKey(rawRepresentation:data){key=restored;return}
        guard let created=try? P256.Signing.PrivateKey() else{key=nil;return}; key=created
        let add:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:account,kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly,kSecValueData as String:created.rawRepresentation]
        SecItemDelete(query as CFDictionary); SecItemAdd(add as CFDictionary,nil)
    }
    var compressedPublicKey:String? { key?.publicKey.compactRepresentation?.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
}

struct ContentView: View {
    @EnvironmentObject private var model: VideoModel
    @Environment(\.openURL) private var openURL
    @State private var query=""
    var body: some View {
        NavigationStack {
            VStack(spacing:0) {
                HStack { Text("YNX Video").font(.title.bold()).foregroundStyle(.white); Spacer(); Button(model.text("signIn")){if let url=model.walletURL(){openURL(url)}}.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(Color(red:0,green:47/255,blue:167/255)).accessibilityLabel(model.text("signIn")) }.padding().background(Color(red:0,green:47/255,blue:167/255))
                HStack { TextField(model.text("search"),text:$query).textFieldStyle(.roundedBorder).accessibilityLabel(model.text("search")); Button(model.text("search")){Task{await model.load(query:query)}} }.padding()
                HStack { Button(model.text("discover")){Task{await model.load()}}; Button(model.text("subscriptions")){Task{await model.loadLibrary("/v1/subscriptions",label:model.text("subscriptions"))}}; Button(model.text("playlists")){Task{await model.loadLibrary("/v1/playlists",label:model.text("playlists"))}}; Button(model.text("history")){Task{await model.loadLibrary("/v1/history",label:model.text("history"))}} }.buttonStyle(.bordered).font(.caption).accessibilityElement(children:.contain)
                stateView.frame(maxWidth:.infinity,maxHeight:.infinity)
                settings
            }
            .environment(\.layoutDirection,model.locale=="ar" ? .rightToLeft:.leftToRight)
            .task { await model.load() }
            .sheet(item:$model.selected){ VideoPlayerSheet(video:$0,gateway:model.gateway,title:model.text("play")) }
        }
    }
    @ViewBuilder private var stateView: some View {
        switch model.state {
        case .loading: ProgressView(model.text("loading"))
        case .empty: ContentUnavailableView(model.text("empty"),systemImage:"play.rectangle",description:Text(model.text("noMetrics")))
        case .offline: retry(model.text("offline"))
        case .unavailable: retry(model.text("walletPending"))
        case .failure(let reason): retry(model.text("unavailable")+"\n"+reason)
        case .library(let label,let rows): List(rows,id:\.self){Text($0)}.navigationTitle(label)
        case .loaded:
            List(model.videos) { video in
                Button { model.selected=video } label: {
                    VStack(alignment:.leading) {
                        Text(video.title).font(.headline)
                        Text(video.description).foregroundStyle(.secondary)
                        Text("\(video.status) · \(video.visibility)").font(.caption)
                    }
                }.accessibilityLabel(model.text("play")+": "+video.title)
            }.listStyle(.plain)
        }
    }
    private func retry(_ message:String)->some View {
        ContentUnavailableView {
            Label(model.text("unavailable"),systemImage:"wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button(model.text("retry")){Task{await model.load()}}
        }
    }
    private var settings: some View { HStack { Text(model.text("language")); Picker(model.text("language"),selection:Binding(get:{model.locale},set:model.choose)){ForEach(VideoModel.supported,id:\.self){Text($0)}}; Text(model.text("aiLanguage")); Picker(model.text("aiLanguage"),selection:Binding(get:{model.aiLocale},set:model.chooseAI)){ForEach(VideoModel.supported,id:\.self){Text($0)}} }.padding().font(.caption) }
}

struct VideoPlayerSheet: View {
    @EnvironmentObject private var model:VideoModel
    let video:VideoRecord; let gateway:URL; let title:String
    @State private var comment="";@State private var report="";@State private var transcript=""
    var body:some View { NavigationStack { ScrollView { VStack { Group { if let key=video.variants?.first(where:{$0.name=="adaptive-hls"})?.object_key ?? video.variants?.first?.object_key { VideoPlayer(player:AVPlayer(url:gateway.appending(path:"/media/\(key)"))).frame(minHeight:260) } else { ContentUnavailableView(title,systemImage:"exclamationmark.triangle") } };HStack{Button(model.text("subscriptions")){Task{await model.mutate("/v1/channels/\(video.channel_id)/subscription",body:[:])}};if let track=video.captions?.first(where:{$0.human_approved}){Button(model.text("captions")){Task{transcript=await model.transcript(track)}}}};TextField(model.text("comments"),text:$comment).textFieldStyle(.roundedBorder);Button(model.text("comments")){Task{await model.mutate("/v1/videos/\(video.id)/comments",body:["body":comment]);comment=""}};TextField(model.text("report"),text:$report).textFieldStyle(.roundedBorder);Button(model.text("report")){Task{await model.mutate("/v1/videos/\(video.id)/reports",body:["reason":"viewer_report","details":report]);report=""}};if !transcript.isEmpty{Text(transcript).accessibilityLabel(model.text("captions"))};if !model.operationMessage.isEmpty{Text(model.operationMessage).font(.caption)} }.padding() }.navigationTitle(video.title).accessibilityLabel(title+": "+video.title) } }
}

private extension URL { func appending(queryItems:[URLQueryItem])->URL { var parts=URLComponents(url:self,resolvingAgainstBaseURL:false)!; parts.queryItems=queryItems; return parts.url! } }
