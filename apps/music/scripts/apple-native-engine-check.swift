import AppKit
import CryptoKit
import Foundation

// Headless owner process, injected custody/generated key and fixed QA network
// adapters only. No user Keychain, app installation, real Wallet or user UI.
@main enum AppleMusicEngineCheck {
    @MainActor static func main() async {
        NSApplication.shared.setActivationPolicy(.prohibited)
        do {
            let args=CommandLine.arguments;guard args.count==5,let gateway=URL(string:args[2]),let backend=URL(string:args[3]),[gateway,backend].allSatisfy({$0.scheme=="http" && $0.host=="127.0.0.1" && $0.path.isEmpty}),["ios","macos"].contains(args[4]) else { throw MusicNativeEngine.Failure.invalidSource }
            let assets=URL(fileURLWithPath:args[1]),platform=args[4],original=P256.Signing.PrivateKey()
            var negative=false
            var renderedTrack="",renderedCount=0,playTasks:[Task<Void,Never>]=[]
            var persisted: Data?,opened="",mismatch=false,hold=false,held: CheckedContinuation<Void,Never>?,loseUploadReply=false,corruptMedia=false
            let credentials=MusicCredentials(read:{name in name=="device-p256" ? (errSecSuccess,Data(original.rawRepresentation.base64EncodedString().utf8)) : (errSecItemNotFound,nil)},add:{_,_ in errSecAuthFailed},update:{_,_ in errSecAuthFailed},remove:{_ in errSecAuthFailed},create:{fatalError("generated original only")})
            let key=MusicDeviceSigner(credentials:credentials)
            let network=MusicNativeTransport()
            var holdSnapshot=false,failSnapshot=false
            let sender: MusicNativeEngine.Sender = { request,limit in
                let url=request.url!
                if url.host=="web4.ynxweb4.com" && hold { hold=false;await withCheckedContinuation { held=$0 } }
                if url.absoluteString==MusicNativeHTTP.api.absoluteString+"/api/me" && mismatch { return (Data("{\"profile\":{\"account\":\"wrong-account\"}}".utf8),HTTPURLResponse(url:url,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!) }
                let target: URL
                if url.host=="wallet-auth.ynxweb4.com" { target=URL(string:gateway.absoluteString+url.path)! }
                else if url.host=="web4.ynxweb4.com",url.path.hasPrefix("/music/") { target=URL(string:backend.absoluteString+url.path.dropFirst("/music".count))! }
                else { throw MusicNativeEngine.Failure.invalidSource }
                var redirected=request;redirected.url=target
                let (bytes,response)=try await network.send(redirected,limit)
                if url.path=="/music/api/me",holdSnapshot {
                    holdSnapshot=false;await withCheckedContinuation {held=$0}
                    if failSnapshot {failSnapshot=false;throw URLError(.networkConnectionLost)}
                }
                if url.path=="/music/api/creator/tracks",request.httpMethod=="POST",loseUploadReply,(200..<300).contains(response.statusCode) {loseUploadReply=false;throw URLError(.networkConnectionLost)}
                var received=bytes
                if url.path.hasSuffix("/media"),corruptMedia,!received.isEmpty {received[received.count-1] ^= 1}
                
                var headers: [String:String]=[:];for (key,value) in response.allHeaderFields { headers[String(describing:key)]=String(describing:value) }
                return (received,HTTPURLResponse(url:url,statusCode:response.statusCode,httpVersion:nil,headerFields:headers)!)
            }
            func create() throws -> MusicNativeEngine {
                let state=try MusicNativeState(platform:platform,deviceId:"qa-original-apple-video-device",deviceKey:MusicNativeState.encode(original.publicKey.compressedRepresentation),read:{persisted},write:{persisted=$0})
                return try MusicNativeEngine(state:state,key:key,assets:assets,send:sender,walletDetected:{true},openWallet:{url in opened=url.absoluteString;return true})
            }
            var engine=try create()
            let directory=FileManager.default.temporaryDirectory.appendingPathComponent("ynx-music-model-"+UUID().uuidString)
            try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
            defer { try? FileManager.default.removeItem(at:directory) }
            func createModel(_ engine:MusicNativeEngine) -> MusicModel { MusicModel(makeNative:{engine},storeRoot:directory,autoRestore:false,systemMediaControls:false,renderLocal:{track,url,_ in precondition(url.isFileURL);renderedTrack=track.id;renderedCount+=1},nativeNegativeRead:{negative},nativeNegativeWrite:{negative=$0}) }
            var model=createModel(engine)
            func reply(_ id: String,_ value: [String:Any]) { do { let bytes=try JSONSerialization.data(withJSONObject:["id":id,"value":value],options:[.sortedKeys]);FileHandle.standardOutput.write(bytes+Data([10])) } catch { FileHandle.standardOutput.write(Data("{\"error\":\"fixture output invalid\"}\n".utf8)) } }
            reply("ready",["ready":true,"platform":platform,"actualOSStorage":false])
            while let line=await Task.detached(operation:{readLine()}).value {
                guard let command=try? MusicNativeState.object(line),let id=command["id"] as? String,let name=command["name"] as? String else { throw MusicNativeEngine.Failure.invalidSource }
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
                            let bytes=try await engine.request(path:command["path"] as! String,method:"GET",body:nil,contentType:"application/json",idempotency:nil)
                            value=["json":try JSONSerialization.jsonObject(with:bytes)]
                        case "uiSignIn":await model.beginSignIn();value=["busy":model.authBusy,"pending":model.revokePending]
                        case "uiRefresh":await model.refresh();value=["status":model.status,"count":model.snapshot.playlists.count]
                        case "cacheWritePermission":
                            guard let operation=model.captureOperation() else {throw MusicNativeEngine.Failure.retired}
                            let dir=directory.appendingPathComponent("MusicAccounts/"+MusicAccountStore.accountKey(operation.account.account))
                            try FileManager.default.setAttributes([.posixPermissions:command["enabled"] as? Bool==true ? 0o700 : 0o500],ofItemAtPath:dir.path);value=["changedIsolatedQAStore":true]
                        case "uiRenamePlaylist":
                            guard let operation=model.captureOperation(),var playlist=model.snapshot.playlists.first else {throw MusicNativeEngine.Failure.retired}
                            playlist.name=command["title"] as! String
                            guard await model.perform(operation,{try await $0.savePlaylist(playlist)}) != nil else {throw MusicNativeEngine.Failure.retired}
                            await model.refresh(operation);value=["count":model.snapshot.playlists.count,"name":model.snapshot.playlists.first?.name ?? ""]
                        case "uiCallback":
                            model.acceptCallback(URL(string:command["url"] as! String)!)
                            let deadline=Date().addingTimeInterval(35)
                            while model.authBusy && Date()<deadline { try await Task.sleep(nanoseconds:10_000_000) }
                            value=["connected":model.signedIn,"status":model.status,"sdkStatus":engine.lastStatus,"sdkFailure":engine.lastFailure]
                        case "uiCreate":
                            guard let operation=model.captureOperation() else { throw MusicNativeEngine.Failure.retired }
                            guard let record=await model.perform(operation,{try await $0.createPlaylist(name:"Protected Native original library",ids:[],key:UUID().uuidString)}) else { throw MusicNativeEngine.Failure.retired }
                            await model.refresh(operation);value=["id":record.id,"count":model.snapshot.playlists.count,"connected":model.signedIn]
                        case "uiUpload":
                            guard let operation=model.captureOperation() else{throw MusicNativeEngine.Failure.retired}
                            if let encoded=command["audio"] as? String {
                                let path=directory.appendingPathComponent("selected-original.wav");try Data(base64Encoded:encoded)!.write(to:path)
                                guard model.prepareUpload(operation,url:path,title:command["title"] as? String ?? "Original protected audio",artist:"Original artist",evidence:"Owned original fixture",provenance:"Original generated PCM fixture") else{throw MusicNativeEngine.Failure.rejected("staging")}
                            }
                            let key=model.state.uploadIntent?.key ?? "",title=model.state.uploadIntent?.title ?? "",success=await model.retryUpload(operation)
                            value=["success":success,"pending":model.state.uploadIntent != nil,"key":key,"tracks":model.snapshot.creatorTracks.count,"id":model.snapshot.creatorTracks.first(where:{$0.title==title})?.id ?? ""]
                        case "uiRelease":
                            guard let operation=model.captureOperation(),let track=model.snapshot.creatorTracks.first(where:{command["track"]==nil || $0.id==command["track"] as? String}) else{throw MusicNativeEngine.Failure.retired}
                            guard await model.perform(operation,{try await $0.release(track.id)}) != nil else{throw MusicNativeEngine.Failure.retired};await model.refresh(operation);value=["id":track.id,"catalog":model.snapshot.catalog.count]
                        case "uiDownload":
                            guard let operation=model.captureOperation(),let track=model.snapshot.catalog.first else{throw MusicNativeEngine.Failure.retired}
                            let bytes=try await operation.api.download(track)
                            model.download(track.id)
                            let deadline=Date().addingTimeInterval(10);while model.state.downloads[track.id] != "available" && model.isCurrent(operation) && Date()<deadline{try await Task.sleep(nanoseconds:10_000_000)}
                            guard model.isCurrent(operation),model.state.downloads[track.id]=="available" else{throw MusicNativeEngine.Failure.retired}
                            let file=directory.appendingPathComponent("MusicAccounts/"+MusicAccountStore.accountKey(operation.account.account)+"/Offline/"+track.id+".wav")
                            let saved=try Data(contentsOf:file);guard saved==bytes else{throw MusicNativeEngine.Failure.rejected("cache")};value=["id":track.id,"bytes":saved.count,"hash":MusicNativeState.hash(saved)]
                        case "loseUploadReply":loseUploadReply=true;value=["armed":true]
                        case "corruptMedia":corruptMedia=command["enabled"] as! Bool;value=["enabled":corruptMedia]
                        case "uiPlay":
                            guard let track=model.snapshot.catalog.first(where:{$0.id==command["track"] as? String}) else{throw MusicNativeEngine.Failure.retired}
                            if let task=model.play(track){playTasks.append(task)};value=["requested":track.id]
                        case "uiWaitPlay":for task in playTasks {await task.value};playTasks.removeAll();value=["played":renderedTrack,"count":renderedCount]
                        case "dropCache":
                            guard let operation=model.captureOperation(),let id=command["track"] as? String,MusicAccountStore.validTrackID(id) else{throw MusicNativeEngine.Failure.retired}
                            let file=directory.appendingPathComponent("MusicAccounts/"+MusicAccountStore.accountKey(operation.account.account)+"/Offline/"+id+".wav");if FileManager.default.fileExists(atPath:file.path){try FileManager.default.removeItem(at:file)};value=["removedQAFile":true]
                        case "uiSignOut":model.signOut();let deadline=Date().addingTimeInterval(35);while model.revokePending && Date()<deadline { try await Task.sleep(nanoseconds:10_000_000) };value=["connected":model.signedIn,"pending":model.revokePending]
                        case "cold":engine.close();engine=try create();model=createModel(engine);await model.restoreNative();value=["status":engine.lastStatus,"connected":model.signedIn,"count":model.snapshot.playlists.count,"uploadPending":model.state.uploadIntent != nil,"uploadKey":model.state.uploadIntent?.key ?? "","tracks":model.snapshot.creatorTracks.count]
                        case "mismatch":mismatch=command["enabled"] as! Bool;value=["enabled":mismatch]
                        case "holdNext":hold=true;value=["holding":true]
                        case "holdNextSnapshot":holdSnapshot=true;value=["holding":true]
                        case "release":failSnapshot=command["failSnapshot"] as? Bool==true;held?.resume();held=nil;value=["released":true]
                        case "inspect":value=["held":held != nil,"pending":model.revokePending,"connected":model.signedIn,"played":renderedTrack,"playCount":renderedCount,"status":model.status,"count":model.snapshot.playlists.count,"playlistName":model.snapshot.playlists.first?.name ?? ""]
                        case "suspend":model.suspendNative();value=["connected":model.signedIn]
                        case "close":engine.close();value=["closed":true]
                        default:throw MusicNativeEngine.Failure.invalidSource
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
