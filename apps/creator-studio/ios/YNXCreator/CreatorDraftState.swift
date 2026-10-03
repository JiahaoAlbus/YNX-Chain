import CryptoKit
import Foundation

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
    }
    private struct Saved: Codable { let version: Int; let account: String; var upload: Upload?; var operation: Operation? }
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
        } else { saved=Saved(version:1,account:account,upload:nil,operation:nil) }
        try require()
    }
    func pendingUpload() throws -> Upload? { try require();return saved.upload }
    func pendingOperation() throws -> Operation? { try require();return saved.operation }
    func wire(_ upload: Upload) throws -> URL {
        try require();try validate(upload);guard saved.upload==upload else { throw Failure.changed }
        let file=directory.appendingPathComponent(upload.key+".multipart")
        let (sha,count)=try Self.digest(file,limit:512*1024*1024)
        guard sha==upload.wireSHA,count==upload.wireBytes else { throw Failure.damaged };try require();return file
    }
    func stage(file: URL,channelID: String,title: String,description: String,basis: String,source: String,license: String,territories: String,evidence: String,owned: Bool) throws -> Upload {
        try require();guard saved.upload==nil else { throw Failure.pending }
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
    func acknowledge(_ upload: Upload) throws { try require();guard saved.upload==upload else { throw Failure.changed };var next=saved;next.upload=nil;try persist(next) }
    func cancelUpload() throws { try require();var next=saved;next.upload=nil;try persist(next) }
    func reserve(path: String,body: [String:Any]) throws -> Operation {
        try require();guard saved.operation==nil,try CreatorHTTP.url(path).path.hasPrefix("/video/api/v1/"),path != "/v1/uploads" else { throw Failure.pending }
        let raw=try CreatorNativeState.canonical(body);guard raw.utf8.count<=1_048_576 else { throw Failure.invalid }
        let operation=Operation(key:"creator-op-"+UUID().uuidString,path:path,body:raw);var next=saved;next.operation=operation;try persist(next);return operation
    }
    func acknowledge(_ operation: Operation) throws { try require();guard saved.operation==operation else { throw Failure.changed };var next=saved;next.operation=nil;try persist(next) }
    func cancelOperation() throws { try require();var next=saved;next.operation=nil;try persist(next) }
    private func validate(_ upload: Upload) throws {
        guard upload.account==account,CreatorNativeState.matches(upload.key,"^creator-upload-[A-Fa-f0-9-]{36}$"),Self.validID(upload.channelID),CreatorNativeState.matches(upload.contentSHA,"^[a-f0-9]{64}$"),CreatorNativeState.matches(upload.wireSHA,"^[a-f0-9]{64}$"),upload.mediaBytes>0,upload.mediaBytes<=511*1024*1024,upload.wireBytes>upload.mediaBytes,upload.wireBytes<=512*1024*1024,upload.contentType=="multipart/form-data; boundary=ynx-"+upload.key else { throw Failure.damaged }
    }
    private func validate(_ operation: Operation) throws {
        guard CreatorNativeState.matches(operation.key,"^creator-op-[A-Fa-f0-9-]{36}$"),operation.path != "/v1/uploads",operation.body.utf8.count<=1_048_576 else { throw Failure.damaged }
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
