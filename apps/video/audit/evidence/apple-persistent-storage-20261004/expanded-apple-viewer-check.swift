import Foundation

@main enum AppleViewerChecks {
    struct Failure: Error { let reason: String }
    static func check(_ value: Bool,_ reason: String) throws { if !value { throw Failure(reason:reason) } }
    static func rejects(_ action: () throws -> Void) throws { do { try action() } catch { return };throw Failure(reason:"invalid operation accepted") }
    @MainActor static func main() throws {
        let account="ynx1"+String(repeating:"q",count:38),other="ynx1"+String(repeating:"p",count:38)
        var bytes: Data?,current=true,failWrite=false
        func make(_ owner: String=account) throws -> VideoViewerState {
            try VideoViewerState(account:owner,read:{bytes},write:{if failWrite { throw Failure(reason:"injected write") };bytes=$0},require:{if !current { throw Failure(reason:"retired") }})
        }
        let original=try make(),playback=try original.playback("original-video")
        let pending=try original.position("original-video",playback,position:47,seconds:7,completed:false)!
        let draft=try original.reservePlaylist("  Original playlist  ")
        let operation=try original.reservePlaylistOperation(action:"add",playlistID:"original-playlist",videoID:"original-video")
        let cold=try make()
        try check(try cold.pendingPlaylistOperation()==operation,"cold replaced original membership request")
        try check(try cold.reservePlaylistOperation(action:"add",playlistID:"original-playlist",videoID:"original-video")==operation,"retry replaced original membership key")
        try rejects { _ = try cold.reservePlaylistOperation(action:"remove",playlistID:"original-playlist",videoID:"original-video") }
        try rejects { try cold.finishPlaylistOperation(.init(key:operation.key,action:"remove",playlistID:operation.playlistID,videoID:operation.videoID)) }
        try cold.finishPlaylistOperation(operation)
        try check(try cold.playback("original-video")==VideoViewerState.Playback(playbackID:playback.playbackID,position:47),"cold resume lost original ID or position")
        try check(try cold.pendingWatch()==[pending],"cold changed pending exact body/key")
        try check(try cold.reservePlaylist("Original playlist")==draft,"retry changed playlist request key")
        try rejects { _ = try cold.reservePlaylist("Replacement") }
        try rejects { _ = try make(other) }
        try rejects { try cold.finishWatch(.init(key:pending.key,videoID:pending.videoID,playbackID:pending.playbackID,seconds:8,completed:false)) }
        try check(try cold.pendingWatch()==[pending],"wrong ACK deleted original watch")
        try cold.finishWatch(pending);try cold.finishPlaylist(draft)
        try check(try make().pendingWatch().isEmpty,"ACK did not persist")
        let retainedDraft=try cold.reservePlaylist("Original lost reply")
        try cold.pausePlaylist(retainedDraft)
        try check(try make().playlistHistory()==[retainedDraft],"cold pause lost original key/body")
        let successor=try cold.reservePlaylist("Successor")
        try rejects { _ = try cold.restorePlaylist(retainedDraft) }
        try rejects { try cold.finishPlaylist(retainedDraft) }
        try check(try cold.playlistDraft()==successor,"late original ACK consumed successor")
        try cold.pausePlaylist(successor)
        let reopened=try make()
        try check(try reopened.restorePlaylist(retainedDraft)==retainedDraft,"restore changed original key/body")
        try check(try reopened.playlistHistory()==[successor],"restoring original removed successor history")
        try rejects { try reopened.pausePlaylist(successor) }
        try reopened.finishPlaylist(retainedDraft)
        try check(try reopened.reservePlaylist("Successor")==successor,"same-name recovery rekeyed retained request")
        try reopened.finishPlaylist(successor)
        var full:[VideoViewerState.Playlist]=[]
        for i in 0..<64 { let row=try reopened.reservePlaylist("retained-\(i)");try reopened.pausePlaylist(row);full.append(row) }
        let capacityPending=try reopened.reservePlaylist("capacity-pending"),beforeCapacity=bytes
        try rejects { try reopened.pausePlaylist(capacityPending) }
        try check(bytes==beforeCapacity,"full history erased original records")
        try rejects { _ = try reopened.restorePlaylist(full[0]) }
        try reopened.finishPlaylist(capacityPending)
        _ = try reopened.restorePlaylist(full[0]);try reopened.finishPlaylist(full[0])
        let completion=try cold.position("original-video",playback,position:50,seconds:0,completed:true)!
        try check(completion.completed && completion.playbackID==playback.playbackID,"completion replaced playback")
        try check(try make().playback("original-video").playbackID != playback.playbackID,"completed playback reused")
        current=false;try rejects { _ = try cold.pendingWatch() };current=true
        let retained=bytes!;var shape=try JSONSerialization.jsonObject(with:retained) as! [String:Any];shape["unexpected"]=true;bytes=try JSONSerialization.data(withJSONObject:shape)
        try rejects { _ = try make() };try check(bytes != retained,"corrupt state was silently overwritten");bytes=retained
        let poisoned=try make();failWrite=true;try rejects { _ = try poisoned.reservePlaylist("Retry") };failWrite=false
        try rejects { _ = try poisoned.pendingWatch() };try check(bytes==retained,"failed write replaced original state")
        // A failed adapter may update its volatile readback before throwing.
        // Exercise each original reserve/queue/ACK, with the durable snapshot
        // kept separate. This is injected storage, not a Keychain guarantee.
        for path in ["reserve-create","reserve-operation","queue-watch","ack-create","ack-operation","ack-watch"] {
            var durable: Data?,volatile: Data?,failing=false,writes=0
            func state() throws -> VideoViewerState {
                try VideoViewerState(account:account,read:{volatile},write:{next in
                    writes += 1;volatile=next
                    if failing { throw Failure(reason:"persistent adapter failure") }
                    durable=next
                },require:{})
            }
            func closed(_ action: () throws -> Void) throws {
                do { try action() }
                catch VideoViewerState.Failure.unconfirmedWrite { return }
                throw Failure(reason:"\(path): poisoned storage did not reject with unconfirmedWrite")
            }
            let active=try state(),play=try active.playback("persistent-video")
            let watch=try active.position("persistent-video",play,position:7,seconds:7,completed:false)!
            let create=path=="reserve-create" ? nil : try active.reservePlaylist("Persistent original")
            let operation=path=="reserve-operation" ? nil : try active.reservePlaylistOperation(action:"add",playlistID:"persistent-list",videoID:"persistent-video")
            let before=durable;failing=true
            do {
                switch path {
                case "reserve-create":_ = try active.reservePlaylist("Persistent original")
                case "reserve-operation":_ = try active.reservePlaylistOperation(action:"add",playlistID:"persistent-list",videoID:"persistent-video")
                case "queue-watch":_ = try active.position("persistent-video",play,position:8,seconds:1,completed:false)
                case "ack-create":try active.finishPlaylist(create!)
                case "ack-operation":try active.finishPlaylistOperation(operation!)
                default:try active.finishWatch(watch)
                }
                throw Failure(reason:"\(path): failed write accepted")
            } catch let error as Failure {
                try check(error.reason=="persistent adapter failure","\(path): unexpected error \(error.reason)")
            }
            try check(durable==before && volatile != before,"\(path): counterexample did not model volatile-only update")
            let attempts=writes
            for _ in 0..<2 {
                try closed { _ = try active.reservePlaylist("Persistent original") }
                try closed { _ = try active.reservePlaylistOperation(action:"add",playlistID:"persistent-list",videoID:"persistent-video") }
                try closed { _ = try active.pendingWatch() }
                try closed { try active.finishWatch(watch) }
            }
            failing=false
            try closed { _ = try active.pendingWatch() }
            try check(writes==attempts && durable==before,"\(path): poisoned retry wrote or erased durable originals")
            volatile=durable;let reopened=try state()
            try check(try reopened.pendingWatch()==[watch],"\(path): cold recovery changed original watch key/body")
            try check(try reopened.playlistDraft()==create,"\(path): cold recovery changed original create key/body")
            try check(try reopened.pendingPlaylistOperation()==operation,"\(path): cold recovery changed original operation key/body")
            try reopened.finishWatch(watch)
            if let create { try reopened.finishPlaylist(create) }
            if let operation { try reopened.finishPlaylistOperation(operation) }
            print("PASS: Apple persistent failure \(path), volatile update blocked, durable original cold recovery; injected storage only")
        }
        var clock=VideoPlaybackClock()
        try check(clock.sample(position:47,playing:true,now:0)==0,"resume counted as watch")
        try check(clock.sample(position:52,playing:true,now:5)==5,"playing seconds missing")
        try check(clock.sample(position:100,playing:false,now:6)==0,"seek counted as watch")
        try check(clock.sample(position:100,playing:true,now:9)==0,"paused time counted")
        try check(clock.sample(position:102,playing:true,now:11)==2,"resumed seconds missing")
        try check(clock.sample(position:200,playing:true,now:100)==0,"background gap counted")
        try check(clock.sample(position:150,playing:true,now:101)==0,"backward seek counted")
        print("Apple viewer original resume/pending/playlist/cold/account/ACK/poison/clock PASS; injected storage only")
    }
}
