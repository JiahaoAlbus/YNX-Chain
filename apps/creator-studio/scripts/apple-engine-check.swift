import AppKit
import CryptoKit
import Foundation

// Headless owner process, injected custody/generated key and fixed QA network
// adapters only. No user Keychain, app installation, real Wallet or user UI.
@main enum AppleEngineCheck {
    @MainActor static func main() async {
        NSApplication.shared.setActivationPolicy(.prohibited)
        do {
            let args=CommandLine.arguments;guard args.count==5,let gateway=URL(string:args[2]),let backend=URL(string:args[3]),[gateway,backend].allSatisfy({$0.scheme=="http" && $0.host=="127.0.0.1" && $0.path.isEmpty}),["ios","macos"].contains(args[4]) else { throw CreatorNativeEngine.Failure.invalidSource }
            let assets=URL(fileURLWithPath:args[1]),platform=args[4],original=P256.Signing.PrivateKey(),isolatedDevice="qa-creator-"+UUID().uuidString
            let root=FileManager.default.temporaryDirectory.appendingPathComponent("ynx-creator-qa-"+UUID().uuidString,isDirectory:true)
            try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
            defer {try? FileManager.default.removeItem(at:root)}
            var persisted: Data?,opened="",mismatch=false,dropMutation=false,dropOperation="",assetBackup:Data?,assetWire:URL?,hold=false,held: CheckedContinuation<Void,Never>?
            let key=CreatorDeviceKey(read:{(errSecSuccess,original.rawRepresentation)},add:{_ in errSecAuthFailed},create:{fatalError("QA must preserve generated original key")})
            let network=CreatorNativeTransport()
            let sender: CreatorNativeEngine.Sender = { request,limit in
                let url=request.url!
                if url.host=="creator.ynxweb4.com" && hold { hold=false;await withCheckedContinuation { held=$0 } }
                if url.absoluteString==CreatorHTTP.api.absoluteString+"/v1/account" && mismatch { return (Data("{\"schemaVersion\":1,\"account\":\"wrong-account\"}".utf8),HTTPURLResponse(url:url,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!) }
                let target: URL
                if url.host=="wallet-auth.ynxweb4.com" { target=URL(string:gateway.absoluteString+url.path)! }
                else if url.host=="creator.ynxweb4.com",url.path.hasPrefix("/video/api/") { target=URL(string:backend.absoluteString+url.path.dropFirst("/video/api".count))! }
                else { throw CreatorNativeEngine.Failure.invalidSource }
                var redirected=request;redirected.url=target
                let (bytes,response)=try await network.send(redirected,limit)
                if dropMutation,url.host=="creator.ynxweb4.com",url.path=="/video/api/v1/uploads",["POST","DELETE"].contains(request.httpMethod ?? "") { dropMutation=false;throw CreatorHTTP.Failure.unexpectedResponse }
                if !dropOperation.isEmpty,url.path=="/video/api"+dropOperation,(200..<300).contains(response.statusCode),request.httpMethod=="POST" {dropOperation="";throw CreatorHTTP.Failure.unexpectedResponse}
                var headers: [String:String]=[:];for (key,value) in response.allHeaderFields { headers[String(describing:key)]=String(describing:value) }
                return (bytes,HTTPURLResponse(url:url,statusCode:response.statusCode,httpVersion:nil,headerFields:headers)!)
            }
            func create() throws -> CreatorNativeEngine {
                let state=try CreatorNativeState(platform:platform,deviceId:isolatedDevice,deviceKey:CreatorNativeState.encode(original.publicKey.compressedRepresentation),read:{persisted},write:{persisted=$0})
                return try CreatorNativeEngine(state:state,key:key,assets:assets,send:sender,walletDetected:{true},openWallet:{url in opened=url.absoluteString;return true})
            }
            var engine=try create()
            func createModel(_ engine: CreatorNativeEngine) -> CreatorModel {
                CreatorModel(makeEngine:{engine},makeDrafts:{active,identity in
                    let epoch=active.epoch
                    return try CreatorDraftState(account:identity.account,root:root,require:{try active.require(identity,epoch)})
                })
            }
            var model=createModel(engine)
            func reply(_ id: String,_ value: [String:Any]) { do { let bytes=try JSONSerialization.data(withJSONObject:["id":id,"value":value],options:[.sortedKeys]);FileHandle.standardOutput.write(bytes+Data([10])) } catch { FileHandle.standardOutput.write(Data("{\"error\":\"fixture output invalid\"}\n".utf8)) } }
            reply("ready",["ready":true,"platform":platform,"actualOSStorage":false])
            while let line=await Task.detached(operation:{readLine()}).value {
                guard let command=try? CreatorNativeState.object(line),let id=command["id"] as? String,let name=command["name"] as? String else {throw CreatorNativeEngine.Failure.invalidSource}
                Task {@MainActor in
                    do {
                        var value:[String:Any]=[:]
                        switch name {
                        case "uiSignIn":await model.signIn()
                        case "uiCallback":
                            model.handle(url:URL(string:command["url"] as! String)!)
                            await Task.yield();try await Task.sleep(nanoseconds:10_000_000)
                            let deadline=Date().addingTimeInterval(35)
                            while model.busy && Date()<deadline {try await Task.sleep(nanoseconds:10_000_000)}
                        case "callback":_ = try await engine.dispatch("handleReturn",["url":command["url"]!])
                        case "uiPerform":await model.perform(command["path"] as! String,body:command["body"] as? [String:Any] ?? [:],method:command["method"] as? String ?? "POST")
                        case "uiSubmitAppeal":await model.submitAppeal(command["recordID"] as! String,reason:command["reason"] as! String,expectedRevision:command["stale"] as? Bool==true ? model.currentRevision &+ 1 : model.currentRevision)
                        case "uiSubmitDispute":await model.submitDispute(command["recordID"] as! String,reason:command["reason"] as! String,expectedRevision:model.currentRevision)
                        case "uiAsset":
                            let kind=command["kind"] as! String,file=root.appendingPathComponent(kind=="thumbnail" ? "selected.png" : "selected.vtt")
                            var content=kind=="thumbnail" ? Data(base64Encoded:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=")! : Data("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOriginal human caption\n".utf8)
                            if command["invalid"] as? Bool==true {content=Data("not a supported original asset".utf8)}
                            try content.write(to:file);let previewHash=CreatorNativeState.hash(content)
                            if command["changed"] as? Bool==true {try (content+Data([1])).write(to:file)}
                            await model.stageAsset(file:file,videoID:command["videoID"] as! String,kind:kind,language:"en",label:"Original human subtitle",expectedContentSHA:previewHash,expectedRevision:command["stale"] as? Bool==true ? model.currentRevision &+ 1 : model.currentRevision)
                        case "uiRetryAsset":await model.retryAsset()
                        case "uiCancelAsset":model.cancelAsset()
                        case "corruptAssetWire","rememberAssetWire":
                            guard let account=engine.identity?.account else {throw CreatorNativeEngine.Failure.retired}
                            let directory=root.appendingPathComponent(CreatorNativeState.hash(Data(account.utf8))),record=try CreatorNativeState.object(String(decoding:Data(contentsOf:directory.appendingPathComponent("drafts.json")),as:UTF8.self))
                            guard let asset=record["asset"] as? [String:Any],let key=asset["key"] as? String else {throw CreatorDraftState.Failure.invalid}
                            assetWire=directory.appendingPathComponent(key+".multipart");assetBackup=try Data(contentsOf:assetWire!);if name=="corruptAssetWire" {try (assetBackup!+Data([1])).write(to:assetWire!)}
                        case "restoreAssetWire":guard let assetWire,let assetBackup else {throw CreatorDraftState.Failure.invalid};try assetBackup.write(to:assetWire)
                        case "retainedAssetWire":value["retained"]=assetWire.map{FileManager.default.fileExists(atPath:$0.path)} ?? false
                        case "uiRetryOperation":await model.retryOperation()
                        case "uiCancelOperation":model.cancelOperation()
                        case "dropNextUpload":dropMutation=true
                        case "dropNextOperation":dropOperation=command["path"] as! String
                        case "legacyPendingOperation":
                            guard let account=engine.identity?.account else {throw CreatorNativeEngine.Failure.retired}
                            let file=root.appendingPathComponent(CreatorNativeState.hash(Data(account.utf8))).appendingPathComponent("drafts.json")
                            var saved=try CreatorNativeState.object(String(decoding:Data(contentsOf:file),as:UTF8.self))
                            guard var operation=saved["operation"] as? [String:Any],operation["method"] as? String=="POST" else {throw CreatorDraftState.Failure.invalid}
                            operation.removeValue(forKey:"method");saved["operation"]=operation
                            try JSONSerialization.data(withJSONObject:saved,options:[.sortedKeys]).write(to:file,options:.atomic)
                        case "uiUpload":
                            let file=root.appendingPathComponent("generated-original.mp4")
                            try Data([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,116,101,115,116]).write(to:file)
                            await model.stage(file:file,title:"Original Apple Creator upload",description:"Original isolated source",basis:"owned",source:"QA generated original content",license:"QA creator-controlled original",territories:"WORLDWIDE",evidence:"",owned:true)
                        case "uiRetryUpload":await model.retryUpload()
                        case "uiCancelUpload":model.cancelUpload()
                        case "uiRefresh":await model.refresh()
                        case "json":
                            let raw=(command["body"] as? [String:Any]).map{try! JSONSerialization.data(withJSONObject:$0)}
                            let bytes=try await CreatorHTTP.shared.accountData(command["path"] as! String,method:command["method"] as? String ?? "GET",body:raw,engine:engine)
                            value["json"]=try JSONSerialization.jsonObject(with:bytes)
                        case "cold":engine.close();engine=try create();model=createModel(engine);await model.restore()
                        case "mismatch":mismatch=command["enabled"] as! Bool;await model.restore()
                        case "holdNext":hold=true
                        case "release":held?.resume();held=nil
                        case "uiSignOut":await model.signOut()
                        case "suspend":model.suspend()
                        case "close":engine.close()
                        case "inspect":break
                        default:throw CreatorNativeEngine.Failure.invalidSource
                        }
                        value["held"]=held != nil;value["walletUrl"]=opened;value["connected"]=model.connected;value["pending"]=model.signOutPending;value["busy"]=model.busy
                        value["channelID"]=model.channelID;value["uploadPending"] = !model.pendingUploadTitle.isEmpty;value["operationPending"]=model.pendingOperation;value["message"]=model.message;value["assetPending"]=model.pendingAssetKind
                        value["businessVerified"]=engine.identity != nil;value["lastFailure"]=model.lastFailure
                        value["videos"]=(model.snapshot?.videos ?? []).map{["id":$0.id,"owner":$0.owner,"sha256":$0.sha256,"bytes":$0.bytes,"workflow":$0.workflow_state,"visibility":$0.visibility,"version":$0.version ?? 0,"reviewedBy":$0.reviewed_by ?? "","thumbnail":$0.thumbnail_key ?? "","captions":($0.captions ?? []).map{["key":$0.object_key,"language":$0.language,"label":$0.label,"aiProposed":$0.ai_proposed,"humanApproved":$0.human_approved] as [String:Any]}] as [String:Any]}
                        value["reviewableVideos"]=(model.snapshot?.videos ?? []).filter{model.canReview($0)}.count
                        value["team"]=(model.snapshot?.team ?? []).map {team in ["channelID":team.channel_id,"members":(team.members ?? []).map{["account":$0.account,"role":$0.role,"state":$0.state]},"invites":(team.invites ?? []).map{["id":$0.id,"account":$0.account,"role":$0.role,"state":$0.state]}] as [String:Any]}
                        value["rights"]=(model.snapshot?.rights ?? []).map{["id":$0.id,"videoID":$0.video_id,"declaredBy":$0.declared_by,"state":$0.state,"reviewer":$0.reviewer ?? ""]}
                        value["reports"]=(model.snapshot?.reports ?? []).map{["id":$0.id,"videoID":$0.VideoID,"state":$0.State,"canAppeal":model.canAppeal($0)] as [String:Any]}
                        value["appeals"]=(model.snapshot?.appeals ?? []).map{["id":$0.id,"reportID":$0.ReportID,"appellant":$0.Appellant,"state":$0.State,"reason":$0.Reason]}
                        value["disputes"]=(model.snapshot?.disputes ?? []).map{["id":$0.id,"recordID":$0.RevenueRecordID,"owner":$0.Owner,"state":$0.State]}
                        if let identity=engine.identity {value["account"]=identity.account;value["binding"]=identity.binding;value["deviceId"]=identity.context.deviceId;value["deviceKey"]=identity.context.deviceKey}
                        reply(id,["ok":true,"result":value])
                    }catch {reply(id,["ok":false,"code":String(describing:error),"businessVerified":engine.identity != nil])}
                }
            }
            engine.close()
        }catch {FileHandle.standardError.write(Data("Creator isolated engine QA failed: \(error)\n".utf8));exit(1)}
    }
}
