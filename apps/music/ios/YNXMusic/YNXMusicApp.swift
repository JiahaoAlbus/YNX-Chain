import SwiftUI
import AVFoundation
import MediaPlayer
import CryptoKit
import Security
import UniformTypeIdentifiers

struct CatalogFile: Decodable { let version: Int; let locales: [String]; let catalog: [String:[String:String]] }
@MainActor final class I18n: ObservableObject {
    static let shared = I18n(); @Published var tag: String; @Published var aiLanguage: String
    private var file = CatalogFile(version: 1, locales: ["en"], catalog: ["en":[:]])
    private init(){ tag=UserDefaults.standard.string(forKey:"locale") ?? "system"; aiLanguage=UserDefaults.standard.string(forKey:"aiLanguage") ?? "system"; if let u=Bundle.main.url(forResource:"i18n",withExtension:"json"),let d=try? Data(contentsOf:u),let v=try? JSONDecoder().decode(CatalogFile.self,from:d){file=v} }
    var resolved:String { if tag != "system" { return tag }; let id=Locale.current.identifier.replacingOccurrences(of:"_",with:"-"); return file.locales.first(where:{id.hasPrefix($0)}) ?? "en" }
    var rtl:Bool { resolved == "ar" }
    func t(_ key:String)->String { file.catalog[resolved]?[key] ?? file.catalog["en"]?[key] ?? "[\(key)]" }
    func set(_ value:String){tag=value;UserDefaults.standard.set(value,forKey:"locale")}
    func setAI(_ value:String){aiLanguage=value;UserDefaults.standard.set(value,forKey:"aiLanguage")}
    func number(_ value:Int)->String { let f=NumberFormatter();f.locale=Locale(identifier:resolved);f.numberStyle = .decimal;return f.string(from:NSNumber(value:value)) ?? "\(value)" }
    func date(_ value:Date)->String { value.formatted(.dateTime.locale(Locale(identifier:resolved)).year().month().day().hour().minute()) }
}

enum WalletLink {
    private static func key()throws->P256.Signing.PrivateKey{try MusicCredentials.shared.deviceKey()}
    static func productDeviceKey()throws->String{try key().publicKey.compressedRepresentation.base64URLEncodedString()}
    static func make()throws->URL{let nonce=random(),now=Date();UserDefaults.standard.set(now.addingTimeInterval(300).timeIntervalSince1970,forKey:"walletExpires");let iso=ISO8601DateFormatter();iso.formatOptions=[.withInternetDateTime,.withFractionalSeconds];let request:[String:Any]=["version":"1","nonce":nonce,"chainId":"ynx_6423-1","requestingProduct":"music","productClientId":"ynx-music-v1","bundleId":"com.ynxweb4.music","productDeviceAlgorithm":"p256-sha256","productDeviceKey":try productDeviceKey(),"callback":"ynxmusic://auth/callback","scopes":["music.creator","music.library","music.playback","music.profile"],"purpose":"Sign in to YNX Music without sharing Wallet recovery material","issuedAt":iso.string(from:now),"expiresAt":iso.string(from:now.addingTimeInterval(300))];let data=try JSONSerialization.data(withJSONObject:request,options:.sortedKeys);UserDefaults.standard.set(String(decoding:data,as:UTF8.self),forKey:"walletRequest");guard let url=URL(string:"ynxwallet://authorize?request=\(data.base64URLEncodedString())")else{throw URLError(.badURL)};return url}
    static func approval(_ encoded:String,request:[String:Any])throws->[String:Any]{guard let data=Data(base64URLEncoded:encoded),let approval=try JSONSerialization.jsonObject(with:data) as? [String:Any]else{throw URLError(.cannotDecodeRawData)};for field in ["nonce","chainId","requestingProduct","productClientId","bundleId","productDeviceAlgorithm","productDeviceKey","callback","purpose"]{guard request[field] as? String == approval[field] as? String else{throw URLError(.userAuthenticationRequired)}};guard (request["scopes"] as? [String]) == (approval["grantedScopes"] as? [String]) else{throw URLError(.userAuthenticationRequired)};return approval}
    static func completion(_ challenge:[String:Any])throws->[String:Any]{guard challenge["productClientId"] as? String == "ynx-music-v1",challenge["bundleId"] as? String == "com.ynxweb4.music",challenge["productDeviceKey"] as? String == (try productDeviceKey())else{throw URLError(.userAuthenticationRequired)};let canonical=try JSONSerialization.data(withJSONObject:challenge,options:.sortedKeys),message=Data("YNX_PRODUCT_SESSION_CHALLENGE_V1\n".utf8)+canonical;let signature=try key().signature(for:message);return ["challenge":challenge,"deviceSignature":signature.derRepresentation.base64URLEncodedString()]}
    private static func random()->String{var b=[UInt8](repeating:0,count:24);_ = SecRandomCopyBytes(kSecRandomDefault,b.count,&b);return Data(b).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")}
}

extension Data { func base64URLEncodedString()->String{base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")};init?(base64URLEncoded value:String){var raw=value.replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/");raw+=String(repeating:"=",count:(4-raw.count%4)%4);self.init(base64Encoded:raw)} }

struct MusicOperation {
    let api:MusicAPI
    let session:MusicSessionContext
    let account:MusicAccountContext
}

@MainActor final class MusicModel:ObservableObject {
    @Published var snapshot=Snapshot()
    @Published var state=LocalState()
    @Published var status="loading"
    @Published var query=""
    @Published private(set) var viewGeneration=UUID()
    private let fence:MusicSessionFence
    private let store:MusicAccountStore
    private var account:MusicAccountContext?
    private var api:MusicAPI
    let player=NativePlayer()

    init() {
        var binding:String?
        var deviceKey=""
        var credentialsReady=true
        do {
            if !UserDefaults.standard.bool(forKey:"music-session-disabled") { binding=try MusicCredentials.shared.session() }
            if binding != nil { deviceKey=try WalletLink.productDeviceKey() }
        } catch { credentialsReady=false }
        let fence=MusicSessionFence(binding:binding)
        self.fence=fence
        let root=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
        store=MusicAccountStore(root:root)
        api=MusicAPI(context:fence.capture(),fence:fence,deviceKey:deviceKey)
        // Private local state stays hidden until this session's /api/me succeeds.
        if credentialsReady { Task { await refresh() } } else { status="retry" }
        player.onPosition={ [weak self] id,position in
            guard let self,let operation=self.captureOperation() else { return }
            self.state.trackId=id; self.state.position=position; self.saveLocal()
            let reference=self.playbackSession(id,account:operation.account)
            Task { _ = await self.perform(operation) { api in
                try await api.reportPosition(id:id,session:reference,position:position,completed:false)
            } }
        }
        player.onComplete={ [weak self] id,position in
            guard let self,let operation=self.captureOperation() else { return }
            let reference=self.playbackSession(id,account:operation.account)
            Task { _ = await self.perform(operation) { api in
                try await api.reportPosition(id:id,session:reference,position:position,completed:true)
            } }
            UserDefaults.standard.removeObject(forKey:self.playbackKey(id,account:operation.account))
            if let at=self.state.queue.firstIndex(of:id),at+1<self.state.queue.count,
               let next=self.snapshot.catalog.first(where:{$0.id==self.state.queue[at+1]}) {
                self.state.position=0; self.play(next)
            }
        }
    }
    var filtered:[Track] {
        query.isEmpty ? snapshot.catalog : snapshot.catalog.filter {
            ($0.title+" "+$0.artistName+" "+($0.album ?? "")).localizedCaseInsensitiveContains(query)
        }
    }
    var signedIn:Bool { captureOperation() != nil }
    var canSignOut:Bool { api.context.binding != nil }
    func captureOperation()->MusicOperation? {
        guard let account,api.context.binding != nil,fence.isCurrent(api.context) else { return nil }
        return MusicOperation(api:api,session:api.context,account:account)
    }
    func isCurrent(_ operation:MusicOperation)->Bool {
        fence.isCurrent(operation.session) && account==operation.account
    }
    func perform<Value>(_ operation:MusicOperation,_ work:(MusicAPI)async throws->Value)async->Value? {
        guard isCurrent(operation) else { return nil }
        do {
            let value=try await work(operation.api)
            guard isCurrent(operation) else { return nil }
            return value
        } catch {
            guard isCurrent(operation) else { return nil }
            if (error as? URLError)?.code == .userAuthenticationRequired { signOut(); status="auth_rejected" }
            else { status="retry" }
            return nil
        }
    }
    func refresh()async { await refresh(api:api,context:api.context) }
    func refresh(_ operation:MusicOperation)async {
        guard isCurrent(operation) else { return }
        await refresh(api:operation.api,context:operation.session)
    }
    private func refresh(api requestAPI:MusicAPI,context:MusicSessionContext)async {
        guard fence.isCurrent(context),context.binding != nil else { status="offline_mode"; return }
        status="loading"
        do {
            let received=try await requestAPI.snapshot()
            guard fence.isCurrent(context) else { return }
            // A server identity change under the same binding is not a switch
            // instruction; it requires a fresh authorization.
            if let account,account.account != received.profile.account { throw URLError(.userAuthenticationRequired) }
            let (selected,cached)=try store.select(verifiedAccount:received.profile.account)
            if account != selected { state=cached }
            account=selected; snapshot=received
            state.favorites=received.listener.favorites
            state.queue=received.listener.queue
            // Availability is local and verified; remote download markers must
            // not claim that a file exists in this account's device directory.
            state.downloads=Dictionary(uniqueKeysWithValues:received.catalog.compactMap { track in
                ((try? store.audioURL(track:track,for:selected)) ?? nil) == nil ? nil : (track.id,"available")
            })
            saveLocal(); status="ready"
        } catch {
            guard fence.isCurrent(context) else { return }
            if (error as? URLError)?.code == .userAuthenticationRequired { signOut(); status="auth_rejected" }
            else { status="offline_mode" }
        }
    }
    func beginSignIn()->URL? {
        signOut()
        do { return try WalletLink.make() }
        catch { status="auth_rejected"; return nil }
    }
    func acceptCallback(_ url:URL) {
        let items=URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems ?? []
        guard url.scheme=="ynxmusic",url.host=="auth",url.path=="/callback",url.user==nil,url.password==nil,
              url.port==nil,url.fragment==nil,items.count==1,items.first?.name=="response",
              Date().timeIntervalSince1970<UserDefaults.standard.double(forKey:"walletExpires"),
              let response=items.first?.value,let raw=UserDefaults.standard.string(forKey:"walletRequest"),
              let data=raw.data(using:.utf8),let request=try? JSONSerialization.jsonObject(with:data) as? [String:Any]
        else { return }
        UserDefaults.standard.removeObject(forKey:"walletRequest")
        UserDefaults.standard.removeObject(forKey:"walletExpires")
        let requestAPI=api,context=api.context
        Task {
            do {
                let binding=try await requestAPI.walletSession(response:response,request:request)
                guard fence.isCurrent(context) else { return }
                let deviceKey=try WalletLink.productDeviceKey()
                try MusicCredentials.shared.saveSession(binding)
                UserDefaults.standard.set(false,forKey:"music-session-disabled")
                let installed=fence.replace(binding:binding)
                api=MusicAPI(context:installed,fence:fence,deviceKey:deviceKey)
                await refresh(api:api,context:installed)
            } catch {
                guard fence.isCurrent(context) else { return }
                status="auth_rejected"
            }
        }
    }
    func signOut() {
        player.stop()
        // A failed/locked Keychain deletion must not restore this session on
        // next launch. This marker contains no credential and is cleared only
        // after a new session has been persisted successfully.
        UserDefaults.standard.set(true,forKey:"music-session-disabled")
        let removalFailed:Bool
        do { try MusicCredentials.shared.clearSession(); removalFailed=false }
        catch { removalFailed=true }
        let context=fence.replace(binding:nil)
        api=MusicAPI(context:context,fence:fence,deviceKey:"")
        store.detach(); account=nil; state=LocalState(); snapshot=Snapshot(); query=""
        viewGeneration=UUID(); status=removalFailed ? "retry":"offline_mode"
        UserDefaults.standard.removeObject(forKey:"walletRequest")
        UserDefaults.standard.removeObject(forKey:"walletExpires")
    }
    func play(_ track:Track) {
        guard let operation=captureOperation(),snapshot.catalog.contains(where:{$0.id==track.id}) else { return }
        let offline=(try? store.audioURL(track:track,for:operation.account)) ?? nil
        let url=offline ?? operation.api.base.appending(path:"api/tracks/\(track.id)/media")
        player.play(track:track,url:url,position:state.trackId==track.id ? state.position:0,context:operation.session,fence:fence)
    }
    func favorite(_ id:String) {
        guard captureOperation() != nil else { return }
        state.favorites.contains(id) ? state.favorites.removeAll{$0==id}:state.favorites.append(id)
        saveLocal(); syncLibrary()
    }
    func enqueue(_ id:String) {
        guard captureOperation() != nil else { return }
        if !state.queue.contains(id) { state.queue.append(id); saveLocal(); syncLibrary() }
    }
    func download(_ id:String) {
        guard let operation=captureOperation(),let track=snapshot.catalog.first(where:{$0.id==id}) else { return }
        status="downloading"
        Task {
            guard let data=await perform(operation, { try await $0.download(track) }),isCurrent(operation) else { return }
            do {
                try store.storeAudio(data,track:track,for:operation.account)
                state.downloads[id]="available"; saveLocal()
                let favorites=state.favorites,queue=state.queue,downloads=state.downloads
                guard await perform(operation, { try await $0.saveLibrary(favorites:favorites,queue:queue,downloads:downloads) }) != nil else { return }
                status="download_ready"
            } catch { if isCurrent(operation) { status="download_failed" } }
        }
    }
    func setAI(_ on:Bool) { guard signedIn else { return }; state.aiEnabled=on; saveLocal() }
    func setProfile(explicit:Bool,privateHistory:Bool) {
        guard let operation=captureOperation() else { return }
        var profile=snapshot.profile; profile.explicitAllowed=explicit; profile.privateHistory=privateHistory
        Task {
            guard await perform(operation, { try await $0.updateProfile(profile) }) != nil else { return }
            await refresh(operation)
        }
    }
    func clearPrivate(_ operation:MusicOperation) {
        guard isCurrent(operation) else { return }
        player.stop()
        if let account {
            do {
                try store.clear(account)
                let prefix="playback-session-\(MusicAccountStore.accountKey(account.account))-"
                for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
                    UserDefaults.standard.removeObject(forKey:key)
                }
            }
            catch { status="retry"; return }
        }
        signOut()
    }
    private func saveLocal() {
        guard let operation=captureOperation() else { return }
        do { try store.save(state,for:operation.account) } catch { status="retry" }
    }
    private func syncLibrary() {
        guard let operation=captureOperation() else { return }
        let favorites=state.favorites,queue=state.queue,downloads=state.downloads
        Task { _ = await perform(operation) { try await $0.saveLibrary(favorites:favorites,queue:queue,downloads:downloads) } }
    }
    private func playbackKey(_ id:String,account:MusicAccountContext)->String {
        "playback-session-\(MusicAccountStore.accountKey(account.account))-\(id)"
    }
    private func playbackSession(_ id:String,account:MusicAccountContext)->String {
        let key=playbackKey(id,account:account)
        if let value=UserDefaults.standard.string(forKey:key) { return value }
        let value=UUID().uuidString; UserDefaults.standard.set(value,forKey:key); return value
    }
}

@MainActor final class NativePlayer {
    private var player:AVPlayer?
    private var observer:Any?
    private var completion:Any?
    private var generation=UUID()
    private var context:MusicSessionContext?
    private var fence:MusicSessionFence?
    var onPosition:((String,Double)->Void)?
    var onComplete:((String,Double)->Void)?

    init() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback,mode:.default,options:[])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        MPRemoteCommandCenter.shared().playCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self,self.isCurrent else { return }; self.player?.play()
            }
            return .success
        }
        MPRemoteCommandCenter.shared().pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor [weak self] in self?.player?.pause() }; return .success
        }
    }
    private var isCurrent:Bool {
        guard let context,let fence else { return false }; return fence.isCurrent(context)
    }
    func stop() {
        generation=UUID()
        player?.pause()
        if let observer,let player { player.removeTimeObserver(observer) }
        if let completion { NotificationCenter.default.removeObserver(completion) }
        observer=nil; completion=nil
        player?.replaceCurrentItem(with:nil); player=nil; context=nil; fence=nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo=nil
    }
    func play(track:Track,url:URL,position:Double,context:MusicSessionContext,fence:MusicSessionFence) {
        stop()
        guard fence.isCurrent(context),context.binding != nil else { return }
        self.context=context; self.fence=fence
        let playGeneration=generation
        var headers:[String:String]=[:]
        if !url.isFileURL,let binding=context.binding {
            headers["X-YNX-App-Session"]=binding
            headers["X-YNX-Product-Device-Key"]=(try? WalletLink.productDeviceKey()) ?? ""
        }
        let asset=AVURLAsset(url:url,options:["AVURLAssetHTTPHeaderFieldsKey":headers])
        let item=AVPlayerItem(asset:asset)
        player=AVPlayer(playerItem:item)
        if position>0 { player?.seek(to:CMTime(seconds:position,preferredTimescale:1000)) }
        player?.play()
        MPNowPlayingInfoCenter.default().nowPlayingInfo=[MPMediaItemPropertyTitle:track.title,MPMediaItemPropertyArtist:track.artistName,MPMediaItemPropertyPlaybackDuration:Double(track.durationMillis)/1000]
        observer=player?.addPeriodicTimeObserver(forInterval:CMTime(seconds:5,preferredTimescale:1),queue:.main) { [weak self] time in
            let seconds=time.seconds
            Task { @MainActor [weak self] in
                guard let self,self.generation==playGeneration,self.isCurrent,seconds.isFinite else { return }
                self.onPosition?(track.id,seconds)
            }
        }
        let duration=Double(track.durationMillis)/1000
        completion=NotificationCenter.default.addObserver(forName:.AVPlayerItemDidPlayToEndTime,object:item,queue:.main) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self,self.generation==playGeneration,self.isCurrent else { return }
                self.onComplete?(track.id,duration)
            }
        }
    }
}

struct TrackDetail:View{@EnvironmentObject var m:MusicModel;@EnvironmentObject var l:I18n;let t:Track;@State var reason="";@State var evidence="";var body:some View{Form{Section(t.title){Text(t.artistName);if let album=t.album,!album.isEmpty{Text(album)};Text("\(l.t("rights")): \(t.rights.basis) · \(t.rights.evidenceRef)");Text("\(l.t("provenance")): \(t.provenance["audio"] ?? "")")};Section(l.t("rights")){TextField(l.t("rights_declaration"),text:$reason);TextField(l.t("rights_evidence"),text:$evidence);ForEach(["report","dispute","appeal"],id:\.self){kind in Button(kind.capitalized){guard let operation=m.captureOperation() else{return};let reason=reason,evidence=evidence;Task{guard await m.perform(operation,{try await $0.openCase(kind:kind,track:t.id,reason:reason,evidence:evidence)}) != nil else{return};await m.refresh(operation)}}.disabled(reason.count<5||evidence.isEmpty)}}}.navigationTitle(t.title)}}
struct TrackRow:View { @EnvironmentObject var m:MusicModel;let t:Track;@EnvironmentObject var l:I18n;var body:some View{VStack(alignment:.leading,spacing:8){NavigationLink{TrackDetail(t:t)}label:{VStack(alignment:.leading){Text(t.title).font(.headline);Text(t.artistName+(t.album.map{" · "+$0} ?? "")).font(.subheadline)}};Text("\(l.t("rights")): \(t.rights.basis) · \(l.t("provenance")): \(t.provenance["audio"] ?? "")").font(.caption).foregroundStyle(.secondary);HStack{Button(l.t("play")){m.play(t)};Button(l.t("favorite")){m.favorite(t.id)};Button(l.t("add_queue")){m.enqueue(t.id)};Button(l.t("download")){m.download(t.id)}}}.accessibilityElement(children:.contain).padding(.vertical,6)}}
struct HomeView:View{@EnvironmentObject var m:MusicModel;@EnvironmentObject var l:I18n;@Environment(\.openURL)var openURL;var body:some View{NavigationStack{List{if m.filtered.isEmpty{ContentUnavailableView(l.t("empty_catalog"),systemImage:"music.note",description:Text(l.t("retry")))}else{ForEach(m.filtered){TrackRow(t:$0)}}}.searchable(text:$m.query,prompt:l.t("search_hint")).navigationTitle(l.t("app_name")).toolbar{Button(l.t("sign_in_wallet")){if let u=m.beginSignIn(){openURL(u)}}}.refreshable{await m.refresh()}}}}
struct LibraryView:View {
    @EnvironmentObject var m:MusicModel
    @EnvironmentObject var l:I18n
    @State private var playlistName=""
    @State private var editing:MusicPlaylist?
    @State private var operation:MusicOperation?
    var body:some View {
        NavigationStack {
            List {
                Section(l.t("favorites")){ForEach(m.state.favorites,id:\.self){Text($0)}}
                Section(l.t("queue")){ForEach(m.state.queue,id:\.self){Text($0)}}
                Section(l.t("download_ready")){ForEach(m.state.downloads.keys.sorted(),id:\.self){Text($0)}}
                Section(l.t("private_history")){ForEach(m.snapshot.listener.history){Text("\($0.trackId) · \($0.positionMillis) ms")}}
                Section(l.t("playlists")) {
                    if m.snapshot.playlists.isEmpty {Text(l.t("empty_playlists"))}
                    ForEach(m.snapshot.playlists){playlist in
                        Button(playlist.name) {
                            guard let captured=m.captureOperation() else{return}
                            Task {
                                guard let fresh=await m.perform(captured,{try await $0.playlist(playlist.id)}),m.isCurrent(captured) else{return}
                                operation=captured;editing=fresh
                            }
                        }
                    }
                    TextField(l.t("playlist_name"),text:$playlistName)
                    Button(l.t("save")) {
                        guard let captured=m.captureOperation() else{return}
                        let name=playlistName,ids=m.state.favorites
                        Task {
                            guard await m.perform(captured,{try await $0.createPlaylist(name:name,ids:ids)}) != nil,m.isCurrent(captured) else{return}
                            playlistName="";await m.refresh(captured)
                        }
                    }.disabled(playlistName.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty||m.state.favorites.isEmpty)
                }
            }.navigationTitle(l.t("library"))
        }
        .sheet(item:$editing){playlist in
            if let operation {MusicPlaylistEditor(initial:playlist,operation:operation)}
        }
        .onChange(of:m.viewGeneration){_ in editing=nil;operation=nil;playlistName=""}
    }
}

struct MusicPlaylistEditor:View {
    @EnvironmentObject var m:MusicModel
    @EnvironmentObject var l:I18n
    @Environment(\.dismiss) private var dismiss
    let operation:MusicOperation
    @State private var draft:MusicPlaylist
    @State private var saving=false
    @State private var failed=false
    init(initial:MusicPlaylist,operation:MusicOperation){self.operation=operation;_draft=State(initialValue:initial)}
    private func title(_ id:String)->String {m.snapshot.catalog.first(where:{$0.id==id})?.title ?? m.snapshot.creatorTracks.first(where:{$0.id==id})?.title ?? id}
    private func move(_ id:String,_ delta:Int){guard let index=draft.trackIds.firstIndex(of:id),draft.trackIds.indices.contains(index+delta) else{return};draft.trackIds.swapAt(index,index+delta)}
    var body:some View {
        NavigationStack {
            Form {
                TextField(l.t("playlist_name"),text:$draft.name)
                TextField(l.t("playlist_description"),text:Binding(get:{draft.description ?? ""},set:{draft.description=$0}))
                Section(l.t("queue")) {
                    ForEach(draft.trackIds,id:\.self){id in
                        VStack(alignment:.leading){
                            Text(title(id))
                            HStack {
                                Button(l.t("move_up")){move(id,-1)}.disabled(draft.trackIds.first==id)
                                Button(l.t("move_down")){move(id,1)}.disabled(draft.trackIds.last==id)
                                Button(l.t("remove_track"),role:.destructive){draft.trackIds.removeAll{$0==id}}
                            }.buttonStyle(.borderless)
                        }
                    }
                }
                Section(l.t("add_track")) {
                    ForEach(m.snapshot.catalog.filter{!draft.trackIds.contains($0.id)}){track in
                        Button(track.title){draft.trackIds.append(track.id)}
                    }
                }
                if failed {Text(l.t("playlist_save_failed")).foregroundStyle(.red)}
            }
            .disabled(saving||!m.isCurrent(operation))
            .navigationTitle(l.t("edit_playlist"))
            .toolbar {
                ToolbarItem(placement:.cancellationAction){Button(l.t("cancel")){dismiss()}}
                ToolbarItem(placement:.confirmationAction){Button(l.t("save")){save()}.disabled(saving||draft.name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty||!m.isCurrent(operation))}
            }
        }.interactiveDismissDisabled(saving)
        .onChange(of:m.viewGeneration){_ in dismiss()}
    }
    private func save(){
        guard m.isCurrent(operation),!saving else{return}
        let submitted=draft;saving=true;failed=false
        Task {
            guard await m.perform(operation,{try await $0.savePlaylist(submitted)}) != nil else{saving=false;failed=true;return}
            guard let readback=await m.perform(operation,{try await $0.playlist(submitted.id)}),m.isCurrent(operation) else{saving=false;failed=true;return}
            guard readback.name==submitted.name,(readback.description ?? "")== (submitted.description ?? ""),readback.trackIds==submitted.trackIds else{saving=false;failed=true;return}
            await m.refresh(operation)
            guard m.isCurrent(operation) else{return}
            saving=false;dismiss()
        }
    }
}

struct CreatorView:View{@EnvironmentObject var m:MusicModel;@EnvironmentObject var l:I18n;@Environment(\.openURL)var openURL;@State var importing=false;@State var importOperation:MusicOperation?;@State var title="";@State var artist="";@State var evidence="";@State var provenance="";@State var proposal:AIProposal?;@State var proposalOperation:MusicOperation?;@State var aiStatus="";var body:some View{NavigationStack{Form{Text(l.t("creator_truth"));TextField(l.t("track_title"),text:$title);TextField(l.t("artist_name"),text:$artist);TextField(l.t("rights_evidence"),text:$evidence);TextField(l.t("provenance"),text:$provenance);Button(l.t("upload_owned_audio")){importOperation=m.captureOperation();importing=importOperation != nil}.fileImporter(isPresented:$importing,allowedContentTypes:[.wav]){result in guard let operation=importOperation,m.isCurrent(operation) else{return};importOperation=nil;if case .success(let url)=result{let title=title,artist=artist,evidence=evidence,provenance=provenance;Task{let access=url.startAccessingSecurityScopedResource();defer{if access{url.stopAccessingSecurityScopedResource()}};guard await m.perform(operation,{try await $0.uploadOwnedWAV(url,title:title,artist:artist,evidence:evidence,provenance:provenance)}) != nil else{return};await m.refresh(operation)}}};Section(l.t("creator")){ForEach(m.snapshot.creatorTracks){track in HStack{Text(track.title+" · "+track.rights.basis);Spacer();if !m.snapshot.catalog.contains(where:{$0.id==track.id}){Button(l.t("upload")){guard let operation=m.captureOperation() else{return};Task{guard await m.perform(operation,{try await $0.release(track.id)}) != nil else{return};await m.refresh(operation)}}}}}};Section(l.t("usage_records")){Text(l.number(m.snapshot.usage.count));Text("YNX Pay: \(l.number(m.snapshot.settlements.count)) · YNX Trust: \(l.number(m.snapshot.cases.count))")};Text(l.t("revenue_truth")).font(.footnote);ForEach(m.snapshot.allocations){allocation in Button("YNX Pay · \(allocation.amountMicros) µYNXT"){guard let operation=m.captureOperation() else{return};let payTo=operation.account.account;Task{if let settlement=await m.perform(operation,{try await $0.settlement(allocation.id,payTo:payTo)}),m.isCurrent(operation),let url=URL(string:settlement.reviewUri){openURL(url)};await m.refresh(operation)}}};Button(l.t("ai_enabled")){guard m.state.aiEnabled,let operation=m.captureOperation() else{return};let ids=m.state.favorites,language=l.aiLanguage == "system" ? l.resolved : l.aiLanguage;Task{guard let result=await m.perform(operation,{try await $0.createAI(ids:ids,language:language)}),m.isCurrent(operation) else{return};proposal=result;proposalOperation=operation;aiStatus="YNX AI · \(result.status) · \(result.estimatedUnits) units\n\(result.result ?? "")"}}.disabled(!m.state.aiEnabled||m.state.favorites.isEmpty);if let proposal{HStack{Button(l.t("upload")){guard let operation=proposalOperation,m.isCurrent(operation) else{return};Task{guard await m.perform(operation,{try await $0.reviewAI(id:proposal.id,action:"apply")}) != nil else{return};self.proposal=nil;proposalOperation=nil;await m.refresh(operation)}};Button(l.t("cancel"),role:.destructive){guard let operation=proposalOperation,m.isCurrent(operation) else{return};Task{guard await m.perform(operation,{try await $0.reviewAI(id:proposal.id,action:"reject")}) != nil else{return};self.proposal=nil;proposalOperation=nil;await m.refresh(operation)}}}};Text(aiStatus.isEmpty ? l.t("ai_explanation"):aiStatus).font(.footnote)}.navigationTitle(l.t("creator"))}}}
struct SettingsView:View{@EnvironmentObject var m:MusicModel;@EnvironmentObject var l:I18n;@State private var clearing=false;@State private var clearOperation:MusicOperation?;var body:some View{NavigationStack{Form{Section{NavigationLink(destination:CreatorView()){Label(l.t("creator"),systemImage:"waveform")};Text(l.t("creator_truth")).font(.footnote).foregroundStyle(.secondary)};Picker(l.t("language"),selection:Binding(get:{l.tag},set:l.set)){Text("System").tag("system");ForEach(["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"],id:\.self){Text($0).tag($0)}};Section(l.t("profile")){Toggle(l.t("explicit_content"),isOn:Binding(get:{m.snapshot.profile.explicitAllowed},set:{m.setProfile(explicit:$0,privateHistory:m.snapshot.profile.privateHistory)}));Toggle(l.t("private_history"),isOn:Binding(get:{m.snapshot.profile.privateHistory},set:{m.setProfile(explicit:m.snapshot.profile.explicitAllowed,privateHistory:$0)}))};Toggle(l.t("ai_enabled"),isOn:Binding(get:{m.state.aiEnabled},set:m.setAI));Picker(l.t("ai_output_language"),selection:Binding(get:{l.aiLanguage},set:l.setAI)){Text("System").tag("system");ForEach(["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"],id:\.self){Text($0).tag($0)}};Text(l.t("ai_explanation"));Button(l.t("sign_out")){m.signOut()}.disabled(!m.canSignOut);Button(l.t("clear_private_data"),role:.destructive){clearOperation=m.captureOperation();clearing=clearOperation != nil}.disabled(!m.signedIn).confirmationDialog(l.t("clear_confirm"),isPresented:$clearing,titleVisibility:.visible){Button(l.t("clear_private_data"),role:.destructive){if let operation=clearOperation{m.clearPrivate(operation)};clearOperation=nil};Button(l.t("cancel"),role:.cancel){clearOperation=nil}}}.navigationTitle(l.t("settings"))}}}

@main struct YNXMusicApp:App{@StateObject var model=MusicModel();@StateObject var l=I18n.shared;var body:some Scene{WindowGroup{TabView{HomeView().tabItem{Label(l.t("home"),systemImage:"music.note.house")};LibraryView().tabItem{Label(l.t("library"),systemImage:"books.vertical")};SettingsView().tabItem{Label(l.t("settings"),systemImage:"gear")}}.environmentObject(model).environmentObject(l).environment(\.locale,Locale(identifier:l.resolved)).environment(\.layoutDirection,l.rtl ? .rightToLeft:.leftToRight).tint(Color(red:0,green:47/255,blue:167/255)).onOpenURL{model.acceptCallback($0)}.id(model.viewGeneration)}}}
