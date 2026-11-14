import Foundation
import Testing
@testable import YNXBrowserCore

@Suite("Production selected-reference resolver and local borrow lifecycle delta")
@MainActor struct BrowserPageSelectionProducerTests {
    private let task = "task-PUBLIC-producer-fixture", profile = "PUBLIC-ordinary"
    private func prepared() throws -> (BrowserPageSelectionStore,[BrowserPageSource],[UUID:BrowserPageDocument],[UUID:BrowserPageContent]) {
        let store = BrowserPageSelectionStore()
        let docs = (0..<3).map { BrowserPageDocument(tabID:UUID(),profileID:profile,generation:1,origin:"https://public-\($0).example",isPrivate:false) }
        let contents = docs.enumerated().map { BrowserPageContent(url:$0.element.origin+"/article",title:"PUBLIC \($0.offset)",text:"PUBLIC synthetic \($0.offset)") }
        let sources = try store.selectPages(zip(docs,contents).map { BrowserPageConfirmation(document:$0.0,taskID:task,allowedFields:["text"],content:$0.1,confirmed:true) })
        return (store,sources,Dictionary(uniqueKeysWithValues:docs.map{($0.tabID,$0)}),Dictionary(uniqueKeysWithValues:zip(docs,contents).map{($0.0.tabID,$0.1)}))
    }
    @Test("exact registered references resolve in request order and borrow reads only original selected fields")
    func exactResolverAndRead() async throws {
        let (store,sources,docs,content)=try prepared(), refs=sources.map(BrowserPageSelectionReference.init(source:))
        #expect(try store.resolveSelectedPageReferences([refs[2],refs[0]],taskID:task,profileID:profile)==[sources[2],sources[0]])
        let borrow=try store.borrowSelectedPages(refs,taskID:task,profileID:profile,currentDocument:{docs[$0]})
        var calls:[UUID]=[]
        let batch=try await borrow.read{source in calls.append(source.selectionID);return content[source.document.tabID]!}
        #expect(calls==sources.map(\.selectionID));#expect(batch.pages.allSatisfy{$0.state == .available})
        for result in batch.pages { let bytes=try #require(result.snapshotBytes);#expect(try BrowserPageSelectionStore.previewFields(bytes,source:result.source)==["text":content[result.source.document.tabID]!.text]) }
        try borrow.requireCurrent();borrow.close()
    }
    @Test("malformed unknown wrong-version task and profile references cause zero DOM calls")
    func rejectsBeforeDOM() async throws {
        let (store,sources,docs,content)=try prepared(), ref=BrowserPageSelectionReference(source:sources[0]);var calls=0
        let cases:[([BrowserPageSelectionReference],String,String,BrowserPageSelectionError)]=[
            ([.init(selectionID:UUID().uuidString,version:ref.version)],task,profile,.denied),
            ([.init(selectionID:ref.selectionID,version:String(repeating:"0",count:128))],task,profile,.stale),
            ([.init(selectionID:"not-a-selection",version:ref.version)],task,profile,.invalid),
            ([.init(selectionID:ref.selectionID.lowercased(),version:ref.version)],task,profile,.invalid),
            ([ref,ref],task,profile,.invalid),([ref],"another-task",profile,.denied),([ref],task,"private-profile",.denied)]
        for (requested,taskID,profileID,want) in cases {
            do { _=try await store.readSelectedPageReferences(requested,taskID:taskID,profileID:profileID,currentDocument:{docs[$0]},extract:{source in calls+=1;return content[source.document.tabID]!});Issue.record("Unexpected read") }
            catch let error as BrowserPageSelectionError { #expect(error==want) }
        }
        #expect(calls==0)
    }
    @Test("private current page refuses borrow without DOM and revokes its previously ordinary reference")
    func privateCurrent() throws {
        let (store,sources,_,_)=try prepared(), ref=BrowserPageSelectionReference(source:sources[0]),doc=sources[0].document
        let privateDoc=BrowserPageDocument(tabID:doc.tabID,profileID:doc.profileID,generation:doc.generation,origin:doc.origin,isPrivate:true)
        #expect(throws:BrowserPageSelectionError.stale){try store.borrowSelectedPages([ref],taskID:task,profileID:profile,currentDocument:{_ in privateDoc})}
        #expect(throws:BrowserPageSelectionError.stale){try store.resolveSelectedPageReferences([ref],taskID:task,profileID:profile)}
    }
    @Test("navigation synchronously revokes affected borrow only and never revives old handle")
    func targetedNavigationRevocation() throws {
        let (store,sources,docs,_)=try prepared(), refs=sources.map(BrowserPageSelectionReference.init(source:))
        let first=try store.borrowSelectedPages([refs[0]],taskID:task,profileID:profile,currentDocument:{docs[$0]})
        let second=try store.borrowSelectedPages([refs[1]],taskID:task,profileID:profile,currentDocument:{docs[$0]})
        var events:[BrowserPageSelectionError]=[];first.installRevocationHandler{events.append($0)}
        store.invalidate(tabID:sources[0].document.tabID)
        #expect(events == [.stale]);#expect(throws:BrowserPageSelectionError.stale){try first.requireCurrent()};try second.requireCurrent()
        first.close();#expect(events == [.stale]);second.close()
    }
    @Test("known revoked reference reports STALE without body or extraction; wrong scope still denies")
    func revokedStateRead() async throws {
        let (store,sources,docs,content)=try prepared(), ref=BrowserPageSelectionReference(source:sources[0]);store.invalidate(tabID:sources[0].document.tabID);var calls=0
        let batch=try await store.readSelectedPageReferences([ref],taskID:task,profileID:profile,currentDocument:{docs[$0]},extract:{source in calls+=1;return content[source.document.tabID]!})
        #expect(calls==0);#expect(batch.pages[0].state == .stale && batch.pages[0].snapshotBytes == nil)
        #expect(throws:BrowserPageSelectionError.denied){try store.resolveSelectedPageReferences([ref],taskID:"other-task",profileID:profile)}
    }
    @Test("explicit close while awaiting first extraction aborts bytes and prevents later DOM reads")
    func closeDuringRead() async throws {
        let (store,sources,docs,content)=try prepared(), borrow=try store.borrowSelectedPages(sources.map(BrowserPageSelectionReference.init(source:)),taskID:task,profileID:profile,currentDocument:{docs[$0]});var calls=0
        do { _=try await borrow.read{source in calls+=1;borrow.close();await Task.yield();return content[source.document.tabID]!};Issue.record("Closed borrow returned bytes") }
        catch BrowserPageSelectionError.denied { }
        #expect(calls==1);#expect(throws:BrowserPageSelectionError.denied){try borrow.requireCurrent()}
    }
    @Test("navigation of earlier page during later extraction aborts borrowed batch with no subsequent DOM")
    func navigationDuringRead() async throws {
        let (store,sources,docs,content)=try prepared(), borrow=try store.borrowSelectedPages(sources.map(BrowserPageSelectionReference.init(source:)),taskID:task,profileID:profile,currentDocument:{docs[$0]});var calls:[UUID]=[]
        do { _=try await borrow.read{source in calls.append(source.selectionID);if source.selectionID==sources[1].selectionID{store.invalidate(tabID:sources[0].document.tabID);await Task.yield()};return content[source.document.tabID]!};Issue.record("Revoked borrow returned bytes") }
        catch BrowserPageSelectionError.stale { }
        #expect(calls==[sources[0].selectionID,sources[1].selectionID]);#expect(throws:BrowserPageSelectionError.stale){try borrow.requireCurrent()}
    }
    @Test("clear synchronously revokes all borrows; explicit close releases native document callback")
    func clearAndRelease() throws {
        final class NativeOwner {}
        let (store,sources,docs,_)=try prepared();var owner:NativeOwner?=NativeOwner();weak var weakOwner=owner
        let borrow=try store.borrowSelectedPages([.init(source:sources[0])],taskID:task,profileID:profile,currentDocument:{[keep=owner!]id in _=keep;return docs[id]})
        owner=nil;#expect(weakOwner != nil);var events=0;borrow.installRevocationHandler{_ in events+=1}
        store.removeAll();#expect(events==1);#expect(weakOwner == nil)
        #expect(throws:BrowserPageSelectionError.stale){try borrow.requireCurrent()}
        var late:BrowserPageSelectionError?;borrow.installRevocationHandler{late=$0};#expect(late == .stale)
    }
    @Test("weak registry does not retain abandoned borrows and bounds simultaneous live handles")
    func boundedWeakRegistry() throws {
        let (store,sources,docs,_)=try prepared();var live:[BrowserPageSelectionBorrow]=[]
        for _ in 0..<BrowserPageSelectionStore.maximumPageBorrows {live.append(try store.borrowSelectedPages([.init(source:sources[0])],taskID:task,profileID:profile,currentDocument:{docs[$0]}))}
        #expect(throws:BrowserPageSelectionError.limit){try store.borrowSelectedPages([.init(source:sources[0])],taskID:task,profileID:profile,currentDocument:{docs[$0]})}
        live.removeAll()
        let next=try store.borrowSelectedPages([.init(source:sources[0])],taskID:task,profileID:profile,currentDocument:{docs[$0]});try next.requireCurrent();next.close()
    }
    @Test("missing document or deallocated store makes borrow permanently unavailable")
    func ownerLoss() throws {
        let (initial,sources,docs,_)=try prepared();var documents=docs
        let borrow=try initial.borrowSelectedPages([.init(source:sources[0])],taskID:task,profileID:profile,currentDocument:{documents[$0]})
        documents.removeValue(forKey:sources[0].document.tabID)
        #expect(throws:BrowserPageSelectionError.unavailable){try borrow.requireCurrent()}
        documents=docs;#expect(throws:BrowserPageSelectionError.unavailable){try borrow.requireCurrent()}
        var store:BrowserPageSelectionStore?=BrowserPageSelectionStore()
        let c=BrowserPageConfirmation(document:sources[1].document,taskID:task,allowedFields:["text"],content:BrowserPageContent(url:"",title:"",text:"PUBLIC"),confirmed:true)
        let selected=try store!.selectPages([c]);let dying=try store!.borrowSelectedPages([.init(source:selected[0])],taskID:task,profileID:profile,currentDocument:{docs[$0]});store=nil
        #expect(throws:BrowserPageSelectionError.unavailable){try dying.requireCurrent()}
    }
}
