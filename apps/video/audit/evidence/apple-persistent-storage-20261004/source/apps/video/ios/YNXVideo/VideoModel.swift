import AVFoundation
import Combine
import Foundation
import Security

struct VideoRecord: Identifiable, Decodable {
    struct Variant: Decodable { let name: String; let object_key: String; let mime: String; let bytes: Int64? }
    struct Caption: Decodable { let language:String; let label:String; let object_key:String; let human_approved:Bool }
    let id: String
    let channel_id: String
    let title: String
    let description: String
    let status: String
    let visibility: String
    let object_key: String?
    let content_type: String?
    let bytes: Int64?
    let variants: [Variant]?
    let captions: [Caption]?
}

struct NativePlaylist: Decodable, Identifiable {
    let playlistID,Owner,Name: String
    let VideoIDs: [String]?
    enum CodingKeys: String,CodingKey { case playlistID="ID",Owner,Name,VideoIDs }
    var id: String { playlistID }
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
    @Published var playlists: [NativePlaylist] = []
    @Published var showingPlaylists = false
    @Published var playlistName = ""
    struct PlaylistPause { let draft: VideoViewerState.Playlist;let revision: UInt64;let account: String }
    @Published var playlistPause: PlaylistPause?
    @Published var savedPlaylistDrafts: [VideoViewerState.Playlist] = []
    @Published var playlistPending = false
    @Published var playlistBusy = false
    @Published var playlistOperationPending = false
    @Published var openedPlaylist: NativePlaylist?
    private var viewer: VideoViewerState?
    private let makeViewer: @MainActor (VideoNativeEngine,VideoNativeEngine.Identity) throws -> VideoViewerState
    private var privateMedia: VideoPrivateMedia?
    private var playback: VideoViewerState.Playback?
    private var playingVideoID: String?
    private var clock=VideoPlaybackClock()
    private var playbackReady=false
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var flushingWatch=false
    private var engine: VideoNativeEngine?
    private let makeEngine: @MainActor () throws -> VideoNativeEngine
    private var accountRevision: UInt64 = 0
    private var didStart = false
    private var catalog: [String:[String:String]] = [:]
    private let boundary = VideoRequestBoundary()
    private let loadData: (String, [URLQueryItem]) async throws -> Data
    let gateway = VideoHTTP.api

    init(loadData: @escaping (String, [URLQueryItem]) async throws -> Data = { path, query in try await VideoHTTP.shared.data(path, query: query) }, makeEngine: @escaping @MainActor () throws -> VideoNativeEngine = VideoNativeEngine.live, makeViewer: @escaping @MainActor (VideoNativeEngine,VideoNativeEngine.Identity) throws -> VideoViewerState = VideoViewerState.live) {
        self.loadData = loadData
        self.makeEngine = makeEngine
        self.makeViewer = makeViewer
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
        showingPlaylists=path=="/v1/playlists"
        // A native SDK-confirmed session and exact business proof are required.
        // Legacy URI parameters never authorize a private library read.
        do {
            let data = try await VideoHTTP.shared.accountData(path,engine:engine,guardRequest:{if !self.boundary.matches(generation) { throw CancellationError() }})
            guard boundary.matches(generation) else { return }
            guard let array=try JSONSerialization.jsonObject(with:data) as? [[String:Any]] else { state = .unavailable; return }
            if path=="/v1/playlists" {
                let records=try JSONDecoder().decode([NativePlaylist].self,from:data)
                guard let account=engine?.identity?.account,records.allSatisfy({$0.Owner==account && VideoViewerState.validID($0.playlistID) && ($0.VideoIDs ?? []).allSatisfy(VideoViewerState.validID)}) else { throw VideoHTTP.Failure.unexpectedResponse }
                playlists=records
            }
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
            if let identity=created.identity {
                self.accountMessage=identity.account
                if self.viewer==nil {
                    do { self.viewer=try self.makeViewer(created,identity);let draft=try self.viewer?.playlistDraft();self.playlistName=draft?.name ?? "";self.playlistPending=draft != nil;self.savedPlaylistDrafts=try self.viewer?.playlistHistory() ?? [];self.playlistOperationPending=try self.viewer?.pendingPlaylistOperation() != nil }
                    catch { self.operationMessage=self.text("unavailable") }
                }
            } else { self.viewer=nil;self.savedPlaylistDrafts=[];self.playlistPause=nil;self.playlists=[];self.playlistName="";self.playlistPending=false;self.playlistOperationPending=false;self.openedPlaylist=nil }
        }
        return created
    }
    func restoreAccount() async {
        guard !accountBusy else { return }
        accountBusy=true;playlistPause=nil;accountRevision &+= 1;let revision=accountRevision
        defer { if revision==accountRevision { accountBusy=false } }
        do {
            let active=try ensureEngine(),result=try await active.dispatch("restore")
            guard revision==accountRevision else { return }
            applyAccount(result,active)
            if accountConnected { await flushWatch() }
        } catch { if revision==accountRevision { accountConnected=false;accountMessage=text("signIn")+" · "+text("retry") } }
    }
    func signIn() async {
        guard !accountBusy,!signOutPending else { return }
        beginNavigation();accountBusy=true;playlistPause=nil;accountRevision &+= 1;let revision=accountRevision
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
            if accountConnected { await flushWatch() }
        } catch { if revision==accountRevision { accountConnected=false;accountMessage=text("signIn")+" · "+text("retry") } }
    }
    func signOut() async {
        beginNavigation();playlistPause=nil;accountRevision &+= 1;let revision=accountRevision
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
        beginNavigation();playlistPause=nil;accountRevision &+= 1;let revision=accountRevision
        accountConnected=false;accountBusy=true;state = .unavailable
        Task { @MainActor in
            defer { if revision==accountRevision { accountBusy=false } }
            do { let active=try ensureEngine(),reply=try await active.dispatch("handleReturn",["url":url.absoluteString]);guard revision==accountRevision else { return };applyAccount(reply,active);if accountConnected { await loadLibrary("/v1/playlists",label:text("playlists"));await flushWatch() } }
            catch { if revision==accountRevision { accountMessage=text("signIn")+" · "+text("retry") } }
        }
    }
    func suspendAccount() { playlistPause=nil;accountRevision &+= 1;accountBusy=false;beginNavigation();engine?.suspend();accountConnected=false;state = .unavailable }
    @discardableResult func mutate(_ path:String,body:[String:Any]) async -> Bool {
        let generation = boundary.generation
        do {
            _ = try await VideoHTTP.shared.accountData(path,method:"POST",body:JSONSerialization.data(withJSONObject:body),engine:engine,guardRequest:{if !self.boundary.matches(generation) { throw CancellationError() }})
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
            let path="/media/\(track.object_key)"
            let data: Data
            if engine?.identity != nil { data=try await VideoHTTP.shared.accountData(path,engine:engine,guardRequest:{if !self.boundary.matches(generation) { throw CancellationError() }}) } else { data=try await loadData(path,[]) }
            guard boundary.matches(generation),data.count<=1024*1024 else { return "" }
            return String(decoding:data,as:UTF8.self).split(separator:"\n").filter{!$0.contains("-->") && $0 != "WEBVTT"}.joined(separator:"\n")
        } catch { return boundary.matches(generation) ? text("unavailable") : "" }
    }
    @discardableResult private func beginNavigation(clearVideos: Bool = true) -> UInt64 {
        let generation = boundary.advance()
        stopPlayback(); selected = nil;openedPlaylist=nil; if clearVideos { videos = [] };playlists=[];showingPlaylists=false; operationMessage = ""
        return generation
    }
    func openPlaylist(_ playlist: NativePlaylist) async {
        let generation=beginNavigation();state = .loading
        do {
            guard playlist.Owner==engine?.identity?.account else { throw VideoHTTP.Failure.nativeSessionUnavailable }
            var records: [VideoRecord]=[]
            for id in playlist.VideoIDs ?? [] {
                let data=try await VideoHTTP.shared.accountData("/v1/videos/"+id,engine:engine,guardRequest:{if !self.boundary.matches(generation) { throw CancellationError() }})
                records.append(try JSONDecoder().decode(VideoRecord.self,from:data))
            }
            guard boundary.matches(generation) else { return };openedPlaylist=playlist;videos=records;state=records.isEmpty ? .empty : .loaded
        } catch { if boundary.matches(generation) { state = .failure(text("unavailable")) } }
    }
    func playlistChoices() async throws -> [NativePlaylist] {
        let generation=boundary.generation
        let data=try await VideoHTTP.shared.accountData("/v1/playlists",engine:engine,guardRequest:{if !self.boundary.matches(generation) { throw CancellationError() }})
        let rows=try JSONDecoder().decode([NativePlaylist].self,from:data)
        guard let account=engine?.identity?.account,rows.allSatisfy({$0.Owner==account && VideoViewerState.validID($0.playlistID) && ($0.VideoIDs ?? []).allSatisfy(VideoViewerState.validID)}) else { throw VideoHTTP.Failure.unexpectedResponse }
        return rows
    }
    func changePlaylist(_ playlist: NativePlaylist,videoID: String?,action: String) async {
        guard !playlistBusy,let viewer,playlist.Owner==engine?.identity?.account else { return }
        do {
            _ = try viewer.reservePlaylistOperation(action:action,playlistID:playlist.playlistID,videoID:videoID);playlistOperationPending=true
            await retryPlaylistOperation()
        } catch { operationMessage=text("retry") }
    }
    func retryPlaylistOperation() async {
        guard !playlistBusy,let viewer,let engine,let identity=engine.identity else { return }
        playlistBusy=true;let generation=boundary.generation
        defer { playlistBusy=false }
        do {
            guard let pending=try viewer.pendingPlaylistOperation() else { playlistOperationPending=false;return }
            let current=try await playlistChoices()
            let original=current.first(where:{$0.playlistID==pending.playlistID})
            let alreadyDone=pending.action=="delete" ? original==nil : pending.action=="remove" && original != nil && !(original!.VideoIDs ?? []).contains(pending.videoID!)
            if !alreadyDone {
                guard original?.Owner==identity.account else { throw VideoHTTP.Failure.unexpectedResponse }
                let path="/v1/playlists/"+pending.playlistID+(pending.action=="delete" ? "" : "/videos"+(pending.action=="remove" ? "/"+pending.videoID! : ""))
                let body=try JSONSerialization.data(withJSONObject:pending.action=="add" ? ["video_id":pending.videoID!] : [:],options:[.sortedKeys,.withoutEscapingSlashes])
                let bytes=try await VideoHTTP.shared.accountData(path,method:pending.action=="add" ? "POST" : "DELETE",body:body,engine:engine,requestKey:pending.key,guardRequest:{if !self.boundary.matches(generation) { throw CancellationError() }})
                guard let result=try JSONSerialization.jsonObject(with:bytes) as? [String:Any],result["ok"] as? Bool==true else { throw VideoHTTP.Failure.unexpectedResponse }
            }
            let rows=try await playlistChoices(),updated=rows.first(where:{$0.playlistID==pending.playlistID})
            let verified=pending.action=="delete" ? updated==nil : updated?.Owner==identity.account && ((updated?.VideoIDs ?? []).contains(pending.videoID!) == (pending.action=="add"))
            guard verified,boundary.matches(generation) else { throw VideoHTTP.Failure.unexpectedResponse }
            try viewer.finishPlaylistOperation(pending);playlistOperationPending=false
            if showingPlaylists { playlists=rows;state=rows.isEmpty ? .empty : .library(text("playlists"),rows.map(\.Name)) }
            if openedPlaylist?.playlistID==pending.playlistID {
                openedPlaylist=updated
                if pending.action=="remove" { videos.removeAll(where:{$0.id==pending.videoID}) }
                if pending.action=="delete" { videos=[];state = .empty }
            }
            operationMessage=""
        } catch { if boundary.matches(generation) { operationMessage=text("retry") } }
    }
    func createPlaylist() async {
        guard !playlistBusy,let viewer,let engine,let identity=engine.identity else { return }
        playlistBusy=true;let generation=boundary.generation
        defer { playlistBusy=false }
        do {
            let draft=try viewer.reservePlaylist(playlistName);playlistPending=true;playlistName=draft.name;savedPlaylistDrafts=try viewer.playlistHistory()
            let guardRequest: @MainActor () throws -> Void = { if !self.boundary.matches(generation) { throw CancellationError() } }
            let body=try JSONSerialization.data(withJSONObject:["Name":draft.name],options:[.sortedKeys,.withoutEscapingSlashes])
            let bytes=try await VideoHTTP.shared.accountData("/v1/playlists",method:"POST",body:body,engine:engine,requestKey:draft.key,guardRequest:guardRequest)
            let created=try JSONDecoder().decode(NativePlaylist.self,from:bytes)
            guard created.Owner==identity.account,created.Name==draft.name else { throw VideoHTTP.Failure.unexpectedResponse }
            let readback=try await VideoHTTP.shared.accountData("/v1/playlists",engine:engine,guardRequest:guardRequest)
            let lists=try JSONDecoder().decode([NativePlaylist].self,from:readback)
            guard lists.contains(where:{$0.playlistID==created.playlistID && $0.Owner==identity.account && $0.Name==draft.name}) else { throw VideoHTTP.Failure.unexpectedResponse }
            try viewer.finishPlaylist(draft);playlistPending=false;playlistName="";await loadLibrary("/v1/playlists",label:text("playlists"))
        } catch { if boundary.matches(generation) { operationMessage=text("retry") } }
    }
    func preparePlaylistPause() {
        guard !playlistBusy,accountConnected,let viewer else { return }
        do { if let draft=try viewer.playlistDraft() { playlistPause=PlaylistPause(draft:draft,revision:accountRevision,account:viewer.account) } } catch { operationMessage=text("unavailable") }
    }
    func confirmPlaylistPause() {
        guard let original=playlistPause else { return };playlistPause=nil
        guard !playlistBusy,accountConnected,original.revision==accountRevision,let viewer,viewer.account==original.account else { return }
        do { try viewer.pausePlaylist(original.draft);playlistName="";playlistPending=false;savedPlaylistDrafts=try viewer.playlistHistory() }
        catch { operationMessage=text("unavailable") }
    }
    func restorePlaylistDraft(_ original: VideoViewerState.Playlist) {
        guard !playlistBusy,accountConnected,let viewer else { return }
        do { let draft=try viewer.restorePlaylist(original);playlistName=draft.name;playlistPending=true;savedPlaylistDrafts=try viewer.playlistHistory() }
        catch { operationMessage=text("unavailable") }
    }
    func flushWatch() async {
        guard !flushingWatch,let viewer,let engine else { return };flushingWatch=true
        let generation=boundary.generation
        defer { flushingWatch=false }
        do {
            for pending in try viewer.pendingWatch() {
                let body=try JSONSerialization.data(withJSONObject:["seconds":pending.seconds,"completed":pending.completed,"playback_id":pending.playbackID],options:[.sortedKeys,.withoutEscapingSlashes])
                let bytes=try await VideoHTTP.shared.accountData("/v1/videos/"+pending.videoID+"/watch",method:"POST",body:body,engine:engine,requestKey:pending.key,guardRequest:{if !self.boundary.matches(generation) { throw CancellationError() }})
                guard let reply=try JSONSerialization.jsonObject(with:bytes) as? [String:Any],reply["ok"] as? Bool==true else { throw VideoHTTP.Failure.unexpectedResponse }
                try viewer.finishWatch(pending)
            }
        } catch { if boundary.matches(generation) { operationMessage=text("retry") } }
    }
    func observePlayback(position: Double,playing: Bool,completed: Bool=false,now: TimeInterval=ProcessInfo.processInfo.systemUptime) {
        guard playbackReady,let viewer,let playback,let id=playingVideoID,position.isFinite,position>=0,position<=Double(Int32.max) else { return }
        let seconds=clock.sample(position:position,playing:playing,now:now)
        do { _ = try viewer.position(id,playback,position:Int(position),seconds:seconds,completed:completed);if completed { self.playback=nil;playingVideoID=nil };Task { await self.flushWatch() } }
        catch { operationMessage=text("unavailable") }
    }
    func select(_ video: VideoRecord) {
        let navigation=beginNavigation(clearVideos:false)
        do {
            let player: AVPlayer
            if let engine,engine.identity != nil {
                let variant=video.variants?.first(where:{$0.mime=="video/mp4" || $0.mime=="video/webm"})
                let key=variant?.object_key ?? video.object_key
                let mime=variant?.mime ?? video.content_type
                guard let key,["video/mp4","video/webm"].contains(mime ?? ""),let viewer else { throw VideoHTTP.Failure.nativeSessionUnavailable }
                let media=try VideoPrivateMedia(engine:engine,path:"/media/"+key,boundary:boundary,navigation:navigation,expectedBytes:variant?.bytes ?? video.bytes)
                privateMedia=media;player=AVPlayer(playerItem:AVPlayerItem(asset:media.asset))
                let original=try viewer.playback(video.id);playback=original;playingVideoID=video.id;clock=VideoPlaybackClock()
                player.seek(to:CMTime(seconds:Double(original.position),preferredTimescale:600),toleranceBefore:.zero,toleranceAfter:.zero) { [weak self,weak player] accepted in
                    Task { @MainActor in guard let self,let player,self.player === player,self.boundary.matches(navigation),accepted else { return };self.playbackReady=true;self.clock=VideoPlaybackClock();_ = self.clock.sample(position:Double(original.position),playing:false,now:ProcessInfo.processInfo.systemUptime);player.play() }
                }
                timeObserver=player.addPeriodicTimeObserver(forInterval:CMTime(seconds:5,preferredTimescale:600),queue:.main) { [weak self,weak player] time in
                    Task { @MainActor in guard let self,let player,self.player === player,self.boundary.matches(navigation) else { return };self.observePlayback(position:time.seconds,playing:player.timeControlStatus == .playing) }
                }
                endObserver=NotificationCenter.default.addObserver(forName:AVPlayerItem.didPlayToEndTimeNotification,object:player.currentItem,queue:.main) { [weak self,weak player] _ in
                    Task { @MainActor in guard let self,let player,self.player === player,self.boundary.matches(navigation) else { return };self.observePlayback(position:player.currentTime().seconds,playing:false,completed:true) }
                }
            } else {
                guard let key=video.variants?.first(where:{$0.name=="adaptive-hls"})?.object_key ?? video.variants?.first?.object_key ?? video.object_key else { throw VideoHTTP.Failure.invalidPath }
                player=AVPlayer(url:try VideoHTTP.url("/media/"+key))
            }
            self.player=player;selected=video
        } catch { stopPlayback();state = .unavailable }
    }
    func stopPlayback() {
        if let player {
            observePlayback(position:player.currentTime().seconds,playing:player.timeControlStatus == .playing)
            if let timeObserver { player.removeTimeObserver(timeObserver) };timeObserver=nil
            if let endObserver { NotificationCenter.default.removeObserver(endObserver) };endObserver=nil
            player.pause();player.replaceCurrentItem(with:nil)
        }
        privateMedia?.close();privateMedia=nil;player=nil;playback=nil;playingVideoID=nil;playbackReady=false
    }
}
