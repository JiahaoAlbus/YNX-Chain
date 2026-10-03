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
    @Published var accountMessage = ""
    @Published var accountBusy = false
    @Published var accountConnected = false
    @Published var signOutPending = false
    @Published var awaitingWallet = false
    private var engine: VideoNativeEngine?
    private let makeEngine: @MainActor () throws -> VideoNativeEngine
    private var accountRevision: UInt64 = 0
    private var didStart = false
    private var catalog: [String:[String:String]] = [:]
    private let boundary = VideoRequestBoundary()
    private let loadData: (String, [URLQueryItem]) async throws -> Data
    let gateway = VideoHTTP.api

    init(loadData: @escaping (String, [URLQueryItem]) async throws -> Data = { path, query in try await VideoHTTP.shared.data(path, query: query) }, makeEngine: @escaping @MainActor () throws -> VideoNativeEngine = VideoNativeEngine.live) {
        self.loadData = loadData
        self.makeEngine = makeEngine
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
            let data = try await VideoHTTP.shared.accountData(path,engine:engine)
            guard boundary.matches(generation) else { return }
            guard let array=try JSONSerialization.jsonObject(with:data) as? [[String:Any]] else { state = .unavailable; return }
            let rows=array.map{String(describing:$0["Name"] ?? $0["name"] ?? $0["VideoID"] ?? $0["video_id"] ?? "record")}
            state=rows.isEmpty ? .empty:.library(label,rows)
        } catch { if boundary.matches(generation) { state = .failure(text("signIn") + " · " + text("unavailable")) } }
    }

    func start() async {
        guard !didStart else { return };didStart=true
        async let guest: Void = load()
        await restoreAccount();await guest
    }
    private func ensureEngine() throws -> VideoNativeEngine {
        if let engine { return engine }
        let created=try makeEngine();engine=created
        created.onChange={ [weak self,weak created] in
            guard let self,let created,self.engine === created else { return }
            let connected=created.identity != nil
            if self.accountConnected && !connected { self.beginNavigation();self.state = .unavailable }
            self.accountConnected=connected
            if let identity=created.identity { self.accountMessage=identity.account }
        }
        return created
    }
    func restoreAccount() async {
        guard !accountBusy else { return }
        accountBusy=true;accountRevision &+= 1;let revision=accountRevision
        defer { if revision==accountRevision { accountBusy=false } }
        do {
            let active=try ensureEngine(),result=try await active.dispatch("restore")
            guard revision==accountRevision else { return }
            applyAccount(result,active)
        } catch { if revision==accountRevision { accountConnected=false;accountMessage=text("signIn")+" · "+text("retry") } }
    }
    func signIn() async {
        guard !accountBusy,!signOutPending else { return }
        beginNavigation();accountBusy=true;accountRevision &+= 1;let revision=accountRevision
        defer { if revision==accountRevision { accountBusy=false } }
        do {
            let active=try ensureEngine()
            signOutPending=true
            let retired=try await active.dispatch("disconnect")
            guard revision==accountRevision else { return }
            applyAccount(retired,active)
            guard !signOutPending,["disconnected","expired"].contains(retired["status"] as? String ?? "") else { return }
            let reply=try await active.dispatch("connect")
            guard revision==accountRevision else { return }
            let result=reply["state"] as? [String:Any] ?? reply
            applyAccount(result,active)
        } catch { if revision==accountRevision { accountConnected=false;accountMessage=text("signIn")+" · "+text("retry") } }
    }
    func signOut() async {
        beginNavigation();accountRevision &+= 1;let revision=accountRevision
        accountBusy=true;accountConnected=false;signOutPending=true
        defer { if revision==accountRevision { accountBusy=false } }
        do {
            let active=try ensureEngine(),reply=try await active.dispatch("disconnect")
            guard revision==accountRevision else { return };applyAccount(reply,active)
        } catch { if revision==accountRevision { accountMessage=text("signOut")+" · "+text("retry") } }
    }
    private func applyAccount(_ result: [String:Any],_ active: VideoNativeEngine) {
        accountConnected=active.identity != nil
        let status=result["status"] as? String ?? "retry-required"
        if accountConnected || ["disconnected","expired"].contains(status) { signOutPending=false }
        else if result["revocationPending"] as? Bool==true || status=="revocation-pending" { signOutPending=true }
        awaitingWallet=status=="connecting"
        if let identity=active.identity { accountMessage=identity.account }
        else if signOutPending { accountMessage=text("signOut")+" · "+text("retry") }
        else if status=="connecting" { accountMessage=text("walletPending") }
        else if ["disconnected","expired","guest"].contains(status) { accountMessage="" }
        else { accountMessage=text("signIn")+" · "+text("retry") }
    }
    func handle(url: URL) {
        guard url.scheme=="ynxvideo",url.host=="wallet-auth",url.path=="/callback",url.user==nil,url.password==nil,url.port==nil,url.fragment==nil,url.absoluteString.count<=32768 else{return}
        beginNavigation();accountRevision &+= 1;let revision=accountRevision
        accountConnected=false;accountBusy=true;state = .unavailable
        Task { @MainActor in
            defer { if revision==accountRevision { accountBusy=false } }
            do { let active=try ensureEngine(),reply=try await active.dispatch("handleReturn",["url":url.absoluteString]);guard revision==accountRevision else { return };applyAccount(reply,active);if accountConnected { await loadLibrary("/v1/playlists",label:text("playlists")) } }
            catch { if revision==accountRevision { accountMessage=text("signIn")+" · "+text("retry") } }
        }
    }
    func suspendAccount() { accountRevision &+= 1;accountBusy=false;beginNavigation();engine?.suspend();accountConnected=false;state = .unavailable }
    @discardableResult func mutate(_ path:String,body:[String:Any]) async -> Bool {
        let generation = boundary.generation
        do {
            _ = try await VideoHTTP.shared.accountData(path,method:"POST",body:JSONSerialization.data(withJSONObject:body),engine:engine)
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
}
