import Foundation
import Testing
@testable import YNXBrowserCore

@Suite("Original P08 page request DATA decoder and binding delta")
@MainActor struct BrowserOriginalPageReadRequestTests {
    private let taskID = "task-PUBLIC-request", profile = "PUBLIC-owned-ordinary"
    private var fixed: BrowserPageSelectionReference { .init(selectionID:"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",version:String(repeating:"a",count:128)) }
    private func raw(refs:[BrowserPageSelectionReference]?=nil,task:String?=nil,query:Bool=false,authorization:String?="PUBLIC-authorization-reference") throws -> Data {
        let refs=refs ?? [fixed]
        var object:[String:Any]=["schema":"YNX_AI_BROWSER_PAGE_READ_REQUEST_V1","runId":"PUBLIC_run-1",
            "session":["id":"PUBLIC-session","account":"PUBLIC-account","deviceId":"PUBLIC-device","productClientId":"ynx-ai-v1","bundleId":"PUBLIC.bundle","sessionBinding":"PUBLIC-binding"],
            "task":["id":task ?? taskID,"account":"PUBLIC-account","holder":"PUBLIC-device","revision":UInt64(1),"generation":UInt64(2),"conversationId":"PUBLIC-conversation","status":"READY","createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z","agentConfigurationRevision":UInt64(0)],
            "references":refs.map{["selectionId":$0.selectionID,"version":$0.version]},"queryOriginal":query]
        if let authorization {object["authorizationRef"]=authorization}
        return try JSONSerialization.data(withJSONObject:object,options:[.sortedKeys,.withoutEscapingSlashes])
    }
    private func expected(refs:[BrowserPageSelectionReference]?=nil,task:String?=nil,sessionID:String="PUBLIC-session",account:String="PUBLIC-account",revision:UInt64=1,query:Bool=false,authorization:String="PUBLIC-authorization-reference") -> BrowserOriginalPageReadExpectedData {
        .init(runID:"PUBLIC_run-1",session:.init(id:sessionID,account:"PUBLIC-account",deviceID:"PUBLIC-device",productClientID:"ynx-ai-v1",bundleID:"PUBLIC.bundle",sessionBinding:"PUBLIC-binding"),taskID:task ?? taskID,account:account,holder:"PUBLIC-device",revision:revision,generation:2,references:refs ?? [fixed],queryOriginal:query,authorizationRef:authorization)
    }
    @Test("actual P08 shape preserves every original UTF8 byte and explicit DATA comparison")
    func preservesRawBytes() throws {
        let data=Data(" \n\t".utf8)+(try raw())+Data("\r\n ".utf8)
        let request=try BrowserOriginalPageReadRequest.decode(data)
        #expect(request.rawBytes==data);#expect(request.task.revision==1 && request.task.generation==2)
        #expect(request.session.productClientID=="ynx-ai-v1" && request.session.sessionBinding=="PUBLIC-binding")
        try request.requireMatches(expected())
    }
    @Test("duplicate keys, including escaped root/session/reference spellings, reject")
    func duplicates() throws {
        let text=String(decoding:try raw(),as:UTF8.self)
        for invalid in [
            "{\"schema\":\"YNX_AI_BROWSER_PAGE_READ_REQUEST_V1\","+text.dropFirst(),
            text.replacingOccurrences(of:"\"session\":{",with:"\"session\":{\"\\u0069d\":\"PUBLIC-session\","),
            text.replacingOccurrences(of:"\"references\":[{",with:"\"references\":[{\"selectionId\":\"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA\",")
        ] {#expect(throws:BrowserPageSelectionError.invalid){try BrowserOriginalPageReadRequest.decode(Data(invalid.utf8))}}
    }
    @Test("wrong types or coercible numbers cannot replace positive uint64 task revisions")
    func strictNumericTypes() throws {
        let text=String(decoding:try raw(),as:UTF8.self)
        for replacement in ["true","null","\"1\"","0","-1","1.0","1e0","01","18446744073709551616"] {
            let invalid=text.replacingOccurrences(of:"\"revision\":1",with:"\"revision\":"+replacement)
            #expect(throws:BrowserPageSelectionError.invalid){try BrowserOriginalPageReadRequest.decode(Data(invalid.utf8))}
        }
        let max=text.replacingOccurrences(of:"\"revision\":1",with:"\"revision\":18446744073709551615")
        #expect(try BrowserOriginalPageReadRequest.decode(Data(max.utf8)).task.revision == UInt64.max)
    }
    @Test("oversize malformed UTF8 trailing/deep/null/unknown/profile input rejects")
    func malformedAndBounds() throws {
        let text=String(decoding:try raw(),as:UTF8.self)
        #expect(throws:BrowserPageSelectionError.limit){try BrowserOriginalPageReadRequest.decode(Data(repeating:32,count:32769))}
        #expect(throws:BrowserPageSelectionError.invalid){try BrowserOriginalPageReadRequest.decode(Data([255]))}
        for invalid in [text+"{}",text.replacingOccurrences(of:"\"queryOriginal\":false",with:"\"queryOriginal\":0"),
            text.replacingOccurrences(of:"\"id\":\"PUBLIC-session\"",with:"\"id\":null"),
            "{\"ownedProfileID\":\"private\","+text.dropFirst(),
            "{\"unknown\":"+String(repeating:"[",count:20)+"0"+String(repeating:"]",count:20)+","+text.dropFirst(),
            text.replacingOccurrences(of:"\"status\":\"READY\"",with:"\"status\":true")
        ] {#expect(throws:BrowserPageSelectionError.invalid){try BrowserOriginalPageReadRequest.decode(Data(invalid.utf8))}}
    }
    @Test("unpaired surrogate is invalid; valid escaped supplementary characters preserve raw bytes")
    func strictUnicode() throws {
        let text=String(decoding:try raw(),as:UTF8.self)
        for bad in ["\\uD800","\\uDC00","\\uD800x"] {
            let invalid=text.replacingOccurrences(of:"PUBLIC-binding",with:bad)
            #expect(throws:BrowserPageSelectionError.invalid){try BrowserOriginalPageReadRequest.decode(Data(invalid.utf8))}
        }
        let valid=Data(text.replacingOccurrences(of:"PUBLIC-binding",with:"\\uD83D\\uDE00").utf8)
        let parsed=try BrowserOriginalPageReadRequest.decode(valid)
        #expect(parsed.rawBytes==valid && parsed.session.sessionBinding=="😀")
    }
    @Test("session/account/task/holder relation and query-original authorization DATA constraints")
    func relationsAndQuery() throws {
        let text=String(decoding:try raw(),as:UTF8.self)
        let account=text.replacingOccurrences(of:"\"account\":\"PUBLIC-account\",\"agentConfigurationRevision\"",with:"\"account\":\"other-account\",\"agentConfigurationRevision\"")
        #expect(throws:BrowserPageSelectionError.denied){try BrowserOriginalPageReadRequest.decode(Data(account.utf8))}
        let holder=text.replacingOccurrences(of:"\"holder\":\"PUBLIC-device\"",with:"\"holder\":\"other-device\"")
        #expect(throws:BrowserPageSelectionError.denied){try BrowserOriginalPageReadRequest.decode(Data(holder.utf8))}
        #expect(throws:BrowserPageSelectionError.invalid){try BrowserOriginalPageReadRequest.decode(raw(authorization:nil))}
        let query=try BrowserOriginalPageReadRequest.decode(raw(query:true,authorization:nil));#expect(query.queryOriginal && query.authorizationRef.isEmpty)
    }
    @Test("DATA comparator rejects mismatched source operands and Unicode normalization aliases")
    func explicitComparison() throws {
        let r=try BrowserOriginalPageReadRequest.decode(raw())
        for mismatch in [expected(task:"other-task"),expected(sessionID:"other-session"),expected(account:"other-account"),expected(revision:2),expected(query:true),expected(authorization:"other-ref"),expected(refs:[])] {
            #expect(throws:BrowserPageSelectionError.denied){try r.requireMatches(mismatch)}
        }
        let text=String(decoding:try raw(),as:UTF8.self).replacingOccurrences(of:"PUBLIC-account",with:"PUBLIC-é")
        let request=try BrowserOriginalPageReadRequest.decode(Data(text.utf8))
        let mismatch=BrowserOriginalPageReadExpectedData(runID:"PUBLIC_run-1",session:.init(id:"PUBLIC-session",account:"PUBLIC-e\u{0301}",deviceID:"PUBLIC-device",productClientID:"ynx-ai-v1",bundleID:"PUBLIC.bundle",sessionBinding:"PUBLIC-binding"),taskID:taskID,account:"PUBLIC-e\u{0301}",holder:"PUBLIC-device",revision:1,generation:2,references:[fixed],queryOriginal:false,authorizationRef:"PUBLIC-authorization-reference")
        #expect(throws:BrowserPageSelectionError.denied){try request.requireMatches(mismatch)}
    }
    @Test("parsed real source refs enter fixed producer; unknown task/ref/profile or expected mismatch causes zero DOM")
    func actualResolverIntegration() async throws {
        let store=BrowserPageSelectionStore(),doc=BrowserPageDocument(tabID:UUID(),profileID:profile,generation:1,origin:"https://public.example",isPrivate:false)
        let content=BrowserPageContent(url:"",title:"",text:"PUBLIC original selected fields")
        let source=try #require(store.selectPages([.init(document:doc,taskID:taskID,allowedFields:["text"],content:content,confirmed:true)]).first)
        let ref=BrowserPageSelectionReference(source:source),request=try BrowserOriginalPageReadRequest.decode(raw(refs:[ref]));var calls=0
        let batch=try await request.read(in:store,ownedProfileID:profile,expected:expected(refs:[ref]),currentDocument:{_ in doc},extract:{_ in calls+=1;return content})
        #expect(calls==1 && batch.pages[0].state == .available)
        let borrow=try request.borrow(in:store,ownedProfileID:profile,expected:expected(refs:[ref]),currentDocument:{_ in doc});try borrow.requireCurrent();borrow.close();calls=0
        let unknown=BrowserPageSelectionReference(selectionID:UUID().uuidString,version:ref.version)
        for (r,p,e) in [(request,"other-profile",expected(refs:[ref])),(request,profile,expected(refs:[ref],task:"other-task")),(try BrowserOriginalPageReadRequest.decode(raw(refs:[unknown])),profile,expected(refs:[unknown]))] {
            do{_=try await r.read(in:store,ownedProfileID:p,expected:e,currentDocument:{_ in doc},extract:{_ in calls+=1;return content});Issue.record("Invalid binding performed a read")}catch BrowserPageSelectionError.denied{}
        }
        #expect(calls==0)
        store.invalidate(tabID:doc.tabID)
        let stale=try await request.read(in:store,ownedProfileID:profile,expected:expected(refs:[ref]),currentDocument:{_ in doc},extract:{_ in calls+=1;return content})
        #expect(stale.pages[0].state == .stale && stale.pages[0].snapshotBytes == nil && calls==0)
    }
}
