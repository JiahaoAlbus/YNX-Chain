import Foundation

actor MusicAPI {
    nonisolated let base:URL
    nonisolated let context:MusicSessionContext
    private let fence:MusicSessionFence
    private let transport:URLSession
    private let deviceKey:String

    init(context:MusicSessionContext, fence:MusicSessionFence, deviceKey:String,
         base:URL = URL(string:"https://web4.ynxweb4.com/music")!,
         transport:URLSession? = nil) {
        self.context=context; self.fence=fence; self.deviceKey=deviceKey; self.base=base
        if let transport { self.transport=transport }
        else {
            let configuration=URLSessionConfiguration.ephemeral
            configuration.httpShouldSetCookies=false
            configuration.urlCache=nil
            configuration.timeoutIntervalForRequest=30
            self.transport=URLSession(configuration:configuration,delegate:MusicRedirectPolicy(),delegateQueue:nil)
        }
    }
    func request(_ path:String,method:String="GET",body:Data?=nil,contentType:String="application/json",idempotency:String?=nil)async throws->Data {
        let authorizationPath = ["api/auth/wallet-v1/challenge","api/auth/wallet-v1/session"].contains(path)
        try fence.requireCurrent(context, authenticated:!authorizationPath)
        var r=URLRequest(url:base.appending(path:path))
        r.httpMethod=method; r.httpBody=body
        r.setValue(contentType,forHTTPHeaderField:"Content-Type")
        if let idempotency { r.setValue(idempotency,forHTTPHeaderField:"Idempotency-Key") }
        if !authorizationPath, let binding=context.binding {
            guard !deviceKey.isEmpty else { throw URLError(.userAuthenticationRequired) }
            r.setValue(binding,forHTTPHeaderField:"X-YNX-App-Session")
            r.setValue(deviceKey,forHTTPHeaderField:"X-YNX-Product-Device-Key")
        }
        try fence.requireCurrent(context, authenticated:!authorizationPath)
        let (data,response)=try await transport.data(for:r)
        try fence.requireCurrent(context, authenticated:!authorizationPath)
        guard let h=response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if h.statusCode == 401 || h.statusCode == 403 { throw URLError(.userAuthenticationRequired) }
        guard (200..<300).contains(h.statusCode) else { throw URLError(.badServerResponse) }
        return data
    }
    func snapshot()async throws->Snapshot { try JSONDecoder().decode(Snapshot.self,from:try await request("api/me")) }
    func download(_ track:Track)async throws->Data {
        guard MusicAccountStore.validTrackID(track.id) else { throw URLError(.badURL) }
        let data=try await request("api/tracks/\(track.id)/media")
        try MusicAccountStore.validateAudio(data, expectedHash:track.audioSha256)
        return data
    }
    // A callback only returns a candidate binding. The main-actor owner checks
    // its captured attempt again before persisting or exposing that binding.
    func walletSession(response:String,request authorization:[String:Any])async throws->String {
        let approval=try WalletLink.approval(response,request:authorization)
        let challengeBody=try JSONSerialization.data(withJSONObject:["authorizationRequest":authorization,"walletApproval":approval],options:.sortedKeys)
        let challengeData=try await request("api/auth/wallet-v1/challenge",method:"POST",body:challengeBody)
        guard let wrapper=try JSONSerialization.jsonObject(with:challengeData) as? [String:Any],let challenge=wrapper["challenge"] as? [String:Any] else { throw URLError(.cannotParseResponse) }
        let completion=try WalletLink.completion(challenge)
        let body=try JSONSerialization.data(withJSONObject:["authorizationRequest":authorization,"walletApproval":approval,"gatewayCompletion":completion],options:.sortedKeys)
        let data=try await request("api/auth/wallet-v1/session",method:"POST",body:body)
        guard let object=try JSONSerialization.jsonObject(with:data) as? [String:Any],let binding=object["sessionBinding"] as? String,binding.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil else { throw URLError(.userAuthenticationRequired) }
        try fence.requireCurrent(context)
        return binding
    }
    func createPlaylist(name:String,ids:[String],key:String)async throws->MusicPlaylist {
        guard key.range(of:"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",options:.regularExpression) != nil else{throw URLError(.badURL)}
        let body=try JSONSerialization.data(withJSONObject:["name":name,"description":"Created from selected real library records","trackIDs":ids])
        let record=try JSONDecoder().decode(MusicPlaylist.self,from:try await request("api/playlists",method:"POST",body:body,idempotency:key))
        return try await playlist(record.id)
    }
    func playlist(_ id:String)async throws->MusicPlaylist { guard id.range(of:"^pl_[0-9a-f]{24}$",options:.regularExpression) != nil else{throw URLError(.badURL)};return try JSONDecoder().decode(MusicPlaylist.self,from:try await request("api/playlists/\(id)")) }
    func savePlaylist(_ playlist:MusicPlaylist)async throws->MusicPlaylist { guard playlist.id.range(of:"^pl_[0-9a-f]{24}$",options:.regularExpression) != nil else{throw URLError(.badURL)};let body=try JSONSerialization.data(withJSONObject:["name":playlist.name,"description":playlist.description ?? "","trackIDs":playlist.trackIds]);return try JSONDecoder().decode(MusicPlaylist.self,from:try await request("api/playlists/\(playlist.id)",method:"PUT",body:body)) }
    func createAI(ids:[String],language:String)async throws->AIProposal{let body=try JSONSerialization.data(withJSONObject:["kind":"playlist","intent":"Explain and organize my selected real library without inventing tracks","provider":"ynx-ai-gateway","model":"operator-selected","trackIDs":ids,"permission":true,"outputLanguage":language,"explanationRequired":true]);let proposal=try JSONDecoder().decode(AIProposal.self,from:try await request("api/ai/proposals",method:"POST",body:body));_ = try await request("api/ai/proposals/\(proposal.id)/stream");let completed=try JSONDecoder().decode(AIProposal.self,from:try await request("api/ai/proposals/\(proposal.id)"));guard completed.status=="completed" else{throw URLError(.badServerResponse)};return completed}
    func reviewAI(id:String,action:String)async throws{guard id.range(of:"^ai_[0-9a-f]{24}$",options:.regularExpression) != nil, ["apply","reject"].contains(action) else{throw URLError(.badURL)};let body=try JSONSerialization.data(withJSONObject:["action":action,"name":"AI reviewed library"]);_ = try await request("api/ai/proposals/\(id)/review",method:"POST",body:body)}
    func onboard(_ artist:String)async throws{let body=try JSONSerialization.data(withJSONObject:["displayName":artist,"bio":"Creator of owned or licensed Music uploads"]);_ = try await request("api/creator/onboarding",method:"POST",body:body)}
    func release(_ id:String)async throws{guard MusicAccountStore.validTrackID(id) else{throw URLError(.badURL)};let body=try JSONSerialization.data(withJSONObject:["state":"published","reason":""]);_ = try await request("api/creator/tracks/\(id)/release",method:"POST",body:body)}
    func openCase(kind:String,track:String,reason:String,evidence:String)async throws{guard ["report","takedown","dispute","appeal"].contains(kind)else{throw URLError(.badURL)};let body=try JSONSerialization.data(withJSONObject:["kind":kind,"trackID":track,"reason":reason,"evidenceRef":evidence]);_ = try await request("api/cases",method:"POST",body:body,idempotency:"music-trust-\(UUID().uuidString)")}
    func settlement(_ allocation:String,payTo:String)async throws->Settlement{let body=try JSONSerialization.data(withJSONObject:["allocationID":allocation,"payTo":payTo]);return try JSONDecoder().decode(Settlement.self,from:try await request("api/creator/settlements",method:"POST",body:body,idempotency:"music-pay-\(allocation)"))}
    func uploadOwnedWAV(_ url:URL,title:String,artist:String,evidence:String,provenance:String)async throws{try await onboard(artist);let boundary="YNXMusic\(UUID().uuidString)";var data=Data();func field(_ name:String,_ value:String){data.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using:.utf8)!)};field("title",title);field("artistName",artist);field("rightsBasis","owned");field("territories","WORLDWIDE");field("evidenceRef",evidence);field("audioProvenance",provenance);field("explicit","false");data.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"owned.wav\"\r\nContent-Type: audio/wav\r\n\r\n".data(using:.utf8)!);data.append(try Data(contentsOf:url));data.append("\r\n--\(boundary)--\r\n".data(using:.utf8)!);_ = try await request("api/creator/tracks",method:"POST",body:data,contentType:"multipart/form-data; boundary=\(boundary)")}
    func reportPosition(id:String,session:String,position:Double,completed:Bool)async throws{guard MusicAccountStore.validTrackID(id) else{throw URLError(.badURL)};let body=try JSONSerialization.data(withJSONObject:["sessionRef":session,"positionMillis":Int(position*1000),"completed":completed]);_ = try await request("api/playback/\(id)/position",method:"POST",body:body)}
    func saveLibrary(favorites:[String],queue:[String],downloads:[String:String])async throws{let body=try JSONSerialization.data(withJSONObject:["favorites":favorites,"queue":queue,"downloads":downloads]);_ = try await request("api/library",method:"PUT",body:body)}
    func updateProfile(_ profile:Profile)async throws{let body=try JSONSerialization.data(withJSONObject:["displayName":profile.displayName.isEmpty ? "YNX listener":profile.displayName,"bio":profile.bio ?? "","explicitAllowed":profile.explicitAllowed,"privateHistory":profile.privateHistory]);_ = try await request("api/profile",method:"PUT",body:body)}
}


private final class MusicRedirectPolicy:NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void) {
        completionHandler(nil)
    }
}
