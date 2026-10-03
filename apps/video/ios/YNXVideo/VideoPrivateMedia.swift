import AVFoundation
import Foundation
import UniformTypeIdentifiers

// The original identity/epoch is captured once. Every bounded native Range
// obtains a fresh original SDK proof; no credentials enter AVPlayer URLs.
@MainActor final class VideoPrivateMedia: NSObject, @preconcurrency AVAssetResourceLoaderDelegate {
    struct Chunk { let data: Data; let total: Int64; let mime: String }
    enum Failure: Error { case invalidRange, invalidResponse, closed }
    private let engine: VideoNativeEngine
    private let identity: VideoNativeEngine.Identity
    private let epoch: UInt64
    private let path: String
    private let boundary: VideoRequestBoundary
    private let navigation: UInt64
    private let expectedBytes: Int64?
    private var total: Int64?
    private var mime: String?
    private var closed=false
    private var requests: [ObjectIdentifier:(AVAssetResourceLoadingRequest,Task<Void,Never>)] = [:]
    let url=URL(string:"ynxvideo-media://native/"+UUID().uuidString.lowercased())!
    lazy var asset: AVURLAsset = {
        let asset=AVURLAsset(url:url);asset.resourceLoader.setDelegate(self,queue:.main);return asset
    }()
    init(engine: VideoNativeEngine,path: String,boundary: VideoRequestBoundary,navigation: UInt64,expectedBytes: Int64? = nil) throws {
        guard path.hasPrefix("/media/"),let identity=engine.identity else { throw VideoHTTP.Failure.nativeSessionUnavailable }
        _ = try VideoHTTP.url(path)
        self.engine=engine;self.identity=identity;self.epoch=engine.epoch;self.path=path
        self.boundary=boundary;self.navigation=navigation;self.expectedBytes=expectedBytes
        if let expectedBytes { guard expectedBytes>0,expectedBytes<=2_147_483_648 else { throw Failure.invalidRange } }
        super.init();try current()
    }
    private func current() throws { guard !closed,boundary.matches(navigation) else { throw Failure.closed };try engine.require(identity,epoch) }
    func range(offset: Int64,count: Int) async throws -> Chunk {
        try current();guard offset>=0,count>0,count<=262144,offset<2_147_483_648 else { throw Failure.invalidRange }
        let known=total ?? expectedBytes
        if let known { guard offset<known else { throw Failure.invalidRange } }
        let end=known.map { min(offset+Int64(count)-1,$0-1) } ?? offset+Int64(count)-1
        let digest=VideoNativeState.hash(Data())
        let proof=try await engine.dispatch("prepareRequest",["method":"GET","path":path,"bodyDigest":digest,"bodyBytes":0])
        try current()
        guard proof["account"] as? String==identity.account,proof["sessionBinding"] as? String==identity.binding,
              proof["bodyDigest"] as? String==digest,proof["bodyBytes"] as? Int==0,
              let identityHeader=proof["identityHeader"] as? String,let actionHeader=proof["actionHeader"] as? String else { throw Failure.invalidResponse }
        var request=URLRequest(url:try VideoHTTP.url(path));request.httpMethod="GET"
        request.setValue(identityHeader,forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2")
        request.setValue(actionHeader,forHTTPHeaderField:"X-YNX-Product-Session-Action-Proof-V2")
        request.setValue("bytes=\(offset)-\(end)",forHTTPHeaderField:"Range")
        request.setValue("video/*,application/octet-stream",forHTTPHeaderField:"Accept")
        let (bytes,response)=try await engine.sendBusiness(request,count,identity,epoch);try current()
        if response.statusCode==401 { try engine.rejected(identity) }
        guard response.statusCode==206,let header=response.value(forHTTPHeaderField:"Content-Range"),header.hasPrefix("bytes "),
              let returnedTotal=Int64(header.split(separator:"/").last ?? ""),returnedTotal>offset,returnedTotal<=2_147_483_648 else { throw Failure.invalidResponse }
        let returnedEnd=min(end,returnedTotal-1)
        guard header=="bytes \(offset)-\(returnedEnd)/\(returnedTotal)",bytes.count==Int(returnedEnd-offset+1),known==nil || known==returnedTotal else { throw Failure.invalidResponse }
        let contentType=response.value(forHTTPHeaderField:"Content-Type")?.split(separator:";").first.map(String.init)?.lowercased() ?? "application/octet-stream"
        guard ["video/mp4","video/webm","application/octet-stream"].contains(contentType),mime==nil || mime==contentType else { throw Failure.invalidResponse }
        total=returnedTotal;mime=contentType;return Chunk(data:bytes,total:returnedTotal,mime:contentType)
    }
    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,shouldWaitForLoadingOfRequestedResource request: AVAssetResourceLoadingRequest) -> Bool {
        guard !closed,request.request.url==url else { return false }
        let id=ObjectIdentifier(request)
        let task=Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try self.current()
                if let info=request.contentInformationRequest {
                    let probe=try await self.range(offset:0,count:1);try self.current()
                    info.contentLength=probe.total;info.isByteRangeAccessSupported=true
                    info.contentType=UTType(mimeType:probe.mime)?.identifier ?? UTType.mpeg4Movie.identifier
                }
                if let data=request.dataRequest {
                    var offset=max(data.requestedOffset,data.currentOffset)
                    guard offset>=0,data.requestedLength>=0,offset<=2_147_483_648 else { throw Failure.invalidRange }
                    var remaining=Int64(data.requestedLength)
                    while data.requestsAllDataToEndOfResource || remaining>0 {
                        try self.current();try Task.checkCancellation()
                        if let total=self.total,offset>=total { break }
                        let count=Int(min(262144,data.requestsAllDataToEndOfResource ? 262144 : remaining))
                        if count<=0 { break }
                        let chunk=try await self.range(offset:offset,count:count);try self.current();try Task.checkCancellation()
                        data.respond(with:chunk.data);offset+=Int64(chunk.data.count);remaining=max(0,remaining-Int64(chunk.data.count))
                        if offset>=chunk.total { break }
                    }
                }
                if self.requests.removeValue(forKey:id) != nil { request.finishLoading() }
            } catch { if self.requests.removeValue(forKey:id) != nil { request.finishLoading(with:error) } }
        }
        requests[id]=(request,task);return true
    }
    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,didCancel loadingRequest: AVAssetResourceLoadingRequest) { requests.removeValue(forKey:ObjectIdentifier(loadingRequest))?.1.cancel() }
    func close() { guard !closed else { return };closed=true;asset.resourceLoader.setDelegate(nil,queue:nil);let active=requests;requests.removeAll();for (request,task) in active.values { task.cancel();request.finishLoading(with:Failure.closed) } }
}
