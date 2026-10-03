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
            let assets=URL(fileURLWithPath:args[1]),platform=args[4],original=P256.Signing.PrivateKey()
            let root=FileManager.default.temporaryDirectory.appendingPathComponent("ynx-creator-qa-"+UUID().uuidString,isDirectory:true)
            try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
            defer {try? FileManager.default.removeItem(at:root)}
            var persisted: Data?,opened="",mismatch=false,dropMutation=false,hold=false,held: CheckedContinuation<Void,Never>?
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
                var headers: [String:String]=[:];for (key,value) in response.allHeaderFields { headers[String(describing:key)]=String(describing:value) }
                return (bytes,HTTPURLResponse(url:url,statusCode:response.statusCode,httpVersion:nil,headerFields:headers)!)
            }
            func create() throws -> CreatorNativeEngine {
                let state=try CreatorNativeState(platform:platform,deviceId:"qa-original-apple-creator-device",deviceKey:CreatorNativeState.encode(original.publicKey.compressedRepresentation),read:{persisted},write:{persisted=$0})
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
                        case "uiPerform":await model.perform(command["path"] as! String,body:command["body"] as? [String:Any] ?? [:])
                        case "uiRetryOperation":await model.retryOperation()
                        case "uiCancelOperation":model.cancelOperation()
                        case "dropNextUpload":dropMutation=true
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
                        value["channelID"]=model.channelID;value["uploadPending"] = !model.pendingUploadTitle.isEmpty;value["operationPending"]=model.pendingOperation;value["message"]=model.message
                        value["businessVerified"]=engine.identity != nil;value["lastFailure"]=model.lastFailure
                        value["videos"]=(model.snapshot?.videos ?? []).map{["id":$0.id,"owner":$0.owner,"sha256":$0.sha256,"bytes":$0.bytes,"workflow":$0.workflow_state,"visibility":$0.visibility] as [String:Any]}
                        if let identity=engine.identity {value["account"]=identity.account;value["binding"]=identity.binding}
                        reply(id,["ok":true,"result":value])
                    }catch {reply(id,["ok":false,"code":String(describing:error),"businessVerified":engine.identity != nil])}
                }
            }
            engine.close()
        }catch {FileHandle.standardError.write(Data("Creator isolated engine QA failed: \(error)\n".utf8));exit(1)}
    }
}
