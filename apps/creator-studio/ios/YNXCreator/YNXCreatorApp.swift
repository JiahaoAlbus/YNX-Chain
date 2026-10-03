import SwiftUI
import UniformTypeIdentifiers
import ImageIO

@main struct YNXCreatorApp: App {
    @StateObject private var model=CreatorModel()
    var body: some Scene {WindowGroup {CreatorView().environmentObject(model).onOpenURL {model.handle(url:$0)}}}
}

struct CreatorView: View {
    @EnvironmentObject private var model: CreatorModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var section="overview"
    @State private var handle=""
    @State private var name=""
    @State private var title=""
    @State private var description=""
    @State private var basis="owned"
    @State private var source=""
    @State private var license=""
    @State private var territories="WORLDWIDE"
    @State private var evidence=""
    @State private var owned=false
    @State private var hasUploadExpiry=false
    @State private var uploadExpiry=Date().addingTimeInterval(365*86400)
    @State private var choosingFile=false
    @State private var cancelUpload=false
    @State private var cancelOperation=false
    @State private var cancelAsset=false
    @State private var selectedVideo: CreatorVideo?
    @State private var pickerRevision: UInt64=0
    @State private var rightsLicense=""
    @State private var rightsEvidence=""
    @State private var payout=""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:20) {
                    header
                    Picker(model.text("overview"),selection:$section) {
                        ForEach(["overview","channel","team","content","upload","moderation","earn","disputes","assets","ai"],id:\.self) {Text(model.text($0)).tag($0)}
                    }.pickerStyle(.menu)
                    if !model.message.isEmpty {Text(model.message).foregroundStyle(.secondary).textSelection(.enabled)}
                    if !model.connected {
                        ContentUnavailableView(model.text("signIn"),systemImage:"person.crop.circle",description:Text(model.text("walletAccess")))
                    } else {
                        recovery
                        if !model.studioReady {
                            if model.studioReadState == .loading {ProgressView(model.text("refresh"))}
                            else {
                                Text(model.text("retryRequired")).foregroundStyle(.secondary)
                                Button(model.text("refresh")) {Task {await model.refresh()}}.disabled(model.busy)
                            }
                        } else {
                        switch section {
                        case "channel": channel
                        case "team": CreatorTeamView()
                        case "moderation": CreatorReviewView()
                        case "content": content
                        case "upload": upload
                        case "earn": earnings
                        case "disputes": CreatorDisputeView()
                        case "assets": CreatorAssetsView()
                        case "ai": CreatorAIView()
                        default: overview
                        }
                        }
                    }
                }.padding(24).frame(maxWidth:960,alignment:.leading).frame(maxWidth:.infinity)
            }.navigationTitle("YNX Creator Studio")
                .task {await model.start()}
                .onChange(of:scenePhase) {_,phase in if phase == .active {Task {await model.restore()}} else if phase == .background {model.suspend()}}
                .onChange(of:model.connected) {_,connected in if !connected {handle="";name="";title="";description="";source="";license="";evidence="";owned=false;hasUploadExpiry=false;uploadExpiry=Date().addingTimeInterval(365*86400);rightsLicense="";rightsEvidence="";payout="";selectedVideo=nil;choosingFile=false}}
                .fileImporter(isPresented:$choosingFile,allowedContentTypes:[.mpeg4Movie,UTType(filenameExtension:"webm") ?? .movie]) {result in
                    guard case .success(let file)=result,model.currentRevision==pickerRevision else {return};let access=file.startAccessingSecurityScopedResource()
                    let captured=(title,description,basis,source,license,territories,evidence,owned,hasUploadExpiry ? uploadExpiry : nil,pickerRevision)
                    Task {@MainActor in defer {if access {file.stopAccessingSecurityScopedResource()}}
                        await model.stage(file:file,title:captured.0,description:captured.1,basis:captured.2,source:captured.3,license:captured.4,territories:captured.5,evidence:captured.6,owned:captured.7,expires:captured.8,expectedRevision:captured.9)
                    }
                }
                .confirmationDialog(model.text("cancelQuestion"),isPresented:$cancelUpload,titleVisibility:.visible) {Button(model.text("cancelDraft"),role:.destructive) {model.cancelUpload()}}
                .confirmationDialog(model.text("cancelQuestion"),isPresented:$cancelAsset,titleVisibility:.visible) {Button(model.text("cancelAsset"),role:.destructive) {model.cancelAsset()}}
                .confirmationDialog(model.text("cancelQuestion"),isPresented:$cancelOperation,titleVisibility:.visible) {Button(model.text("cancelOperation"),role:.destructive) {model.cancelOperation()}}
                .sheet(item:$selectedVideo) {video in rights(video)}
        }
        #if os(macOS)
        .frame(minWidth:740,minHeight:560)
        #endif
        .environment(\.locale,Locale(identifier:model.locale))
        .environment(\.layoutDirection,model.locale=="ar" ? .rightToLeft : .leftToRight)
    }
    private var header: some View {
        VStack(alignment:.leading,spacing:12) {
            HStack {
                Image("ynx-brand-original").resizable().scaledToFit().frame(width:124,height:58).accessibilityLabel("YNX")
                Spacer()
                Menu(model.text("language")) {ForEach(["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"],id:\.self) {locale in Button(Locale(identifier:locale).localizedString(forIdentifier:locale) ?? locale) {model.language(locale)}}}
                if model.busy {ProgressView()}
                if model.connected || model.signOutPending {
                    Button(model.text(model.signOutPending ? "signOutRetry" : "signOut")) {Task {await model.signOut()}}.disabled(model.signOutPending && model.busy)
                } else {Button(model.text("signIn")) {Task {await model.signIn()}}.buttonStyle(.borderedProminent).disabled(model.busy || model.signOutPending)}
            }
            if !model.account.isEmpty {Text(model.account).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)}
            if model.awaitingWallet {Text(model.text("walletPending")).foregroundStyle(.secondary)}
        }
    }
    private var recovery: some View {
        VStack(alignment:.leading,spacing:10) {
            if !model.pendingUploadTitle.isEmpty {
                Label(model.pendingUploadTitle,systemImage:"arrow.up.document")
                HStack {Button(model.text("retryUpload")) {Task {await model.retryUpload()}};Button(model.text("cancelDraft"),role:.destructive) {cancelUpload=true}}
            }
            if model.pendingAICancel {
                HStack {Text(model.text("aiCancelUnknown"));Button(model.text("retryAICancel")) {Task {await model.retryAICancel()}}.disabled(model.aiCancelling)}
            }
            if !model.pendingAssetKind.isEmpty {
                HStack {Text(model.text("assetUnconfirmed"));Button(model.text("retryAsset")) {Task {await model.retryAsset()}};Button(model.text("cancelAsset"),role:.destructive) {cancelAsset=true}}
            }
            if model.pendingOperation {
                HStack {Text(model.text("operationPending"));Button(model.text("retry")) {Task {await model.retryOperation()}};Button(model.text("cancelOperation"),role:.destructive) {cancelOperation=true}}
            }
        }.disabled(model.busy)
    }
    private var overview: some View {
        VStack(alignment:.leading,spacing:16) {
            HStack {Text(model.text("creatorOverview")).font(.title2);Spacer();Button(model.text("refresh")) {Task {await model.refresh()}}.disabled(model.busy)}
            if let analytics=model.snapshot?.analytics {
                LazyVGrid(columns:[GridItem(.adaptive(minimum:150))],spacing:16) {
                    metric("views",analytics.views);metric("watchSeconds",analytics.watch_seconds);metric("subscribers",analytics.subscribers);metric("revenue",analytics.revenue_ynxt)
                }
                Text(analytics.source).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    private func metric(_ key:String,_ value:Int) -> some View {
        VStack(alignment:.leading,spacing:8) {Text(model.text(key)).foregroundStyle(.secondary);Text(model.number(value)).font(.title.bold())}.frame(maxWidth:.infinity,alignment:.leading).padding().background(.quaternary,in:RoundedRectangle(cornerRadius:14))
    }
    private var channel: some View {
        VStack(alignment:.leading,spacing:14) {
            Text(model.text("channel")).font(.title2)
            TextField(model.text("channelID"),text:$model.channelID).textFieldStyle(.roundedBorder)
            TextField(model.text("handle"),text:$handle).textFieldStyle(.roundedBorder)
            TextField(model.text("name"),text:$name).textFieldStyle(.roundedBorder)
            Button(model.text("createChannel")) {model.submit("/v1/channels",body:["handle":handle,"name":name])}.buttonStyle(.borderedProminent).disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || handle.isEmpty || name.isEmpty)
        }
    }
    private var upload: some View {
        VStack(alignment:.leading,spacing:14) {
            Text(model.text("uploadOwned")).font(.title2)
            TextField(model.text("channelID"),text:$model.channelID).textFieldStyle(.roundedBorder)
            TextField(model.text("title"),text:$title).textFieldStyle(.roundedBorder)
            TextField(model.text("description"),text:$description,axis:.vertical).textFieldStyle(.roundedBorder)
            Picker(model.text("rightsBasis"),selection:$basis) {ForEach(["owned","licensed","public-domain"],id:\.self) {Text(model.text($0)).tag($0)}}
            TextField(model.text("rightsSource"),text:$source).textFieldStyle(.roundedBorder)
            TextField(model.text("license"),text:$license).textFieldStyle(.roundedBorder)
            TextField(model.text("territories"),text:$territories).textFieldStyle(.roundedBorder)
            TextField(model.text("evidence"),text:$evidence).textFieldStyle(.roundedBorder)
            Toggle(model.text("rightsHasEnd"),isOn:$hasUploadExpiry)
            if hasUploadExpiry {DatePicker(model.text("rightsEnd"),selection:$uploadExpiry,in:Date()...)}
            Toggle(model.text("ownedConsent"),isOn:$owned)
            Text(model.text("uploadLimit")).font(.caption).foregroundStyle(.secondary)
            Button(model.text("chooseUpload")) {pickerRevision=model.currentRevision;choosingFile=true}.buttonStyle(.borderedProminent).disabled(model.busy || !model.pendingUploadTitle.isEmpty || !owned || model.channelID.isEmpty || title.isEmpty || source.isEmpty || license.isEmpty || hasUploadExpiry && uploadExpiry<=Date())
        }
    }
    private var content: some View {
        VStack(alignment:.leading,spacing:16) {
            HStack {Text(model.text("content")).font(.title2);Spacer();Button(model.text("refresh")) {Task {await model.refresh()}}.disabled(model.busy)}
            if (model.snapshot?.videos ?? []).isEmpty {Text(model.text("noVideos")).foregroundStyle(.secondary)}
            ForEach(model.snapshot?.videos ?? []) {video in
                VStack(alignment:.leading,spacing:10) {
                    Text(video.title).font(.headline);Text(video.status+" · "+video.workflow_state+" · "+video.visibility).font(.caption).foregroundStyle(.secondary)
                    Text(video.sha256).font(.caption2).textSelection(.enabled)
                    if let expiry=video.rights?.expires_at {Text(model.text("rightsEnd")+": "+expiry).font(.caption).textSelection(.enabled)}
                    if let scheduled=video.scheduled_at {Text(model.text("publicationTime")+": "+scheduled).font(.caption).textSelection(.enabled)}
                    if let history=video.versions,!history.isEmpty {
                        DisclosureGroup(model.text("versionHistory")+" ("+model.number(history.count)+")") {
                            ForEach(history.reversed()) {version in
                                VStack(alignment:.leading,spacing:4) {
                                    Text("v"+String(version.sequence)+" · "+version.kind+" · "+version.previous_state+" → "+version.next_state)
                                    Text(version.recorded_at).font(.caption)
                                    Text(version.actor).font(.caption).textSelection(.enabled)
                                    Text(version.content_sha256).font(.caption2).textSelection(.enabled)
                                }.padding(.vertical,4)
                            }
                        }
                    }
                    if let rights=model.snapshot?.rights?.first(where:{$0.video_id==video.id}) {CreatorRightsDetails(rights:rights)}
                    ViewThatFits {
                        HStack {videoActions(video)}
                        VStack(alignment:.leading) {videoActions(video)}
                    }.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty)
                    CreatorPublicationControls(video:video).disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty)
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
        }
    }
    @ViewBuilder private func videoActions(_ video:CreatorVideo) -> some View {
        Button(model.text("rights")) {selectedVideo=video}
        if video.status=="failed" {Button(model.text("retryProcessing")) {model.submit("/v1/videos/"+video.id+"/retry-processing")}}
        if ["draft","rejected","unpublished"].contains(video.workflow_state) && video.status=="ready" {Button(model.text("submitReview")) {model.submit("/v1/videos/"+video.id+"/submit-review")}}
        if video.workflow_state=="approved" {
            Menu(model.text("publish")) {ForEach(["public","unlisted","private"],id:\.self) {visibility in Button(model.text(visibility)) {model.submit("/v1/videos/"+video.id+"/publish",body:["visibility":visibility])}}}
        }
        if video.workflow_state=="published" {Button(model.text("unpublish")) {model.submit("/v1/videos/"+video.id+"/unpublish")}}
        Button(model.text("monetization")) {model.submit("/v1/videos/"+video.id+"/monetization")}
    }
    private func rights(_ video:CreatorVideo) -> some View {CreatorRightsForm(videoID:video.id,expectedRevision:model.currentRevision)}
    private var earnings: some View {
        VStack(alignment:.leading,spacing:16) {
            Text(model.text("earn")).font(.title2)
            ForEach(model.snapshot?.revenue ?? []) {record in VStack(alignment:.leading) {Text(model.number(record.AmountYNXT)+" YNXT");Text(record.PayReceiptID).font(.caption).textSelection(.enabled);Text(model.text("revenueOwner")+": "+record.Owner).font(.caption).textSelection(.enabled)}}
            if (model.snapshot?.revenue ?? []).isEmpty {Text(model.text("noRevenue")).foregroundStyle(.secondary)}
            ForEach(model.snapshot?.payout_intents ?? []) {intent in HStack {Text(model.number(intent.AmountYNXT)+" YNXT");Spacer();Text(intent.State).foregroundStyle(.secondary)}}
            if model.canRequestPayout {
            TextField(model.text("payoutAmount"),text:$payout).textFieldStyle(.roundedBorder)
            Text(model.text("payoutConsent")).font(.caption).foregroundStyle(.secondary)
            Button(model.text("createPayout")) {if let amount=Int(payout),amount>0 {model.submit("/v1/studio/payout-intents",body:["amount_ynxt":amount])}}.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || (Int(payout) ?? 0)<=0)
            }
        }
    }
}

struct CreatorTeamView: View {
    @EnvironmentObject private var model:CreatorModel
    @State private var inviteAccount=""
    @State private var inviteID=""
    @State private var customExpiry=false
    @State private var inviteExpiry=Date().addingTimeInterval(7*86400)
    @State private var role="moderator"
    @State private var revoking: String?
    private let roles=["editor","uploader","analyst","finance","moderator","viewer"]
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            Text(model.text("team")).font(.title2)
            TextField(model.text("channelID"),text:$model.channelID).textFieldStyle(.roundedBorder)
            Text(model.text("inviteHelp")).foregroundStyle(.secondary)
            TextField(model.text("inviteAccount"),text:$inviteAccount).textFieldStyle(.roundedBorder)
            Picker(model.text("teamRole"),selection:$role) {ForEach(roles,id:\.self) {Text(model.text($0)).tag($0)}}
            Toggle(model.text("inviteCustomExpiry"),isOn:$customExpiry)
            if customExpiry {DatePicker(model.text("inviteExpiry"),selection:$inviteExpiry,in:Date()...Date().addingTimeInterval(30*86400))}
            Button(model.text("invite")) {
                var body:[String:Any]=["account":inviteAccount,"role":role]
                if customExpiry {body["expires_at"]=ISO8601DateFormatter().string(from:inviteExpiry)}
                model.submit("/v1/channels/"+model.channelID+"/team/invites",body:body)
            }.disabled(model.role(model.channelID) != "owner" || inviteAccount.isEmpty || customExpiry && (inviteExpiry<=Date() || inviteExpiry>Date().addingTimeInterval(30*86400)))
            Divider()
            TextField(model.text("inviteID"),text:$inviteID).textFieldStyle(.roundedBorder)
            Button(model.text("acceptInvite")) {model.submit("/v1/team/invites/"+inviteID+"/accept")}.disabled(!CreatorDraftState.validID(inviteID))
            ForEach(model.snapshot?.team ?? []) {team in
                VStack(alignment:.leading,spacing:12) {
                    Text(team.channel_id).font(.headline).textSelection(.enabled)
                    if let version=team.auth_version {Text(model.text("authorizationVersion")+": "+String(version)).font(.caption)}
                    ForEach(team.members ?? [],id:\.account) {member in
                        VStack(alignment:.leading,spacing:6) {
                            Text(member.account).font(.caption).textSelection(.enabled)
                            Text(model.text(member.role)+" · "+model.text(member.state)).foregroundStyle(.secondary)
                            if model.role(team.channel_id)=="owner",member.account != model.account,member.state=="active" {
                                HStack {
                                    Menu(model.text("changeRole")) {ForEach(roles,id:\.self) {chosen in Button(model.text(chosen)) {model.submit("/v1/channels/"+team.channel_id+"/team/"+member.account+"/role",body:["role":chosen])}}}
                                    Button(model.text("revoke"),role:.destructive) {revoking=team.channel_id+"/team/"+member.account}
                                }
                            }
                        }
                    }
                    ForEach(team.invites ?? []) {invite in
                        VStack(alignment:.leading) {Text(invite.id).textSelection(.enabled);Text(invite.account+" · "+model.text(invite.role)+" · "+model.text(invite.state)).font(.caption).foregroundStyle(.secondary);if let expiry=invite.expires_at {Text(model.text("inviteExpiry")+": "+expiry).font(.caption).textSelection(.enabled)}}
                    }
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
        }.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty)
            .confirmationDialog(model.text("revokeQuestion"),isPresented:Binding(get:{revoking != nil},set:{if !$0 {revoking=nil}}),titleVisibility:.visible) {
                Button(model.text("revoke"),role:.destructive) {if let path=revoking {model.submit("/v1/channels/"+path,method:"DELETE")};revoking=nil}
            }
            .onChange(of:model.account) {_,_ in inviteAccount="";inviteID="";customExpiry=false;inviteExpiry=Date().addingTimeInterval(7*86400);revoking=nil}
    }
}

struct CreatorReviewView: View {
    @EnvironmentObject private var model:CreatorModel
    @State private var reason=""
    var body: some View {
        VStack(alignment:.leading,spacing:16) {
            Text(model.text("moderation")).font(.title2)
            Text(model.text("independentReview")).foregroundStyle(.secondary)
            TextField(model.text("reviewReason"),text:$reason,axis:.vertical).textFieldStyle(.roundedBorder)
            ForEach((model.snapshot?.videos ?? []).filter{model.canReview($0)}) {video in
                VStack(alignment:.leading,spacing:12) {
                    Text(video.title).font(.headline)
                    Text(video.owner).font(.caption).textSelection(.enabled)
                    if let rights=model.snapshot?.rights?.first(where:{$0.id==video.rights_declaration_id}),rights.state=="declared",rights.declared_by != model.account {
                        CreatorRightsDetails(rights:rights)
                        HStack {
                            Button(model.text("approveRights")) {model.submit("/v1/rights/"+rights.id+"/review",body:["accepted":true,"reason":reason])}
                            Button(model.text("rejectRights"),role:.destructive) {model.submit("/v1/rights/"+rights.id+"/review",body:["accepted":false,"reason":reason])}
                        }.disabled(reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                    }
                    if video.workflow_state=="in_review" {
                        HStack {
                            Button(model.text("approvePublication")) {model.submit("/v1/videos/"+video.id+"/review-publication",body:["approved":true,"reason":reason])}
                            Button(model.text("rejectPublication"),role:.destructive) {model.submit("/v1/videos/"+video.id+"/review-publication",body:["approved":false,"reason":reason])}
                        }.disabled(reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                    }
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
        }.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty)
            .onChange(of:model.account) {_,_ in reason=""}
    }
}

struct CreatorPublicationControls: View {
    @EnvironmentObject private var model:CreatorModel
    let video:CreatorVideo
    @State private var editing=false
    @State private var title=""
    @State private var description=""
    @State private var scheduling=false
    @State private var when=Date().addingTimeInterval(3600)
    @State private var visibility="public"
    var body: some View {
        HStack {
            if ["owner","editor"].contains(model.role(video.channel_id) ?? "") {
                Button(model.text("edit")) {title=video.title;description=video.description;editing=true}
                if video.workflow_state=="approved" {Button(model.text("schedule")) {scheduling=true}}
                if video.workflow_state=="scheduled" {Button(model.text("publishDue")) {model.submit("/v1/videos/"+video.id+"/publish-due")}}
            }
        }
        .sheet(isPresented:$editing) {
            NavigationStack {Form {
                TextField(model.text("title"),text:$title)
                TextField(model.text("description"),text:$description,axis:.vertical)
                Button(model.text("save")) {model.submit("/v1/videos/"+video.id+"/metadata",body:["title":title,"description":description],onSuccess:{editing=false})}.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || title.count>140 || description.utf8.count>5000)
            }.navigationTitle(model.text("edit")).toolbar {Button(model.text("close")) {editing=false}}}.frame(minWidth:320,minHeight:300)
        }
        .sheet(isPresented:$scheduling) {
            NavigationStack {Form {
                DatePicker(model.text("publicationTime"),selection:$when,in:Date()...)
                Picker(model.text("publish"),selection:$visibility) {ForEach(["public","unlisted"],id:\.self) {Text(model.text($0)).tag($0)}}
                Button(model.text("schedule")) {model.submit("/v1/videos/"+video.id+"/schedule",body:["visibility":visibility,"scheduled_at":ISO8601DateFormatter().string(from:when)],onSuccess:{scheduling=false})}.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || when<=Date())
            }.navigationTitle(model.text("schedule")).toolbar {Button(model.text("close")) {scheduling=false}}}.frame(minWidth:320,minHeight:300)
        }
        .onChange(of:model.account) {_,_ in editing=false;scheduling=false;title="";description=""}
    }
}

struct CreatorDisputeView:View {
    @EnvironmentObject private var model:CreatorModel
    @State private var selected:Request?
    struct Request:Identifiable {let id:String;let appeal:Bool;let revision:UInt64}
    var body:some View {
        VStack(alignment:.leading,spacing:16) {
            HStack {Text(model.text("disputes")).font(.title2);Spacer();Button(model.text("refresh")) {Task {await model.refresh()}}}
            Text(model.text("disputeHelp")).foregroundStyle(.secondary)
            Text(model.text("reportsAppeals")).font(.headline)
            if (model.snapshot?.reports ?? []).isEmpty {Text(model.text("noReports")).foregroundStyle(.secondary)}
            ForEach(model.snapshot?.reports ?? []) {report in
                VStack(alignment:.leading,spacing:8) {
                    Text(report.Reason);Text(report.Details).foregroundStyle(.secondary)
                    Text(report.id+" · "+report.State).font(.caption).textSelection(.enabled)
                    if model.canAppeal(report) {Button(model.text("submitAppeal")) {selected=Request(id:report.id,appeal:true,revision:model.currentRevision)}}
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
            ForEach(model.snapshot?.appeals ?? []) {appeal in
                VStack(alignment:.leading,spacing:6) {Text(appeal.Reason);Text(appeal.id+" · "+appeal.State).font(.caption);Text(appeal.ReportID).font(.caption).textSelection(.enabled)}
            }
            Text(model.text("revenueDisputes")).font(.headline)
            if (model.snapshot?.revenue ?? []).isEmpty {Text(model.text("noRevenue")).foregroundStyle(.secondary)}
            ForEach(model.snapshot?.revenue ?? []) {record in
                VStack(alignment:.leading,spacing:8) {
                    Text(model.number(record.AmountYNXT)+" YNXT");Text(record.PayReceiptID).font(.caption).textSelection(.enabled);Text(model.text("revenueOwner")+": "+record.Owner).font(.caption).textSelection(.enabled)
                    if model.canDispute(record) {Button(model.text("submitDispute")) {selected=Request(id:record.id,appeal:false,revision:model.currentRevision)}}
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
            ForEach(model.snapshot?.disputes ?? []) {dispute in
                VStack(alignment:.leading,spacing:6) {Text(dispute.Reason);Text(dispute.id+" · "+dispute.State).font(.caption);Text(dispute.RevenueRecordID).font(.caption).textSelection(.enabled)}
            }
        }.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty)
        .sheet(item:$selected) {request in CreatorDisputeForm(request:request)}
        .onChange(of:model.currentRevision) {_,_ in selected=nil}
        .onChange(of:model.connected) {_,connected in if !connected {selected=nil}}
    }
}
struct CreatorDisputeForm:View {
    @EnvironmentObject private var model:CreatorModel
    @Environment(\.dismiss) private var dismiss
    let request:CreatorDisputeView.Request
    @State private var reason=""
    var body:some View {
        NavigationStack {
            Form {
                Text(request.id).font(.caption).textSelection(.enabled)
                Text(model.text("disputeHelp")).foregroundStyle(.secondary)
                TextField(model.text("disputeReason"),text:$reason,axis:.vertical).lineLimit(3...8)
                Button(model.text(request.appeal ? "submitAppeal" : "submitDispute")) {
                    let captured=reason
                    Task {
                        if request.appeal {await model.submitAppeal(request.id,reason:captured,expectedRevision:request.revision)}
                        else {await model.submitDispute(request.id,reason:captured,expectedRevision:request.revision)}
                        if !model.pendingOperation {dismiss()}
                    }
                }.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || request.revision != model.currentRevision || reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || reason.count>2000)
            }.navigationTitle(model.text(request.appeal ? "submitAppeal" : "submitDispute"))
            .toolbar {Button(model.text("close")) {dismiss()}}
            .onChange(of:model.connected) {_,connected in if !connected {reason="";dismiss()}}
        }.frame(minWidth:320,minHeight:320)
    }
}

struct CreatorAssetsView:View {
    @EnvironmentObject private var model:CreatorModel
    @State private var selected:Request?
    struct Request:Identifiable {let videoID,kind:String;let revision:UInt64;var id:String {videoID+kind}}
    var body:some View {
        VStack(alignment:.leading,spacing:16) {
            Text(model.text("assets")).font(.title2)
            Text(model.text("assetHelp")).foregroundStyle(.secondary)
            if (model.snapshot?.videos ?? []).isEmpty {Text(model.text("noVideos")).foregroundStyle(.secondary)}
            ForEach(model.snapshot?.videos ?? []) {video in
                VStack(alignment:.leading,spacing:10) {
                    Text(video.title).font(.headline)
                    if let key=video.thumbnail_key {Text(model.text("thumbnail")+" · "+key).font(.caption).textSelection(.enabled)}
                    ForEach(video.captions ?? [],id:\.object_key) {track in
                        Text(track.label+" · "+track.language+" · "+model.text(track.human_approved ? "humanApproved" : "humanReviewRequired")).font(.caption)
                    }
                    if model.canManageAssets(video) {
                        HStack {ForEach(["thumbnail","captions"],id:\.self) {kind in Button(model.text(kind)) {selected=Request(videoID:video.id,kind:kind,revision:model.currentRevision)}}}
                    }
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
        }.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || !model.pendingUploadTitle.isEmpty)
        .sheet(item:$selected) {request in CreatorAssetForm(request:request)}
        .onChange(of:model.currentRevision) {_,_ in selected=nil}
        .onChange(of:model.connected) {_,connected in if !connected {selected=nil}}
    }
}
struct CreatorAssetForm:View {
    @EnvironmentObject private var model:CreatorModel
    @Environment(\.dismiss) private var dismiss
    let request:CreatorAssetsView.Request
    @State private var file:URL?
    @State private var scoped=false
    @State private var fileSHA=""
    @State private var fileBytes=0
    @State private var captionPreview=""
    @State private var preview:CGImage?
    @State private var language="en"
    @State private var label=""
    @State private var choosing=false
    @State private var failure=false
    @State private var humanApproved=false
    private var types:[UTType] {request.kind=="thumbnail" ? [.png,.jpeg,UTType(filenameExtension:"webp") ?? .image] : [UTType(filenameExtension:"vtt") ?? .plainText]}
    private func clearFile() {if let file,scoped {file.stopAccessingSecurityScopedResource()};file=nil;scoped=false;fileSHA="";fileBytes=0;captionPreview="";preview=nil}
    var body:some View {
        NavigationStack {
            Form {
                Text(model.text("assetHelp")).foregroundStyle(.secondary)
                if request.kind=="captions" {TextField(model.text("captionLanguage"),text:$language);TextField(model.text("captionLabel"),text:$label)}
                Button(model.text("chooseAsset")) {choosing=true}
                if let file {
                    Text(file.lastPathComponent);Text(model.number(fileBytes)+" bytes").font(.caption)
                    Text(fileSHA).font(.caption2).textSelection(.enabled)
                    if let preview {Image(decorative:preview,scale:1).resizable().scaledToFit().frame(maxHeight:240)}
                    if !captionPreview.isEmpty {Text(captionPreview).font(.caption).textSelection(.enabled)}
                }
                if request.kind=="captions" {Toggle(model.text("captionConsent"),isOn:$humanApproved)}
                if failure {Text(model.text("assetInvalid")).foregroundStyle(.secondary)}
                Button(model.text("uploadAsset")) {
                    guard let file else {return};let captured=(language,label,fileSHA)
                    Task {
                        await model.stageAsset(file:file,videoID:request.videoID,kind:request.kind,language:captured.0,label:captured.1,expectedContentSHA:captured.2,expectedRevision:request.revision)
                        if !model.pendingAssetKind.isEmpty || model.message==model.text("assetSaved") {clearFile();dismiss()}
                    }
                }.disabled(file==nil || model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || request.revision != model.currentRevision || request.kind=="captions" && (!humanApproved || language.isEmpty || label.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty))
            }.navigationTitle(model.text(request.kind))
            .toolbar {Button(model.text("close")) {clearFile();dismiss()}.disabled(model.busy)}
            .fileImporter(isPresented:$choosing,allowedContentTypes:types) {result in
                guard model.connected,request.revision==model.currentRevision,case .success(let selected)=result else {return};clearFile();failure=false;humanApproved=false
                let access=selected.startAccessingSecurityScopedResource()
                do {
                    let bytes=try CreatorDraftState.read(selected,limit:request.kind=="thumbnail" ? 5*1024*1024 : 1024*1024)
                    guard !bytes.isEmpty else {throw CreatorDraftState.Failure.invalid}
                    if request.kind=="thumbnail" {
                        guard let source=CGImageSourceCreateWithData(bytes as CFData,nil),let image=CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:640] as CFDictionary) else {throw CreatorDraftState.Failure.invalid};preview=image
                    } else {guard let text=String(data:bytes,encoding:.utf8),text.replacingOccurrences(of:"\u{feff}",with:"").hasPrefix("WEBVTT") else {throw CreatorDraftState.Failure.invalid};captionPreview=String(text.prefix(4000))}
                    file=selected;scoped=access;fileBytes=bytes.count;fileSHA=CreatorNativeState.hash(bytes)
                } catch {if access {selected.stopAccessingSecurityScopedResource()};failure=true;preview=nil;captionPreview=""}
            }
            .onChange(of:model.currentRevision) {_,_ in clearFile();label="";humanApproved=false;dismiss()}
            .onChange(of:model.connected) {_,connected in if !connected {clearFile();label="";humanApproved=false;dismiss()}}
            .onDisappear {clearFile();label="";humanApproved=false}
        }.frame(minWidth:320,minHeight:420)
    }
}

struct CreatorAIView:View {
    @EnvironmentObject private var model:CreatorModel
    @State private var videoID=""
    @State private var kind="summary"
    @State private var language="en"
    @State private var metadata=false
    @State private var captions=false
    @State private var savedID=""
    @State private var deletion:String?
    private let kinds=["summary","chapters","captions","metadata","search_assistance","moderation_explanation"]
    private let languages=["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"]
    private var blocked:Bool {model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || model.pendingAICancel}
    var body:some View {
        VStack(alignment:.leading,spacing:16) {
            HStack {Text(model.text("ai")).font(.title2);Spacer();Button(model.text("aiCheckProvider")) {Task {await model.checkAIProvider()}}.disabled(model.busy)}
            Text(model.text(model.aiProviderAvailable==true ? "aiProviderReady" : model.aiProviderAvailable==false ? "aiProviderMissing" : "aiProviderUnknown")).foregroundStyle(.secondary)
            Text(model.text("aiPrepareHelp")).foregroundStyle(.secondary)
            Picker(model.text("content"),selection:$videoID) {
                Text(model.text("aiChooseVideo")).tag("")
                ForEach((model.snapshot?.videos ?? []).filter{model.canManageAssets($0)}) {video in Text(video.title).tag(video.id)}
            }.disabled(blocked)
            Picker(model.text("aiKind"),selection:$kind) {ForEach(kinds,id:\.self) {Text(model.text("aiKind_"+$0)).tag($0)}}.disabled(blocked)
            Picker(model.text("aiOutputLanguage"),selection:$language) {ForEach(languages,id:\.self) {Text(Locale(identifier:$0).localizedString(forIdentifier:$0) ?? $0).tag($0)}}.disabled(blocked)
            Toggle(model.text("aiShareMetadata"),isOn:$metadata).disabled(blocked)
            Toggle(model.text("aiShareCaptions"),isOn:$captions).disabled(blocked)
            Button(model.text("aiPrepare")) {
                let captured=(videoID,kind,language,metadata,captions,model.currentRevision)
                Task {await model.prepareAI(videoID:captured.0,kind:captured.1,classes:(captured.3 ? ["metadata"] : [])+(captured.4 ? ["captions"] : []),language:captured.2,expectedRevision:captured.5)}
            }.disabled(blocked || videoID.isEmpty)
            Divider()
            Picker(model.text("aiSaved"),selection:$savedID) {
                Text(model.text("aiChooseSaved")).tag("")
                ForEach(model.snapshot?.ai_jobs ?? []) {job in Text(model.text("aiKind_"+job.Kind)+" · "+model.text("aiState_"+job.State)).tag(job.id)}
            }.disabled(model.busy)
            Button(model.text("aiOpenSaved")) {let captured=(savedID,model.currentRevision);Task {await model.openAI(captured.0,expectedRevision:captured.1)}}.disabled(model.busy || savedID.isEmpty)
            if let job=model.selectedAI {
                VStack(alignment:.leading,spacing:12) {
                    Text(model.text("aiState_"+job.State)).font(.headline)
                    Text(job.id).font(.caption).textSelection(.enabled)
                    Text(model.text("aiOutputLanguage")+": "+job.OutputLanguage)
                    Text(model.text("aiContextPreview")+": "+job.ContextPreview).textSelection(.enabled)
                    Text(model.text("aiEstimatedUnits")+": "+model.number(job.EstimatedUnits))
                    if !job.Provider.isEmpty {Text(job.Provider+" · "+job.Model).font(.caption).textSelection(.enabled)}
                    if !job.Failure.isEmpty {Text(job.Failure).foregroundStyle(.secondary).textSelection(.enabled)}
                    if model.aiStreaming {ProgressView();Text(model.aiPartial.isEmpty ? model.text("aiWaiting") : model.aiPartial).textSelection(.enabled)}
                    else {Text(!job.Result.isEmpty ? job.Result : !job.Partial.isEmpty ? job.Partial : model.text("aiNoResult")).textSelection(.enabled)}
                    Text(model.text("aiHumanHelp")).font(.caption).foregroundStyle(.secondary)
                    ViewThatFits {
                        HStack {actions(job)}
                        VStack(alignment:.leading) {actions(job)}
                    }
                    Button(model.text("aiRefreshTask")) {let captured=(job.id,model.currentRevision);Task {await model.openAI(captured.0,expectedRevision:captured.1)}}.disabled(model.busy)
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
        }.task {await model.checkAIProvider()}
        .onChange(of:model.currentRevision) {_,_ in videoID="";savedID="";metadata=false;captions=false;deletion=nil}
        .confirmationDialog(model.text("aiDeleteQuestion"),isPresented:Binding(get:{deletion != nil},set:{if !$0 {deletion=nil}}),titleVisibility:.visible) {
            Button(model.text("aiDelete"),role:.destructive) {guard let id=deletion else {return};let revision=model.currentRevision;deletion=nil;Task {await model.deleteAI(id,expectedRevision:revision)}}
        }
    }
    @ViewBuilder private func actions(_ job:CreatorAIJob) -> some View {
        if job.State=="awaiting_permission",!model.aiStreaming {Button(model.text("aiApproveRun")) {let captured=(job.id,model.currentRevision);Task {await model.approveAI(captured.0,expectedRevision:captured.1)}}.disabled(blocked || model.aiProviderAvailable != true)}
        if ["awaiting_permission","running"].contains(job.State) || model.aiStreaming {Button(model.text("aiCancel"),role:.destructive) {let captured=(job.id,model.currentRevision);Task {await model.cancelAI(captured.0,expectedRevision:captured.1)}}.disabled(model.aiCancelling)}
        if job.State=="review_required" {
            Button(model.text("aiAccept")) {let captured=(job.id,model.currentRevision);Task {await model.reviewAI(captured.0,apply:true,expectedRevision:captured.1)}}.disabled(blocked)
            Button(model.text("aiReject")) {let captured=(job.id,model.currentRevision);Task {await model.reviewAI(captured.0,apply:false,expectedRevision:captured.1)}}.disabled(blocked)
        }
        if job.State != "running",!model.aiStreaming {Button(model.text("aiDelete"),role:.destructive) {deletion=job.id}.disabled(blocked)}
    }
}

struct CreatorRightsForm:View {
    @EnvironmentObject private var model:CreatorModel
    @Environment(\.dismiss) private var dismiss
    let videoID:String
    let expectedRevision:UInt64
    @State private var basis="owned"
    @State private var license=""
    @State private var territories="WORLDWIDE"
    @State private var evidence=""
    @State private var exclusive=false
    @State private var hasStart=false
    @State private var hasEnd=false
    @State private var start=Date()
    @State private var end=Date().addingTimeInterval(365*86400)
    @State private var contributors:[CreatorModel.Contribution]=[]
    private var video:CreatorVideo? {model.snapshot?.videos?.first(where:{$0.id==videoID})}
    var body:some View {
        NavigationStack {
            Form {
                if let video {
                    Text(video.title).font(.headline)
                    Text(video.sha256).font(.caption).textSelection(.enabled)
                    Picker(model.text("rightsBasis"),selection:$basis) {ForEach(["owned","licensed","public-domain"],id:\.self) {Text(model.text($0)).tag($0)}}
                    TextField(model.text("license"),text:$license)
                    TextField(model.text("territories"),text:$territories)
                    TextField(model.text("evidence"),text:$evidence)
                    Toggle(model.text("rightsExclusive"),isOn:$exclusive)
                    Toggle(model.text("rightsHasStart"),isOn:$hasStart)
                    if hasStart {DatePicker(model.text("rightsStart"),selection:$start)}
                    Toggle(model.text("rightsHasEnd"),isOn:$hasEnd)
                    if hasEnd {DatePicker(model.text("rightsEnd"),selection:$end)}
                    Section(model.text("rightsContributors")) {
                        Text(model.text("rightsSharesHelp")).font(.caption).foregroundStyle(.secondary)
                        ForEach($contributors) {$contributor in
                            VStack(alignment:.leading,spacing:8) {
                                TextField(model.text("rightsContributorAccount"),text:$contributor.account)
                                TextField(model.text("rightsSharePercent"),text:$contributor.percent)
                                Button(model.text("rightsRemoveContributor"),role:.destructive) {contributors.removeAll(where:{$0.id==contributor.id})}.disabled(contributors.count<=1)
                            }
                        }
                        Button(model.text("rightsAddContributor")) {contributors.append(CreatorModel.Contribution(account:"",percent:""))}.disabled(contributors.count>=64)
                    }
                    Text(model.text("independentReview")).foregroundStyle(.secondary)
                    Button(model.text("declareRights")) {
                        let captured=(basis,license,territories,hasStart ? start : nil,hasEnd ? end : nil,exclusive,contributors,evidence)
                        Task {
                            await model.declareRights(videoID:videoID,basis:captured.0,license:captured.1,territories:captured.2,start:captured.3,end:captured.4,exclusive:captured.5,contributors:captured.6,evidence:captured.7,expectedRevision:expectedRevision)
                            guard expectedRevision==model.currentRevision else {return}
                            if model.pendingOperation {dismiss()}
                            else if model.message.isEmpty {dismiss()}
                        }
                    }.disabled(model.busy || model.pendingOperation || !model.pendingAssetKind.isEmpty || expectedRevision != model.currentRevision || CreatorModel.contributorBody(contributors)==nil || evidence.count != 64 || hasEnd && (end<=Date() || hasStart && end<=start))
                } else {Text(model.text("rightsInvalid"))}
            }.navigationTitle(model.text("rights"))
            .toolbar {Button(model.text("close")) {dismiss()}}
            .onAppear {if contributors.isEmpty,let video {contributors=[CreatorModel.Contribution(account:video.owner,percent:"100")]}}
            .onChange(of:model.currentRevision) {_,_ in license="";evidence="";contributors=[];dismiss()}
        }.frame(minWidth:320,minHeight:480)
    }
}

struct CreatorRightsDetails:View {
    @EnvironmentObject private var model:CreatorModel
    let rights:CreatorSnapshot.Rights
    var body:some View {
        DisclosureGroup(model.text("rights")+" · "+model.text(rights.state)) {
            VStack(alignment:.leading,spacing:8) {
                Text(model.text("rightsBasis")+": "+model.text(rights.basis=="public_domain" ? "public-domain" : rights.basis))
                Text(model.text("rightsDeclaredBy")+": "+rights.declared_by).textSelection(.enabled)
                if let license=rights.license_reference,!license.isEmpty {Text(model.text("license")+": "+license).textSelection(.enabled)}
                Text(model.text("territories")+": "+(rights.territories ?? []).joined(separator:", "))
                Text(model.text("rightsExclusive")+": "+model.text(rights.exclusive==true ? "yes" : "no"))
                if let start=rights.starts_at {Text(model.text("rightsStart")+": "+start)}
                if let end=rights.ends_at {Text(model.text("rightsEnd")+": "+end)}
                if let splits=rights.contributor_splits,!splits.isEmpty {
                    Text(model.text("rightsContributors")).font(.headline)
                    ForEach(splits.indices,id:\.self) {index in
                        Text(splits[index].account+" · "+(Double(splits[index].basis_points)/100).formatted(.number.precision(.fractionLength(0...2)).locale(Locale(identifier:model.locale)))+"%").textSelection(.enabled)
                    }
                }
                Text(model.text("evidence")+": "+rights.evidence_sha256).font(.caption).textSelection(.enabled)
                Text(model.text("rightsSourceHash")+": "+rights.source_sha256).font(.caption).textSelection(.enabled)
                if let reviewer=rights.reviewer,!reviewer.isEmpty {Text(model.text("rightsReviewer")+": "+reviewer).font(.caption).textSelection(.enabled)}
            }.font(.callout).frame(maxWidth:.infinity,alignment:.leading)
        }
    }
}
