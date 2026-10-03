import Combine
import Foundation

struct CreatorVideo: Decodable, Identifiable {
    let id, owner, channel_id, title, description, status, visibility, workflow_state, sha256: String
    let bytes: Int
    let rights_declaration_id: String?
    let version: UInt64?
    let reviewed_by: String?
    struct Caption:Decodable,Equatable {let language,label,object_key:String;let ai_proposed,human_approved:Bool}
    let thumbnail_key:String?
    let captions:[Caption]?
}
struct CreatorAIJob:Decodable,Identifiable,Equatable {
    let recordID,Owner,VideoID,Kind,State,Provider,Model,Failure,OutputLanguage,ContextPreview,Result,Partial:String
    let ContextClasses:[String]?
    let EstimatedUnits:Int
    let Accepted:Bool
    var id:String {recordID}
    enum CodingKeys:String,CodingKey {case recordID="ID",Owner,VideoID,Kind,State,Provider,Model,Failure,OutputLanguage,ContextPreview,Result,Partial,ContextClasses,EstimatedUnits,Accepted}
    @MainActor func valid(_ account:String) -> Bool {
        Owner==account && CreatorDraftState.validID(id) && CreatorDraftState.validID(VideoID) && ["awaiting_permission","running","review_required","accepted_suggestion","rejected","cancelled","recovery_required"].contains(State) && Result.utf8.count<=200000 && Partial.utf8.count<=200000 && ContextPreview.utf8.count<=10000 && EstimatedUnits>=0
    }
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
    struct Rights:Decodable,Identifiable {
        struct Split:Decodable {let account:String;let basis_points:Int}
        let id,video_id,declared_by,basis,state,evidence_sha256,source_sha256:String
        let reviewer,license_reference,starts_at,ends_at:String?
        let territories:[String]?
        let exclusive:Bool?
        let contributor_splits:[Split]?
    }
    struct Revenue: Decodable,Identifiable { let recordID,VideoID,Owner,PayReceiptID: String;let AmountYNXT: Int;var id:String {recordID};enum CodingKeys:String,CodingKey {case recordID="ID",VideoID,Owner,PayReceiptID,AmountYNXT} }
    struct Report: Decodable,Identifiable {
        let recordID,VideoID,Reporter,Reason,Details,State:String
        var id:String {recordID}
        enum CodingKeys:String,CodingKey {case recordID="ID",VideoID,Reporter,Reason,Details,State}
    }
    struct Appeal: Decodable,Identifiable {
        let recordID,ReportID,VideoID,Appellant,Reason,State:String
        var id:String {recordID}
        enum CodingKeys:String,CodingKey {case recordID="ID",ReportID,VideoID,Appellant,Reason,State}
    }
    struct Dispute: Decodable,Identifiable {
        let recordID,Owner,RevenueRecordID,Reason,State:String
        var id:String {recordID}
        enum CodingKeys:String,CodingKey {case recordID="ID",Owner,RevenueRecordID,Reason,State}
    }
    struct Payout: Decodable,Identifiable { let intentID,Owner,State: String;let AmountYNXT: Int;var id:String {intentID};enum CodingKeys:String,CodingKey {case intentID="ID",Owner,State,AmountYNXT} }
    let videos: [CreatorVideo]?
    let analytics: Analytics
    let team: [Team]?
    let revenue: [Revenue]?
    let payout_intents: [Payout]?
    let rights: [Rights]?
    let reports: [Report]?
    let appeals: [Appeal]?
    let disputes: [Dispute]?
    let ai_jobs:[CreatorAIJob]?
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
    @Published var pendingAssetKind=""
    @Published var selectedAI:CreatorAIJob?
    @Published var aiStreaming=false
    @Published var aiPartial=""
    @Published var aiCancelling=false
    @Published var pendingAICancel=false
    @Published var aiProviderAvailable:Bool?
    private var aiSelection:UInt64=0
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
    private func clear() {connected=false;account="";snapshot=nil;drafts=nil;visibleIdentity=nil;visibleEpoch=nil;channelID="";pendingUploadTitle="";pendingOperation=false;pendingAssetKind="";selectedAI=nil;aiStreaming=false;aiPartial="";aiCancelling=false;pendingAICancel=false;aiProviderAvailable=nil;aiSelection &+= 1}
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
                self.pendingAssetKind=try store.pendingAsset()?.kind ?? ""
                self.pendingAICancel=try store.pendingAICancel() != nil
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
            if connected {
                try await refreshCaptured(active,captured)
                if let cancel=try drafts?.pendingAICancel() {let id=String(cancel.path.split(separator:"/")[3]);selectedAI=snapshot?.ai_jobs?.first(where:{$0.id==id})}
                else if let operation=try drafts?.pendingOperation(),operation.path.hasSuffix("/stream") {let id=String(operation.path.split(separator:"/")[3]);selectedAI=snapshot?.ai_jobs?.first(where:{$0.id==id})}
            }
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
        guard let identity=active.identity,(fresh.revenue ?? []).allSatisfy({Self.financialAccess(fresh,identity.account,$0)}),(fresh.payout_intents ?? []).allSatisfy({$0.Owner==identity.account}),(fresh.disputes ?? []).allSatisfy({dispute in fresh.revenue?.contains(where:{$0.id==dispute.RevenueRecordID && $0.Owner==dispute.Owner && Self.financialAccess(fresh,identity.account,$0)})==true}),(fresh.ai_jobs ?? []).allSatisfy({$0.valid(identity.account)}),
              (fresh.videos ?? []).allSatisfy({CreatorDraftState.validID($0.id) && CreatorDraftState.validID($0.channel_id) && CreatorNativeState.matches($0.owner,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$")}) else {throw CreatorHTTP.Failure.unexpectedResponse}
        snapshot=fresh
        if let selectedAI {self.selectedAI=fresh.ai_jobs?.first(where:{$0.id==selectedAI.id})}

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
    func perform(_ path: String,body: [String:Any]=[:],method:String="POST",expectedRevision:UInt64?=nil) async {
        guard !busy,pendingAssetKind.isEmpty,expectedRevision==nil || expectedRevision==revision,let store=drafts else {return}
        do {_ = try store.reserve(path:path,body:body,method:method);pendingOperation=true}catch {lastFailure=String(describing:error);message=text("operationPending");return}
        await retryOperation()
    }
    func retryOperation() async {
        guard !busy,let active=engine,let store=drafts else {return};busy=true;let captured=revision
        defer {if captured==revision {busy=false}}
        do {
            guard let operation=try store.pendingOperation() else {return}
            if CreatorNativeState.matches(operation.path,"^/v1/ai/jobs/[A-Za-z0-9_-]{1,160}/stream$") {try await runSavedAI(active,store,operation,captured);return}
            let data=try await CreatorHTTP.shared.accountData(operation.path,method:operation.method,body:Data(operation.body.utf8),engine:active,requestKey:operation.key,guardRequest:{try self.require(active,captured)})
            try require(active,captured)
            if operation.path=="/v1/channels",let channel=try JSONSerialization.jsonObject(with:data) as? [String:Any],let id=channel["ID"] as? String,CreatorDraftState.validID(id),channel["Owner"] as? String==account {channelID=id}
            try await refreshCaptured(active,captured)
            if operation.path=="/v1/ai/jobs" {
                let job=try JSONDecoder().decode(CreatorAIJob.self,from:data);guard job.valid(account),let original=snapshot?.ai_jobs?.first(where:{$0.id==job.id}) else {throw CreatorHTTP.Failure.unexpectedResponse};selectedAI=original;aiSelection &+= 1
            }
            try store.acknowledge(operation);pendingOperation=false;message=""
        } catch {if captured==revision {lastFailure=String(describing:error);message=text("operationPending");try? await refreshCaptured(active,captured)}}
    }
    func cancelOperation() {guard !busy else {return};do {try drafts?.cancelOperation();pendingOperation=false;message=text("cancelRetained")}catch {message=text("draftUnavailable")}}
    func checkAIProvider() async {
        guard !busy,let active=engine,connected else {return};let captured=revision
        do {
            let data=try await CreatorHTTP.shared.accountData("/v1/ai/status",engine:active,guardRequest:{try self.require(active,captured)});try require(active,captured)
            guard let body=try JSONSerialization.jsonObject(with:data) as? [String:Any],let configured=body["configured"] as? Bool else {throw CreatorHTTP.Failure.unexpectedResponse};aiProviderAvailable=configured
        } catch {if captured==revision {aiProviderAvailable=nil}}
    }
    func prepareAI(videoID:String,kind:String,classes:[String],language:String,expectedRevision:UInt64) async {
        guard expectedRevision==revision,let video=snapshot?.videos?.first(where:{$0.id==videoID}),canManageAssets(video),["summary","chapters","captions","metadata","search_assistance","moderation_explanation"].contains(kind),classes.allSatisfy({["metadata","captions"].contains($0)}),["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"].contains(language) else {return}
        await perform("/v1/ai/jobs",body:["video_id":videoID,"kind":kind,"context_classes":classes,"output_language":language],expectedRevision:expectedRevision)
    }
    private func readAI(_ id:String,_ active:CreatorNativeEngine,_ captured:UInt64) async throws -> CreatorAIJob {
        guard CreatorDraftState.validID(id) else {throw CreatorHTTP.Failure.invalidPath}
        let data=try await CreatorHTTP.shared.accountData("/v1/ai/jobs/"+id,engine:active,guardRequest:{try self.require(active,captured)})
        try require(active,captured);let job=try JSONDecoder().decode(CreatorAIJob.self,from:data)
        guard job.id==id,job.valid(account) else {throw CreatorHTTP.Failure.unexpectedResponse};return job
    }
    func openAI(_ id:String,expectedRevision:UInt64) async {
        guard !busy,expectedRevision==revision,let active=engine else {return};busy=true;let captured=revision;aiSelection &+= 1;let selection=aiSelection;selectedAI=nil;aiPartial=""
        defer {if captured==revision {busy=false}}
        do {let original=try await readAI(id,active,captured);guard selection==aiSelection else {return};selectedAI=original;message=""}
        catch {if captured==revision,selection==aiSelection {message=text("aiUnavailable")}}
    }
    func approveAI(_ id:String,expectedRevision:UInt64) async {
        guard expectedRevision==revision,selectedAI?.id==id,selectedAI?.State=="awaiting_permission" else {return}
        await perform("/v1/ai/jobs/"+id+"/stream",expectedRevision:expectedRevision)
    }
    private func runSavedAI(_ active:CreatorNativeEngine,_ store:CreatorDraftState,_ operation:CreatorDraftState.Operation,_ captured:UInt64) async throws {
        let id=String(operation.path.split(separator:"/")[3]);let original=try await readAI(id,active,captured)
        selectedAI=original;aiSelection &+= 1;let selection=aiSelection
        if original.State=="running" || original.State=="recovery_required" {message=text("aiUnknown");return}
        if original.State != "awaiting_permission" {try store.acknowledge(operation);pendingOperation=false;message="";return}
        aiStreaming=true;aiPartial="";var terminal=false
        defer {if captured==revision,selection==aiSelection {aiStreaming=false}}
        try await CreatorHTTP.shared.streamAI(operation,engine:active,guardRequest:{try self.require(active,captured)}) {line in
            guard selection==self.aiSelection,!terminal,let text=String(data:line,encoding:.utf8),let value=try JSONSerialization.jsonObject(with:Data(text.utf8)) as? [String:Any],Set(value.keys).isSubset(of:["state","delta","job","error"]),["starting","running","review_required","cancelled","recovery_required","failed"].contains(value["state"] as? String ?? "") else {throw CreatorHTTP.Failure.unexpectedResponse}
            if value["error"] != nil {throw CreatorHTTP.Failure.unexpectedResponse}
            if let delta=value["delta"] {guard let delta=delta as? String,self.aiPartial.utf8.count+delta.utf8.count<=200000,value["state"] as? String=="running" else {throw CreatorHTTP.Failure.unexpectedResponse};self.aiPartial += delta}
            if let result=value["job"] {
                let job=try JSONDecoder().decode(CreatorAIJob.self,from:JSONSerialization.data(withJSONObject:result))
                guard job.id==id,job.valid(self.account),["review_required","cancelled","recovery_required"].contains(job.State),value["state"] as? String==job.State else {throw CreatorHTTP.Failure.unexpectedResponse};self.selectedAI=job;terminal=true
            }
        }
        try require(active,captured);guard terminal else {throw CreatorHTTP.Failure.unexpectedResponse}
        let confirmed=try await readAI(id,active,captured);guard confirmed.State != "running",confirmed.State != "awaiting_permission" else {throw CreatorHTTP.Failure.unexpectedResponse}
        try await refreshCaptured(active,captured);selectedAI=confirmed;try store.acknowledge(operation);pendingOperation=false;aiPartial="";message=""
    }
    func cancelAI(_ id:String,expectedRevision:UInt64) async {
        guard connected,expectedRevision==revision,!aiCancelling,let store=drafts,selectedAI?.id==id,["awaiting_permission","running"].contains(selectedAI?.State ?? "") || aiStreaming else {return}
        do {_ = try store.reserveAICancel(id);pendingAICancel=true}catch {message=text("aiCancelUnknown");return}
        await retryAICancel()
    }
    func retryAICancel() async {
        guard connected,!aiCancelling,let active=engine,let store=drafts else {return};aiCancelling=true;let captured=revision
        defer {if captured==revision {aiCancelling=false}}
        do {
            guard let operation=try store.pendingAICancel() else {return};let id=String(operation.path.split(separator:"/")[3]);var job=try await readAI(id,active,captured)
            if ["awaiting_permission","running"].contains(job.State) {
                _ = try await CreatorHTTP.shared.accountData(operation.path,method:"POST",body:Data(operation.body.utf8),engine:active,requestKey:operation.key,guardRequest:{try self.require(active,captured)})
                job=try await readAI(id,active,captured)
            }
            guard !["awaiting_permission","running"].contains(job.State) else {throw CreatorHTTP.Failure.unexpectedResponse}
            try require(active,captured);try store.acknowledgeAICancel(operation);pendingAICancel=false
            if selectedAI?.id==id {selectedAI=job};message=job.State=="cancelled" ? text("aiCancelled") : text("aiCancelTooLate")
            try await refreshCaptured(active,captured)
        }catch {if captured==revision {lastFailure=String(describing:error);message=text("aiCancelUnknown")}}
    }
    func reviewAI(_ id:String,apply:Bool,expectedRevision:UInt64) async {
        guard expectedRevision==revision,selectedAI?.id==id,selectedAI?.State=="review_required" else {return}
        await perform("/v1/ai/jobs/"+id+"/review",body:["apply":apply],expectedRevision:expectedRevision)
    }
    func deleteAI(_ id:String,expectedRevision:UInt64) async {
        guard expectedRevision==revision,selectedAI?.id==id,selectedAI?.State != "running" else {return}
        await perform("/v1/ai/jobs/"+id,method:"DELETE",expectedRevision:expectedRevision)
    }
    func canManageAssets(_ video:CreatorVideo) -> Bool {connected && ["owner","editor","uploader"].contains(role(video.channel_id) ?? "")}
    func stageAsset(file:URL,videoID:String,kind:String,language:String="",label:String="",expectedContentSHA:String?=nil,expectedRevision:UInt64) async {
        guard !busy,expectedRevision==revision,let store=drafts,let video=snapshot?.videos?.first(where:{$0.id==videoID}),canManageAssets(video) else {return}
        do {_ = try store.stageAsset(file:file,videoID:videoID,kind:kind,language:language,label:label,expectedContentSHA:expectedContentSHA);pendingAssetKind=kind}
        catch {if expectedRevision==revision {message=text("assetInvalid")};return}
        await retryAsset()
    }
    func retryAsset() async {
        guard !busy,let active=engine,let store=drafts else {return};busy=true;let captured=revision
        defer {if captured==revision {busy=false}}
        do {
            guard let asset=try store.pendingAsset() else {return};let wire=try store.wire(asset)
            let reply=try await CreatorHTTP.shared.accountData(asset.path,method:"POST",file:wire,contentType:asset.contentType,engine:active,requestKey:asset.key,guardRequest:{try self.require(active,captured)})
            try require(active,captured);try await refreshCaptured(active,captured)
            guard let video=snapshot?.videos?.first(where:{$0.id==asset.videoID}) else {throw CreatorHTTP.Failure.unexpectedResponse}
            let key:String
            if asset.kind=="captions" {
                let track=try JSONDecoder().decode(CreatorVideo.Caption.self,from:reply)
                guard track.language==asset.language,track.label==asset.label,!track.ai_proposed,track.human_approved,video.captions?.contains(track)==true else {throw CreatorHTTP.Failure.unexpectedResponse};key=track.object_key
            } else {
                guard let value=try JSONSerialization.jsonObject(with:reply) as? [String:Any],value["ok"] as? Bool==true,let original=video.thumbnail_key,!original.isEmpty else {throw CreatorHTTP.Failure.unexpectedResponse};key=original
            }
            guard CreatorNativeState.matches(key,"^[A-Za-z0-9_./-]{1,512}$"),!key.contains(".."),key.hasPrefix(asset.videoID+"/") else {throw CreatorHTTP.Failure.unexpectedResponse}
            let readback=try await CreatorHTTP.shared.accountData("/media/"+key,engine:active,responseLimit:asset.limit,guardRequest:{try self.require(active,captured)})
            try require(active,captured);guard readback.count==asset.mediaBytes,CreatorNativeState.hash(readback)==asset.contentSHA else {throw CreatorHTTP.Failure.unexpectedResponse}
            try store.acknowledge(asset);pendingAssetKind="";message=text("assetSaved")
        } catch {if captured==revision {lastFailure=String(describing:error);message=text("assetUnconfirmed");try? await refreshCaptured(active,captured)}}
    }
    func cancelAsset() {guard !busy else {return};do {try drafts?.cancelAsset();pendingAssetKind="";message=text("cancelRetained")}catch {message=text("draftUnavailable")}}
    func canAppeal(_ report:CreatorSnapshot.Report) -> Bool {
        connected && report.State=="takedown" && snapshot?.videos?.contains(where:{$0.id==report.VideoID && $0.owner==account})==true && !(snapshot?.appeals ?? []).contains(where:{$0.ReportID==report.id && $0.State=="submitted"})
    }
    private static func financialAccess(_ snapshot:CreatorSnapshot,_ account:String,_ record:CreatorSnapshot.Revenue) -> Bool {
        guard CreatorDraftState.validID(record.id),let video=snapshot.videos?.first(where:{$0.id==record.VideoID && $0.owner==record.Owner}),let member=snapshot.team?.first(where:{$0.channel_id==video.channel_id})?.members?.first(where:{$0.account==account && $0.state=="active"}) else {return false}
        return ["owner","finance"].contains(member.role)
    }
    var canRequestPayout:Bool {connected && snapshot?.team?.contains(where:{$0.members?.contains(where:{$0.account==account && $0.role=="owner" && $0.state=="active"})==true})==true}
    func canDispute(_ record:CreatorSnapshot.Revenue) -> Bool {
        connected && snapshot.map{Self.financialAccess($0,account,record)}==true && !(snapshot?.disputes ?? []).contains(where:{$0.RevenueRecordID==record.id && $0.State=="submitted"})
    }
    func submitAppeal(_ reportID:String,reason:String,expectedRevision:UInt64) async {
        let reason=reason.trimmingCharacters(in:.whitespacesAndNewlines)
        guard expectedRevision==revision,let report=snapshot?.reports?.first(where:{$0.id==reportID}),canAppeal(report),CreatorDraftState.validID(reportID),!reason.isEmpty,reason.count<=2000 else {return}
        await perform("/v1/reports/"+reportID+"/appeals",body:["reason":reason],expectedRevision:expectedRevision)
    }
    func submitDispute(_ recordID:String,reason:String,expectedRevision:UInt64) async {
        let reason=reason.trimmingCharacters(in:.whitespacesAndNewlines)
        guard expectedRevision==revision,let record=snapshot?.revenue?.first(where:{$0.id==recordID}),canDispute(record),CreatorDraftState.validID(recordID),!reason.isEmpty,reason.count<=2000 else {return}
        await perform("/v1/revenue/"+recordID+"/disputes",body:["reason":reason],expectedRevision:expectedRevision)
    }
    struct Contribution:Identifiable {let id=UUID();var account:String;var percent:String}
    static func contributorBody(_ rows:[Contribution]) -> [[String:Any]]? {
        guard !rows.isEmpty,rows.count<=64 else {return nil};var total=0,seen=Set<String>(),body=[[String:Any]]()
        for row in rows {
            let account=row.account.trimmingCharacters(in:.whitespacesAndNewlines),text=row.percent.trimmingCharacters(in:.whitespacesAndNewlines).replacingOccurrences(of:",",with:".")
            guard CreatorNativeState.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$"),seen.insert(account).inserted,CreatorNativeState.matches(text,"^[0-9]{1,3}(\\.[0-9]{1,2})?$"),let value=Decimal(string:text),value>0,value<=100 else {return nil}
            let points=NSDecimalNumber(decimal:value*100).intValue;total+=points;body.append(["account":account,"basis_points":points])
        }
        return total==10000 ? body : nil
    }
    func declareRights(videoID:String,basis:String,license:String,territories:String,start:Date?,end:Date?,exclusive:Bool,contributors:[Contribution],evidence:String,expectedRevision:UInt64) async {
        guard expectedRevision==revision,connected,!busy else {return}
        guard let video=snapshot?.videos?.first(where:{$0.id==videoID}),["owner","editor"].contains(role(video.channel_id) ?? ""),let splits=Self.contributorBody(contributors),["owned","licensed","public-domain"].contains(basis),license.utf8.count<=512,basis != "licensed" || !license.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,CreatorNativeState.matches(evidence.lowercased(),"^[a-f0-9]{64}$"),end==nil || end!>Date(),start==nil || end==nil || end!>start! else {message=text("rightsInvalid");return}
        let places=territories.split(separator:",").map{String($0).trimmingCharacters(in:.whitespacesAndNewlines)};guard !places.isEmpty,places.count<=64 else {message=text("rightsInvalid");return}
        var body:[String:Any]=["basis":basis=="public-domain" ? "public_domain" : basis,"license_reference":license,"territories":places,"exclusive":exclusive,"contributor_splits":splits,"evidence_sha256":evidence.lowercased(),"source_sha256":video.sha256]
        if let start {body["starts_at"]=ISO8601DateFormatter().string(from:start)};if let end {body["ends_at"]=ISO8601DateFormatter().string(from:end)}
        await perform("/v1/videos/"+videoID+"/rights",body:body,expectedRevision:expectedRevision)
    }
    func role(_ channel: String) -> String? {snapshot?.team?.first(where:{$0.channel_id==channel})?.members?.first(where:{$0.account==account && $0.state=="active"})?.role}
    func canReview(_ video: CreatorVideo) -> Bool {connected && video.owner != account && role(video.channel_id)=="moderator"}
}
