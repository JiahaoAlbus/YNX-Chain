import AVFoundation
import Combine
import Foundation
import Security

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
    @Published var player: AVPlayer?
    @Published var operationMessage = ""
    private var catalog: [String:[String:String]] = [:]
    private let boundary = VideoRequestBoundary()
    private let loadData: (String, [URLQueryItem]) async throws -> Data
    let gateway = VideoHTTP.api

    init(loadData: @escaping (String, [URLQueryItem]) async throws -> Data = { path, query in try await VideoHTTP.shared.data(path, query: query) }) {
        self.loadData = loadData
        let system = Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
        let selectedLocale = UserDefaults.standard.string(forKey: "ynx.video.locale") ?? Self.supported.first(where: { system.hasPrefix($0) }) ?? "en"
        locale = selectedLocale
        aiLocale = UserDefaults.standard.string(forKey: "ynx.video.ai-locale") ?? selectedLocale
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
        let generation = beginNavigation()
        state = .loading
        do {
            let data = try await loadData("/v1/videos", [URLQueryItem(name:"q",value:query)])
            guard boundary.matches(generation) else { return }
            videos=try JSONDecoder().decode([VideoRecord].self,from:data); state=videos.isEmpty ? .empty : .loaded
        } catch let error as URLError where error.code == .notConnectedToInternet { if boundary.matches(generation) { state = .offline } }
        catch { if boundary.matches(generation) { state = .failure(text("unavailable")) } }
    }

    func loadLibrary(_ path:String,label:String) async {
        let generation = beginNavigation()
        state = .loading
        // A native SDK-confirmed session and exact business proof are required.
        // Legacy URI parameters never authorize a private library read.
        do {
            let data = try await VideoHTTP.shared.accountData(path)
            guard boundary.matches(generation) else { return }
            guard let array=try JSONSerialization.jsonObject(with:data) as? [[String:Any]] else { state = .unavailable; return }
            let rows=array.map{String(describing:$0["Name"] ?? $0["name"] ?? $0["VideoID"] ?? $0["video_id"] ?? "record")}
            state=rows.isEmpty ? .empty:.library(label,rows)
        } catch { if boundary.matches(generation) { state = .failure(text("signIn") + " · " + text("unavailable")) } }
    }

    func walletURL() -> URL? {
        beginNavigation()
        let now=Date(), expires=now.addingTimeInterval(300)
        let iso=ISO8601DateFormatter(); iso.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        let key: String
        do { key = try ProductDeviceKey.shared.compressedPublicKey() }
        catch { state = .failure(text("unavailable")); return nil }
        let nonce=random(24)
        let request: [String:Any] = ["bundleId":"com.ynxweb4.video","callback":"ynxvideo://wallet-auth/callback","chainId":"ynx_6423-1","expiresAt":iso.string(from:expires),"issuedAt":iso.string(from:now),"nonce":nonce,"productClientId":"ynx-video-mobile-v1","productDeviceAlgorithm":"p256-sha256","productDeviceKey":key,"purpose":text("privacy"),"requestingProduct":"ynx-video","scopes":["video.comment","video.history","video.read","video.report","video.subscribe"],"version":"1"]
        guard JSONSerialization.isValidJSONObject(request), let data=try? JSONSerialization.data(withJSONObject:request,options:[.sortedKeys]) else{return nil}
        let encoded=data.base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
        return URL(string:"ynxwallet://authorize?request=\(encoded)")
    }

    func handle(url: URL) {
        guard url.scheme=="ynxvideo",url.host=="wallet-auth",url.path=="/callback",url.user==nil,url.password==nil,url.port==nil,url.fragment==nil else{return}
        beginNavigation()
        state = .failure(text("signIn") + " · " + text("unavailable"))
    }
    @discardableResult func mutate(_ path:String,body:[String:Any]) async -> Bool {
        let generation = boundary.generation
        do {
            _ = try await VideoHTTP.shared.accountData(path,method:"POST",body:JSONSerialization.data(withJSONObject:body))
            guard boundary.matches(generation) else { return false }
            operationMessage = ""
            return true
        } catch {
            if boundary.matches(generation) { operationMessage = text("signIn") + " · " + text("unavailable") }
            return false
        }
    }
    func transcript(_ track:VideoRecord.Caption) async ->String {
        let generation = boundary.generation
        guard track.human_approved else{return text("unavailable")}
        do {
            let data = try await loadData("/media/\(track.object_key)", [])
            guard boundary.matches(generation),data.count<=1024*1024 else { return "" }
            return String(decoding:data,as:UTF8.self).split(separator:"\n").filter{!$0.contains("-->") && $0 != "WEBVTT"}.joined(separator:"\n")
        } catch { return boundary.matches(generation) ? text("unavailable") : "" }
    }
    @discardableResult private func beginNavigation(clearVideos: Bool = true) -> UInt64 {
        let generation = boundary.advance()
        stopPlayback(); selected = nil; if clearVideos { videos = [] }; operationMessage = ""
        return generation
    }
    func select(_ video: VideoRecord) {
        beginNavigation(clearVideos: false)
        guard let key=video.variants?.first(where:{$0.name=="adaptive-hls"})?.object_key ?? video.variants?.first?.object_key,
              let url=try? VideoHTTP.url("/media/\(key)") else { state = .unavailable; return }
        player=AVPlayer(url:url); selected=video
    }
    func stopPlayback() { player?.pause(); player?.replaceCurrentItem(with:nil); player=nil }
    private func random(_ count:Int)->String { var bytes=[UInt8](repeating:0,count:count); _=SecRandomCopyBytes(kSecRandomDefault,count,&bytes); return Data(bytes).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") }
}
