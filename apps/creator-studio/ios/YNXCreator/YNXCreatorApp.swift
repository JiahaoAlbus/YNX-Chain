import SwiftUI
import UniformTypeIdentifiers

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
    @State private var choosingFile=false
    @State private var cancelUpload=false
    @State private var cancelOperation=false
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
                        ForEach(["overview","channel","team","content","upload","moderation","earn","disputes"],id:\.self) {Text(model.text($0)).tag($0)}
                    }.pickerStyle(.menu)
                    if !model.message.isEmpty {Text(model.message).foregroundStyle(.secondary).textSelection(.enabled)}
                    if !model.connected {
                        ContentUnavailableView(model.text("signIn"),systemImage:"person.crop.circle",description:Text(model.text("walletAccess")))
                    } else {
                        recovery
                        switch section {
                        case "channel": channel
                        case "team": CreatorTeamView()
                        case "moderation": CreatorReviewView()
                        case "content": content
                        case "upload": upload
                        case "earn": earnings
                        case "disputes": CreatorDisputeView()
                        default: overview
                        }
                    }
                }.padding(24).frame(maxWidth:960,alignment:.leading).frame(maxWidth:.infinity)
            }.navigationTitle("YNX Creator Studio")
                .task {await model.start()}
                .onChange(of:scenePhase) {_,phase in if phase == .active {Task {await model.restore()}} else if phase == .background {model.suspend()}}
                .onChange(of:model.connected) {_,connected in if !connected {handle="";name="";title="";description="";source="";license="";evidence="";owned=false;rightsLicense="";rightsEvidence="";payout="";selectedVideo=nil;choosingFile=false}}
                .fileImporter(isPresented:$choosingFile,allowedContentTypes:[.mpeg4Movie,UTType(filenameExtension:"webm") ?? .movie]) {result in
                    guard case .success(let file)=result,model.currentRevision==pickerRevision else {return};let access=file.startAccessingSecurityScopedResource()
                    let captured=(title,description,basis,source,license,territories,evidence,owned,pickerRevision)
                    Task {@MainActor in defer {if access {file.stopAccessingSecurityScopedResource()}}
                        await model.stage(file:file,title:captured.0,description:captured.1,basis:captured.2,source:captured.3,license:captured.4,territories:captured.5,evidence:captured.6,owned:captured.7,expectedRevision:captured.8)
                    }
                }
                .confirmationDialog(model.text("cancelQuestion"),isPresented:$cancelUpload,titleVisibility:.visible) {Button(model.text("cancelDraft"),role:.destructive) {model.cancelUpload()}}
                .confirmationDialog(model.text("cancelQuestion"),isPresented:$cancelOperation,titleVisibility:.visible) {Button(model.text("cancelOperation"),role:.destructive) {model.cancelOperation()}}
                .sheet(item:$selectedVideo) {video in rights(video)}
        }
        #if os(macOS)
        .frame(minWidth:740,minHeight:560)
        #endif
    }
    private var header: some View {
        VStack(alignment:.leading,spacing:12) {
            HStack {
                Image("ynx-brand-original").resizable().scaledToFit().frame(width:124,height:58).accessibilityLabel("YNX")
                Spacer()
                Menu(model.text("language")) {ForEach(["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"],id:\.self) {locale in Button(Locale(identifier:locale).localizedString(forIdentifier:locale) ?? locale) {model.language(locale)}}}
                if model.busy {ProgressView()}
                if model.connected || model.signOutPending {
                    Button(model.text(model.signOutPending ? "signOutRetry" : "signOut")) {Task {await model.signOut()}}.disabled(model.busy)
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
            Button(model.text("createChannel")) {Task {await model.perform("/v1/channels",body:["handle":handle,"name":name])}}.buttonStyle(.borderedProminent).disabled(model.busy || model.pendingOperation || handle.isEmpty || name.isEmpty)
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
            Toggle(model.text("ownedConsent"),isOn:$owned)
            Text(model.text("uploadLimit")).font(.caption).foregroundStyle(.secondary)
            Button(model.text("chooseUpload")) {pickerRevision=model.currentRevision;choosingFile=true}.buttonStyle(.borderedProminent).disabled(model.busy || !model.pendingUploadTitle.isEmpty || !owned || model.channelID.isEmpty || title.isEmpty || source.isEmpty || license.isEmpty)
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
                    ViewThatFits {
                        HStack {videoActions(video)}
                        VStack(alignment:.leading) {videoActions(video)}
                    }.disabled(model.busy || model.pendingOperation)
                    CreatorPublicationControls(video:video).disabled(model.busy || model.pendingOperation)
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
        }
    }
    @ViewBuilder private func videoActions(_ video:CreatorVideo) -> some View {
        Button(model.text("rights")) {selectedVideo=video}
        if video.status=="failed" {Button(model.text("retryProcessing")) {Task {await model.perform("/v1/videos/"+video.id+"/retry-processing")}}}
        if ["draft","rejected","unpublished"].contains(video.workflow_state) && video.status=="ready" {Button(model.text("submitReview")) {Task {await model.perform("/v1/videos/"+video.id+"/submit-review")}}}
        if video.workflow_state=="approved" {
            Menu(model.text("publish")) {ForEach(["public","unlisted","private"],id:\.self) {visibility in Button(model.text(visibility)) {Task {await model.perform("/v1/videos/"+video.id+"/publish",body:["visibility":visibility])}}}}
        }
        if video.workflow_state=="published" {Button(model.text("unpublish")) {Task {await model.perform("/v1/videos/"+video.id+"/unpublish")}}}
        Button(model.text("monetization")) {Task {await model.perform("/v1/videos/"+video.id+"/monetization")}}
    }
    private func rights(_ video:CreatorVideo) -> some View {
        NavigationStack {
            Form {
                Text(video.title)
                Picker(model.text("rightsBasis"),selection:$basis) {ForEach(["owned","licensed","public-domain"],id:\.self) {Text(model.text($0)).tag($0)}}
                TextField(model.text("license"),text:$rightsLicense)
                TextField(model.text("territories"),text:$territories)
                TextField(model.text("evidence"),text:$rightsEvidence)
                Text(model.text("independentReview")).foregroundStyle(.secondary)
                Button(model.text("declareRights")) {Task {await model.perform("/v1/videos/"+video.id+"/rights",body:["basis":basis=="public-domain" ? "public_domain" : basis,"license_reference":rightsLicense,"territories":territories.split(separator:",").map{String($0).trimmingCharacters(in:.whitespaces)},"contributor_splits":[],"evidence_sha256":rightsEvidence.lowercased(),"source_sha256":video.sha256]);if !model.pendingOperation {selectedVideo=nil}}}.disabled(model.busy || model.pendingOperation || rightsEvidence.count != 64)
            }.navigationTitle(model.text("rights")).toolbar {Button(model.text("close")) {selectedVideo=nil}}
        }.frame(minWidth:320,minHeight:360)
    }
    private var earnings: some View {
        VStack(alignment:.leading,spacing:16) {
            Text(model.text("earn")).font(.title2)
            ForEach(model.snapshot?.revenue ?? []) {record in VStack(alignment:.leading) {Text(model.number(record.AmountYNXT)+" YNXT");Text(record.PayReceiptID).font(.caption).textSelection(.enabled)}}
            if (model.snapshot?.revenue ?? []).isEmpty {Text(model.text("noRevenue")).foregroundStyle(.secondary)}
            ForEach(model.snapshot?.payout_intents ?? []) {intent in HStack {Text(model.number(intent.AmountYNXT)+" YNXT");Spacer();Text(intent.State).foregroundStyle(.secondary)}}
            TextField(model.text("payoutAmount"),text:$payout).textFieldStyle(.roundedBorder)
            Text(model.text("payoutConsent")).font(.caption).foregroundStyle(.secondary)
            Button(model.text("createPayout")) {if let amount=Int(payout),amount>0 {Task {await model.perform("/v1/studio/payout-intents",body:["amount_ynxt":amount])}}}.disabled(model.busy || model.pendingOperation || (Int(payout) ?? 0)<=0)
        }
    }
}

struct CreatorTeamView: View {
    @EnvironmentObject private var model:CreatorModel
    @State private var inviteAccount=""
    @State private var inviteID=""
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
            Button(model.text("invite")) {Task {await model.perform("/v1/channels/"+model.channelID+"/team/invites",body:["account":inviteAccount,"role":role])}}.disabled(model.role(model.channelID) != "owner" || inviteAccount.isEmpty)
            Divider()
            TextField(model.text("inviteID"),text:$inviteID).textFieldStyle(.roundedBorder)
            Button(model.text("acceptInvite")) {Task {await model.perform("/v1/team/invites/"+inviteID+"/accept")}}.disabled(!CreatorDraftState.validID(inviteID))
            ForEach(model.snapshot?.team ?? []) {team in
                VStack(alignment:.leading,spacing:12) {
                    Text(team.channel_id).font(.headline).textSelection(.enabled)
                    ForEach(team.members ?? [],id:\.account) {member in
                        VStack(alignment:.leading,spacing:6) {
                            Text(member.account).font(.caption).textSelection(.enabled)
                            Text(model.text(member.role)+" · "+model.text(member.state)).foregroundStyle(.secondary)
                            if model.role(team.channel_id)=="owner",member.account != model.account,member.state=="active" {
                                HStack {
                                    Menu(model.text("changeRole")) {ForEach(roles,id:\.self) {chosen in Button(model.text(chosen)) {Task {await model.perform("/v1/channels/"+team.channel_id+"/team/"+member.account+"/role",body:["role":chosen])}}}}
                                    Button(model.text("revoke"),role:.destructive) {revoking=team.channel_id+"/team/"+member.account}
                                }
                            }
                        }
                    }
                    ForEach(team.invites ?? []) {invite in
                        VStack(alignment:.leading) {Text(invite.id).textSelection(.enabled);Text(invite.account+" · "+model.text(invite.role)+" · "+model.text(invite.state)).font(.caption).foregroundStyle(.secondary)}
                    }
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
        }.disabled(model.busy || model.pendingOperation)
            .confirmationDialog(model.text("revokeQuestion"),isPresented:Binding(get:{revoking != nil},set:{if !$0 {revoking=nil}}),titleVisibility:.visible) {
                Button(model.text("revoke"),role:.destructive) {if let path=revoking {Task {await model.perform("/v1/channels/"+path,method:"DELETE")}};revoking=nil}
            }
            .onChange(of:model.account) {_,_ in inviteAccount="";inviteID="";revoking=nil}
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
                        Text(model.text("rights")+" · "+model.text(rights.basis))
                        Text(rights.evidence_sha256).font(.caption2).textSelection(.enabled)
                        HStack {
                            Button(model.text("approveRights")) {Task {await model.perform("/v1/rights/"+rights.id+"/review",body:["accepted":true,"reason":reason])}}
                            Button(model.text("rejectRights"),role:.destructive) {Task {await model.perform("/v1/rights/"+rights.id+"/review",body:["accepted":false,"reason":reason])}}
                        }.disabled(reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                    }
                    if video.workflow_state=="in_review" {
                        HStack {
                            Button(model.text("approvePublication")) {Task {await model.perform("/v1/videos/"+video.id+"/review-publication",body:["approved":true,"reason":reason])}}
                            Button(model.text("rejectPublication"),role:.destructive) {Task {await model.perform("/v1/videos/"+video.id+"/review-publication",body:["approved":false,"reason":reason])}}
                        }.disabled(reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)
                    }
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
        }.disabled(model.busy || model.pendingOperation)
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
                if video.workflow_state=="scheduled" {Button(model.text("publishDue")) {Task {await model.perform("/v1/videos/"+video.id+"/publish-due")}}}
            }
        }
        .sheet(isPresented:$editing) {
            NavigationStack {Form {
                TextField(model.text("title"),text:$title)
                TextField(model.text("description"),text:$description,axis:.vertical)
                Button(model.text("save")) {Task {await model.perform("/v1/videos/"+video.id+"/metadata",body:["title":title,"description":description]);if !model.pendingOperation {editing=false}}}.disabled(model.busy || model.pendingOperation || title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || title.count>140 || description.utf8.count>5000)
            }.navigationTitle(model.text("edit")).toolbar {Button(model.text("close")) {editing=false}}}.frame(minWidth:320,minHeight:300)
        }
        .sheet(isPresented:$scheduling) {
            NavigationStack {Form {
                DatePicker(model.text("publicationTime"),selection:$when,in:Date()...)
                Picker(model.text("publish"),selection:$visibility) {ForEach(["public","unlisted"],id:\.self) {Text(model.text($0)).tag($0)}}
                Button(model.text("schedule")) {Task {await model.perform("/v1/videos/"+video.id+"/schedule",body:["visibility":visibility,"scheduled_at":ISO8601DateFormatter().string(from:when)]);if !model.pendingOperation {scheduling=false}}}.disabled(model.busy || model.pendingOperation || when<=Date())
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
                    Text(model.number(record.AmountYNXT)+" YNXT");Text(record.PayReceiptID).font(.caption).textSelection(.enabled)
                    if model.canDispute(record) {Button(model.text("submitDispute")) {selected=Request(id:record.id,appeal:false,revision:model.currentRevision)}}
                }.padding().frame(maxWidth:.infinity,alignment:.leading).background(.quaternary,in:RoundedRectangle(cornerRadius:14))
            }
            ForEach(model.snapshot?.disputes ?? []) {dispute in
                VStack(alignment:.leading,spacing:6) {Text(dispute.Reason);Text(dispute.id+" · "+dispute.State).font(.caption);Text(dispute.RevenueRecordID).font(.caption).textSelection(.enabled)}
            }
        }.disabled(model.busy || model.pendingOperation)
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
                }.disabled(model.busy || model.pendingOperation || request.revision != model.currentRevision || reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || reason.count>2000)
            }.navigationTitle(model.text(request.appeal ? "submitAppeal" : "submitDispute"))
            .toolbar {Button(model.text("close")) {dismiss()}}
            .onChange(of:model.connected) {_,connected in if !connected {reason="";dismiss()}}
        }.frame(minWidth:320,minHeight:320)
    }
}
