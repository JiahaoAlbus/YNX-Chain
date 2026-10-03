import Foundation
import CryptoKit

struct Track: Codable, Identifiable { let id,title,artistName:String; var album:String?; var explicit:Bool; var durationMillis:Int; var rights:Rights; var provenance:[String:String]; var audioSha256:String?; var owner:String?=nil; var releaseState:String?=nil }
struct Rights:Codable { let basis,evidenceRef:String;let territories:[String] }
struct HistoryEntry:Codable,Identifiable{var id:String{trackId+"-"+String(positionMillis)};let trackId:String;let positionMillis:Int;let completed:Bool}
struct Listener:Codable{var favorites:[String]=[];var queue:[String]=[];var downloads:[String:String]=[:];var history:[HistoryEntry]=[]}
struct Profile:Codable{var account="";var displayName="";var bio:String?;var explicitAllowed=false;var privateHistory=true;var creatorStatus="listener"}
struct Allocation:Codable,Identifiable{let id:String;let amountMicros:Int}
struct Settlement:Codable,Identifiable{let id,status,reviewUri:String;let amountMicros:Int}
struct CaseRecord:Codable,Identifiable{let id,kind,status:String}
struct AIProposal:Codable,Identifiable{let id,kind,status:String;let estimatedUnits:Int;var result:String?}
struct MusicPlaylist:Codable,Identifiable { let id:String;var name:String;var description:String?;var trackIds:[String] }
struct Snapshot:Codable { var profile=Profile();var listener=Listener();var catalog:[Track]=[];var creatorTracks:[Track]=[];var usage:[Usage]=[];var allocations:[Allocation]=[];var settlements:[Settlement]=[];var cases:[CaseRecord]=[];var aiProposals:[AIProposal]=[];var playlists:[MusicPlaylist]=[] }
struct Usage:Codable,Identifiable{let id,trackId:String;let listenedMillis:Int}
struct PlaylistCreation:Codable {let key:String;let name:String;let trackIds:[String]}
struct MusicUploadIntent:Codable,Equatable { let key,title,artist,evidence,provenance,audioSHA256:String }
struct LocalState:Codable { var favorites:[String]=[];var queue:[String]=[];var downloads:[String:String]=[:];var trackId="";var position:Double=0;var aiEnabled=true;var playlistCreation:PlaylistCreation?;var uploadIntent:MusicUploadIntent? }


struct MusicSessionContext:Equatable, Sendable {
    let generation:UUID
    let binding:String?
}

// One in-memory authority for this process. Requests retain the original value;
// replacing the binding invalidates every older request, including guest login.
final class MusicSessionFence:@unchecked Sendable {
    private let lock=NSLock()
    private var value:MusicSessionContext
    init(binding:String?) { value=MusicSessionContext(generation:UUID(),binding:binding) }
    func capture()->MusicSessionContext { lock.lock(); defer{lock.unlock()}; return value }
    @discardableResult func replace(binding:String?)->MusicSessionContext {
        lock.lock(); defer{lock.unlock()}
        value=MusicSessionContext(generation:UUID(),binding:binding); return value
    }
    func isCurrent(_ context:MusicSessionContext)->Bool { lock.lock(); defer{lock.unlock()}; return value==context }
    func requireCurrent(_ context:MusicSessionContext,authenticated:Bool=false)throws {
        guard isCurrent(context) else { throw CancellationError() }
        if authenticated && context.binding == nil { throw URLError(.userAuthenticationRequired) }
    }
}

struct MusicAccountContext:Equatable {
    let account:String
    let generation:UUID
}
private struct MusicStoredState:Codable {
    let version:Int
    let account:String
    let state:LocalState
}

// Only a verified /api/me account may select a directory. The old global JSON
// and Offline directory carry no trustworthy account binding, so they are kept
// intact and never assigned to whichever account signs in first after upgrade.
final class MusicAccountStore {
    private let root:URL
    private let files=FileManager.default
    private let lock=NSLock()
    private var active:MusicAccountContext?
    init(root:URL) { self.root=root }
    static func accountKey(_ account:String)->String {
        SHA256.hash(data:Data(account.utf8)).map{String(format:"%02x",$0)}.joined()
    }
    static func validTrackID(_ id:String)->Bool {
        id.range(of:"^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$",options:.regularExpression) != nil
    }
    static func validateAudio(_ data:Data,expectedHash:String?)throws {
        guard data.count>44,data.count<=64*1024*1024,
              data.prefix(4)==Data("RIFF".utf8),data.subdata(in:8..<12)==Data("WAVE".utf8),
              let expectedHash,expectedHash.range(of:"^[0-9a-fA-F]{64}$",options:.regularExpression) != nil,
              SHA256.hash(data:data).map({String(format:"%02x",$0)}).joined()==expectedHash.lowercased()
        else { throw URLError(.cannotDecodeContentData) }
    }
    func select(verifiedAccount account:String)throws->(MusicAccountContext,LocalState) {
        guard !account.isEmpty,account.count<=512,!account.contains("\0") else { throw URLError(.userAuthenticationRequired) }
        lock.lock(); defer{lock.unlock()}
        if active?.account != account { active=MusicAccountContext(account:account,generation:UUID()) }
        let context=active!
        let file=directory(context).appendingPathComponent("music-state.json")
        guard files.fileExists(atPath:file.path) else { return (context,LocalState()) }
        let data=try Data(contentsOf:file)
        guard let stored=try? JSONDecoder().decode(MusicStoredState.self,from:data),
              stored.version==1,stored.account==account else {
            // Keep damaged or mismatched account records available for recovery
            // before a verified network snapshot is allowed to replace them.
            let recovery=directory(context).appendingPathComponent("music-state.recovery-\(UUID().uuidString).json")
            try files.copyItem(at:file,to:recovery)
            return (context,LocalState())
        }
        return (context,stored.state)
    }
    func detach() { lock.lock(); defer{lock.unlock()}; active=nil }
    func stageUpload(_ data:Data,intent:MusicUploadIntent,for context:MusicAccountContext)throws {
        try Self.validateAudio(data,expectedHash:intent.audioSHA256)
        guard data.count<=50*1024*1024 else {throw URLError(.dataLengthExceedsMaximum)}
        lock.lock();defer{lock.unlock()};try requireCurrent(context)
        let url=try uploadURL(intent,context);try files.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true)
        if files.fileExists(atPath:url.path) {guard try Data(contentsOf:url)==data else{throw URLError(.cannotDecodeContentData)};return}
        try data.write(to:url,options:.atomic)
    }
    func uploadData(_ intent:MusicUploadIntent,for context:MusicAccountContext)throws->Data {
        lock.lock();defer{lock.unlock()};try requireCurrent(context)
        let data=try Data(contentsOf:uploadURL(intent,context));try Self.validateAudio(data,expectedHash:intent.audioSHA256)
        guard data.count<=50*1024*1024 else{throw URLError(.dataLengthExceedsMaximum)};return data
    }
    private func uploadURL(_ intent:MusicUploadIntent,_ context:MusicAccountContext)throws->URL {
        guard intent.key.range(of:"^music-upload-[A-Fa-f0-9-]{36}$",options:.regularExpression) != nil else{throw URLError(.badURL)}
        return directory(context).appendingPathComponent("UploadDrafts",isDirectory:true).appendingPathComponent(intent.key+".wav")
    }
    func save(_ state:LocalState,for context:MusicAccountContext)throws {
        lock.lock(); defer{lock.unlock()}; try requireCurrent(context)
        let dir=directory(context); try files.createDirectory(at:dir,withIntermediateDirectories:true)
        let data=try JSONEncoder().encode(MusicStoredState(version:1,account:context.account,state:state))
        try data.write(to:dir.appendingPathComponent("music-state.json"),options:.atomic)
    }
    func audioURL(track:Track,for context:MusicAccountContext)throws->URL? {
        lock.lock(); defer{lock.unlock()}; try requireCurrent(context)
        guard Self.validTrackID(track.id) else { throw URLError(.badURL) }
        let url=directory(context).appendingPathComponent("Offline",isDirectory:true).appendingPathComponent("\(track.id).wav")
        guard let data=try? Data(contentsOf:url), (try? Self.validateAudio(data,expectedHash:track.audioSha256)) != nil else { return nil }
        return url
    }
    @discardableResult func storeAudio(_ data:Data,track:Track,for context:MusicAccountContext)throws->URL {
        try Self.validateAudio(data,expectedHash:track.audioSha256)
        lock.lock(); defer{lock.unlock()}; try requireCurrent(context)
        guard Self.validTrackID(track.id) else { throw URLError(.badURL) }
        let dir=directory(context).appendingPathComponent("Offline",isDirectory:true)
        try files.createDirectory(at:dir,withIntermediateDirectories:true)
        let url=dir.appendingPathComponent("\(track.id).wav")
        // Foundation's atomic writer preserves the previous complete file on
        // failure. No shared track.tmp or preemptive deletion is used.
        try data.write(to:url,options:.atomic)
        return url
    }
    func clear(_ context:MusicAccountContext)throws {
        lock.lock(); defer{lock.unlock()}; try requireCurrent(context)
        let dir=directory(context)
        for name in ["music-state.json","Offline","UploadDrafts"] {
            let url=dir.appendingPathComponent(name)
            if files.fileExists(atPath:url.path) { try files.removeItem(at:url) }
        }
        active=nil
    }
    private func requireCurrent(_ context:MusicAccountContext)throws {
        guard active==context else { throw CancellationError() }
    }
    private func directory(_ context:MusicAccountContext)->URL {
        root.appendingPathComponent("MusicAccounts",isDirectory:true).appendingPathComponent(Self.accountKey(context.account),isDirectory:true)
    }
}
