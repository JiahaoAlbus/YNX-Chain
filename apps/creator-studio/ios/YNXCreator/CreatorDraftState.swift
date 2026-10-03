import CryptoKit
import Foundation
import ImageIO

// Original wire files remain in the Creator account directory after cancel or
// acknowledgement. Neither a new account nor a damaged record replaces them.
@MainActor final class CreatorDraftState {
    enum Failure: Error { case invalid, pending, changed, damaged }
    struct Upload: Codable, Equatable {
        let key, account, channelID, title, contentSHA, wireSHA, contentType: String
        let mediaBytes, wireBytes: Int
    }
    struct Operation: Codable, Equatable {
        let key, path, body: String
        let method: String
        enum CodingKeys: String,CodingKey {case key,path,body,method}
        init(key:String,path:String,body:String,method:String) {self.key=key;self.path=path;self.body=body;self.method=method}
        init(from decoder: Decoder) throws {
            let box=try decoder.container(keyedBy:CodingKeys.self)
            key=try box.decode(String.self,forKey:.key);path=try box.decode(String.self,forKey:.path);body=try box.decode(String.self,forKey:.body)
            // Existing saved POST operations retain their exact key/body.
            method=try box.decodeIfPresent(String.self,forKey:.method) ?? "POST"
        }
    }
    struct Asset:Codable,Equatable {
        let key,account,videoID,kind,contentSHA,wireSHA,contentType,language,label:String
        let mediaBytes,wireBytes:Int
        var path:String {"/v1/videos/"+videoID+"/"+kind}
        var limit:Int {kind=="thumbnail" ? 5*1024*1024 : 1024*1024}
    }
    private struct Saved: Codable { let version: Int; let account: String; var upload: Upload?; var operation: Operation?;var asset:Asset?;var aiCancel:Operation? }

    let account: String
    let directory: URL
    private let authority: () throws -> Void
    private var poisoned=false
    private var saved: Saved

    static func live(_ engine: CreatorNativeEngine,_ identity: CreatorNativeEngine.Identity) throws -> CreatorDraftState {
        let root=try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true)
            .appendingPathComponent("com.ynxweb4.creator-studio",isDirectory:true).appendingPathComponent("accounts",isDirectory:true)
        let epoch=engine.epoch
        return try CreatorDraftState(account:identity.account,root:root,require:{try engine.require(identity,epoch)})
    }
    init(account: String,root: URL,require: @escaping () throws -> Void) throws {
        guard root.isFileURL,CreatorNativeState.matches(account,"^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$") else { throw Failure.invalid }
        self.account=account;self.authority=require;directory=root.appendingPathComponent(CreatorNativeState.hash(Data(account.utf8)),isDirectory:true)
        try require();try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        let file=directory.appendingPathComponent("drafts.json")
        if FileManager.default.fileExists(atPath:file.path) {
            let bytes=try Self.read(file,limit:1_048_576)
            guard let decoded=try? JSONDecoder().decode(Saved.self,from:bytes),decoded.version==1,decoded.account==account else {
                // Preserve the original file and refuse all writes. No recovery
                // can silently reset the pending business operation.
                throw Failure.damaged
            }
            saved=decoded
            if let upload=saved.upload { try validate(upload) }
            if let operation=saved.operation { try validate(operation) }
            if let asset=saved.asset {try validate(asset)}
            if let cancel=saved.aiCancel {try validate(cancel);guard CreatorNativeState.matches(cancel.path,"^/v1/ai/jobs/[A-Za-z0-9_-]{1,160}/cancel$"),cancel.method=="POST",cancel.body=="{}" else {throw Failure.damaged}}
        } else { saved=Saved(version:1,account:account,upload:nil,operation:nil) }
        try require()
    }
    func pendingAICancel() throws -> Operation? {try require();return saved.aiCancel}
    func reserveAICancel(_ jobID:String) throws -> Operation {
        try require();guard Self.validID(jobID) else {throw Failure.invalid}
        let path="/v1/ai/jobs/"+jobID+"/cancel"
        if let original=saved.aiCancel {guard original.path==path else {throw Failure.pending};return original}
        let operation=Operation(key:"creator-op-"+UUID().uuidString,path:path,body:"{}",method:"POST");var next=saved;next.aiCancel=operation;try persist(next);return operation
    }
    func acknowledgeAICancel(_ operation:Operation) throws {try require();guard saved.aiCancel==operation else {throw Failure.changed};var next=saved;next.aiCancel=nil;try persist(next)}
    func pendingAsset() throws -> Asset? {try require();return saved.asset}
    func pendingUpload() throws -> Upload? { try require();return saved.upload }
    func pendingOperation() throws -> Operation? { try require();return saved.operation }
    func wire(_ upload: Upload) throws -> URL {
        try require();try validate(upload);guard saved.upload==upload else { throw Failure.changed }
        let file=directory.appendingPathComponent(upload.key+".multipart")
        let (sha,count)=try Self.digest(file,limit:512*1024*1024)
        guard sha==upload.wireSHA,count==upload.wireBytes else { throw Failure.damaged };try require();return file
    }
    func stage(file: URL,channelID: String,title: String,description: String,basis: String,source: String,license: String,territories: String,evidence: String,owned: Bool) throws -> Upload {
        try require();guard saved.upload==nil,saved.asset==nil else { throw Failure.pending }
        guard file.isFileURL,owned,Self.validID(channelID),!title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,title.count<=140,description.utf8.count<=5000,
              ["owned","licensed","public-domain"].contains(basis),!source.isEmpty,source.count<=256,!license.isEmpty,license.count<=160,!territories.isEmpty,territories.count<=256,
              evidence.isEmpty || CreatorNativeState.matches(evidence,"^[a-f0-9]{64}$") else { throw Failure.invalid }
        let ext=file.pathExtension.lowercased();guard ["mp4","webm"].contains(ext) else { throw Failure.invalid }
        let input=try FileHandle(forReadingFrom:file);defer { try? input.close() }
        let first=try input.read(upToCount:16) ?? Data()
        guard ext=="mp4" ? first.count>=12 && first.subdata(in:4..<8)==Data("ftyp".utf8) : first.starts(with:[0x1a,0x45,0xdf,0xa3]) else { throw Failure.invalid }
        try input.seek(toOffset:0)
        let key="creator-upload-"+UUID().uuidString,boundary="ynx-"+key,wire=directory.appendingPathComponent(key+".multipart"),partial=directory.appendingPathComponent(key+".partial")
        guard FileManager.default.createFile(atPath:partial.path,contents:nil,attributes:[.posixPermissions:0o600]) else { throw Failure.invalid }
        let output=try FileHandle(forWritingTo:partial);defer { try? output.close() }
        var mediaHash=SHA256(),size=0
        // Source media streams into the immutable final multipart file. It is
        // never loaded into a JS bridge or a large Data allocation.
        try output.write(contentsOf:Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"media\"; filename=\"original.\(ext)\"\r\nContent-Type: video/\(ext)\r\n\r\n".utf8))
        while let bytes=try input.read(upToCount:65536),!bytes.isEmpty {
            try require();size+=bytes.count;guard size<=511*1024*1024 else { throw Failure.invalid }
            mediaHash.update(data:bytes);try output.write(contentsOf:bytes)
        }
        guard size>0 else { throw Failure.invalid }
        let contentSHA=mediaHash.finalize().map{String(format:"%02x",$0)}.joined()
        let fields=[("channel_id",channelID),("size",String(size)),("title",title),("description",description),("sha256",contentSHA),("rights_basis",basis),("rights_source",source),("rights_license",license),("rights_territories",territories),("rights_evidence_sha256",evidence),("owned_content_declaration","true")]
        for (name,value) in fields {
            guard !value.contains("\r\n--"+boundary) else { throw Failure.invalid }
            try output.write(contentsOf:Data("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)".utf8))
        }
        try output.write(contentsOf:Data("\r\n--\(boundary)--\r\n".utf8));try output.synchronize();try output.close();try require()
        try FileManager.default.moveItem(at:partial,to:wire)
        let (wireSHA,wireBytes)=try Self.digest(wire,limit:512*1024*1024)
        let draft=Upload(key:key,account:account,channelID:channelID,title:title,contentSHA:contentSHA,wireSHA:wireSHA,contentType:"multipart/form-data; boundary="+boundary,mediaBytes:size,wireBytes:wireBytes)
        var next=saved;next.upload=draft;try persist(next);return draft
    }
    func stageAsset(file:URL,videoID:String,kind:String,language:String="",label:String="",expectedContentSHA:String?=nil) throws -> Asset {
        try require();guard saved.asset==nil,saved.operation==nil,saved.upload==nil else {throw Failure.pending}
        guard file.isFileURL,Self.validID(videoID),["thumbnail","captions"].contains(kind) else {throw Failure.invalid}
        let limit=kind=="thumbnail" ? 5*1024*1024 : 1024*1024
        let bytes=try Self.read(file,limit:limit);guard !bytes.isEmpty,expectedContentSHA==nil || expectedContentSHA==CreatorNativeState.hash(bytes) else {throw Failure.invalid}
        let mime:String,filename:String
        if kind=="thumbnail" {
            if bytes.starts(with:[137,80,78,71,13,10,26,10]) {mime="image/png";filename="thumbnail.png"}
            else if bytes.starts(with:[255,216,255]) {mime="image/jpeg";filename="thumbnail.jpg"}
            else if bytes.count>=12,bytes.prefix(4)==Data("RIFF".utf8),bytes.subdata(in:8..<12)==Data("WEBP".utf8) {mime="image/webp";filename="thumbnail.webp"}
            else {throw Failure.invalid}
            guard let source=CGImageSourceCreateWithData(bytes as CFData,nil),CGImageSourceGetCount(source)>0,CGImageSourceCreateThumbnailAtIndex(source,0,[kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceThumbnailMaxPixelSize:640] as CFDictionary) != nil else {throw Failure.invalid}
        } else {
            guard let text=String(data:bytes,encoding:.utf8),text.replacingOccurrences(of:"\u{feff}",with:"").hasPrefix("WEBVTT"),!text.contains("\0"),CreatorNativeState.matches(language,"^[A-Za-z0-9-]{1,16}$"),!label.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,label.count<=80 else {throw Failure.invalid}
            mime="text/vtt";filename="captions.vtt"
        }
        let key="creator-asset-"+UUID().uuidString,boundary="ynx-"+key
        var wire=Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(kind)\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".utf8);wire.append(bytes)
        var fields=[("size",String(bytes.count))]
        if kind=="captions" {fields += [("language",language),("label",label),("ai_proposed","false")]}
        for (name,value) in fields {
            guard !value.contains("\r\n--"+boundary) else {throw Failure.invalid}
            wire.append(Data("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)".utf8))
        }
        wire.append(Data("\r\n--\(boundary)--\r\n".utf8));guard wire.count<=limit+65536 else {throw Failure.invalid};try require()
        let file=directory.appendingPathComponent(key+".multipart")
        guard !FileManager.default.fileExists(atPath:file.path) else {throw Failure.invalid}
        try wire.write(to:file,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
        let (hash,count)=try Self.digest(file,limit:limit+65536);guard hash==CreatorNativeState.hash(wire),count==wire.count else {throw Failure.damaged}
        let asset=Asset(key:key,account:account,videoID:videoID,kind:kind,contentSHA:CreatorNativeState.hash(bytes),wireSHA:hash,contentType:"multipart/form-data; boundary="+boundary,language:language,label:label,mediaBytes:bytes.count,wireBytes:count)
        var next=saved;next.asset=asset;try persist(next);return asset
    }
    func wire(_ asset:Asset) throws -> URL {
        try require();try validate(asset);guard saved.asset==asset else {throw Failure.changed}
        let file=directory.appendingPathComponent(asset.key+".multipart"), (hash,count)=try Self.digest(file,limit:asset.limit+65536)
        guard hash==asset.wireSHA,count==asset.wireBytes else {throw Failure.damaged};try require();return file
    }
    func acknowledge(_ asset:Asset) throws {try require();guard saved.asset==asset else {throw Failure.changed};var next=saved;next.asset=nil;try persist(next)}
    func cancelAsset() throws {try require();var next=saved;next.asset=nil;try persist(next)}
    private func validate(_ asset:Asset) throws {
        guard asset.account==account,CreatorNativeState.matches(asset.key,"^creator-asset-[A-Fa-f0-9-]{36}$"),Self.validID(asset.videoID),["thumbnail","captions"].contains(asset.kind),CreatorNativeState.matches(asset.contentSHA,"^[a-f0-9]{64}$"),CreatorNativeState.matches(asset.wireSHA,"^[a-f0-9]{64}$"),asset.mediaBytes>0,asset.mediaBytes<=asset.limit,asset.wireBytes>asset.mediaBytes,asset.wireBytes<=asset.limit+65536,asset.contentType=="multipart/form-data; boundary=ynx-"+asset.key else {throw Failure.damaged}
        if asset.kind=="captions" {guard CreatorNativeState.matches(asset.language,"^[A-Za-z0-9-]{1,16}$"),!asset.label.isEmpty,asset.label.count<=80 else {throw Failure.damaged}}
    }
    func acknowledge(_ upload: Upload) throws { try require();guard saved.upload==upload else { throw Failure.changed };var next=saved;next.upload=nil;try persist(next) }
    func cancelUpload() throws { try require();var next=saved;next.upload=nil;try persist(next) }
    func reserve(path: String,body: [String:Any],method: String="POST") throws -> Operation {
        try require();guard saved.operation==nil,["POST","DELETE"].contains(method),try CreatorHTTP.url(path).path.hasPrefix("/video/api/v1/"),path != "/v1/uploads" else { throw Failure.pending }
        let raw=try CreatorNativeState.canonical(body);guard raw.utf8.count<=1_048_576 else { throw Failure.invalid }
        let operation=Operation(key:"creator-op-"+UUID().uuidString,path:path,body:raw,method:method);var next=saved;next.operation=operation;try persist(next);return operation
    }
    func acknowledge(_ operation: Operation) throws { try require();guard saved.operation==operation else { throw Failure.changed };var next=saved;next.operation=nil;try persist(next) }
    func cancelOperation() throws { try require();var next=saved;next.operation=nil;try persist(next) }
    private func validate(_ upload: Upload) throws {
        guard upload.account==account,CreatorNativeState.matches(upload.key,"^creator-upload-[A-Fa-f0-9-]{36}$"),Self.validID(upload.channelID),CreatorNativeState.matches(upload.contentSHA,"^[a-f0-9]{64}$"),CreatorNativeState.matches(upload.wireSHA,"^[a-f0-9]{64}$"),upload.mediaBytes>0,upload.mediaBytes<=511*1024*1024,upload.wireBytes>upload.mediaBytes,upload.wireBytes<=512*1024*1024,upload.contentType=="multipart/form-data; boundary=ynx-"+upload.key else { throw Failure.damaged }
    }
    private func validate(_ operation: Operation) throws {
        guard CreatorNativeState.matches(operation.key,"^creator-op-[A-Fa-f0-9-]{36}$"),["POST","DELETE"].contains(operation.method),operation.path != "/v1/uploads",operation.body.utf8.count<=1_048_576 else { throw Failure.damaged }
        _ = try CreatorHTTP.url(operation.path);_ = try CreatorNativeState.object(operation.body)
    }
    private func persist(_ next: Saved) throws {
        try require();let bytes=try JSONEncoder().encode(next),file=directory.appendingPathComponent("drafts.json")
        do {try bytes.write(to:file,options:.atomic);guard try Self.read(file,limit:1_048_576)==bytes else { throw Failure.damaged };try require();saved=next}
        catch {poisoned=true;throw error}
    }
    private func require() throws {guard !poisoned else {throw Failure.damaged};try authority()}
    static func validID(_ text: String) -> Bool { CreatorNativeState.matches(text,"^[A-Za-z0-9_-]{1,160}$") }
    static func read(_ file: URL,limit: Int) throws -> Data {
        let stream=try FileHandle(forReadingFrom:file);defer {try? stream.close()};let bytes=try stream.read(upToCount:limit+1) ?? Data();guard bytes.count<=limit else { throw Failure.damaged };return bytes
    }
    static func digest(_ file: URL,limit: Int) throws -> (String,Int) {
        let stream=try FileHandle(forReadingFrom:file);defer {try? stream.close()};var hash=SHA256(),count=0
        while let bytes=try stream.read(upToCount:65536),!bytes.isEmpty { count+=bytes.count;guard count<=limit else { throw Failure.invalid };hash.update(data:bytes) }
        return (hash.finalize().map{String(format:"%02x",$0)}.joined(),count)
    }
}
