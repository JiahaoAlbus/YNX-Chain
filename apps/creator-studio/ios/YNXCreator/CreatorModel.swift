import Combine
import Foundation

struct CreatorVideo: Decodable, Identifiable {
    let id, owner, channel_id, title, description, status, visibility, workflow_state, sha256: String
    let bytes: Int
    let rights_declaration_id: String?
    let version: UInt64?
    let reviewed_by: String?
}
struct CreatorSnapshot: Decodable {
    struct Analytics: Decodable { let views, watch_seconds, subscribers, revenue_ynxt: Int; let source: String }
    struct Team: Decodable, Identifiable {
        struct Member: Decodable {let account,role,state: String}
        struct Invite: Decodable,Identifiable {let id,channel_id,account,role,state: String}
        let channel_id: String
        let members: [Member]?
        let invites: [Invite]?
        var id:String {channel_id}
    }
    struct Rights: Decodable,Identifiable {let id,video_id,declared_by,basis,state,evidence_sha256,source_sha256: String;let reviewer: String?}
    struct Revenue: Decodable,Identifiable { let recordID,Owner,PayReceiptID: String;let AmountYNXT: Int;var id:String {recordID};enum CodingKeys:String,CodingKey {case recordID="ID",Owner,PayReceiptID,AmountYNXT} }
    struct Payout: Decodable,Identifiable { let intentID,Owner,State: String;let AmountYNXT: Int;var id:String {intentID};enum CodingKeys:String,CodingKey {case intentID="ID",Owner,State,AmountYNXT} }
    let videos: [CreatorVideo]?
    let analytics: Analytics
    let team: [Team]?
    let revenue: [Revenue]?
    let payout_intents: [Payout]?
    let rights: [Rights]?
}

@MainActor final class CreatorModel: ObservableObject {
    @Published var connected=false
    @Published var busy=false
    @Published var signOutPending=false
    @Published var awaitingWallet=false
    @Published var account=""
    @Published var message=""
    @Published var channelID=""
    @Published var pendingUploadTitle=""
    @Published var pendingOperation=false
    @Published var snapshot: CreatorSnapshot?
    @Published var locale=UserDefaults.standard.string(forKey:"ynx.creator.locale") ?? (Locale.current.identifier.hasPrefix("zh") ? "zh-CN" : "en")
    private(set) var engine: CreatorNativeEngine?
    private(set) var lastFailure=""
    private var drafts: CreatorDraftState?
    private var visibleIdentity: CreatorNativeEngine.Identity?
    private var visibleEpoch: UInt64?
    private var revision: UInt64=0
    var currentRevision: UInt64 {revision}
    private var started=false
    private let makeEngine: @MainActor () throws -> CreatorNativeEngine
    private let makeDrafts: @MainActor (CreatorNativeEngine,CreatorNativeEngine.Identity) throws -> CreatorDraftState
    private var catalog: [String:[String:String]]=[:]
    init(makeEngine: @escaping @MainActor () throws -> CreatorNativeEngine=CreatorNativeEngine.live,makeDrafts: @escaping @MainActor (CreatorNativeEngine,CreatorNativeEngine.Identity) throws -> CreatorDraftState=CreatorDraftState.live) {
        self.makeEngine=makeEngine;self.makeDrafts=makeDrafts
        if let file=Bundle.main.url(forResource:"catalog",withExtension:"json"),let bytes=try? Data(contentsOf:file),let parsed=try? JSONDecoder().decode([String:[String:String]].self,from:bytes) {catalog=parsed}
    }
    func text(_ key: String) -> String { catalog[locale]?[key] ?? catalog["en"]?[key] ?? key }
    func language(_ value: String) {locale=value;UserDefaults.standard.set(value,forKey:"ynx.creator.locale")}
    func number(_ value: Int) -> String {value.formatted(.number.locale(Locale(identifier:locale)))}
    private func clear() {connected=false;account="";snapshot=nil;drafts=nil;visibleIdentity=nil;visibleEpoch=nil;channelID="";pendingUploadTitle="";pendingOperation=false}
    private func ensure() throws -> CreatorNativeEngine {
        if let engine {return engine};let created=try makeEngine();engine=created
        created.onChange={ [weak self,weak created] in
            guard let self,let created,self.engine === created else {return}
            guard let identity=created.identity else {self.clear();return}
            // prepareRequest publishes the same verified SDK identity. Keep
            // its original draft controller so a previously acknowledged
            // operation cannot reappear from a stale in-memory snapshot.
            if self.visibleIdentity==identity,self.visibleEpoch==created.epoch,self.drafts != nil {return}
            do {
                let store=try self.makeDrafts(created,identity);self.drafts=store
                self.visibleIdentity=identity;self.visibleEpoch=created.epoch
                self.connected=true;self.account=identity.account
                self.pendingUploadTitle=try store.pendingUpload()?.title ?? ""
                self.pendingOperation=try store.pendingOperation() != nil
            } catch {self.clear();self.message=self.text("draftUnavailable")}
        }
        return created
    }
    func start() async {guard !started else {return};started=true;await auth("restore")}
    func signIn() async {
        guard !busy,!signOutPending else {return}
        await auth("disconnect");guard !signOutPending else {return};await auth("connect")
    }
    func signOut() async {await auth("disconnect")}
    func restore() async {await auth("restore")}
    private func auth(_ method: String,args: [String:Any]=[:],replaceBusy: Bool=false) async {
        guard !busy || replaceBusy else {return};revision &+= 1;let captured=revision;busy=true;clear()
        if method=="disconnect" {signOutPending=true}
        defer {if captured==revision {busy=false}}
        do {
            let active=try ensure(),reply=try await active.dispatch(method,args)
            guard captured==revision else {return}
            let result=reply["state"] as? [String:Any] ?? reply,status=result["status"] as? String ?? "retry-required"
            if active.identity != nil || ["disconnected","expired"].contains(status) {signOutPending=false}
            else if status=="revocation-pending" || result["revocationPending"] as? Bool==true {signOutPending=true}
            awaitingWallet=status=="connecting"
            message=connected ? "" : awaitingWallet ? text("walletPending") : signOutPending ? text("signOutRetry") : text("signIn")
            if connected {try await refreshCaptured(active,captured)}
        } catch {if captured==revision {message=text("retryRequired")}}
    }
    func handle(url: URL) {
        guard url.scheme=="ynxcreator",url.host=="wallet-auth",url.path=="/callback",url.user==nil,url.password==nil,url.port==nil,url.fragment==nil,url.absoluteString.count<=32768 else {return}
        // A callback supersedes any in-flight original attempt. Late responses
        // cannot restore a former account or publish its private studio.
        revision &+= 1;busy=false;engine?.suspend();clear()
        Task {@MainActor in await auth("handleReturn",args:["url":url.absoluteString],replaceBusy:true)}
    }
    func suspend() {revision &+= 1;busy=false;engine?.suspend();clear()}
    private func require(_ active: CreatorNativeEngine,_ captured: UInt64) throws {guard captured==revision,connected,engine === active else {throw CancellationError()}}
    private func refreshCaptured(_ active: CreatorNativeEngine,_ captured: UInt64) async throws {
        let data=try await CreatorHTTP.shared.accountData("/v1/studio",engine:active,guardRequest:{try self.require(active,captured)})
        try require(active,captured);let fresh=try JSONDecoder().decode(CreatorSnapshot.self,from:data)
        guard let identity=active.identity,(fresh.revenue ?? []).allSatisfy({$0.Owner==identity.account}),(fresh.payout_intents ?? []).allSatisfy({$0.Owner==identity.account}),
              (fresh.videos ?? []).allSatisfy({CreatorDraftState.validID($0.id) && CreatorDraftState.validID($0.channel_id) && CreatorNativeState.matches($0.owner,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$")}) else {throw CreatorHTTP.Failure.unexpectedResponse}
        snapshot=fresh
        if channelID.isEmpty {channelID=fresh.team?.first?.channel_id ?? fresh.videos?.first?.channel_id ?? ""}
    }
    func refresh() async {
        guard !busy,let active=engine else {return};busy=true;let captured=revision
        defer {if captured==revision {busy=false}}
        do {try await refreshCaptured(active,captured);message=""}catch {if captured==revision {message=text("retryRequired")}}
    }
    func stage(file: URL,title: String,description: String,basis: String,source: String,license: String,territories: String,evidence: String,owned: Bool,expectedRevision: UInt64?=nil) async {
        guard !busy,expectedRevision==nil || expectedRevision==revision,let store=drafts else {return};let captured=revision
        do {_ = try store.stage(file:file,channelID:channelID,title:title,description:description,basis:basis,source:source,license:license,territories:territories,evidence:evidence.lowercased(),owned:owned);pendingUploadTitle=title}
        catch {if captured==revision {message=text("uploadInvalid")};return}
        await retryUpload()
    }
    func retryUpload() async {
        guard !busy,let active=engine,let store=drafts else {return};busy=true;let captured=revision
        defer {if captured==revision {busy=false}}
        do {
            guard let upload=try store.pendingUpload() else {return};let wire=try store.wire(upload)
            let data=try await CreatorHTTP.shared.accountData("/v1/uploads",method:"POST",file:wire,contentType:upload.contentType,engine:active,requestKey:upload.key,guardRequest:{try self.require(active,captured)})
            try require(active,captured);let original=try JSONDecoder().decode(CreatorVideo.self,from:data)
            guard original.channel_id==upload.channelID,original.sha256==upload.contentSHA,original.bytes==upload.mediaBytes,original.title==upload.title,CreatorDraftState.validID(original.id) else {throw CreatorHTTP.Failure.unexpectedResponse}
            try await refreshCaptured(active,captured)
            guard snapshot?.videos?.contains(where:{$0.id==original.id && $0.owner==original.owner && $0.sha256==upload.contentSHA && $0.channel_id==upload.channelID})==true else {throw CreatorHTTP.Failure.unexpectedResponse}
            try store.acknowledge(upload);pendingUploadTitle="";message=text("uploadSaved")
        } catch {if captured==revision {message=text("uploadUnconfirmed");try? await refreshCaptured(active,captured)}}
    }
    func cancelUpload() {guard !busy else {return};do {try drafts?.cancelUpload();pendingUploadTitle="";message=text("cancelRetained")}catch {message=text("draftUnavailable")}}
    func perform(_ path: String,body: [String:Any]=[:],method:String="POST") async {
        guard !busy,let store=drafts else {return}
        do {_ = try store.reserve(path:path,body:body,method:method);pendingOperation=true}catch {lastFailure=String(describing:error);message=text("operationPending");return}
        await retryOperation()
    }
    func retryOperation() async {
        guard !busy,let active=engine,let store=drafts else {return};busy=true;let captured=revision
        defer {if captured==revision {busy=false}}
        do {
            guard let operation=try store.pendingOperation() else {return}
            let data=try await CreatorHTTP.shared.accountData(operation.path,method:operation.method,body:Data(operation.body.utf8),engine:active,requestKey:operation.key,guardRequest:{try self.require(active,captured)})
            try require(active,captured)
            if operation.path=="/v1/channels",let channel=try JSONSerialization.jsonObject(with:data) as? [String:Any],let id=channel["ID"] as? String,CreatorDraftState.validID(id),channel["Owner"] as? String==account {channelID=id}
            try await refreshCaptured(active,captured);try store.acknowledge(operation);pendingOperation=false;message=""
        } catch {if captured==revision {lastFailure=String(describing:error);message=text("operationPending");try? await refreshCaptured(active,captured)}}
    }
    func cancelOperation() {guard !busy else {return};do {try drafts?.cancelOperation();pendingOperation=false;message=text("cancelRetained")}catch {message=text("draftUnavailable")}}
    func role(_ channel: String) -> String? {snapshot?.team?.first(where:{$0.channel_id==channel})?.members?.first(where:{$0.account==account && $0.state=="active"})?.role}
    func canReview(_ video: CreatorVideo) -> Bool {connected && video.owner != account && role(video.channel_id)=="moderator"}
}
