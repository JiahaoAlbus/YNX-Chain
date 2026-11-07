import Foundation

@main struct AgentComparisonChecks {
    @MainActor static func main()async throws {
        var count=0
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};count+=1;print("PASS "+name)}
        func refused(_ name:String,_ action:()throws->Void)throws{do{try action()}catch is ShopError{try check(true,name);return};throw NSError(domain:name,code:2)}
        let account="ynx1"+String(repeating:"q",count:38),summary="Public catalog comparison; sku=original; priceYNXT=9007199254740993"
        var storage=["original-UNKNOWN":Data("retain original operation bytes".utf8)],reads=0,writes=0,allowWrite=true
        let sentinel=storage["original-UNKNOWN"]
        let journal=ShopComparisonJournal(read:{reads+=1;return storage[$0]},write:{guard allowWrite else{throw ShopError.security};writes+=1;storage[$0]=$1})
        try check(reads==0 && writes==0,"journal initialization does not open protected storage")
        let original=try journal.prepare(account:account,summary:summary)
        let frozen=try CanonicalJSON.data(journal.input(original))
        try check(frozen==original.requestBody && (try journal.prepare(account:account,summary:summary)).key==original.key,"same proposal retains frozen request and original idempotency key")
        try refused("new context cannot replace unresolved disclosure"){_ = try journal.prepare(account:account,summary:"replacement")}
        try journal.dispatch(original,phase:"creation_unknown")
        let cold=ShopComparisonJournal(read:{storage[$0]},write:{storage[$0]=$1})
        try check(try cold.active(account)?.phase=="creation_unknown" && CanonicalJSON.data(cold.input(original))==frozen,"cold recovery preserves original create UNKNOWN and exact lookup bytes")
        try refused("lost creation acknowledgement cannot dispatch a second creation"){try cold.dispatch(original,phase:"creation_unknown")}
        func job(_ status:String,_ owner:String?=nil,_ context:String?=nil,_ id:String?=nil)->ShopAgentJob {
            ShopAgentJob(jobID:id ?? "ai_"+String(repeating:"a",count:24),actor:owner ?? account,walletActor:nil,workflow:"search_comparison",status:status,providerStatus:"fixture",contextSummary:context ?? summary,contextClasses:["public_catalog"],allowedActions:["draft_comparison"],estimateUnits:1,permissionGranted:true,result:status=="review_required" ? "Comparison draft":"",failure:"",applied:status=="applied_draft",rejected:status=="rejected",cancelled:status=="cancelled",runAttemptID:nil)
        }
        try refused("foreign job cannot be adopted"){_ = try cold.observe(original,job:job("permission_granted","foreign"))}
        try refused("changed disclosure cannot be adopted"){_ = try cold.observe(original,job:job("permission_granted",nil,"replacement"))}
        _ = try cold.observe(original,job:job("permission_granted"))
        try cold.dispatch(original,phase:"run_unknown")
        try check(try cold.observe(original,job:job("permission_granted")).phase=="run_unknown","pre-run read cannot prove uncertain generation was not delivered")
        try refused("lost run acknowledgement cannot dispatch generation again"){try cold.dispatch(original,phase:"run_unknown")}
        _ = try cold.observe(original,job:job("review_required"))
        try check(try cold.observe(original,job:job("running")).phase=="review_required","late running result cannot rewind review")
        try cold.dispatch(original,phase:"decision_unknown",action:"apply")
        try check(try cold.observe(original,job:job("running")).phase=="decision_unknown","late pre-review result retains exact uncertain decision")
        try check(try cold.observe(original,job:job("rejected")).phase=="decision_conflict","opposite terminal outcome is not reported as own accepted decision")
        try check(try cold.observe(original,job:job("applied_draft")).phase=="decision_conflict","decision conflict remains immutable")
        let next=try cold.prepare(account:account,summary:summary)
        try check(next.key != original.key,"new explicit proposal after definitive completion has a distinct original key")
        try cold.dispatch(next,phase:"creation_unknown")
        _ = try cold.observe(next,job:job("permission_granted",nil,nil,"ai_"+String(repeating:"b",count:24)))
        try cold.dispatch(next,phase:"run_unknown");try cold.dispatch(next,phase:"cancel_unknown")
        try check(try cold.observe(next,job:job("review_required",nil,nil,"ai_"+String(repeating:"b",count:24))).phase=="cancel_unknown","late generation result cannot erase unresolved cancellation")
        try refused("privacy cannot erase an unresolved original"){try cold.redactCompleted(account)}
        _ = try cold.observe(next,job:job("cancelled",nil,nil,"ai_"+String(repeating:"b",count:24)))
        try check(try cold.observe(next,job:job("review_required",nil,nil,"ai_"+String(repeating:"b",count:24))).phase=="cancelled","late provider completion cannot revive a cancelled original")
        try cold.redactCompleted(account)
        let retired=try cold.records(account)
        try check(retired.count==2 && retired.values.allSatisfy{$0.phase=="retired" && $0.contextSummary.isEmpty && $0.requestBody==nil && $0.job==nil},"confirmed privacy cleanup retains original tombstones while redacting contexts")
        let undispatched=try cold.prepare(account:"other-local-account",summary:summary)
        try check(try cold.discardPrepared(undispatched).phase=="cancelled" && cold.active("other-local-account")==nil,"explicit local cancellation retires only a known undispatched proposal")
        try refused("local cancellation cannot rewrite an uncertain original"){_ = try cold.discardPrepared(original)}
        allowWrite=false
        try refused("failed durable prepare blocks dispatch"){_ = try journal.prepare(account:account,summary:summary)}
        try check(storage["original-UNKNOWN"]==sentinel,"all comparison operations preserve unrelated original UNKNOWN bytes")
        for (method,path) in [("POST","/api/ai/jobs/intent-lookup"),("GET","/api/ai/jobs"),("GET","/api/ai/jobs/ai_original"),("POST","/api/ai/jobs/ai_original/cancel")] {
            try check(try AppleNativeBusinessPolicy.scopes(method,path)==AppleNativeProductState.scopes,"original comparison recovery preserves existing Buyer proof scopes")
        }
        try refused("wrong comparison recovery method cannot obtain proof"){_ = try AppleNativeBusinessPolicy.scopes("PUT","/api/ai/jobs/intent-lookup")}
        let en=Locale(identifier:"en_US")
        try check(ShopMoneyDisplay.legacyYNXT(Int64.max,locale:en)=="9,223,372,036,854,775,807 YNXT","legacy display preserves Int64 maximum without floating point rounding")
        try check(ShopMoneyDisplay.legacyYNXT(9007199254740993,locale:en)=="9,007,199,254,740,993 YNXT","price beyond double precision preserves every digit")
        try check(ShopMoneyDisplay.atoms("18446744073709551615",locale:en)?.hasPrefix("18,446,744,073,709,551,615 ")==true,"native atom display preserves UInt64 maximum")
        try check(["01","-1","1.0","18446744073709551616"," 1"].allSatisfy{ShopMoneyDisplay.atoms($0,locale:en)==nil},"native atoms refuse noncanonical values and overflow")
        let order=try JSONDecoder().decode(Order.self,from:Data("{\"ID\":\"original\",\"Status\":\"pending\",\"TotalYNXT\":1,\"Currency\":\"USD\"}".utf8))
        try check(ShopMoneyDisplay.order(order,locale:en)==nil,"unknown currency is not relabeled as YNX or legacy YNXT")
        for (inventory,reserved) in [(Int.max,-1),(Int.min,Int.max),(1,2)] {
            let v=try JSONDecoder().decode(Variant.self,from:JSONSerialization.data(withJSONObject:["ID":"original","Name":"Invalid fixture","PriceYNXT":1,"Inventory":inventory,"Reserved":reserved]))
            try check(v.available==0,"malformed inventory remains unavailable without arithmetic overflow")
        }
        print("Agent journal/money checks PASS \(count); no real Keychain, provider, Wallet or funds used")
    }
}
