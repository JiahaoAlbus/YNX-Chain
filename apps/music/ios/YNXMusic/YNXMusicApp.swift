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

enum MusicSnapshotReadState:String {case unread,loading,ready,failed}

@MainActor final class MusicModel:ObservableObject {
    @Published var snapshot=Snapshot()
    @Published private(set) var snapshotReadState=MusicSnapshotReadState.unread
    private var snapshotContext:MusicSessionContext?
    @Published var state=LocalState()
    @Published var status="loading"
    @Published var query=""
    @Published private(set) var viewGeneration=UUID()
    private let fence:MusicSessionFence
    private let store:MusicAccountStore
    private var account:MusicAccountContext?
    private var api:MusicAPI
    private var native:MusicNativeEngine?
    private let makeNative: @MainActor () throws -> MusicNativeEngine
    private var authRevision:UInt64=0
    private var snapshotReadGeneration:UInt64=0
    private let nativeNegativeRead: () -> Bool
    private let nativeNegativeWrite: (Bool) -> Void
    @Published var authBusy=false
    @Published var revokePending=false
    let player:NativePlayer

    init(makeNative: @escaping @MainActor () throws -> MusicNativeEngine = MusicNativeEngine.live,storeRoot:URL?=nil,autoRestore:Bool=true,systemMediaControls:Bool=true,renderLocal:((Track,URL,Double)->Void)?=nil,nativeNegativeRead: @escaping () -> Bool = {UserDefaults.standard.bool(forKey:"music-native-session-disabled-v2")},nativeNegativeWrite: @escaping (Bool) -> Void = {UserDefaults.standard.set($0,forKey:"music-native-session-disabled-v2")}) {
        self.nativeNegativeRead=nativeNegativeRead;self.nativeNegativeWrite=nativeNegativeWrite
        self.makeNative=makeNative;self.player=NativePlayer(systemControls:systemMediaControls,renderLocal:renderLocal)
        let fence=MusicSessionFence(binding:nil)
        self.fence=fence
        let root=storeRoot ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
        store=MusicAccountStore(root:root)
        api=MusicAPI(context:fence.capture(),fence:fence,deviceKey:"")
        status="offline_mode"
        if autoRestore { Task { await restoreNative() } }
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
    var hasCurrentSnapshot:Bool { guard let snapshotContext else{return false};return snapshotContext==api.context && fence.isCurrent(snapshotContext) && account != nil }
    func retrySnapshot()async {if api.context.binding != nil {await refresh()}else{await restoreNative()}}
    var signedIn:Bool { captureOperation() != nil }
    var canSignOut:Bool { api.context.binding != nil || revokePending }
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
        snapshotReadGeneration &+= 1;let readGeneration=snapshotReadGeneration
        status="loading";snapshotReadState = .loading
        do {
            let received=try await requestAPI.snapshot()
            guard fence.isCurrent(context),readGeneration==snapshotReadGeneration else { return }
            // A server identity change under the same binding is not a switch
            // instruction; it requires a fresh authorization.
            if let account,account.account != received.profile.account { throw URLError(.userAuthenticationRequired) }
            let (selected,cached)=try store.select(verifiedAccount:received.profile.account)
            var candidate=account != selected ? cached : state
            candidate.favorites=received.listener.favorites
            candidate.queue=received.listener.queue
            // Availability is local and verified; remote download markers must
            // not claim that a file exists in this account's device directory.
            candidate.downloads=Dictionary(uniqueKeysWithValues:received.catalog.compactMap { track in
                ((try? store.audioURL(track:track,for:selected)) ?? nil) == nil ? nil : (track.id,"available")
            })
            try store.save(candidate,for:selected)
            account=selected;state=candidate;snapshot=received;snapshotContext=context;snapshotReadState = .ready;status="ready"
        } catch {
            guard fence.isCurrent(context),readGeneration==snapshotReadGeneration else { return }
            if (error as? URLError)?.code == .userAuthenticationRequired { signOut(); status="auth_rejected" }
            else { snapshotReadState = .failed;status="offline_mode" }
        }
    }
    private func engine() throws -> MusicNativeEngine {
        if let native { return native }
        let created=try makeNative();native=created
        created.onChange={ [weak self,weak created] in
            guard let self,let created,self.native === created else { return }
            if created.identity==nil { self.withdraw() }
        }
        return created
    }
    private func withdraw() {
        snapshotReadGeneration &+= 1;snapshotContext=nil;snapshotReadState = .unread
        player.stop();let context=fence.replace(binding:nil)
        api=MusicAPI(context:context,fence:fence,deviceKey:"",native:native)
        store.detach();account=nil;state=LocalState();snapshot=Snapshot();query="";viewGeneration=UUID()
    }
    private func installNative(_ engine:MusicNativeEngine) async {
        guard let identity=engine.identity else { status="offline_mode";return }
        let context=fence.replace(binding:identity.binding)
        api=MusicAPI(context:context,fence:fence,deviceKey:identity.context.deviceKey,native:engine)
        await refresh(api:api,context:context)
    }
    func restoreNative() async {
        guard !authBusy else { return };authRevision &+= 1;let revision=authRevision;authBusy=true;defer{if revision==authRevision {authBusy=false}}
        do {
            let active=try engine()
            if nativeNegativeRead() {
                withdraw();revokePending=true;let reply=try await active.dispatch("disconnect")
                guard revision==authRevision else {return}
                if ["disconnected","expired"].contains(reply["status"] as? String ?? "") {nativeNegativeWrite(false);revokePending=false};status="offline_mode";return
            }
            let reply=try await active.dispatch("restore");guard revision==authRevision else { return };revokePending=reply["revocationPending"] as? Bool ?? false;await installNative(active) }
        catch { if revision==authRevision {status="retry"} }
    }
    func beginSignIn() async {
        guard !authBusy,!revokePending else { return };authRevision &+= 1;let revision=authRevision;authBusy=true;defer{if revision==authRevision {authBusy=false}}
        do {
            nativeNegativeWrite(true);withdraw();let active=try engine();try active.retireLocally();revokePending=true
            let retired=try await active.dispatch("disconnect")
            guard revision==authRevision else { return }
            guard ["disconnected","expired"].contains(retired["status"] as? String ?? "") else { status="retry";return }
            nativeNegativeWrite(false);revokePending=false;_ = try await active.dispatch("connect");if revision==authRevision {status="loading"}
        } catch { if revision==authRevision {status="retry"} }
    }
    func acceptCallback(_ url:URL) {
        guard !nativeNegativeRead(),url.scheme=="ynxmusic",url.host=="auth",url.path=="/callback",url.user==nil,url.password==nil,url.port==nil,url.fragment==nil,url.absoluteString.count<=32768 else { return }
        authRevision &+= 1;let revision=authRevision;authBusy=true
        Task { @MainActor in
            defer{if revision==authRevision {authBusy=false}}
            do { let active=try engine();_ = try await active.dispatch("handleReturn",["url":url.absoluteString]);guard revision==authRevision else {return};await installNative(active) }
            catch { if revision==authRevision {status="retry"} }
        }
    }
    func signOut() {
        authRevision &+= 1;let revision=authRevision;authBusy=false;nativeNegativeWrite(true)
        do { try native?.retireLocally() } catch { if revision==authRevision {status="retry"} }
        withdraw();revokePending=true
        Task { @MainActor in
            do { let active=try engine(),reply=try await active.dispatch("disconnect");guard revision==authRevision else {return};revokePending = !["disconnected","expired"].contains(reply["status"] as? String ?? "");if !revokePending {nativeNegativeWrite(false)};status=revokePending ? "retry":"offline_mode" }
            catch { if revision==authRevision {status="retry"} }
        }
    }
    func suspendNative() { authRevision &+= 1;authBusy=false;withdraw();native?.suspend() }
    private var playbackSelection=UUID()
    @discardableResult func play(_ track:Track)->Task<Void,Never>? {
        guard let operation=captureOperation(),snapshot.catalog.contains(where:{$0.id==track.id}) else { return nil }
        let selection=UUID();playbackSelection=selection
        if let url=(try? store.audioURL(track:track,for:operation.account)) ?? nil {
            player.play(track:track,url:url,position:state.trackId==track.id ? state.position:0,context:operation.session,fence:fence);return nil
        }
        return Task { @MainActor in
            guard let data=await perform(operation,{try await $0.download(track)}),isCurrent(operation),playbackSelection==selection else { return }
            do {
                let url=try store.storeAudio(data,track:track,for:operation.account)
                guard isCurrent(operation),playbackSelection==selection else { return }
                state.downloads[track.id]="available";saveLocal()
                player.play(track:track,url:url,position:state.trackId==track.id ? state.position:0,context:operation.session,fence:fence)
            } catch { if isCurrent(operation) { status="retry" } }
        }
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
    @Published private var playlistCreationGeneration:UUID?
    @Published private var uploadGeneration:UUID?
    var uploading:Bool {uploadGeneration==viewGeneration}
    func prepareUpload(_ operation:MusicOperation,url:URL,title:String,artist:String,evidence:String,provenance:String)->Bool {
        guard isCurrent(operation),!uploading,state.uploadIntent==nil else{return false}
        let values=[title,artist,evidence,provenance].map{$0.trimmingCharacters(in:.whitespacesAndNewlines)}
        guard values.allSatisfy({!$0.isEmpty && $0.count<=1000}),values[0].count<=120,values[1].count<=120 else{status="retry";return false}
        do {
            guard let stream=InputStream(url:url) else{throw URLError(.cannotOpenFile)}
            stream.open();defer{stream.close()};var data=Data(),buffer=[UInt8](repeating:0,count:32768)
            while true {let n=stream.read(&buffer,maxLength:buffer.count);if n<0{throw stream.streamError ?? URLError(.cannotOpenFile)};if n==0{break};guard data.count+n<=50*1024*1024 else{throw URLError(.dataLengthExceedsMaximum)};data.append(contentsOf:buffer.prefix(n))}
            let intent=MusicUploadIntent(key:"music-upload-\(UUID().uuidString)",title:values[0],artist:values[1],evidence:values[2],provenance:values[3],audioSHA256:MusicNativeState.hash(data))
            try store.stageUpload(data,intent:intent,for:operation.account)
            var candidate=state;candidate.uploadIntent=intent;try store.save(candidate,for:operation.account);state=candidate;return true
        }catch{if isCurrent(operation){status="retry"};return false}
    }
    func retryUpload(_ operation:MusicOperation)async->Bool {
        guard isCurrent(operation),!uploading,let intent=state.uploadIntent else{return false}
        let generation=viewGeneration;uploadGeneration=generation;defer{if uploadGeneration==generation{uploadGeneration=nil}}
        let bytes:Data
        do {bytes=try store.uploadData(intent,for:operation.account)}catch{status="retry";return false}
        guard await perform(operation,{try await $0.onboard(intent.artist)}) != nil else{return false}
        guard let track=await perform(operation,{try await $0.uploadOwnedWAV(bytes,intent:intent)}),track.owner==operation.account.account else{return false}
        // A transport receipt alone does not clear a durable operation. Verify
        // the exact content in the original current-account business projection.
        guard let readback=await perform(operation,{try await $0.snapshot()}),readback.profile.account==operation.account.account,readback.creatorTracks.contains(where:{$0.id==track.id && $0.owner==operation.account.account && $0.audioSha256==intent.audioSHA256}),isCurrent(operation),state.uploadIntent==intent else{status="retry";return false}
        var acknowledged=state;acknowledged.uploadIntent=nil
        do {try store.save(acknowledged,for:operation.account);state=acknowledged}catch{status="retry";return false}
        // Keep the staged bytes for recovery; only explicit private-data clear
        // removes them, together with this account's other private content.
        await refresh(operation);return isCurrent(operation)
    }
    func discardUpload(_ operation:MusicOperation) {
        guard isCurrent(operation),!uploading else{return}
        var candidate=state;candidate.uploadIntent=nil
        do{try store.save(candidate,for:operation.account);state=candidate}catch{status="retry"}
    }
    var creatingPlaylist:Bool {playlistCreationGeneration==viewGeneration}
    func createPlaylist(_ operation:MusicOperation,name:String)async->Bool {
        guard isCurrent(operation),!creatingPlaylist else{return false}
        let generation=viewGeneration;playlistCreationGeneration=generation
        defer{if playlistCreationGeneration==generation{playlistCreationGeneration=nil}}
        var candidate=state
        if candidate.playlistCreation==nil {
            guard !name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,!state.favorites.isEmpty else{return false}
            candidate.playlistCreation=PlaylistCreation(key:"music-playlist-\(UUID().uuidString)",name:name,trackIds:state.favorites)
        }
        guard let pending=candidate.playlistCreation else{return false}
        do{try store.save(candidate,for:operation.account);state=candidate}catch{status="playlist_save_failed";return false}
        guard await perform(operation,{try await $0.createPlaylist(name:pending.name,ids:pending.trackIds,key:pending.key)}) != nil,isCurrent(operation) else{return false}
        // Clear only this acknowledged intent. Other local private content and
        // any later server-side edits are retained.
        if state.playlistCreation?.key==pending.key {
            var acknowledged=state;acknowledged.playlistCreation=nil
            do{try store.save(acknowledged,for:operation.account);state=acknowledged}catch{status="playlist_save_failed";return false}
        }
        await refresh(operation);return isCurrent(operation)
    }
    func discardPlaylistCreation(_ operation:MusicOperation){
        guard isCurrent(operation) else{return}
        var candidate=state;candidate.playlistCreation=nil
        do{try store.save(candidate,for:operation.account);state=candidate}catch{status="playlist_save_failed"}
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
    private let systemControls:Bool
    private let renderLocal:((Track,URL,Double)->Void)?
    private var player:AVPlayer?
    private var observer:Any?
    private var completion:Any?
    private var generation=UUID()
    private var context:MusicSessionContext?
    private var fence:MusicSessionFence?
    var onPosition:((String,Double)->Void)?
    var onComplete:((String,Double)->Void)?

    init(systemControls:Bool=true,renderLocal:((Track,URL,Double)->Void)?=nil) {
        self.systemControls=systemControls;self.renderLocal=renderLocal
        guard systemControls else { return }
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
        if systemControls {MPNowPlayingInfoCenter.default().nowPlayingInfo=nil}
    }
    func play(track:Track,url:URL,position:Double,context:MusicSessionContext,fence:MusicSessionFence) {
        stop()
        guard fence.isCurrent(context),context.binding != nil,url.isFileURL else { return }
        self.context=context; self.fence=fence
        let playGeneration=generation
        if let renderLocal {renderLocal(track,url,position);return}
        let asset=AVURLAsset(url:url)
        let item=AVPlayerItem(asset:asset)
        player=AVPlayer(playerItem:item)
        if position>0 { player?.seek(to:CMTime(seconds:position,preferredTimescale:1000)) }
        player?.play()
        if systemControls {MPNowPlayingInfoCenter.default().nowPlayingInfo=[MPMediaItemPropertyTitle:track.title,MPMediaItemPropertyArtist:track.artistName,MPMediaItemPropertyPlaybackDuration:Double(track.durationMillis)/1000]}
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
struct MusicSnapshotNotice:View {
    @EnvironmentObject var m:MusicModel
    @EnvironmentObject var l:I18n
    var body:some View {
        VStack(alignment:.leading,spacing:12) {
            if m.snapshotReadState == .loading || m.authBusy {ProgressView(l.t("loading"))}
            else if m.snapshotReadState == .failed {Text(l.t("offline_mode"))}
            else if !m.hasCurrentSnapshot {Text(l.t("sign_in_wallet"))}
            if m.snapshotReadState != .loading && !m.authBusy {Button(l.t("retry")){Task{await m.retrySnapshot()}}}
        }.padding(.vertical,8)
    }
}
struct HomeView:View {
    @EnvironmentObject var m:MusicModel
    @EnvironmentObject var l:I18n
    var body:some View {
        NavigationStack {
            List {
                if !m.hasCurrentSnapshot {MusicSnapshotNotice()}
                else {
                    if m.snapshotReadState != .ready {MusicSnapshotNotice()}
                    if m.filtered.isEmpty {ContentUnavailableView(l.t(m.snapshot.catalog.isEmpty ? "empty_catalog":"no_search_results"),systemImage:"music.note")}
                    else {ForEach(m.filtered){TrackRow(t:$0)}}
                }
            }.searchable(text:$m.query,prompt:l.t("search_hint")).navigationTitle(l.t("app_name"))
            .toolbar{Button(l.t("sign_in_wallet")){Task{await m.beginSignIn()}}.disabled(m.authBusy || m.revokePending)}
            .refreshable{await m.retrySnapshot()}
        }
    }
}
struct LibraryView:View {
    @EnvironmentObject var m:MusicModel
    @EnvironmentObject var l:I18n
    @State private var playlistName=""
    @State private var discardCreation=false
    @State private var discardOperation:MusicOperation?
    @State private var editing:MusicPlaylist?
    @State private var operation:MusicOperation?
    var body:some View {
        NavigationStack {
            List {
                if !m.hasCurrentSnapshot {MusicSnapshotNotice()}else{
                if m.snapshotReadState != .ready {MusicSnapshotNotice()}
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
                    TextField(l.t("playlist_name"),text:Binding(get:{m.state.playlistCreation?.name ?? playlistName},set:{playlistName=$0})).disabled(m.state.playlistCreation != nil||m.creatingPlaylist)
                    if m.state.playlistCreation != nil {Text(l.t("playlist_pending"));Button(l.t("new_playlist")){discardOperation=m.captureOperation();discardCreation=discardOperation != nil}.disabled(m.creatingPlaylist)}
                    Button(l.t("save")) {
                        guard let captured=m.captureOperation() else{return}
                        let name=playlistName
                        Task {if await m.createPlaylist(captured,name:name),m.isCurrent(captured){playlistName=""}}
                    }.disabled(m.creatingPlaylist||(m.state.playlistCreation==nil&&(playlistName.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty||m.state.favorites.isEmpty)))
                }
                }
            }.navigationTitle(l.t("library")).refreshable{await m.retrySnapshot()}
        }
        .alert(l.t("new_playlist"),isPresented:$discardCreation){Button(l.t("cancel"),role:.cancel){};Button(l.t("new_playlist"),role:.destructive){if let operation=discardOperation{m.discardPlaylistCreation(operation)}}}message:{Text(l.t("playlist_pending"))}
        .sheet(item:$editing){playlist in
            if let operation {MusicPlaylistEditor(initial:playlist,operation:operation)}
        }
        .onChange(of:m.viewGeneration){_ in editing=nil;operation=nil;playlistName="";discardCreation=false;discardOperation=nil}
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
            .disabled(saving || !m.isCurrent(operation))
            .navigationTitle(l.t("edit_playlist"))
            .toolbar {
                ToolbarItem(placement:.cancellationAction){Button(l.t("cancel")){dismiss()}}
                ToolbarItem(placement:.confirmationAction){Button(l.t("save")){save()}.disabled(saving||draft.name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || !m.isCurrent(operation))}
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
            guard readback.name==submitted.name,(readback.description ?? "") == (submitted.description ?? ""),readback.trackIds==submitted.trackIds else{saving=false;failed=true;return}
            await m.refresh(operation)
            guard m.isCurrent(operation) else{return}
            saving=false;dismiss()
        }
    }
}

struct CreatorView:View{@EnvironmentObject var m:MusicModel;@EnvironmentObject var l:I18n;@Environment(\.openURL)var openURL;@State var importing=false;@State var cancellingUpload=false;@State var cancelUploadOperation:MusicOperation?;@State var importOperation:MusicOperation?;@State var title="";@State var artist="";@State var evidence="";@State var provenance="";@State var proposal:AIProposal?;@State var proposalOperation:MusicOperation?;@State var aiStatus="";var body:some View{NavigationStack{Form{if !m.hasCurrentSnapshot{MusicSnapshotNotice()}else{if m.snapshotReadState != .ready{MusicSnapshotNotice()};Text(l.t("creator_truth"));TextField(l.t("track_title"),text:$title);TextField(l.t("artist_name"),text:$artist);TextField(l.t("rights_evidence"),text:$evidence);TextField(l.t("provenance"),text:$provenance);if let intent=m.state.uploadIntent {Text(intent.title+" · "+intent.artist);Button(l.t("retry")){guard let operation=m.captureOperation() else{return};Task{_ = await m.retryUpload(operation)}}.disabled(m.uploading);Button(l.t("cancel")){cancelUploadOperation=m.captureOperation();cancellingUpload=cancelUploadOperation != nil}.disabled(m.uploading)};Button(l.t("upload_owned_audio")){importOperation=m.captureOperation();importing=importOperation != nil}.disabled(m.uploading || m.state.uploadIntent != nil || !m.signedIn).fileImporter(isPresented:$importing,allowedContentTypes:[.wav]){result in guard let operation=importOperation,m.isCurrent(operation) else{return};importOperation=nil;if case .success(let url)=result{let title=title,artist=artist,evidence=evidence,provenance=provenance;Task{let access=url.startAccessingSecurityScopedResource();defer{if access{url.stopAccessingSecurityScopedResource()}};guard m.prepareUpload(operation,url:url,title:title,artist:artist,evidence:evidence,provenance:provenance) else{return};_ = await m.retryUpload(operation)}}};Section(l.t("creator")){ForEach(m.snapshot.creatorTracks){track in HStack{Text(track.title+" · "+track.rights.basis);Spacer();if !m.snapshot.catalog.contains(where:{$0.id==track.id}){Button(l.t("upload")){guard let operation=m.captureOperation() else{return};Task{guard await m.perform(operation,{try await $0.release(track.id)}) != nil else{return};await m.refresh(operation)}}}}}};Section(l.t("usage_records")){Text(l.number(m.snapshot.usage.count));Text("YNX Pay: \(l.number(m.snapshot.settlements.count)) · YNX Trust: \(l.number(m.snapshot.cases.count))")};Text(l.t("revenue_truth")).font(.footnote);ForEach(m.snapshot.allocations){allocation in Button("YNX Pay · \(allocation.amountMicros) µYNXT"){guard let operation=m.captureOperation() else{return};let payTo=operation.account.account;Task{if let settlement=await m.perform(operation,{try await $0.settlement(allocation.id,payTo:payTo)}),m.isCurrent(operation),let url=URL(string:settlement.reviewUri){openURL(url)};await m.refresh(operation)}}};Button(l.t("ai_enabled")){guard m.state.aiEnabled,let operation=m.captureOperation() else{return};let ids=m.state.favorites,language=l.aiLanguage == "system" ? l.resolved : l.aiLanguage;Task{guard let result=await m.perform(operation,{try await $0.createAI(ids:ids,language:language)}),m.isCurrent(operation) else{return};proposal=result;proposalOperation=operation;aiStatus="YNX AI · \(result.status) · \(result.estimatedUnits) units\n\(result.result ?? "")"}}.disabled(!m.state.aiEnabled||m.state.favorites.isEmpty);if let proposal{HStack{Button(l.t("upload")){guard let operation=proposalOperation,m.isCurrent(operation) else{return};Task{guard await m.perform(operation,{try await $0.reviewAI(id:proposal.id,action:"apply")}) != nil else{return};self.proposal=nil;proposalOperation=nil;await m.refresh(operation)}};Button(l.t("cancel"),role:.destructive){guard let operation=proposalOperation,m.isCurrent(operation) else{return};Task{guard await m.perform(operation,{try await $0.reviewAI(id:proposal.id,action:"reject")}) != nil else{return};self.proposal=nil;proposalOperation=nil;await m.refresh(operation)}}}};Text(aiStatus.isEmpty ? l.t("ai_explanation"):aiStatus).font(.footnote)}}.navigationTitle(l.t("creator")).confirmationDialog(l.t("cancel_upload_draft"),isPresented:$cancellingUpload,titleVisibility:.visible){Button(l.t("cancel_upload"),role:.destructive){if let operation=cancelUploadOperation{m.discardUpload(operation)};cancelUploadOperation=nil};Button(l.t("cancel"),role:.cancel){cancelUploadOperation=nil}}}}}
struct SettingsView:View{@AppStorage("ynx.media.display.text") private var displayMode=1;@EnvironmentObject var m:MusicModel;@EnvironmentObject var l:I18n;@State private var clearing=false;@State private var clearOperation:MusicOperation?;var body:some View{NavigationStack{Form{Picker(musicDisplayLabels(l.resolved)[0],selection:$displayMode){ForEach(0..<3,id:\.self){Text(musicDisplayLabels(l.resolved)[$0+1]).tag($0)}};Section{NavigationLink(destination:CreatorView()){Label(l.t("creator"),systemImage:"waveform")};Text(l.t("creator_truth")).font(.footnote).foregroundStyle(.secondary)};Picker(l.t("language"),selection:Binding(get:{l.tag},set:l.set)){Text("System").tag("system");ForEach(["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"],id:\.self){Text($0).tag($0)}};Section(l.t("profile")){if !m.hasCurrentSnapshot{MusicSnapshotNotice()}else{Toggle(l.t("explicit_content"),isOn:Binding(get:{m.snapshot.profile.explicitAllowed},set:{m.setProfile(explicit:$0,privateHistory:m.snapshot.profile.privateHistory)}));Toggle(l.t("private_history"),isOn:Binding(get:{m.snapshot.profile.privateHistory},set:{m.setProfile(explicit:m.snapshot.profile.explicitAllowed,privateHistory:$0)}))}};Toggle(l.t("ai_enabled"),isOn:Binding(get:{m.state.aiEnabled},set:m.setAI));Picker(l.t("ai_output_language"),selection:Binding(get:{l.aiLanguage},set:l.setAI)){Text("System").tag("system");ForEach(["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"],id:\.self){Text($0).tag($0)}};Text(l.t("ai_explanation"));Button(l.t("sign_out")){m.signOut()}.disabled(!m.canSignOut);Button(l.t("clear_private_data"),role:.destructive){clearOperation=m.captureOperation();clearing=clearOperation != nil}.disabled(!m.signedIn).confirmationDialog(l.t("clear_confirm"),isPresented:$clearing,titleVisibility:.visible){Button(l.t("clear_private_data"),role:.destructive){if let operation=clearOperation{m.clearPrivate(operation)};clearOperation=nil};Button(l.t("cancel"),role:.cancel){clearOperation=nil}}}.navigationTitle(l.t("settings"))}}}

@main struct YNXMusicApp:App{@AppStorage("ynx.media.display.text") private var displayMode=1;@ScaledMetric(relativeTo:.body) private var displayPoints:CGFloat=15;private var displayScale:CGFloat {[0.9333333,1,1.1333333][max(0,min(displayMode,2))]};@Environment(\.scenePhase) private var scenePhase;@StateObject var model=MusicModel();@StateObject var l=I18n.shared;var body:some Scene{WindowGroup{VStack(spacing:0){HStack(spacing:12){Image("ynx-brand-original").resizable().scaledToFit().frame(width:46,height:24).padding(4).background(Color.white).clipShape(RoundedRectangle(cornerRadius:6)).accessibilityLabel("YNX");Text(l.t("app_name")).font(.headline.bold());Spacer()}.environment(\.layoutDirection,.leftToRight).padding(.horizontal).padding(.vertical,8);TabView{HomeView().tabItem{Label(l.t("home"),systemImage:"music.note.house")};LibraryView().tabItem{Label(l.t("library"),systemImage:"books.vertical")};SettingsView().tabItem{Label(l.t("settings"),systemImage:"gear")}}}.font(.system(size:displayPoints*displayScale)).environmentObject(model).environmentObject(l).environment(\.locale,Locale(identifier:l.resolved)).environment(\.layoutDirection,l.rtl ? .rightToLeft:.leftToRight).tint(Color(red:0,green:47/255,blue:167/255)).onOpenURL{model.acceptCallback($0)}.onChange(of:scenePhase){_,phase in if phase == .background { model.suspendNative() } else if phase == .active { Task{await model.restoreNative()} }}.id(model.viewGeneration)}}}

private func musicDisplayLabels(_ tag:String)->[String] {
 switch Locale(identifier:tag).languageCode ?? "en" {
 case "zh":return tag.contains("Hant") || tag.contains("TW") ? ["顯示與字級","緊湊","標準","較大"]:["显示与字号","紧凑","标准","较大"]
 case "ja":return ["表示と文字サイズ","小さめ","標準","大きめ"]
 case "ko":return ["화면 및 글자 크기","작게","표준","크게"]
 case "es":return ["Pantalla y texto","Compacto","Estándar","Grande"]
 case "fr":return ["Affichage et texte","Compact","Standard","Grand"]
 case "de":return ["Anzeige und Text","Kompakt","Standard","Größer"]
 case "pt":return ["Exibição e texto","Compacto","Padrão","Maior"]
 case "ru":return ["Вид и размер текста","Компактный","Обычный","Крупный"]
 case "ar":return ["العرض وحجم النص","صغير","قياسي","أكبر"]
 case "id":return ["Tampilan dan teks","Ringkas","Standar","Besar"]
 default:return ["Display and text size","Compact","Standard","Larger"]
 }
}
