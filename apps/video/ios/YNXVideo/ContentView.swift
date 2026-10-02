import AVKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: VideoModel
    @Environment(\.openURL) private var openURL
    @State private var query=""
    var body: some View {
        NavigationStack {
            VStack(spacing:0) {
                HStack { Text("YNX Video").font(.title.bold()).foregroundStyle(.white); Spacer(); Button(model.text("signIn")){if let url=model.walletURL(){openURL(url)}}.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(Color(red:0,green:47/255,blue:167/255)).accessibilityLabel(model.text("signIn")) }.padding().background(Color(red:0,green:47/255,blue:167/255))
                HStack { TextField(model.text("search"),text:$query).textFieldStyle(.roundedBorder).accessibilityLabel(model.text("search")); Button(model.text("search")){Task{await model.load(query:query)}} }.padding()
                HStack { Button(model.text("discover")){Task{await model.load()}}; Button(model.text("subscriptions")){Task{await model.loadLibrary("/v1/subscriptions",label:model.text("subscriptions"))}}; Button(model.text("playlists")){Task{await model.loadLibrary("/v1/playlists",label:model.text("playlists"))}}; Button(model.text("history")){Task{await model.loadLibrary("/v1/history",label:model.text("history"))}} }.buttonStyle(.bordered).font(.caption).accessibilityElement(children:.contain)
                stateView.frame(maxWidth:.infinity,maxHeight:.infinity)
                settings
            }
            .environment(\.layoutDirection,model.locale=="ar" ? .rightToLeft:.leftToRight)
            .task { await model.load() }
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
        case .library(let label,let rows): List(rows,id:\.self){Text($0)}.navigationTitle(label)
        case .loaded:
            List(model.videos) { video in
                Button { model.select(video) } label: {
                    VStack(alignment:.leading) {
                        Text(video.title).font(.headline)
                        Text(video.description).foregroundStyle(.secondary)
                        Text("\(video.status) · \(video.visibility)").font(.caption)
                    }
                }.accessibilityLabel(model.text("play")+": "+video.title)
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
    private var settings: some View { HStack { Text(model.text("language")); Picker(model.text("language"),selection:Binding(get:{model.locale},set:model.choose)){ForEach(VideoModel.supported,id:\.self){Text($0)}}; Text(model.text("aiLanguage")); Picker(model.text("aiLanguage"),selection:Binding(get:{model.aiLocale},set:model.chooseAI)){ForEach(VideoModel.supported,id:\.self){Text($0)}} }.padding().font(.caption) }
}

struct VideoPlayerSheet: View {
    @EnvironmentObject private var model:VideoModel
    let video:VideoRecord; let gateway:URL; let title:String
    @State private var comment="";@State private var report="";@State private var transcript=""
    var body:some View { NavigationStack { ScrollView { VStack { Group { if model.player != nil { VideoPlayer(player:model.player).frame(minHeight:260) } else { ContentUnavailableView(title,systemImage:"exclamationmark.triangle") } };HStack{Button(model.text("subscriptions")){Task{await model.mutate("/v1/channels/\(video.channel_id)/subscription",body:[:])}};if let track=video.captions?.first(where:{$0.human_approved}){Button(model.text("captions")){Task{transcript=await model.transcript(track)}}}};TextField(model.text("comments"),text:$comment).textFieldStyle(.roundedBorder);Button(model.text("comments")){Task{if await model.mutate("/v1/videos/\(video.id)/comments",body:["body":comment]) { comment="" }}};TextField(model.text("report"),text:$report).textFieldStyle(.roundedBorder);Button(model.text("report")){Task{if await model.mutate("/v1/videos/\(video.id)/reports",body:["reason":"viewer_report","details":report]) { report="" }}};if !transcript.isEmpty{Text(transcript).accessibilityLabel(model.text("captions"))};if !model.operationMessage.isEmpty{Text(model.operationMessage).font(.caption)} }.padding() }.navigationTitle(video.title).accessibilityLabel(title+": "+video.title) } }
}
