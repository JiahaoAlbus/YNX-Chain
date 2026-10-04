import Foundation
import Security

// Account-owned content, not a grant or signing namespace. Original UUID,
// positions, pending watch bodies and playlist request keys survive reopening.
@MainActor final class VideoViewerState {
    enum Failure: Error { case invalidState, changedRecord, capacity, unconfirmedWrite }
    struct Playback: Codable, Equatable { let playbackID: String; var position: Int }
    struct Watch: Codable, Equatable { let key,videoID,playbackID: String;let seconds: Int;let completed: Bool }
    struct Playlist: Codable, Equatable { let key,name: String }
    struct PlaylistOperation: Codable, Equatable { let key,action,playlistID: String;let videoID: String? }
    private struct Stored: Codable { let version: Int;let account: String;var resume: [String:Playback];var watchPending: [Watch];var playlistDraft: Playlist?;var playlistOperation: PlaylistOperation?;var playlistHistory: [Playlist]? }
    let account: String
    private let read: () throws -> Data?
    private let write: (Data) throws -> Void
    private let require: () throws -> Void
    private var poisoned=false
    static func live(_ engine: VideoNativeEngine,_ identity: VideoNativeEngine.Identity) throws -> VideoViewerState {
        let custody=try VideoNativeCustody(platform:identity.context.platform,viewerAccount:identity.account),epoch=engine.epoch
        return try VideoViewerState(account:identity.account,read:custody.read,write:custody.write,require:{try engine.require(identity,epoch)})
    }
    init(account: String,read: @escaping () throws -> Data?,write: @escaping (Data) throws -> Void,require: @escaping () throws -> Void) throws {
        guard VideoNativeState.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else { throw Failure.invalidState }
        self.account=account;self.read=read;self.write=write;self.require=require;_ = try load()
    }
    private func current() throws { guard !poisoned else { throw Failure.unconfirmedWrite };try require() }
    private func load() throws -> Stored {
        try current();guard let data=try read() else { return Stored(version:1,account:account,resume:[:],watchPending:[],playlistDraft:nil,playlistOperation:nil,playlistHistory:nil) }
        guard data.count<=524288,let shape=try JSONSerialization.jsonObject(with:data) as? [String:Any],Set(shape.keys).subtracting(["version","account","resume","watchPending","playlistDraft","playlistOperation","playlistHistory"]).isEmpty else { throw Failure.invalidState }
        guard let resume=shape["resume"] as? [String:Any],let pending=shape["watchPending"] as? [[String:Any]] else { throw Failure.invalidState }
        for raw in resume.values { guard let row=raw as? [String:Any],Set(row.keys)==Set(["playbackID","position"]) else { throw Failure.invalidState } }
        for row in pending { guard Set(row.keys)==Set(["key","videoID","playbackID","seconds","completed"]) else { throw Failure.invalidState } }
        if let raw=shape["playlistDraft"],!(raw is NSNull) { guard let draft=raw as? [String:Any],Set(draft.keys)==Set(["key","name"]) else { throw Failure.invalidState } }
        if let raw=shape["playlistHistory"],!(raw is NSNull) { guard let rows=raw as? [[String:Any]],rows.allSatisfy({Set($0.keys)==Set(["key","name"])}) else { throw Failure.invalidState } }
        if let raw=shape["playlistOperation"],!(raw is NSNull) {
            guard let row=raw as? [String:Any],Set(row.keys).subtracting(["key","action","playlistID","videoID"]).isEmpty else { throw Failure.invalidState }
        }
        let stored=try JSONDecoder().decode(Stored.self,from:data)
        try validate(stored);try current();return stored
    }
    private func save(_ state: Stored) throws {
        try current();try validate(state);let bytes=try JSONEncoder().encode(state);guard bytes.count<=524288 else { throw Failure.capacity }
        do { try write(bytes);guard try read()==bytes else { throw Failure.unconfirmedWrite };try current() }
        catch { poisoned=true;throw error }
    }
    private func validate(_ value: Stored) throws {
        guard value.version==1,value.account==account,value.watchPending.count<=4096 else { throw Failure.invalidState }
        for (id,row) in value.resume { guard Self.validID(id),Self.uuid(row.playbackID),row.position>=0,row.position<=2_147_483_647 else { throw Failure.invalidState } }
        var keys=Set<String>()
        for row in value.watchPending { guard Self.validID(row.videoID),Self.uuid(row.playbackID),Self.uuid(row.key),row.seconds>=0,row.seconds<=86400,keys.insert(row.key).inserted else { throw Failure.invalidState } }
        if let row=value.playlistOperation { guard Self.validOperation(row) else { throw Failure.invalidState } }
        let history=value.playlistHistory ?? [];guard history.count<=64 else { throw Failure.invalidState }
        var playlistKeys=Set<String>()
        for draft in history+(value.playlistDraft.map{[$0]} ?? []) { guard Self.uuid(draft.key),!draft.name.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,draft.name.utf16.count<=1024,playlistKeys.insert(draft.key).inserted else { throw Failure.invalidState } }
    }
    private static func validOperation(_ row: PlaylistOperation) -> Bool {
        uuid(row.key) && validID(row.playlistID) && (["add","remove"].contains(row.action) ? row.videoID.map(validID)==true : row.action=="delete" && row.videoID==nil)
    }
    func pendingPlaylistOperation() throws -> PlaylistOperation? { try load().playlistOperation }
    func reservePlaylistOperation(action: String,playlistID: String,videoID: String?) throws -> PlaylistOperation {
        var state=try load()
        let row=PlaylistOperation(key:Self.newKey(),action:action,playlistID:playlistID,videoID:videoID)
        guard Self.validOperation(row) else { throw Failure.invalidState }
        if let original=state.playlistOperation {
            guard original.action==action,original.playlistID==playlistID,original.videoID==videoID else { throw Failure.changedRecord };return original
        }
        state.playlistOperation=row;try save(state);return row
    }
    func finishPlaylistOperation(_ original: PlaylistOperation) throws {
        var state=try load();guard state.playlistOperation==original else { throw Failure.changedRecord };state.playlistOperation=nil;try save(state)
    }
    func playback(_ id: String) throws -> Playback {
        guard Self.validID(id) else { throw Failure.invalidState };var state=try load()
        if let row=state.resume[id] { return row }
        let row=Playback(playbackID:Self.newKey(),position:0);state.resume[id]=row;try save(state);return row
    }
    @discardableResult func position(_ id: String,_ playback: Playback,position: Int,seconds: Int,completed: Bool) throws -> Watch? {
        var state=try load();guard state.resume[id]?.playbackID==playback.playbackID,position>=0,position<=2_147_483_647,seconds>=0,seconds<=86400 else { throw Failure.changedRecord }
        if completed { state.resume.removeValue(forKey:id) } else { state.resume[id]!.position=position }
        var pending: Watch?
        if seconds>0 || completed { let row=Watch(key:Self.newKey(),videoID:id,playbackID:playback.playbackID,seconds:seconds,completed:completed);state.watchPending.append(row);pending=row }
        try save(state);return pending
    }
    func pendingWatch() throws -> [Watch] { try load().watchPending }
    func finishWatch(_ original: Watch) throws {
        var state=try load();guard let index=state.watchPending.firstIndex(where:{$0.key==original.key}),state.watchPending[index]==original else { throw Failure.changedRecord }
        state.watchPending.remove(at:index);try save(state)
    }
    func playlistDraft() throws -> Playlist? { try load().playlistDraft }
    func reservePlaylist(_ name: String) throws -> Playlist {
        let name=name.trimmingCharacters(in:.whitespacesAndNewlines);guard !name.isEmpty,name.utf16.count<=1024 else { throw Failure.invalidState }
        var state=try load();if let original=state.playlistDraft { guard original.name==name else { throw Failure.changedRecord };return original }
        if let retained=(state.playlistHistory ?? []).first(where:{$0.name==name}) { return try restorePlaylist(retained) }
        let draft=Playlist(key:Self.newKey(),name:name);state.playlistDraft=draft;try save(state);return draft
    }
    func finishPlaylist(_ original: Playlist) throws { var state=try load();guard state.playlistDraft==original else { throw Failure.changedRecord };state.playlistDraft=nil;try save(state) }
    func playlistHistory() throws -> [Playlist] { try load().playlistHistory ?? [] }
    func pausePlaylist(_ original: Playlist) throws {
        var state=try load();guard state.playlistDraft==original else { throw Failure.changedRecord };var rows=state.playlistHistory ?? [];guard rows.count<64 else { throw Failure.capacity };rows.append(original);state.playlistHistory=rows;state.playlistDraft=nil;try save(state)
    }
    func restorePlaylist(_ original: Playlist) throws -> Playlist {
        var state=try load();guard state.playlistDraft==nil,var rows=state.playlistHistory,let index=rows.firstIndex(where:{$0.key==original.key}),rows[index]==original else { throw Failure.changedRecord };rows.remove(at:index);state.playlistHistory=rows;state.playlistDraft=original;try save(state);return original
    }
    static func validID(_ id: String) -> Bool { VideoNativeState.matches(id,"^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$") }
    static func uuid(_ text: String) -> Bool { VideoNativeState.matches(text,"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$") }
    private static func newKey() -> String { UUID().uuidString.lowercased() }
}

// Count observed monotonic playback, never seeks, cumulative resume positions,
// paused ticks or an unbounded background gap. Fractional seconds remain local.
struct VideoPlaybackClock {
    private var lastPosition: Double?
    private var lastTime: TimeInterval?
    private var wasPlaying=false
    private var remainder: Double=0
    mutating func sample(position: Double,playing: Bool,now: TimeInterval) -> Int {
        defer { if position.isFinite,position>=0,now.isFinite { lastPosition=position;lastTime=now;wasPlaying=playing } }
        guard position.isFinite,position>=0,now.isFinite else { return 0 }
        guard let previous=lastPosition,let time=lastTime else { return 0 }
        let delta=position-previous,elapsed=now-time
        guard wasPlaying,elapsed>=0,elapsed<=15,delta>=0,delta<=elapsed*2+1 else { return 0 }
        remainder+=min(delta,elapsed,10);let seconds=Int(remainder.rounded(.down));remainder-=Double(seconds);return seconds
    }
}
