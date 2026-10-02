import Foundation
import CryptoKit
import Security

// This host-only signer avoids Keychain and Wallet access. Tests exercise the
// shipped API transport/session fence, never claim a Wallet approval.
enum WalletLink {
    static func approval(_ response:String,request:[String:Any])throws->[String:Any] { ["hostFixture":true] }
    static func completion(_ challenge:[String:Any])throws->[String:Any] { ["challenge":challenge] }
}

final class FixtureProtocol:URLProtocol {
    static var handler:((URLRequest)->(Int,Data))?
    static var requests:[URLRequest]=[]
    override class func canInit(with request:URLRequest)->Bool { true }
    override class func canonicalRequest(for request:URLRequest)->URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let (status,data)=Self.handler!(request)
        let response=HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main struct AppleAccountCheck {
    static func require(_ passed:Bool,_ message:String) throws {
        if !passed { throw NSError(domain:"AppleAccountCheck",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }
    }
    static func rejected(_ message:String,_ action:()throws->Void)throws {
        do { try action() } catch { return }
        throw NSError(domain:"AppleAccountCheck",code:2,userInfo:[NSLocalizedDescriptionKey:message])
    }
    static func main()async throws {
        let retained=P256.Signing.PrivateKey()
        let retainedEncoded=Data(retained.rawRepresentation.base64EncodedString().utf8)
        var writes:[String]=[]
        var deletes:[String]=[]
        var creates=0
        func credentials(_ read:@escaping MusicCredentials.Read, add:@escaping MusicCredentials.Write={_,_ in errSecSuccess}, update:@escaping MusicCredentials.Write={_,_ in errSecSuccess})->MusicCredentials {
            MusicCredentials(read:read,add:{account,data in writes.append("add:"+account);return add(account,data)},update:{account,data in writes.append("update:"+account);return update(account,data)},remove:{account in deletes.append(account);return errSecSuccess},create:{creates+=1;return P256.Signing.PrivateKey()})
        }
        let existing=credentials({_ in (errSecSuccess,retainedEncoded)})
        try require(try existing.deviceKey().rawRepresentation==retained.rawRepresentation,"legacy device key changed")
        try require(writes.isEmpty && creates==0,"existing key triggered creation/write")
        let locked=credentials({_ in (errSecInteractionNotAllowed,nil)})
        try rejected("locked key became first use") { _ = try locked.deviceKey() }
        let denied=credentials({_ in (errSecAuthFailed,nil)})
        try rejected("denied key became first use") { _ = try denied.deviceKey() }
        let damaged=credentials({_ in (errSecSuccess,Data("damaged".utf8))})
        try rejected("corrupt key replaced") { _ = try damaged.deviceKey() }
        try require(writes.isEmpty && deletes.isEmpty && creates==0,"failed reads or corruption mutated key")
        var winnerReads=0
        let concurrent=credentials({_ in winnerReads+=1;return winnerReads==1 ? (errSecItemNotFound,nil):(errSecSuccess,retainedEncoded)},add:{_,_ in errSecDuplicateItem})
        try require(try concurrent.deviceKey().rawRepresentation==retained.rawRepresentation,"duplicate creation used losing key")
        try require(winnerReads==2 && creates==1 && writes==["add:device-p256"],"duplicate key was overwritten")
        writes=[]
        let unavailable=credentials({_ in (errSecItemNotFound,nil)},add:{_,_ in errSecNotAvailable})
        try rejected("unpersisted new device key returned") { _ = try unavailable.deviceKey() }
        writes=[]
        let failedSession=credentials({_ in (errSecItemNotFound,nil)},add:{_,_ in errSecNotAvailable},update:{_,_ in errSecItemNotFound})
        let sessionValue=String(repeating:"a",count:64)
        try rejected("unpersisted session reported success") { try failedSession.saveSession(sessionValue) }
        try require(writes==["update:sessionBinding","add:sessionBinding"] && deletes.isEmpty,"session failure deleted an inherited item")
        writes=[]
        var storedSession:Data?
        let validSession=credentials({_ in (errSecSuccess,storedSession)},update:{account,data in storedSession=data;return errSecSuccess})
        try validSession.saveSession(sessionValue)
        try require(try validSession.session()==sessionValue,"session did not persist")
        try validSession.clearSession()
        try require(deletes==["sessionBinding"] && writes==["update:sessionBinding"],"session lifecycle touched device key")
        print("PASS Apple injected credentials: retained base64 identity, locked/corrupt preservation, duplicate winner, failed persistence, session-only deletion; no real Keychain calls")

        let files=FileManager.default
        let root=files.temporaryDirectory.appendingPathComponent("ynx-apple-account-\(UUID().uuidString)",isDirectory:true)
        try files.createDirectory(at:root,withIntermediateDirectories:true)
        defer { try? files.removeItem(at:root) }
        let legacy=Data("{\"favorites\":[\"private-legacy\"],\"queue\":[],\"downloads\":{},\"trackId\":\"private-legacy\",\"position\":12,\"aiEnabled\":false}".utf8)
        try legacy.write(to:root.appendingPathComponent("music-state.json"))
        let legacyOffline=root.appendingPathComponent("Offline",isDirectory:true)
        try files.createDirectory(at:legacyOffline,withIntermediateDirectories:true)
        let legacyAudio=Data("retained-unattributed-audio".utf8)
        try legacyAudio.write(to:legacyOffline.appendingPathComponent("old.wav"))
        let store=MusicAccountStore(root:root)
        let (accountA,initial)=try store.select(verifiedAccount:"account-a")
        try require(initial.favorites.isEmpty && initial.trackId.isEmpty,"unowned legacy cache was exposed")
        var stateA=LocalState(); stateA.favorites=["a-track"]; stateA.position=27; stateA.trackId="a-track"
        try store.save(stateA,for:accountA)
        let (accountB,stateB)=try store.select(verifiedAccount:"account-b")
        try require(stateB.favorites.isEmpty && stateB.position==0,"A state crossed into B")
        try rejected("old A save allowed") { try store.save(stateA,for:accountA) }
        try rejected("old A clear allowed") { try store.clear(accountA) }
        var newStateB=stateB;newStateB.favorites=["b-track"]
        try store.save(newStateB,for:accountB)
        let (restoredA,restoredState)=try store.select(verifiedAccount:"account-a")
        try require(restoredA != accountA && restoredState.favorites==["a-track"] && restoredState.position==27,"A cache restore failed")
        let (sameA,_)=try store.select(verifiedAccount:"account-a")
        try require(sameA==restoredA,"same verified account unexpectedly rotated file context")
        var wav=Data("RIFF".utf8);wav.append(Data(repeating:0,count:4));wav.append(Data("WAVE".utf8));wav.append(Data(repeating:42,count:44))
        let hash=SHA256.hash(data:wav).map{String(format:"%02x",$0)}.joined()
        let track=Track(id:"a-track",title:"A",artistName:"Fixture",explicit:false,durationMillis:1000,rights:Rights(basis:"owned",evidenceRef:"fixture",territories:[]),provenance:[:],audioSha256:hash)
        let audio=try store.storeAudio(wav,track:track,for:restoredA)
        try require(try Data(contentsOf:audio)==wav,"audio did not save")
        try require(try store.audioURL(track:track,for:restoredA)==audio,"saved audio not verifiable")
        var corrupt=wav;corrupt[20]=99
        try rejected("checksum failure accepted") { try store.storeAudio(corrupt,track:track,for:restoredA) }
        try require(try Data(contentsOf:audio)==wav,"checksum failure replaced existing audio")
        let traversal=Track(id:"../outside",title:track.title,artistName:track.artistName,explicit:false,durationMillis:1000,rights:track.rights,provenance:[:],audioSha256:hash)
        try rejected("traversal accepted") { try store.storeAudio(wav,track:traversal,for:restoredA) }
        let (newB,_)=try store.select(verifiedAccount:"account-b")
        try rejected("late A media saved in B context") { try store.storeAudio(wav,track:track,for:restoredA) }
        try require(try store.audioURL(track:track,for:newB)==nil,"A audio exposed to B")
        try store.clear(newB)
        try require(try Data(contentsOf:audio)==wav,"B clear deleted A file")
        try require(try Data(contentsOf:root.appendingPathComponent("music-state.json"))==legacy,"legacy state modified")
        try require(try Data(contentsOf:legacyOffline.appendingPathComponent("old.wav"))==legacyAudio,"legacy audio modified")
        let (_,emptyB)=try store.select(verifiedAccount:"account-b")
        try require(emptyB.favorites.isEmpty,"B clear did not clear B state")
        let damagedDir=root.appendingPathComponent("MusicAccounts",isDirectory:true).appendingPathComponent(MusicAccountStore.accountKey("account-damaged"),isDirectory:true)
        try files.createDirectory(at:damagedDir,withIntermediateDirectories:true)
        let damagedState=Data("retained-broken-state".utf8)
        try damagedState.write(to:damagedDir.appendingPathComponent("music-state.json"))
        let (damagedAccount,recovered)=try store.select(verifiedAccount:"account-damaged")
        try require(recovered.favorites.isEmpty,"damaged record was exposed")
        try store.save(recovered,for:damagedAccount)
        let recoveries=try files.contentsOfDirectory(at:damagedDir,includingPropertiesForKeys:nil).filter{$0.lastPathComponent.hasPrefix("music-state.recovery-")}
        try require(recoveries.count==1 && (try Data(contentsOf:recoveries[0]))==damagedState,"damaged state was overwritten without recovery copy")
        store.detach()
        try rejected("detached save allowed") { try store.save(stateA,for:restoredA) }
        try rejected("blank verified identity accepted") { _ = try store.select(verifiedAccount:"") }
        print("PASS Apple account files: A/B isolation, verified restore, late writes, checksum, atomic preservation, scoped clear and retained legacy originals")

        let fence=MusicSessionFence(binding:"session-a")
        let contextA=fence.capture()
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[FixtureProtocol.self]
        let transport=URLSession(configuration:config)
        defer { transport.invalidateAndCancel() }
        let api=MusicAPI(context:contextA,fence:fence,deviceKey:"fixture-device-public",base:URL(string:"https://fixture.invalid/music")!,transport:transport)
        FixtureProtocol.handler={ request in
            precondition(request.value(forHTTPHeaderField:"X-YNX-App-Session")=="session-a")
            precondition(request.value(forHTTPHeaderField:"X-YNX-Product-Device-Key")=="fixture-device-public")
            return (200,Data("{}".utf8))
        }
        _ = try await api.request("api/me")
        FixtureProtocol.handler={ request in
            precondition(request.value(forHTTPHeaderField:"X-YNX-App-Session")=="session-a")
            fence.replace(binding:"session-b")
            return (200,Data("{\"owner\":\"a\"}".utf8))
        }
        do { _ = try await api.request("api/me");throw NSError(domain:"late response accepted",code:1) }
        catch is CancellationError {} // Only cancellation proves the account fence rejected it.
        let requestCount=FixtureProtocol.requests.count
        do { _ = try await api.request("api/library",method:"PUT",body:Data("{}".utf8));throw NSError(domain:"old API reused new session",code:1) }
        catch is CancellationError {}
        try require(FixtureProtocol.requests.count==requestCount,"old API emitted network mutation")
        let current=fence.capture()
        fence.replace(binding:current.binding)
        try rejected("same-binding replacement failed to invalidate old attempt") { try fence.requireCurrent(current) }
        let guest=fence.replace(binding:nil)
        try rejected("guest private request permitted") { try fence.requireCurrent(guest,authenticated:true) }
        let guestAPI=MusicAPI(context:guest,fence:fence,deviceKey:"fixture-device-public",base:URL(string:"https://fixture.invalid/music")!,transport:transport)
        FixtureProtocol.handler={ request in
            precondition(request.value(forHTTPHeaderField:"X-YNX-App-Session")==nil)
            return request.url!.path.hasSuffix("challenge") ? (200,Data("{\"challenge\":{}}".utf8)) : (200,Data("{\"sessionBinding\":\"\(String(repeating:"a",count:64))\"}".utf8))
        }
        let candidate=try await guestAPI.walletSession(response:"fixture",request:[:])
        try require(candidate==String(repeating:"a",count:64) && fence.capture()==guest,"API installed callback candidate without owner check")
        FixtureProtocol.handler={ request in
            if request.url!.path.hasSuffix("session") { fence.replace(binding:"new-account") }
            return request.url!.path.hasSuffix("challenge") ? (200,Data("{\"challenge\":{}}".utf8)) : (200,Data("{\"sessionBinding\":\"\(String(repeating:"b",count:64))\"}".utf8))
        }
        do { _ = try await guestAPI.walletSession(response:"fixture",request:[:]);throw NSError(domain:"late callback accepted",code:1) }
        catch is CancellationError {}
        try require(fence.capture().binding=="new-account","late callback replaced newer identity")
        print("PASS Apple API: captured headers, late-response rejection, zero stale mutation requests, same-binding generation fencing, guest rejection, non-installing callback candidate")
    }
}
