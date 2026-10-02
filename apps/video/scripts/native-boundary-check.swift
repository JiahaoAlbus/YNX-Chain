import AVFoundation
import Foundation

@main enum NativeBoundaryCheck {
    struct Failure: Error { let message:String }
    static func check(_ value:Bool,_ why:String)throws { if !value { throw Failure(message:why) } }
    @MainActor static func main() async throws {
        try check(try VideoHTTP.url("/v1/videos").absoluteString == "https://video.ynxweb4.com/video/api/v1/videos","official endpoint")
        for path in ["https://other.example/v1/videos","//other.example/v1/videos","/media/../secret","/v1/videos#fragment","/media/\\other"] {
            do { _ = try VideoHTTP.url(path); throw Failure(message:"unsafe path accepted") } catch is VideoHTTP.Failure {}
        }
        let makeRecord: (String)->Data = { id in Data("[{\"id\":\"\(id)\",\"channel_id\":\"channel_1\",\"title\":\"Owned fixture\",\"description\":\"\",\"status\":\"published\",\"visibility\":\"public\"}]".utf8) }
        var delayed: CheckedContinuation<Data,Error>?
        var calls=0
        let model=VideoModel(loadData:{_,query in
            calls += 1
            if query.first?.value == "old" { return try await withCheckedThrowingContinuation { delayed=$0 } }
            return makeRecord("new")
        })
        let oldLoad=Task { await model.load(query:"old") }
        while delayed == nil { await Task.yield() }
        await model.load(query:"new")
        delayed!.resume(returning:makeRecord("old"));await oldLoad.value;delayed=nil
        try check(model.videos.map(\.id)==["new"],"late list replaced current selection")
        let failedLoad=Task { await model.load(query:"old") }
        while delayed == nil { await Task.yield() }
        await model.load(query:"new")
        delayed!.resume(throwing:URLError(.notConnectedToInternet));await failedLoad.value;delayed=nil
        if case .loaded=model.state {} else { throw Failure(message:"late failure replaced current state") }
        model.handle(url:URL(string:"wrong://wallet-auth/callback?gateway_session=untrusted")!)
        try check(model.videos.map(\.id)==["new"],"unrelated callback cleared current screen")

        let stopped=AVPlayer(playerItem:AVPlayerItem(asset:AVMutableComposition()))
        model.player=stopped
        model.selected=model.videos.first
        let callbackLoad=Task { await model.load(query:"old") }
        while delayed == nil { await Task.yield() }
        model.handle(url:URL(string:"ynxvideo://wallet-auth/callback?gateway_session=untrusted")!)
        delayed!.resume(returning:makeRecord("old"));await callbackLoad.value
        try check(model.player == nil && stopped.currentItem == nil && model.selected == nil && model.videos.isEmpty,"callback restored old playback or visible account content")
        let beforePrivate=calls
        await model.loadLibrary("/v1/history",label:"History")
        await model.mutate("/v1/videos/owned/comments",body:["body":"not sent"])
        try check(calls==beforePrivate,"unverified callback created private authority")

        let testURL=URL(string:"https://other.example/redirect")!
        let task=URLSession.shared.dataTask(with:testURL)
        let response=HTTPURLResponse(url:VideoHTTP.api,statusCode:302,httpVersion:nil,headerFields:["Location":testURL.absoluteString])!
        var decisionMade=false
        VideoHTTP.shared.urlSession(URLSession.shared,task:task,willPerformHTTPRedirection:response,newRequest:URLRequest(url:testURL)){ request in decisionMade=true;precondition(request == nil) }
        task.cancel()
        try check(decisionMade,"redirect decision missing")
        print("PASS: Apple Video actual model stale responses/failures, playback clear, unverified callback isolation, official paths and redirect rejection (no external requests)")
    }
}
