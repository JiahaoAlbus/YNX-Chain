import AVKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: VideoModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var query=""
    @State private var showingDisplaySettings=false
    @State private var deletingPlaylist: NativePlaylist?
    @AppStorage("ynx.media.display.text") private var displayMode=1
    @ScaledMetric(relativeTo:.body) private var displayPoints:CGFloat=15
    private var displayScale:CGFloat {[0.9333333,1,1.1333333][max(0,min(displayMode,2))]}
    var body: some View {
        NavigationStack {
            VStack(spacing:0) {
                HStack(spacing:12) { Image("ynx-brand-original").resizable().scaledToFit().frame(width:46,height:24).padding(4).background(Color.white).clipShape(RoundedRectangle(cornerRadius:6)).accessibilityLabel("YNX"); Text("YNX Video").font(.headline.bold()).foregroundStyle(.white); Spacer(); Button(model.text("signIn")){Task{await model.signIn()}}.disabled(model.accountBusy || model.signOutPending).buttonStyle(.borderedProminent).tint(.white).foregroundStyle(Color(red:0,green:47/255,blue:167/255)).accessibilityLabel(model.text("signIn")) }.padding().background(Color(red:0,green:47/255,blue:167/255))
                HStack { if !model.accountMessage.isEmpty { Text(model.accountMessage).font(.caption).lineLimit(1) };Spacer();if model.accountConnected || model.signOutPending || model.awaitingWallet { Button(model.text("signOut")){Task{await model.signOut()}}.disabled(model.accountBusy) };Button(model.text("retry")){Task{await model.restoreAccount()}}.disabled(model.accountBusy) }.padding(.horizontal)
                HStack { TextField(model.text("search"),text:$query).textFieldStyle(.roundedBorder).accessibilityLabel(model.text("search")); Button(model.text("search")){Task{await model.load(query:query)}} }.padding()
                ScrollView(.horizontal) { HStack { Button(model.text("discover")){Task{await model.load()}}; Button(model.text("subscriptions")){Task{await model.loadLibrary("/v1/subscriptions",label:model.text("subscriptions"))}}; Button(model.text("playlists")){Task{await model.loadLibrary("/v1/playlists",label:model.text("playlists"))}}; Button(model.text("history")){Task{await model.loadLibrary("/v1/history",label:model.text("history"))}} }.buttonStyle(.bordered).font(.caption).accessibilityElement(children:.contain) }
                if model.showingPlaylists && model.accountConnected {
                    HStack { TextField(model.text("playlists"),text:$model.playlistName).textFieldStyle(.roundedBorder).disabled(model.playlistPending || model.playlistBusy);Button(model.text(model.playlistPending ? "retry" : "createPlaylist")){Task{await model.createPlaylist()}}.disabled(model.playlistBusy);if model.playlistPending { Button(model.text("pauseDraft")){model.preparePlaylistPause()}.disabled(model.playlistBusy) } }.padding(.horizontal)
                }
                if model.showingPlaylists && model.accountConnected && !model.savedPlaylistDrafts.isEmpty {
                    VStack(alignment:.leading) { Text(model.text("savedDrafts")).font(.caption);ForEach(model.savedPlaylistDrafts,id:\.key) { draft in Button(model.text("restoreDraft")+": "+draft.name){model.restorePlaylistDraft(draft)}.disabled(model.playlistPending || model.playlistBusy) } }.padding(.horizontal)
                }
                if model.playlistOperationPending && model.accountConnected { Button(model.text("retry")){Task{await model.retryPlaylistOperation()}}.disabled(model.playlistBusy) }
                if !model.operationMessage.isEmpty { Text(model.operationMessage).font(.caption) }
                stateView.frame(maxWidth:.infinity,maxHeight:.infinity)
                settings
            }
            .font(.system(size:displayPoints*displayScale))
            .environment(\.layoutDirection,model.locale=="ar" ? .rightToLeft:.leftToRight)
            .task { await model.start() }
            .onChange(of:scenePhase) { _,phase in if phase == .background { model.suspendAccount() } else if phase == .active { Task { await model.restoreAccount() } } }
            .confirmationDialog(model.text("deletePlaylist"),isPresented:Binding(get:{deletingPlaylist != nil},set:{if !$0 { deletingPlaylist=nil }}),titleVisibility:.visible) {
                Button(model.text("deletePlaylist"),role:.destructive) { if let original=deletingPlaylist { deletingPlaylist=nil;Task{await model.changePlaylist(original,videoID:nil,action:"delete")} } }
            } message: { Text(deletingPlaylist?.Name ?? "") }
            .confirmationDialog(model.text("pauseDraft"),isPresented:Binding(get:{model.playlistPause != nil},set:{if !$0 { model.playlistPause=nil }}),titleVisibility:.visible) { Button(model.text("pauseDraft")){model.confirmPlaylistPause()} } message: { Text(model.text("pauseDraftNotice")) }
            .sheet(item:$model.selected){ VideoPlayerSheet(video:$0,gateway:model.gateway,title:model.text("play")).onDisappear { model.stopPlayback() } }
        }
    }
    @ViewBuilder private var stateView: some View {
        switch model.state {
        case .loading: ProgressView(model.text("loading"))
        case .empty: ContentUnavailableView(model.text("empty"),systemImage:"play.rectangle",description:Text(model.text("noMetrics")))
        case .offline: retry(model.text("offline"))
        case .unavailable: retry(model.text("walletPending"))
        case .failure(let reason): retry(model.text("unavailable")+"\n"+reason)
        case .library(let label,let rows):
            if model.showingPlaylists { List(model.playlists) { item in Button(item.Name){Task{await model.openPlaylist(item)}}.contextMenu { Button(model.text("deletePlaylist"),role:.destructive){deletingPlaylist=item}.disabled(model.playlistBusy || model.playlistOperationPending) } }.navigationTitle(label) } else { List(rows,id:\.self){Text($0)}.navigationTitle(label) }
        case .loaded:
            List(model.videos) { video in
                Button { model.select(video) } label: {
                    VStack(alignment:.leading) {
                        Text(video.title).font(.headline)
                        Text(video.description).foregroundStyle(.secondary)
                        Text("\(video.status) · \(video.visibility)").font(.caption)
                    }
                }.accessibilityLabel(model.text("play")+": "+video.title)
                .contextMenu { if let playlist=model.openedPlaylist { Button(model.text("removeFromPlaylist"),role:.destructive){Task{await model.changePlaylist(playlist,videoID:video.id,action:"remove")}}.disabled(model.playlistBusy || model.playlistOperationPending) } }
            }.listStyle(.plain)
        }
    }
    private func retry(_ message:String)->some View {
        ContentUnavailableView {
            Label(model.text("unavailable"),systemImage:"wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button(model.text("retry")){Task{await model.load()}}
        }
    }
    private var settings: some View {
      Button { showingDisplaySettings=true } label: { Label(videoDisplayLabels(model.locale)[0],systemImage:"slider.horizontal.3") }.frame(minHeight:44)
      .sheet(isPresented:$showingDisplaySettings) {
       NavigationStack {
        Form {
         Picker(model.text("language"),selection:Binding(get:{model.locale},set:model.choose)){ForEach(VideoModel.supported,id:\.self){Text($0)}}
         Picker(model.text("aiLanguage"),selection:Binding(get:{model.aiLocale},set:model.chooseAI)){ForEach(VideoModel.supported,id:\.self){Text($0)}}
         Picker(videoDisplayLabels(model.locale)[0],selection:$displayMode){ForEach(0..<3,id:\.self){Text(videoDisplayLabels(model.locale)[$0+1]).tag($0)}}
        }.navigationTitle(videoDisplayLabels(model.locale)[0]).toolbar { ToolbarItem(placement:.confirmationAction) { Button(model.text("cancel")) { showingDisplaySettings=false } } }
       }.font(.system(size:displayPoints*displayScale))
      }
    }
}

struct VideoPlayerSheet: View {
    @EnvironmentObject private var model:VideoModel
    let video:VideoRecord; let gateway:URL; let title:String
    @State private var choices:[NativePlaylist]=[]
    @State private var comment="";@State private var report="";@State private var transcript=""
    var body:some View { NavigationStack { ScrollView { VStack { HStack(spacing:12){Image("ynx-brand-original").resizable().scaledToFit().frame(width:46,height:24).padding(4).background(Color.white).clipShape(RoundedRectangle(cornerRadius:6)).accessibilityLabel("YNX");Text("YNX Video").font(.headline);Spacer()};Group { if model.player != nil { VideoPlayer(player:model.player).frame(minHeight:260) } else { ContentUnavailableView(title,systemImage:"exclamationmark.triangle") } };if model.accountConnected { Menu(model.text("addToPlaylist")){ForEach(choices){playlist in Button(playlist.Name){Task{await model.changePlaylist(playlist,videoID:video.id,action:"add")}}}}.disabled(choices.isEmpty || model.playlistBusy || model.playlistOperationPending) };HStack{Button(model.text("subscriptions")){Task{await model.mutate("/v1/channels/\(video.channel_id)/subscription",body:[:])}};if let track=video.captions?.first(where:{$0.human_approved}){Button(model.text("captions")){Task{transcript=await model.transcript(track)}}}};TextField(model.text("comments"),text:$comment).textFieldStyle(.roundedBorder);Button(model.text("comments")){Task{if await model.mutate("/v1/videos/\(video.id)/comments",body:["body":comment]) { comment="" }}};TextField(model.text("report"),text:$report).textFieldStyle(.roundedBorder);Button(model.text("report")){Task{if await model.mutate("/v1/videos/\(video.id)/reports",body:["reason":"viewer_report","details":report]) { report="" }}};if !transcript.isEmpty{Text(transcript).accessibilityLabel(model.text("captions"))};if !model.operationMessage.isEmpty{Text(model.operationMessage).font(.caption)} }.padding() }.navigationTitle(video.title).accessibilityLabel(title+": "+video.title).task { if model.accountConnected { choices=(try? await model.playlistChoices()) ?? [] } } } }
}

private func videoDisplayLabels(_ tag:String)->[String] {
 switch Locale(identifier:tag).languageCode ?? "en" {
 case "zh":return tag.contains("Hant") || tag.contains("TW") ? ["顯示與字級","緊湊","標準","較大"]:["显示与字号","紧凑","标准","较大"]
 case "ja":return ["表示と文字サイズ","小さめ","標準","大きめ"]
 case "ko":return ["화면 및 글자 크기","작게","표준","크게"]
 case "es":return ["Pantalla y texto","Compacto","Estándar","Grande"]
 case "fr":return ["Affichage et texte","Compact","Standard","Grand"]
 case "de":return ["Anzeige und Text","Kompakt","Standard","Größer"]
 case "pt":return ["Exibição e texto","Compacto","Padrão","Maior"]
 case "ru":return ["Вид и размер текста","Компактный","Обычный","Крупный"]
 case "ar":return ["العرض وحجم النص","صغير","قياسي","أكبر"]
 case "id":return ["Tampilan dan teks","Ringkas","Standar","Besar"]
 default:return ["Display and text size","Compact","Standard","Larger"]
 }
}
