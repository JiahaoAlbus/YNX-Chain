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
            var persisted: Data?,opened="",mismatch=false,dropMutation=false,dropOperation="",assetBackup:Data?,assetWire:URL?,hold=false,dropStream=false,foreignStream=false,streamLines=0,legacyCancelledDelta=false,held: CheckedContinuation<Void,Never>?
            let key=CreatorDeviceKey(read:{(errSecSuccess,original.rawRepresentation)},add:{_ in errSecAuthFailed},create:{fatalError("QA must preserve generated original key")})
            var networkTrace=[[String:Any]]()
            var businessWindow=Int(Date().timeIntervalSince1970/60),businessRequests=0
            func businessBudget()->[String:Any] {
                let now=Date().timeIntervalSince1970,window=Int(now/60)
                if window != businessWindow {businessWindow=window;businessRequests=0}
                return ["remaining":120-businessRequests,"waitMilliseconds":Int((Double(window+1)*60-now)*1000)+100]
            }
            var dropStudio=false,holdStudio=false,failHeldStudio=false
            func trace(_ path:String,_ status:Int,_ mocked:Bool=false) {networkTrace.append(["path":path,"status":status,"mockedMismatch":mocked]);if networkTrace.count>64 {networkTrace.removeFirst(networkTrace.count-64)}}
            let network=CreatorNativeTransport()
            let sender: CreatorNativeEngine.Sender = { request,limit in
                let url=request.url!
                if url.host=="creator.ynxweb4.com" && hold { hold=false;await withCheckedContinuation { held=$0 } }
                if url.absoluteString==CreatorHTTP.api.absoluteString+"/v1/account" && mismatch {trace(url.path,200,true); return (Data("{\"schemaVersion\":1,\"account\":\"wrong-account\"}".utf8),HTTPURLResponse(url:url,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!) }
                let target: URL
                if url.host=="wallet-auth.ynxweb4.com" { target=URL(string:gateway.absoluteString+url.path)! }
                else if url.host=="creator.ynxweb4.com",url.path.hasPrefix("/video/api/") { target=URL(string:backend.absoluteString+url.path.dropFirst("/video/api".count))! }
                else { throw CreatorNativeEngine.Failure.invalidSource }
                var redirected=request;redirected.url=target
                if url.host=="creator.ynxweb4.com" {_ = businessBudget();businessRequests+=1}
                let (bytes,response)=try await network.send(redirected,limit);trace(url.path,response.statusCode)
                if url.path=="/video/api/v1/studio" {
                    if holdStudio {holdStudio=false;await withCheckedContinuation {held=$0};if failHeldStudio {failHeldStudio=false;throw CreatorHTTP.Failure.unexpectedResponse}}
                    if dropStudio {dropStudio=false;throw CreatorHTTP.Failure.unexpectedResponse}
                }
                if dropMutation,url.host=="creator.ynxweb4.com",url.path=="/video/api/v1/uploads",["POST","DELETE"].contains(request.httpMethod ?? "") { dropMutation=false;throw CreatorHTTP.Failure.unexpectedResponse }
                if !dropOperation.isEmpty,url.path=="/video/api"+dropOperation,(200..<300).contains(response.statusCode),request.httpMethod=="POST" {dropOperation="";throw CreatorHTTP.Failure.unexpectedResponse}
                var headers: [String:String]=[:];for (key,value) in response.allHeaderFields { headers[String(describing:key)]=String(describing:value) }
                return (bytes,HTTPURLResponse(url:url,statusCode:response.statusCode,httpVersion:nil,headerFields:headers)!)
            }
            let streamer:CreatorNativeEngine.StreamSender = {request,limit,receive in
                let original=request.url!;guard original.host=="creator.ynxweb4.com",original.path.hasPrefix("/video/api/v1/ai/jobs/") else {throw CreatorNativeEngine.Failure.invalidSource}
                var redirected=request;redirected.url=URL(string:backend.absoluteString+original.path.dropFirst("/video/api".count))!
                let response=try await network.stream(redirected,limit) {line in
                    streamLines+=1
                    if legacyCancelledDelta,var event=try JSONSerialization.jsonObject(with:line) as? [String:Any],event["state"] as? String=="cancelled" {
                        legacyCancelledDelta=false;event["delta"]="Isolated legacy cancelled partial";try receive(JSONSerialization.data(withJSONObject:event))
                    } else if foreignStream,var event=try JSONSerialization.jsonObject(with:line) as? [String:Any],var job=event["job"] as? [String:Any] {
                        foreignStream=false;job["ID"]="foreign_original_job";event["job"]=job;try receive(JSONSerialization.data(withJSONObject:event))
                    } else {try receive(line)}
                }
                if dropStream {dropStream=false;throw CreatorHTTP.Failure.unexpectedResponse}
                var headers:[String:String]=[:];for (key,value) in response.allHeaderFields {headers[String(describing:key)]=String(describing:value)}
                return HTTPURLResponse(url:original,statusCode:response.statusCode,httpVersion:nil,headerFields:headers)!
            }
            func create() throws -> CreatorNativeEngine {
                let state=try CreatorNativeState(platform:platform,deviceId:isolatedDevice,deviceKey:CreatorNativeState.encode(original.publicKey.compressedRepresentation),read:{persisted},write:{persisted=$0})
                return try CreatorNativeEngine(state:state,key:key,assets:assets,send:sender,stream:streamer,walletDetected:{true},openWallet:{url in opened=url.absoluteString;return true})
            }
            var engine=try create()
            var queuedSubmit:(@MainActor () async -> Void)?,submitCompletions=0
            func createModel(_ engine: CreatorNativeEngine) -> CreatorModel {
                CreatorModel(makeEngine:{engine},makeDrafts:{active,identity in
                    let epoch=active.epoch
                    return try CreatorDraftState(account:identity.account,root:root,require:{try active.require(identity,epoch)})
                },scheduleOperation:{work in queuedSubmit=work})
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
                        case "uiSubmitCaptured":model.submit(command["path"] as! String,body:command["body"] as? [String:Any] ?? [:],method:command["method"] as? String ?? "POST",onSuccess:{submitCompletions+=1})
                        case "uiReleaseSubmit":let work=queuedSubmit;queuedSubmit=nil;await work?()
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
                        case "uiDeclareRights":
                            let rows=(command["contributors"] as! [[String:String]]).map{CreatorModel.Contribution(account:$0["account"]!,percent:$0["percent"]!)}
                            await model.declareRights(videoID:command["videoID"] as! String,basis:"licensed",license:"Isolated original license",territories:"WORLDWIDE",start:Date().addingTimeInterval(-3600),end:Date().addingTimeInterval(365*86400),exclusive:true,contributors:rows,evidence:String(repeating:"b",count:64),expectedRevision:command["stale"] as? Bool==true ? model.currentRevision &+ 1 : model.currentRevision)
                        case "uiAIProvider":await model.checkAIProvider()
                        case "uiPrepareAI":await model.prepareAI(videoID:command["videoID"] as! String,kind:command["kind"] as? String ?? "summary",classes:["metadata"],language:"zh-CN",expectedRevision:command["stale"] as? Bool==true ? model.currentRevision &+ 1 : model.currentRevision)
                        case "uiOpenAI":await model.openAI(command["jobID"] as! String,expectedRevision:model.currentRevision)
                        case "uiApproveAI":await model.approveAI(command["jobID"] as! String,expectedRevision:model.currentRevision)
                        case "uiCancelAI":await model.cancelAI(command["jobID"] as! String,expectedRevision:model.currentRevision)
                        case "uiRetryAICancel":await model.retryAICancel()
                        case "uiReviewAI":await model.reviewAI(command["jobID"] as! String,apply:command["apply"] as! Bool,expectedRevision:model.currentRevision)
                        case "uiDeleteAI":await model.deleteAI(command["jobID"] as! String,expectedRevision:model.currentRevision)
                        case "dropNextStream":dropStream=true
                        case "legacyCancelledDelta":legacyCancelledDelta=true
                        case "foreignStreamJob":foreignStream=true
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
                            await model.stage(file:file,title:"Original Apple Creator upload",description:"Original isolated source",basis:"owned",source:"QA generated original content",license:"QA creator-controlled original",territories:"WORLDWIDE",evidence:"",owned:true,expires:(command["expires"] as? String).flatMap{ISO8601DateFormatter().date(from:$0)})
                        case "uiRetryUpload":await model.retryUpload()
                        case "uiCancelUpload":model.cancelUpload()
                        case "uiRefresh":await model.refresh()
                        case "rateBudget":value["originalBusinessBudget"]=businessBudget()
                        case "uiRestore":await model.restore()
                        case "dropNextStudio":dropStudio=true
                        case "holdNextStudio":holdStudio=true
                        case "json":
                            let raw=(command["body"] as? [String:Any]).map{try! JSONSerialization.data(withJSONObject:$0)}
                            let bytes=try await CreatorHTTP.shared.accountData(command["path"] as! String,method:command["method"] as? String ?? "GET",body:raw,engine:engine)
                            value["json"]=try JSONSerialization.jsonObject(with:bytes)
                        case "cold":engine.close();engine=try create();model=createModel(engine);await model.restore()
                        case "mismatch":mismatch=command["enabled"] as! Bool;await model.restore()
                        case "holdNext":hold=true
                        case "release":failHeldStudio=command["failStudio"] as? Bool==true;held?.resume();held=nil
                        case "uiSignOut":await model.signOut()
                        case "suspend":model.suspend()
                        case "close":engine.close()
                        case "inspect":break
                        default:throw CreatorNativeEngine.Failure.invalidSource
                        }
                        value["held"]=held != nil;value["walletUrl"]=opened;value["connected"]=model.connected;value["pending"]=model.signOutPending;value["busy"]=model.busy
                        value["channelID"]=model.channelID;value["uploadPending"] = !model.pendingUploadTitle.isEmpty;value["operationPending"]=model.pendingOperation;value["message"]=model.message;value["assetPending"]=model.pendingAssetKind
                        value["submitQueued"]=queuedSubmit != nil;value["submitCompletions"]=submitCompletions;value["businessVerified"]=engine.identity != nil;value["lastFailure"]=model.lastFailure;value["sdkStatus"]=engine.lastStatus;value["sdkFailure"]=engine.lastFailure;value["networkTail"]=Array(networkTrace.suffix(8))
                        value["studioReadState"]=model.studioReadState.rawValue;value["studioReady"]=model.studioReady;value["studioReadFailurePhase"]=model.studioReadFailurePhase
                        value["videos"]=(model.snapshot?.videos ?? []).map{["id":$0.id,"owner":$0.owner,"title":$0.title,"description":$0.description,"sha256":$0.sha256,"uploadExpiry":$0.rights?.expires_at ?? "","bytes":$0.bytes,"workflow":$0.workflow_state,"visibility":$0.visibility,"version":$0.version ?? 0,"reviewedBy":$0.reviewed_by ?? "","scheduledAt":$0.scheduled_at ?? "","versions":($0.versions ?? []).map{["sequence":$0.sequence,"actor":$0.actor,"kind":$0.kind,"at":$0.recorded_at,"contentHash":$0.content_sha256] as [String:Any]},"thumbnail":$0.thumbnail_key ?? "","captions":($0.captions ?? []).map{["key":$0.object_key,"language":$0.language,"label":$0.label,"aiProposed":$0.ai_proposed,"humanApproved":$0.human_approved] as [String:Any]}] as [String:Any]}
                        value["reviewableVideos"]=(model.snapshot?.videos ?? []).filter{model.canReview($0)}.count
                        value["team"]=(model.snapshot?.team ?? []).map {team in ["channelID":team.channel_id,"authVersion":team.auth_version ?? 0,"members":(team.members ?? []).map{["account":$0.account,"role":$0.role,"state":$0.state]},"invites":(team.invites ?? []).map{["id":$0.id,"account":$0.account,"role":$0.role,"state":$0.state,"expires":$0.expires_at ?? ""]}] as [String:Any]}
                        value["rights"]=(model.snapshot?.rights ?? []).map{["id":$0.id,"videoID":$0.video_id,"declaredBy":$0.declared_by,"state":$0.state,"reviewer":$0.reviewer ?? "","sourceHash":$0.source_sha256,"territories":$0.territories ?? [],"license":$0.license_reference ?? "","start":$0.starts_at ?? "","end":$0.ends_at ?? "","exclusive":$0.exclusive ?? false,"splits":($0.contributor_splits ?? []).map{["account":$0.account,"points":$0.basis_points] as [String:Any]}]}
                        value["reports"]=(model.snapshot?.reports ?? []).map{["id":$0.id,"videoID":$0.VideoID,"state":$0.State,"canAppeal":model.canAppeal($0)] as [String:Any]}
                        value["appeals"]=(model.snapshot?.appeals ?? []).map{["id":$0.id,"reportID":$0.ReportID,"appellant":$0.Appellant,"state":$0.State,"reason":$0.Reason]}
                        value["revenue"]=(model.snapshot?.revenue ?? []).map{["id":$0.id,"videoID":$0.VideoID,"owner":$0.Owner,"receipt":$0.PayReceiptID,"amount":$0.AmountYNXT,"canDispute":model.canDispute($0)] as [String:Any]}
                        value["canRequestPayout"]=model.canRequestPayout
                        value["disputes"]=(model.snapshot?.disputes ?? []).map{["id":$0.id,"recordID":$0.RevenueRecordID,"owner":$0.Owner,"state":$0.State]}
                        value["aiStreaming"]=model.aiStreaming;value["aiPartial"]=model.aiPartial;value["aiStreamLines"]=streamLines;value["aiCancelPending"]=model.pendingAICancel;value["aiProvider"]=model.aiProviderAvailable as Any? ?? NSNull()
                        value["aiJobs"]=(model.snapshot?.ai_jobs ?? []).map{["id":$0.id,"owner":$0.Owner,"state":$0.State,"language":$0.OutputLanguage,"provider":$0.Provider,"result":$0.Result]}
                        if let job=model.selectedAI {value["selectedAI"]=["id":job.id,"owner":job.Owner,"state":job.State,"language":job.OutputLanguage,"preview":job.ContextPreview,"units":job.EstimatedUnits,"provider":job.Provider,"result":job.Result] as [String:Any]}
                        if let identity=engine.identity {value["account"]=identity.account;value["binding"]=identity.binding;value["deviceId"]=identity.context.deviceId;value["deviceKey"]=identity.context.deviceKey}
                        reply(id,["ok":true,"result":value])
                    }catch {reply(id,["ok":false,"code":String(describing:error),"businessVerified":engine.identity != nil])}
                }
            }
            engine.close()
        }catch {FileHandle.standardError.write(Data("Creator isolated engine QA failed: \(error)\n".utf8));exit(1)}
    }
}
