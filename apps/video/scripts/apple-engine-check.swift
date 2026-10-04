import AppKit
import CryptoKit
import Foundation

// Headless owner process, injected custody/generated key and fixed QA network
// adapters only. No user Keychain, app installation, real Wallet or user UI.
@main enum AppleEngineCheck {
    @MainActor static func main() async {
        NSApplication.shared.setActivationPolicy(.prohibited)
        do {
            let args=CommandLine.arguments;guard args.count==5,let gateway=URL(string:args[2]),let backend=URL(string:args[3]),[gateway,backend].allSatisfy({$0.scheme=="http" && $0.host=="127.0.0.1" && $0.path.isEmpty}),["ios","macos"].contains(args[4]) else { throw VideoNativeEngine.Failure.invalidSource }
            let assets=URL(fileURLWithPath:args[1]),platform=args[4],original=P256.Signing.PrivateKey()
            var viewerRecords: [String:Data]=[:]
            var persisted: Data?,opened="",mismatch=false,dropMutation=false,hold=false,held: CheckedContinuation<Void,Never>?
            let key=ProductDeviceKey(read:{(errSecSuccess,original.rawRepresentation)},add:{_ in errSecAuthFailed},create:{fatalError("QA must preserve generated original key")})
            let network=VideoNativeTransport()
            let sender: VideoNativeEngine.Sender = { request,limit in
                let url=request.url!
                if url.host=="video.ynxweb4.com" && hold { hold=false;await withCheckedContinuation { held=$0 } }
                if url.absoluteString==VideoHTTP.api.absoluteString+"/v1/account" && mismatch { return (Data("{\"schemaVersion\":1,\"account\":\"wrong-account\"}".utf8),HTTPURLResponse(url:url,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!) }
                let target: URL
                if url.host=="wallet-auth.ynxweb4.com" { target=URL(string:gateway.absoluteString+url.path)! }
                else if url.host=="video.ynxweb4.com",url.path.hasPrefix("/video/api/") { target=URL(string:backend.absoluteString+url.path.dropFirst("/video/api".count))! }
                else { throw VideoNativeEngine.Failure.invalidSource }
                var redirected=request;redirected.url=target
                let (bytes,response)=try await network.send(redirected,limit)
                if dropMutation,url.host=="video.ynxweb4.com",(url.path.contains("/playlists/") || url.path.hasSuffix("/playlists")),["POST","DELETE"].contains(request.httpMethod ?? "") { dropMutation=false;throw VideoHTTP.Failure.unexpectedResponse }
                var headers: [String:String]=[:];for (key,value) in response.allHeaderFields { headers[String(describing:key)]=String(describing:value) }
                return (bytes,HTTPURLResponse(url:url,statusCode:response.statusCode,httpVersion:nil,headerFields:headers)!)
            }
            func create() throws -> VideoNativeEngine {
                let state=try VideoNativeState(platform:platform,deviceId:"qa-original-apple-video-device",deviceKey:VideoNativeState.encode(original.publicKey.compressedRepresentation),read:{persisted},write:{persisted=$0})
                return try VideoNativeEngine(state:state,key:key,assets:assets,send:sender,walletDetected:{true},openWallet:{url in opened=url.absoluteString;return true})
            }
            var engine=try create()
            func viewer(_ engine: VideoNativeEngine) throws -> VideoViewerState {
                guard let identity=engine.identity else { throw VideoNativeEngine.Failure.retired }
                let epoch=engine.epoch,account=identity.account
                return try VideoViewerState(account:account,read:{viewerRecords[account]},write:{viewerRecords[account]=$0},require:{try engine.require(identity,epoch)})
            }
            func createModel(_ engine: VideoNativeEngine) -> VideoModel { VideoModel(loadData:{path,query in
                var parts=URLComponents(url:try VideoHTTP.url(path),resolvingAgainstBaseURL:false)!;parts.queryItems=query
                let (bytes,_)=try await sender(URLRequest(url:parts.url!),2_097_152);return bytes
            },makeEngine:{engine},makeViewer:{engine,identity in
                try viewer(engine)
            }) }
            var model=createModel(engine)
            func reply(_ id: String,_ value: [String:Any]) { do { let bytes=try JSONSerialization.data(withJSONObject:["id":id,"value":value],options:[.sortedKeys]);FileHandle.standardOutput.write(bytes+Data([10])) } catch { FileHandle.standardOutput.write(Data("{\"error\":\"fixture output invalid\"}\n".utf8)) } }
            reply("ready",["ready":true,"platform":platform,"actualOSStorage":false])
            while let line=await Task.detached(operation:{readLine()}).value {
                guard let command=try? VideoNativeState.object(line),let id=command["id"] as? String,let name=command["name"] as? String else { throw VideoNativeEngine.Failure.invalidSource }
                Task { @MainActor in
                    do {
                        let value: [String:Any]
                        switch name {
                        case "connect":value=try await engine.dispatch("connect")
                        case "callback":value=try await engine.dispatch("handleReturn",["url":command["url"]!])
                        case "restore":value=try await engine.dispatch("restore")
                        case "disconnect":value=try await engine.dispatch("disconnect")
                        case "proof":value=try await engine.dispatch("prepareRequest",command["args"] as! [String:Any])
                        case "json":
                            let body=(command["body"] as? String).map{Data($0.utf8)}
                            let bytes=try await VideoHTTP.shared.accountData(command["path"] as! String,method:command["method"] as? String ?? "GET",body:body,engine:engine)
                            value=["json":try JSONSerialization.jsonObject(with:bytes)]
                        case "uiSignIn":await model.signIn();value=["busy":model.accountBusy,"pending":model.signOutPending]
                        case "uiCallback":
                            model.handle(url:URL(string:command["url"] as! String)!)
                            let deadline=Date().addingTimeInterval(35)
                            while model.accountBusy && Date()<deadline { try await Task.sleep(nanoseconds:10_000_000) }
                            value=["connected":model.accountConnected,"busy":model.accountBusy,"sdkStatus":engine.lastStatus,"sdkFailure":engine.lastFailure]
                        case "uiLibrary":
                            await model.loadLibrary("/v1/playlists",label:"Playlists")
                            if case .library(_,let rows)=model.state { value=["rows":rows] } else { value=["rows":[],"connected":model.accountConnected] }
                        case "dropNextMutation":dropMutation=true;value=["armed":true]
                        case "uiPlaylistChange":
                            let rows=try await model.playlistChoices(),index=command["index"] as? Int ?? 0
                            guard let original=(command["nameValue"] as? String).flatMap({name in rows.first(where:{$0.Name==name})}) ?? (rows.indices.contains(index) ? rows[index] : nil) else { throw VideoHTTP.Failure.unexpectedResponse }
                            await model.changePlaylist(original,videoID:command["videoID"] as? String,action:command["action"] as! String)
                            let current=try await model.playlistChoices()
                            value=["pending":model.playlistOperationPending,"count":current.count,"members":current.first?.VideoIDs ?? []]
                        case "queuePlaylistRemove":
                            let rows=try await model.playlistChoices();guard let first=rows.first else { throw VideoHTTP.Failure.unexpectedResponse }
                            let operation=try viewer(engine).reservePlaylistOperation(action:"remove",playlistID:first.playlistID,videoID:command["videoID"] as? String)
                            value=["key":operation.key]
                        case "uiPlaylistRetry":await model.retryPlaylistOperation();value=["pending":model.playlistOperationPending,"members":try await model.playlistChoices().first?.VideoIDs ?? []]
                        case "queueWatch":
                            let store=try viewer(engine),video=command["videoID"] as! String,playback=try store.playback(video)
                            _ = try store.position(video,playback,position:47,seconds:7,completed:false)
                            value=["playbackID":playback.playbackID,"pending":try store.pendingWatch().count]
                        case "uiFlush":await model.flushWatch();value=["pending":try viewer(engine).pendingWatch().count]
                        case "uiPlaylist":
                            model.playlistName=command["nameValue"] as! String;await model.createPlaylist();value=["pending":model.playlistPending,"count":model.playlists.count,"message":model.operationMessage]
                        case "uiPlaylistPause":model.preparePlaylistPause();model.confirmPlaylistPause();value=["pending":model.playlistPending,"history":model.savedPlaylistDrafts.map{["key":$0.key,"name":$0.name]}]
                        case "uiPlaylistRestore":
                            guard let original=model.savedPlaylistDrafts.first(where:{$0.name==command["nameValue"] as? String}) else { throw VideoViewerState.Failure.changedRecord }
                            model.restorePlaylistDraft(original);value=["pending":model.playlistPending,"draft":try viewer(engine).playlistDraft().map{["key":$0.key,"name":$0.name]} as Any,"history":model.savedPlaylistDrafts.map{["key":$0.key,"name":$0.name]}]
                        case "uiPlaylistInspect":value=["pending":model.playlistPending,"draft":try viewer(engine).playlistDraft().map{["key":$0.key,"name":$0.name]} ?? [:],"history":try viewer(engine).playlistHistory().map{["key":$0.key,"name":$0.name]}]
                        case "nativeRange":
                            let boundary=VideoRequestBoundary(),media=try VideoPrivateMedia(engine:engine,path:command["path"] as! String,boundary:boundary,navigation:boundary.generation,expectedBytes:20)
                            let first=try await media.range(offset:0,count:4),second=try await media.range(offset:4,count:4)
                            boundary.advance()
                            var retired=false;do { _ = try await media.range(offset:8,count:4) } catch { retired=true };media.close()
                            value=["first":first.data.count,"second":second.data.count,"total":second.total,"retired":retired]
                        case "uiMutate":value=["accepted":await model.mutate(command["path"] as! String,body:command["body"] as! [String:Any])]
                        case "uiSignOut":await model.signOut();value=["connected":model.accountConnected,"pending":model.signOutPending]
                        case "cold":engine.close();engine=try create();model=createModel(engine);await model.restoreAccount();value=["status":engine.lastStatus,"connected":model.accountConnected]
                        case "mismatch":mismatch=command["enabled"] as! Bool;value=["enabled":mismatch]
                        case "holdNext":hold=true;value=["holding":true]
                        case "release":held?.resume();held=nil;value=["released":true]
                        case "inspect":value=["held":held != nil,"pending":model.signOutPending,"connected":model.accountConnected]
                        case "suspend":model.suspendAccount();value=["connected":model.accountConnected]
                        case "close":engine.close();value=["closed":true]
                        default:throw VideoNativeEngine.Failure.invalidSource
                        }
                        var answer=value;answer["walletUrl"]=opened;answer["businessVerified"]=engine.identity != nil
                        if let identity=engine.identity { answer["account"]=identity.account;answer["binding"]=identity.binding }
                        reply(id,["ok":true,"result":answer])
                    } catch { reply(id,["ok":false,"code":String(describing:error),"businessVerified":engine.identity != nil]) }
                }
            }
            engine.close()
        } catch { FileHandle.standardError.write(Data("Apple isolated engine QA failed: \(error)\n".utf8));exit(1) }
    }
}
