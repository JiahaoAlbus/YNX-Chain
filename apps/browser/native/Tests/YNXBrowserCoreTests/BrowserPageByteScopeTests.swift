import Foundation
import Testing
@testable import YNXBrowserCore

@Suite("Byte-exact task/profile scope alias regression delta")
@MainActor struct BrowserPageByteScopeTests {
    private func fixture(task: String, profile: String) throws -> (BrowserPageSelectionStore,BrowserPageSource,BrowserPageContent) {
        let store=BrowserPageSelectionStore(),doc=BrowserPageDocument(tabID:UUID(),profileID:profile,generation:1,origin:"https://public.example",isPrivate:false)
        let content=BrowserPageContent(url:"",title:"",text:"PUBLIC byte-scope synthetic")
        let source=try #require(store.selectPages([.init(document:doc,taskID:task,allowedFields:["text"],content:content,confirmed:true)]).first)
        return(store,source,content)
    }
    @Test("canonically equivalent task IDs with different UTF8 deny resolver and direct batch before DOM")
    func taskAliasDeniedBeforeDOM() async throws {
        let original="task-\u{00e9}",alias="task-e\u{0301}",profile="PUBLIC-ordinary"
        #expect(original==alias);#expect(!original.utf8.elementsEqual(alias.utf8))
        let (store,source,content)=try fixture(task:original,profile:profile),ref=BrowserPageSelectionReference(source:source);var calls=0
        #expect(throws:BrowserPageSelectionError.denied){try store.resolveSelectedPageReferences([ref],taskID:alias,profileID:profile)}
        do{_=try await store.readSelectedPageReferences([ref],taskID:alias,profileID:profile,currentDocument:{_ in source.document},extract:{_ in calls+=1;return content});Issue.record("Aliased task reference reached DOM")}catch BrowserPageSelectionError.denied{}
        do{_=try await store.readSelectedPageBatch([source],taskID:alias,profileID:profile,currentDocument:{_ in source.document},extract:{_ in calls+=1;return content});Issue.record("Aliased task batch reached DOM")}catch BrowserPageSelectionError.denied{}
        #expect(calls==0)
        #expect(try store.resolveSelectedPageReferences([ref],taskID:original,profileID:profile)==[source])
    }
    @Test("canonically equivalent profile IDs with different UTF8 deny resolver and direct batch before DOM")
    func profileAliasDeniedBeforeDOM() async throws {
        let task="PUBLIC-task",original="profile-\u{00e9}",alias="profile-e\u{0301}"
        #expect(original==alias);#expect(!original.utf8.elementsEqual(alias.utf8))
        let (store,source,content)=try fixture(task:task,profile:original),ref=BrowserPageSelectionReference(source:source);var calls=0
        #expect(throws:BrowserPageSelectionError.denied){try store.resolveSelectedPageReferences([ref],taskID:task,profileID:alias)}
        do{_=try await store.readSelectedPageReferences([ref],taskID:task,profileID:alias,currentDocument:{_ in source.document},extract:{_ in calls+=1;return content});Issue.record("Aliased profile reference reached DOM")}catch BrowserPageSelectionError.denied{}
        do{_=try await store.readSelectedPageBatch([source],taskID:task,profileID:alias,currentDocument:{_ in source.document},extract:{_ in calls+=1;return content});Issue.record("Aliased profile batch reached DOM")}catch BrowserPageSelectionError.denied{}
        #expect(calls==0)
        #expect(try store.resolveSelectedPageReferences([ref],taskID:task,profileID:original)==[source])
    }
}
