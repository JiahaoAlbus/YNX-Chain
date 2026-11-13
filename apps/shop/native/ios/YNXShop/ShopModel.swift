import Foundation
import SwiftUI

@MainActor final class ShopModel:ObservableObject {
    @Published var products:[Product]=[]
    @Published private(set) var catalogPhase="idle"
    @Published private(set) var catalogLoadedQuery:String?
    @Published private var productCache:[String:Product]=[:]
    @Published private var productPhases:[String:String]=[:]
    private var productReadTicket=0
    private var productTickets:[String:Int]=[:]
    private var productReads:[String:(ticket:Int,task:Task<Void,Never>)]=[:]
    var catalogIsStale:Bool{catalogPhase != "loaded" || catalogLoadedQuery != search}
    @Published var cart:[CartItem]=[]
    @Published var orders:[Order]=[]
    @Published private(set) var checkoutResult:Order?
    @Published var state="loading"
    @Published var search=""
    @Published var selected:Product?
    @Published var signedIn=false
    @Published private(set) var localDataLocked:Bool
    @Published var privacyRevision=0
    @Published var privacyExportURL:URL?
    @Published var appLanguage=ShopLanguage.read(.standard,key:"app-language")
    @Published var aiLanguage=ShopLanguage.read(.standard,key:"ai-language")
    struct InvoicePresentation:Identifiable {let review:AppleBuyerJourney.Review;let session:ShopSession;let revision:Int;let url:URL;var id:String{review.key}}
    @Published var invoicePresentation:InvoicePresentation?
    @Published var originalOrderLink:OriginalOrderLink?
    @Published private(set) var linkedOriginalOrder:Order?
    @Published private(set) var originalOrderLoading=false
    private var originalOrderRevision=0
    private var originalLinkRestoring=true
    private var pendingNativeReturnURL:URL?
    private var nativeReturnBusy=false
    var nativeReturnPending:Bool{pendingNativeReturnURL != nil}
    private var pendingOriginalOrderURL:URL?
    private var pendingOriginalOrderAfterSignIn:OriginalOrderLink?
    private var originalOrderSignInSuspended=false
    private var originalOrderSignInDispatched=false
    let api:APIClient,queue:OfflineQueue,invoiceHandoffs:InvoiceHandoffJournal,journey:AppleBuyerJourney
    let nativeInvoices:NativeInvoicePreparationJournal
    let comparisonJournal:ShopComparisonJournal
    @Published var agentWorkspaceVisible=false
    @Published var agentPresentation:AgentComparisonPresentation?
    @Published private(set) var agentJob:ShopAgentJob?
    @Published private(set) var agentJobs:[ShopAgentJob]=[]
    @Published private(set) var agentPhase="proposal"
    @Published private(set) var agentBusy=false
    private var agentRevision=0
    private var agentActiveKey:String?

    private var presentedSession:ShopSession?
    private var operationRevision=0
    private var ordersRefreshRevision=0
    private var catalogRefreshRevision=0
    @Published private(set) var mutationBusy=false
    @Published private(set) var checkoutRecoveryRequired=false
    @Published private(set) var orderRecoveryStates:[String:String]=[:]
    private var preparedTransitionOrders=Set<String>()
    private var nativeBoundOrderIDs=Set<String>()
    private var attemptedReconciliations:[String:[String]]=[:]
    @Published var profileName=""
    @Published var profileRecipient=""
    @Published var profileAddress=""
    @Published var profileCity=""
    @Published var profileCountry=""
    struct OrderActionPresentation:Identifiable {let id=UUID();let order:Order;let action:String;let title:String;let session:ShopSession;let revision:Int}
    @Published var orderActionPresentation:OrderActionPresentation?
    private var handoffPresentationRevision=0
    func cancelInvoicePresentation(){handoffPresentationRevision+=1;invoicePresentation=nil;orderActionPresentation=nil}
    private func refreshCheckoutRecovery(){guard let current=api.currentSession,current==presentedSession else{checkoutRecoveryRequired=false;return};do{let draft=try journey.load(current.account);checkoutRecoveryRequired=draft.checkoutKey != nil || draft.checkoutPhase != nil}catch{checkoutRecoveryRequired=true}}
    init(api:APIClient?=nil,queue:OfflineQueue?=nil,invoiceHandoffs:InvoiceHandoffJournal?=nil,journey:AppleBuyerJourney?=nil,nativeInvoices:NativeInvoicePreparationJournal?=nil,comparisonJournal:ShopComparisonJournal?=nil,localDataInitiallyLocked:Bool?=nil){self.comparisonJournal=comparisonJournal ?? ShopComparisonJournal();self.nativeInvoices=nativeInvoices ?? NativeInvoicePreparationJournal();self.api=api ?? APIClient();self.queue=queue ?? OfflineQueue();self.invoiceHandoffs=invoiceHandoffs ?? InvoiceHandoffJournal();self.journey=journey ?? AppleBuyerJourney();localDataLocked=localDataInitiallyLocked ?? (journey==nil);if !localDataLocked{do{cart=try self.journey.guest()}catch{localDataLocked=true}};self.api.onSessionChanged={[weak self] in self?.reconcileIdentity()};Task{try? await self.api.restoreNative();let pending=self.pendingOriginalOrderURL;self.pendingOriginalOrderURL=nil;self.originalLinkRestoring=false;self.reconcileIdentity();if let pending{self.walletCallback(pending)}};Task{await loadCatalog()};Task{[weak self] in while !Task.isCancelled{try? await Task.sleep(for:.seconds(1));guard let self else{return};if self.presentedSession != self.api.currentSession{self.reconcileIdentity()}}}}
    private func reconcileIdentity(){let current=api.currentSession;guard current != presentedSession else{return};clearAgentPresentation();attemptedReconciliations=[:];let pendingLink=pendingOriginalOrderAfterSignIn;closeOriginalOrderLink();cancelInvoicePresentation();operationRevision+=1;invalidateProductReads();mutationBusy=false;cart=[];orders=[];checkoutResult=nil;orderRecoveryStates=[:];selected=nil;privacyRevision+=1;if let url=privacyExportURL{try? FileManager.default.removeItem(at:url)};privacyExportURL=nil;clearProfilePresentation();presentedSession=current;signedIn=current != nil;if let current{do{cart=try journey.load(current.account).items;Task{await loadOrders();await resumeOriginalOrder();if api.nativeInvoiceMode{await resumeNativeInvoiceReferences()}}}catch{state="security_error"}};refreshCheckoutRecovery();if let pendingLink,let current{if current.account==pendingLink.account,current.nativeGeneration != nil{originalOrderLink=pendingLink;Task{await refreshOriginalOrderLink()}}else{state="security_error"}}}
    func sceneActive(){reconcileIdentity();refreshCheckoutRecovery();Task{await resumeOriginalOrder();await resumeNativeInvoiceReferences()}}
    func setLanguage(_ value:String){appLanguage=ShopLanguage.choose(value,in:.standard,key:"app-language")}
    func setAILanguage(_ value:String){aiLanguage=ShopLanguage.choose(value,in:.standard,key:"ai-language")}
    private func failure(_ error:Error){if let refusal=error as? OriginalMainPayRefusal{state=refusal.presentationState;return};if let error=error as? ShopError{if error == .contextChanged{if signedIn && api.currentSession==nil{signOut()};return};if error == .signedOut{signOut();return}};state="unavailable"}
    func signOut(){clearAgentPresentation();attemptedReconciliations=[:];localDataLocked=true;pendingNativeReturnURL=nil;closeOriginalOrderLink();pendingOriginalOrderURL=nil;cancelInvoicePresentation();api.invalidate();operationRevision+=1;invalidateProductReads();mutationBusy=false;presentedSession=nil;signedIn=false;checkoutRecoveryRequired=false;cart=[];orders=[];checkoutResult=nil;orderRecoveryStates=[:];selected=nil;privacyRevision+=1;if let url=privacyExportURL{try? FileManager.default.removeItem(at:url)};privacyExportURL=nil;clearProfilePresentation();do{try api.disconnectNative();state=""}catch{state="security_error"}}
    func loadCatalog()async {
        catalogRefreshRevision+=1
        let refresh=catalogRefreshRevision,operation=operationRevision,query=search
        state="loading";catalogPhase="loading"
        productReadTicket+=1;let ticket=productReadTicket
        var authorization:(()throws->Void)?
        do {
            let check=try api.capture(requireSession:false);authorization=check
            var components=URLComponents()
            components.queryItems=[URLQueryItem(name:"q",value:query)]
            // Go's query decoder treats a literal + as a form-encoded space.
            guard let encoded=components.percentEncodedQuery?.replacingOccurrences(of:"+",with:"%2B") else{throw ShopError.invalidResponse}
            let response:CatalogResponse=try await api.request("products?\(encoded)")
            guard refresh==catalogRefreshRevision,operation==operationRevision else{return}
            guard query==search else{catalogPhase="idle";return}
            try check()
            guard Set(response.products.map(\.productID)).count==response.products.count else{throw ShopError.invalidResponse}
            for product in response.products{try validateCatalogProduct(product)}
            for product in response.products{ingestProduct(product,ticket:ticket)}
            products=response.products.map{productCache[$0.productID] ?? $0};catalogLoadedQuery=query;catalogPhase="loaded";state=products.isEmpty ? "empty_catalog":""
        } catch {
            guard refresh==catalogRefreshRevision,operation==operationRevision else{return}
            guard query==search else{catalogPhase="idle";return}
            if let authorization {do{try authorization()}catch{catalogPhase="idle";return}}
            catalogPhase=publicReadFailure(error);state="unavailable"
        }
    }
    private func publicReadFailure(_ error:Error)->String {
        if let error=error as? URLError,[.notConnectedToInternet,.networkConnectionLost,.cannotConnectToHost,.cannotFindHost,.dnsLookupFailed,.timedOut].contains(error.code){return "offline"}
        return "failed"
    }
    private func invalidateProductReads(){
        for read in productReads.values{read.task.cancel()};productReads=[:]
        productPhases=productPhases.mapValues{$0=="loading" ? "idle":$0}
        if catalogPhase=="loading"{catalogPhase="idle"}
    }
    private func validateCatalogProduct(_ product:Product)throws {
        guard NativeWire.matches(product.productID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),NativeWire.matches(product.storeID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),Set(product.variants.map(\.variantID)).count==product.variants.count,product.variants.allSatisfy({NativeWire.matches($0.variantID,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")}) else{throw ShopError.invalidResponse}
    }
    private func ingestProduct(_ product:Product,ticket:Int){
        guard ticket >= (productTickets[product.productID] ?? 0) else{return}
        if let old=productCache[product.productID]?.revision,product.revision==nil || product.revision!<old{return}
        productTickets[product.productID]=ticket;productCache[product.productID]=product;productPhases[product.productID]="loaded"
    }
    func cachedProduct(_ id:String)->Product?{productCache[id]}
    func productPhase(_ id:String)->String{productPhases[id] ?? "idle"}
    func refreshProduct(_ id:String)async {
        if let read=productReads[id]{await read.task.value;return}
        guard NativeWire.matches(id,"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$") else{productPhases[id]="failed";return}
        productReadTicket+=1;let ticket=productReadTicket,operation=operationRevision
        productTickets[id]=ticket;productPhases[id]="loading"
        let task=Task{@MainActor in
            defer{if self.productReads[id]?.ticket==ticket{self.productReads[id]=nil}}
            var authorization:(()throws->Void)?
            do{
                let check=try self.api.capture(requireSession:false);authorization=check
                let product:Product=try await self.api.request("products/"+id)
                try check();guard operation==self.operationRevision,self.productTickets[id]==ticket else{return}
                guard product.productID==id else{throw ShopError.invalidResponse};try self.validateCatalogProduct(product)
                if let old=self.productCache[id]?.revision,product.revision==nil || product.revision!<old{throw ShopError.invalidResponse}
                self.ingestProduct(product,ticket:ticket)
            }catch{
                guard operation==self.operationRevision,self.productTickets[id]==ticket else{return}
                if let authorization{do{try authorization()}catch{self.productPhases[id]="idle";return}}
                self.productPhases[id]=(error as? ShopHTTPRefusal)?.status==404 ? "not_found":self.publicReadFailure(error)
            }
        }
        productReads[id]=(ticket,task);await task.value
    }
    func refreshCartProducts()async{for id in Set(cart.map(\.productID)).sorted(){await refreshProduct(id)}}
    func maximumCartQuantity(_ item:CartItem)->Int? {
        guard productPhase(item.productID)=="loaded",let p=productCache[item.productID],let v=p.variants.first(where:{$0.variantID==item.variantID}) else{return nil}
        guard v.nativePrice==nil ? v.priceYNXT>0 : CatalogPricing.nativeUnit(v) != nil else{return nil}
        return min(20,v.available)
    }
    private func nativePriceFields(_ variant:Variant)->[String]?{variant.nativePrice.map{[$0.Genesis,$0.NativeChainID,$0.AssetID,$0.UnitVersion,$0.AmountAtoms]}}
    func canAdd(_ product:Product,_ variant:Variant)->Bool {
        guard !localDataLocked,!mutationBusy,!checkoutRecoveryRequired,productPhase(product.productID)=="loaded",let current=productCache[product.productID],let v=current.variants.first(where:{$0.variantID==variant.variantID}),v.priceYNXT==variant.priceYNXT,
              nativePriceFields(v)==nativePriceFields(variant),v.nativePrice==nil ? v.priceYNXT>0 : CatalogPricing.nativeUnit(v) != nil else{return false}
        let quantity=cart.first(where:{$0.productID==product.productID && $0.variantID==variant.variantID})?.quantity ?? 0
        return quantity<min(20,v.available)
    }
    private var resolvedCart:[(CartItem,Product,Variant)]? {
        guard !cart.isEmpty else{return nil};var result:[(CartItem,Product,Variant)]=[]
        for item in cart{guard productPhase(item.productID)=="loaded",let p=productCache[item.productID],let v=p.variants.first(where:{$0.variantID==item.variantID}),(1...20).contains(item.quantity),v.available>=item.quantity else{return nil};result.append((item,p,v))};return result
    }
    var cartNativeSubtotal:CatalogNativeAmount? {
        guard let rows=resolvedCart,Set(rows.map{$0.1.storeID}).count==1 else{return nil};var domain:CatalogNativeDomain?;var sum:UInt64=0
        for (item,_,v) in rows{guard let price=CatalogPricing.nativeUnit(v),domain==nil || domain==price.domain else{return nil};domain=price.domain;let amount=price.atoms.multipliedReportingOverflow(by:UInt64(item.quantity));let total=sum.addingReportingOverflow(amount.partialValue);guard !amount.overflow,!total.overflow else{return nil};sum=total.partialValue}
        guard let domain else{return nil};return .init(domain:domain,atoms:sum)
    }
    var cartLegacySubtotal:Int64? {
        guard let rows=resolvedCart,Set(rows.map{$0.1.storeID}).count==1 else{return nil};var sum:Int64=0
        for (item,_,v) in rows{guard v.nativePrice==nil,v.priceYNXT>0 else{return nil};let amount=v.priceYNXT.multipliedReportingOverflow(by:Int64(item.quantity));let total=sum.addingReportingOverflow(amount.partialValue);guard !amount.overflow,!total.overflow else{return nil};sum=total.partialValue};return sum
    }
    var cartCatalogIssue:String? {
        guard !cart.isEmpty else{return nil}
        for item in cart{guard productPhase(item.productID)=="loaded",let p=productCache[item.productID],let v=p.variants.first(where:{$0.variantID==item.variantID}) else{return "shop_cart_catalog_unavailable"};if item.quantity<1 || item.quantity>min(20,v.available){return "shop_cart_quantity_exceeds_stock"}}
        if Set(cart.compactMap{productCache[$0.productID]?.storeID}).count>1{return "shop_cart_multiple_stores"}
        return cartNativeSubtotal==nil && cartLegacySubtotal==nil ? "shop_cart_price_unavailable":nil
    }
    func loadOrders()async{_ = await readOrders()}
    private func readOrders()async->Bool {
        ordersRefreshRevision+=1
        let refresh=ordersRefreshRevision,operation=operationRevision
        guard signedIn else{return false}
        var authorization:(()throws->Void)?
        do {
            let check=try api.capture();authorization=check
            let response:OrdersResponse=try await api.request("orders")
            guard refresh==ordersRefreshRevision,operation==operationRevision else{return false}
            try check()
            guard let account=api.currentSession?.account else{throw ShopError.signedOut}
            try response.orders.forEach{try AppleBuyerReceipt.validate($0,account:account)}
            orders=response.orders;refreshOrderRecoveries();return true
        } catch {
            // Obsolete reads cannot replace a newer list or its error/loading state.
            guard refresh==ordersRefreshRevision,operation==operationRevision else{return false}
            if let authorization {do{try authorization()}catch{return false}}
            failure(error);return false
        }
    }
    func unlockLocalData(){
        do {
            let original:[CartItem]
            if let current=api.currentSession{original=try journey.load(current.account).items}else{original=try journey.guest()}
            cart=original;localDataLocked=false
        }catch{localDataLocked=true;state="security_error"}
    }
    private func editCart(_ items:[CartItem])throws{guard !localDataLocked else{throw ShopError.security};let current=api.currentSession;guard current==presentedSession,signedIn == (current != nil) else{throw ShopError.contextChanged};if let current{try journey.edit(current.account,items:items)}else{try journey.editGuest(items)};cart=items}
    func add(_ product:Product,_ variant:Variant){guard canAdd(product,variant) else{return};var next=cart;if let index=next.firstIndex(where:{$0.productID==product.productID && $0.variantID==variant.variantID}){guard next[index].quantity<20 else{return};next[index].quantity+=1}else{next.append(.init(productID:product.productID,variantID:variant.variantID,quantity:1))};do{try editCart(next)}catch{failure(error)}}
    func removeCart(_ item:CartItem,revision:Int?=nil){guard !mutationBusy,revision==nil || revision==privacyRevision else{return};do{try editCart(cart.filter{$0.productID != item.productID || $0.variantID != item.variantID})}catch{failure(error)}}
    func setCartQuantity(_ item:CartItem,quantity:Int,revision:Int){guard !mutationBusy,revision==privacyRevision,(1...20).contains(quantity),let index=cart.firstIndex(where:{$0.productID==item.productID && $0.variantID==item.variantID}),cart[index].quantity==item.quantity,quantity<=item.quantity || (quantity <= (maximumCartQuantity(item) ?? 0) && !checkoutRecoveryRequired) else{return};var next=cart;next[index].quantity=quantity;do{try editCart(next)}catch{failure(error)}}
    func syncCart(){guard signedIn,!mutationBusy,!checkoutRecoveryRequired else{return};mutationBusy=true;let revision=operationRevision;Task{defer{if revision==operationRevision{mutationBusy=false;refreshCheckoutRecovery();refreshOrderRecoveries()}};do{let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut};let remote=try await api.raw("cart",method:"GET",json:[:]);try check();try journey.reconcileCart(remote,account:account);let draft=try journey.load(account);if draft.dirty {let pending=try journey.prepareCart(account);let body:[String:Any]=["Items":pending.items.map{["ProductID":$0.productID,"VariantID":$0.variantID,"Quantity":$0.quantity] as [String:Any]},"ExpectedRevision":pending.expected,"IdempotencyKey":pending.key];let saved=try await api.raw("cart",method:"PUT",json:body);try check();try journey.reconcileCart(saved,account:account)};cart=try journey.load(account).items;state=""}catch{failure(error)}}}
    func signIn(){if localDataLocked{unlockLocalData();guard !localDataLocked else{return}};
        if let original=pendingNativeReturnURL {
            guard !nativeReturnBusy else{return};nativeReturnBusy=true
            Task{defer{nativeReturnBusy=false};do{try await api.resumeNativeReturnByUser(original);guard pendingNativeReturnURL==original else{throw ShopError.contextChanged};pendingNativeReturnURL=nil;reconcileIdentity();state=signedIn ? "wallet_active":"security_error";await loadOrders();await resumeOriginalOrder()}catch{failure(error)}}
            return
        }
        originalOrderSignInDispatched=pendingOriginalOrderAfterSignIn != nil;cancelInvoicePresentation();api.invalidate();operationRevision+=1;invalidateProductReads();mutationBusy=false;Task{do{try await WalletAuth.begin(api:api)}catch{failure(error)}}}
    func resumeAuthorizationReturnByUser(_ url:URL){
        guard pendingNativeReturnURL==nil || pendingNativeReturnURL==url else{state="security_error";return}
        walletCallback(url)
        if nativeReturnPending{signIn()}
    }
    func walletCallback(_ url:URL){if AppleBuyerJourney.wakeHint(url){Task{await resumeOriginalOrder()};return};if url.scheme=="ynxshop",url.host=="orders"{do{_ = try OriginalOrderLink.parse(url.absoluteString);if originalLinkRestoring{pendingOriginalOrderURL=url;return};try openOriginalOrderLink(url)}catch{state="security_error"};return};guard url.scheme=="ynxshop",url.host=="wallet-auth",url.path=="/callback" else{return};
        guard url.absoluteString.utf8.count<=16384 else{state="security_error";return}
        if nativeReturnPending || api.nativeAccessLocked {
            guard pendingNativeReturnURL==nil || pendingNativeReturnURL==url else{state="security_error";return}
            pendingNativeReturnURL=url;state="wallet_sign_in";return
        }
        Task{do{try await WalletAuth.complete(url,api:api);reconcileIdentity();state=signedIn ? "wallet_active":"security_error";await loadOrders();await resumeOriginalOrder()}catch{failure(error)}}}
    func suspendOriginalOrderLink(){pendingOriginalOrderURL=nil;let pending=originalOrderSignInDispatched ? pendingOriginalOrderAfterSignIn:nil;closeOriginalOrderLink();pendingOriginalOrderAfterSignIn=pending;originalOrderSignInSuspended=pending != nil;originalOrderSignInDispatched=pending != nil}
    func originalOrderSheetDismissed(){if originalOrderSignInSuspended{originalOrderSignInSuspended=false;return};if originalOrderLink==nil{closeOriginalOrderLink()}}
    func closeOriginalOrderLink(){pendingOriginalOrderAfterSignIn=nil;originalOrderSignInSuspended=false;originalOrderSignInDispatched=false;originalOrderRevision+=1;originalOrderLink=nil;linkedOriginalOrder=nil;originalOrderLoading=false}
    private func openOriginalOrderLink(_ url:URL)throws {
        let link=try OriginalOrderLink.parse(url.absoluteString)
        closeOriginalOrderLink();cancelInvoicePresentation()
        guard let current=api.currentSession else{originalOrderLink=link;pendingOriginalOrderAfterSignIn=link;state="wallet_sign_in";return}
        guard current.account==link.account,current.nativeGeneration != nil else{throw ShopError.security}
        originalOrderLink=link
        Task{await refreshOriginalOrderLink()}
    }
    func refreshOriginalOrderLink()async {
        guard let link=originalOrderLink else{return}
        originalOrderRevision+=1
        let revision=originalOrderRevision
        originalOrderLoading=true;linkedOriginalOrder=nil
        do {
            let check=try api.capture()
            let fence:()throws->Void={try check();guard self.originalOrderRevision==revision,self.originalOrderLink==link else{throw ShopError.contextChanged}}
            let order=try await api.readOriginalOrderLink(link,beforeDispatch:fence)
            try fence();linkedOriginalOrder=order;originalOrderLoading=false
        } catch {
            guard originalOrderRevision==revision,originalOrderLink==link else{return}
            originalOrderLoading=false;linkedOriginalOrder=nil
            failure(error)
        }
    }
    func checkLinkedOriginalPayment()async {
        guard !originalOrderLoading,let link=originalOrderLink,let order=linkedOriginalOrder,link.orderID==order.orderID else{return}
        let revision=originalOrderRevision
        originalOrderLoading=true
        do {
            let check=try api.capture()
            let fence:()throws->Void={try check();guard self.originalOrderRevision==revision,self.originalOrderLink==link else{throw ShopError.contextChanged}}
            try await api.confirmOriginalPayment(order,beforeDispatch:fence)
            try fence()
            await refreshOriginalOrderLink()
        }catch{
            guard originalOrderRevision==revision,originalOrderLink==link else{return}
            originalOrderLoading=false;linkedOriginalOrder=nil;failure(error)
        }
    }
    private func mutation(path:String,input:[String:Any],receipt:@escaping ([String:Any])throws->Void){
        guard signedIn,!mutationBusy else{return}
        do{let authorization=try api.capture(),view=handoffPresentationRevision;let check:()throws->Void={try authorization();guard view==self.handoffPresentationRevision else{throw ShopError.contextChanged}};guard let account=api.currentSession?.account else{throw ShopError.signedOut};guard try !queue.load(account:account).contains(where:{$0.path==path}) else{throw ShopError.unresolvedMutation};let item=try queue.prepareUnsent(account:account,path:path,input:input);mutationBusy=true;let revision=operationRevision
            Task{defer{if revision==operationRevision{mutationBusy=false;refreshCheckoutRecovery();refreshOrderRecoveries()}};do{let json=try JSONSerialization.jsonObject(with:item.body) as? [String:Any];guard let json else{throw ShopError.security};try check();let result=try await api.raw(item.path,method:item.method,json:json,beforeDispatch:{try check();try self.queue.beginDispatch(item)});try check();_ = try AppleBuyerReceipt.decode(result,account:account);try receipt(result);try queue.confirmedTracked(item);await loadOrders()}catch{do{try queue.markUnknown(item)}catch{guard revision==operationRevision else{return};failure(error);return};guard revision==operationRevision else{return};do{try check()}catch{return};if let err=error as? ShopError,err == .contextChanged || err == .signedOut{failure(error)}else{state="queued_offline"}}}
        }catch{failure(error)}
    }
    func checkout(recipient:String,address:String,city:String,country:String){
        guard signedIn else{signIn();return};guard !mutationBusy,!checkoutRecoveryRequired else{return}
        do{
            let check=try api.capture();guard let session=api.currentSession else{throw ShopError.signedOut}
            let draft=try journey.load(session.account)
            guard !draft.dirty,draft.cartIntent==nil,let cartRevision=draft.revision,!draft.items.isEmpty,!recipient.isEmpty,!address.isEmpty,!country.isEmpty else{throw ShopError.unresolvedMutation}
            let revision=operationRevision
            let current:()throws->Void={
                try check();guard revision==self.operationRevision else{throw ShopError.contextChanged}
                let now=try self.journey.load(session.account)
                guard !now.dirty,now.cartIntent==nil,now.revision==cartRevision,now.items.count==draft.items.count,zip(now.items,draft.items).allSatisfy({$0.productID==$1.productID && $0.variantID==$1.variantID && $0.quantity==$1.quantity}) else{throw ShopError.contextChanged}
            }
            mutationBusy=true;checkoutResult=nil
            Task{
                defer{if revision==operationRevision{mutationBusy=false;refreshCheckoutRecovery();refreshOrderRecoveries()}}
                do{
                    let store=try await api.checkoutStore(draft.items,current:current);try current()
                    let old=try queue.load(account:session.account).contains{$0.path=="orders"}
                    let body:[String:Any]=["StoreID":store,"Items":draft.items.map{["ProductID":$0.productID,"VariantID":$0.variantID,"Quantity":$0.quantity] as [String:Any]},"CartRevision":cartRevision,"Address":["Recipient":recipient,"Line1":address,"City":city,"Country":country]]
                    let item=try queue.prepare(account:session.account,path:"orders",input:body)
                    try journey.checkoutPrepared(session.account,item:item,existing:old)
                    guard let input=try JSONSerialization.jsonObject(with:item.body) as? [String:Any] else{throw ShopError.security}
                    let result=try await api.raw("orders",json:input,beforeDispatch:{try current();try self.journey.checkoutDispatch(session.account,item:item)})
                    try check();let order=try AppleBuyerReceipt.decode(result,account:session.account)
                    try journey.checkoutConfirmed(session.account,item:item,order:order);try queue.confirmed(item)
                    cart=try journey.load(session.account).items;checkoutResult=order;await loadOrders()
                }catch{failure(error)}
            }
        }catch{failure(error)}
    }
    func recoverCheckout(){guard signedIn,!mutationBusy else{return};mutationBusy=true;let revision=operationRevision;Task{defer{if revision==operationRevision{mutationBusy=false;refreshCheckoutRecovery();refreshOrderRecoveries()}};do{let check=try api.capture();guard let account=api.currentSession?.account,let item=try queue.load(account:account).first(where:{$0.path=="orders"}),let body=try JSONSerialization.jsonObject(with:item.body) as? [String:Any],let key=body["IdempotencyKey"] as? String else{throw ShopError.unresolvedMutation};let result=try await api.raw("orders/intent-lookup",json:["IdempotencyKey":key]);try check();let order=try AppleBuyerReceipt.decode(result,account:account);try journey.checkoutConfirmed(account,item:item,order:order);try queue.confirmed(item);cart=try journey.load(account).items;checkoutResult=order;await loadOrders()}catch{failure(error)}}}
    func beginOrderAction(_ order:Order,_ action:String,title:String){
        guard signedIn,!mutationBusy,let session=api.currentSession else{return}
        do{_ = try api.capture();try AppleBuyerReceipt.validate(order,account:session.account);guard orderRecoveryState(order)=="none",action != "cancelled" || canCancelOrder(order),BuyerOrderActionInput.allowed(order.status,action) else{throw ShopError.invalidResponse};cancelInvoicePresentation();orderActionPresentation=OrderActionPresentation(order:order,action:action,title:title,session:session,revision:operationRevision)}catch{failure(error)}
    }
    func submitOrderAction(_ presentation:OrderActionPresentation,rating:Int,reason:String,detail:String)->Bool {
        guard orderActionPresentation?.id==presentation.id,api.currentSession==presentation.session,operationRevision==presentation.revision,signedIn,!mutationBusy else{orderActionPresentation=nil;return false}
        do{let check=try api.capture();try check();guard try !queue.load(account:presentation.session.account).contains(where:{$0.path=="orders/\(presentation.order.orderID)/transition"}) else{state="order_request_pending";return false};try AppleBuyerReceipt.validate(presentation.order,account:presentation.session.account);let input=try BuyerOrderActionInput.build(status:presentation.order.status,action:presentation.action,rating:rating,reason:reason,detail:detail);mutation(path:"orders/\(presentation.order.orderID)/transition",input:input){value in guard value["ID"] as? String==presentation.order.orderID else{throw ShopError.security}};if mutationBusy{orderActionPresentation=nil;return true};return false}catch{state="order_input_required";return false}
    }
    func checkPayment(_ order:Order){
        guard signedIn,!mutationBusy else{return}
        do{
            let check=try api.capture();guard let session=api.currentSession else{throw ShopError.signedOut}
            try AppleBuyerReceipt.validate(order,account:session.account)
            let at=operationRevision;mutationBusy=true
            Task{defer{if at==operationRevision{mutationBusy=false;refreshOrderRecoveries()}}
                do{try check();try await api.confirmOriginalPayment(order,beforeDispatch:check);try check();await resumeOriginalOrder();try check();let fresh=await readOrders();try check();if fresh,let observed=orders.first(where:{$0.orderID==order.orderID}){acceptExplicitReconciliationQuery(order,observed)}}
                catch{guard at==operationRevision else{return};do{try check()}catch{return};failure(error)}
            }
        }catch{failure(error)}
    }
    // Cached local recovery projection. SwiftUI rendering never reads Vault or
    // requests a proof. UNKNOWN metadata is refreshed at actual model events.
    func orderRecoveryState(_ order:Order)->String{orderRecoveryStates[order.orderID] ?? "none"}
    func canRetryPreparedOrder(_ order:Order)->Bool{preparedTransitionOrders.contains(order.orderID)}
    func canCancelOrder(_ order:Order)->Bool{order.localCancellationBlocked != true && order.status=="payment_pending" && !(order.payIntentID ?? "").hasPrefix("npi_") && !nativeBoundOrderIDs.contains(order.orderID) && orderRecoveryState(order)=="none"}
    private func refreshOrderRecoveries(){
        guard signedIn,let session=api.currentSession,session==presentedSession else{orderRecoveryStates=[:];preparedTransitionOrders=[];nativeBoundOrderIDs=[];return}
        do{
            let pending=try queue.load(account:session.account),native=try nativeInvoices.records(session.account)
            var states:[String:String]=[:],prepared=Set<String>()
            for order in orders{
                if let item=pending.first(where:{$0.path=="orders/\(order.orderID)/transition"}){let phase=try queue.dispatchPhase(item);states[order.orderID]=phase=="prepared" ? "prepared":"unknown";if phase=="prepared"{prepared.insert(order.orderID)}}
                else if let original=native[order.orderID],original.phase != "reference"{states[order.orderID]=original.phase=="prepared" ? "prepared":"unknown"}
            }
            orderRecoveryStates=states;preparedTransitionOrders=prepared;nativeBoundOrderIDs=Set(native.values.filter{$0.phase != "prepared"}.map{$0.orderID})
        }catch{orderRecoveryStates=Dictionary(uniqueKeysWithValues:orders.map{($0.orderID,"unavailable")})}
    }
    private func readNativeInvoice(_ original:NativeInvoicePreparationJournal.Record,check:@escaping ()throws->Void)async throws->NativeInvoicePreparationJournal.Record {
        guard original.phase != "prepared" else{throw ShopError.unresolvedMutation}
        let path="orders/\(original.orderID)/native-pay-intent"
        let needsLookup=original.phase=="unknown"
        let result=try await api.raw(path+(needsLookup ? "-lookup":""),method:needsLookup ? "POST":"GET",json:needsLookup ? ["IdempotencyKey":original.key]:[:],beforeDispatch:check)
        try check()
        return try nativeInvoices.observed(original,result:result)
    }
    func recoverOrder(_ order:Order){
        guard signedIn,!mutationBusy else{return}
        do{
            let check=try api.capture();guard let session=api.currentSession else{throw ShopError.signedOut}
            try AppleBuyerReceipt.validate(order,account:session.account)
            let at=operationRevision;mutationBusy=true
            Task{defer{if at==operationRevision{mutationBusy=false;refreshOrderRecoveries()}}
                do{
                    try check()
                    let matching=try queue.load(account:session.account).filter{$0.path=="orders/\(order.orderID)/transition"}
                    for item in matching{
                        // The query endpoint returns the original retained
                        // result. A never-dispatched prepared action is not sent.
                        guard try queue.dispatchPhase(item) != "prepared" else{throw ShopError.unresolvedMutation}
                        guard let body=try JSONSerialization.jsonObject(with:item.body) as? [String:Any] else{throw ShopError.security}
                        let value=try await api.raw(item.path+"-intent-lookup",json:body,beforeDispatch:check);try check()
                        _ = try BuyerTransitionRecovery.receipt(value,session:session,item:item)
                        try queue.confirmedTracked(item)
                    }
                    if let original=try nativeInvoices.records(session.account)[order.orderID],original.phase != "prepared"{_ = try await readNativeInvoice(original,check:check)}
                    try check()
                    let refreshed=await readOrders()
                    try check()
                    if refreshed{state=""}
                }catch{guard at==operationRevision else{return};do{try check()}catch{return};failure(error)}
            }
        }catch{failure(error)}
    }
    func retryPreparedOrder(_ order:Order){
        guard signedIn,!mutationBusy else{return}
        do{
            let check=try api.capture();guard let session=api.currentSession else{throw ShopError.signedOut}
            try AppleBuyerReceipt.validate(order,account:session.account)
            guard let item=try queue.load(account:session.account).first(where:{$0.path=="orders/\(order.orderID)/transition"}),try queue.dispatchPhase(item)=="prepared",let body=try JSONSerialization.jsonObject(with:item.body) as? [String:Any] else{throw ShopError.unresolvedMutation}
            let at=operationRevision;mutationBusy=true
            Task{defer{if at==operationRevision{mutationBusy=false;refreshOrderRecoveries()}}
                do{try check();let value=try await api.raw(item.path,method:item.method,json:body,beforeDispatch:{try check();try self.queue.beginDispatch(item)});try check();let observed=try AppleBuyerReceipt.decode(value,account:session.account);guard observed.orderID==order.orderID else{throw ShopError.security};try queue.confirmedTracked(item);await loadOrders();try check();state=""}
                catch{do{try queue.markUnknown(item)}catch{guard at==operationRevision else{return};failure(error);return};guard at==operationRevision else{return};do{try check()}catch{return};failure(error)}
            }
        }catch{failure(error)}
    }
    private func reconciliationSelection(_ order:Order)->[String]?{
        guard let payment=order.nativePayment else{return nil}
        return [order.orderID,order.buyer ?? "",order.storeID ?? "",order.payIntentID ?? "",order.invoiceID ?? "",order.payMerchant ?? "",order.payPayoutAddress ?? "",payment.InvoiceID,payment.SessionID,payment.TermsHash,payment.PrincipalAtoms]
    }
    private func acceptExplicitReconciliationQuery(_ previous:Order,_ observed:Order){
        guard previous.orderID==observed.orderID,previous.payIntentID==observed.payIntentID,previous.invoiceID==observed.invoiceID,previous.payMerchant==observed.payMerchant,previous.payPayoutAddress==observed.payPayoutAddress,let old=previous.nativePayment,let fresh=observed.nativePayment,old.InvoiceID==fresh.InvoiceID,old.SessionID==fresh.SessionID,old.TermsHash==fresh.TermsHash,old.PrincipalAtoms==fresh.PrincipalAtoms,(try? fresh.validate(observed,requirePaid:false)) != nil else{return}
        for hash in old.PendingOriginals ?? [] where (fresh.PendingOriginals ?? []).contains(hash){let key=previous.orderID+"\n"+hash;if attemptedReconciliations[key]==reconciliationSelection(previous),attemptedReconciliations[key]==reconciliationSelection(observed){attemptedReconciliations.removeValue(forKey:key)}}
    }
    func canReconcilePayment(_ order:Order,nativeHash:String)->Bool{
        signedIn && attemptedReconciliations[order.orderID+"\n"+nativeHash]==nil && (order.nativePayment?.PendingOriginals ?? []).contains(nativeHash) && NativeWire.matches(nativeHash,"^0x[a-f0-9]{64}$")
    }
    // Explicit reconciliation of an already retained native hash. Foreground
    // restore, ordinary invoice queries and UNKNOWN recovery never invoke it.
    func reconcilePayment(_ order:Order,nativeHash:String){
        guard signedIn,!mutationBusy else{return}
        do{
            let check=try api.capture();guard let session=api.currentSession else{throw ShopError.signedOut}
            try AppleBuyerReceipt.validate(order,account:session.account)
            guard canReconcilePayment(order,nativeHash:nativeHash),let payment=order.nativePayment,(payment.PendingOriginals ?? []).contains(nativeHash),let operation=order.payIntentID,NativeWire.matches(operation,"^npi_[a-f0-9]{48}$"),NativeWire.matches(nativeHash,"^0x[a-f0-9]{64}$") else{throw ShopError.unresolvedMutation}
            try payment.validate(order,requirePaid:false)
            attemptedReconciliations[order.orderID+"\n"+nativeHash]=reconciliationSelection(order)
            let at=operationRevision;mutationBusy=true
            Task{defer{if at==operationRevision{mutationBusy=false;refreshOrderRecoveries()}}
                do{
                    try check();var originalError:Error?
                    do{try await api.reconcileOriginalNativeOperation(operation,orderID:order.orderID,nativeHash:nativeHash)}catch{originalError=error}
                    try check()
                    // Even a lost reconciliation reply recovers through the
                    // independently verified original archive, never by send.
                    do{try await api.confirmOriginalPayment(order,beforeDispatch:check)}catch{if originalError==nil{originalError=error}}
                    try check();await loadOrders();try check()
                    if let originalError{failure(originalError)}else{state=""}
                }catch{guard at==operationRevision else{return};do{try check()}catch{return};failure(error)}
            }
        }catch{failure(error)}
    }
    func reviewPayment(_ order:Order){
        guard signedIn,!mutationBusy else{return}
        do{
            let check=try api.capture();guard let session=api.currentSession else{throw ShopError.signedOut}
            try AppleBuyerReceipt.validate(order,account:session.account)
            guard order.status=="payment_pending",let operation=order.payIntentID,NativeWire.matches(operation,"^npi_[a-f0-9]{48}$"),orderRecoveryState(order)=="none" else{throw ShopError.unresolvedMutation}
            let at=operationRevision;mutationBusy=true
            Task{defer{if at==operationRevision{mutationBusy=false;refreshOrderRecoveries()}}
                do{try check();_ = try await api.reviewOriginalNativePayment(operation,orderID:order.orderID);try check();state="native_main_review_pending"}
                catch{guard at==operationRevision else{return};do{try check()}catch{return};failure(error)}
            }
        }catch{failure(error)}
    }

    func pay(_ order:Order){guard signedIn,!mutationBusy else{return};if api.nativeInvoiceMode && ((order.payIntentID ?? "").isEmpty || (order.payIntentID ?? "").hasPrefix("npi_")){prepareNativeInvoice(order);return};if (order.payIntentID ?? "").hasPrefix("npi_"){checkPayment(order);return};do{let authorization=try api.capture(),presentation=handoffPresentationRevision;let check:()throws->Void={try authorization();guard presentation==self.handoffPresentationRevision else{throw ShopError.contextChanged}};guard let session=api.currentSession else{throw ShopError.signedOut};try AppleBuyerReceipt.validate(order,account:session.account);let legacy=try queue.originalHandoff(account:session.account,path:"orders/\(order.orderID)/pay-handoff");let originalKey=try legacy.map{try JSONSerialization.jsonObject(with:$0.body) as? [String:Any]}.flatMap{$0?["IdempotencyKey"] as? String};let existed=try invoiceHandoffs.existing(account:session.account,order:order);let original=try invoiceHandoffs.prepare(account:session.account,order:order,originalKey:originalKey);let review=try journey.prepareReview(session.account,order:order,original:original,existing:existed || legacy != nil);mutationBusy=true;let revision=operationRevision;Task{defer{if revision==operationRevision{mutationBusy=false;refreshCheckoutRecovery();refreshOrderRecoveries()}};do{let create=review.phase=="prepared";let result=try await api.raw("orders/\(original.orderID)/pay-handoff",method:create ? "POST":"GET",json:create ? ["IdempotencyKey":original.record.key]:[:],beforeDispatch:{try check();if create{try self.journey.reviewDispatch(session.account,review:review)}});try check();guard presentation==handoffPresentationRevision else{return};let url=try invoiceHandoffs.reviewURL(original,response:result);let received=try journey.reviewReceived(session.account,review:review,response:result,url:url);invoicePresentation=InvoicePresentation(review:received,session:session,revision:presentation,url:url)}catch{do{try check()}catch{return};failure(error)}}}catch{failure(error)}}
    func prepareNativeInvoice(_ order:Order){
        guard signedIn,!mutationBusy else{return}
        do{
            let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut}
            let legacy=try invoiceHandoffs.existing(account:account,order:order) || queue.originalHandoff(account:account,path:"orders/\(order.orderID)/pay-handoff") != nil
            let original=try nativeInvoices.prepare(order,account:account,legacyPending:legacy)
            mutationBusy=true;let revision=operationRevision,presentation=handoffPresentationRevision
            Task{defer{if revision==operationRevision{mutationBusy=false;refreshOrderRecoveries()}};do{
                let current:()throws->Void={try check();guard presentation==self.handoffPresentationRevision else{throw ShopError.contextChanged}}
                let retained:NativeInvoicePreparationJournal.Record
                if original.phase=="prepared" {
                    let result=try await api.raw("orders/\(original.orderID)/native-pay-intent",json:["IdempotencyKey":original.key],beforeDispatch:{try current();try self.nativeInvoices.dispatched(original)})
                    try current()
                    retained=try nativeInvoices.observed(original,result:result)
                }else{
                    retained=try await readNativeInvoice(original,check:current)
                }
                guard let operation=retained.originalOperation else{throw ShopError.security}
                // The reference is durable before crossing into original Main.
                // Missing Main navigation preserves it for explicit later use.
                do{try await api.openOriginalNativePay(operation,orderID:original.orderID);try current()}
                catch{let originalError=error;try current();await loadOrders();try current();throw originalError}
                _ = try await readNativeInvoice(retained,check:current);try current();await loadOrders()
            }catch{guard revision==operationRevision,presentation==handoffPresentationRevision else{return};do{try check()}catch{return};failure(error)}}
        }catch{failure(error)}
    }
    func resumeNativeInvoiceReferences()async {
        // Foreground/identity recovery must not race the original dispatch.
        // Its durable UNKNOWN record belongs to the active mutation until that
        // request completes; a later resume may query that same original key.
        guard signedIn,!mutationBusy else{return}
        mutationBusy=true;let revision=operationRevision
        defer{if revision==operationRevision{mutationBusy=false;refreshOrderRecoveries()}}
        do{let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut}
            for original in try nativeInvoices.records(account).values where original.phase != "prepared" {
                _ = try await readNativeInvoice(original,check:check)
            }
        }catch{guard revision==operationRevision else{return};failure(error)}
    }
    func openReviewedInvoice(){guard let presentation=invoicePresentation else{return};invoicePresentation=nil;Task{do{let check=try api.capture();guard api.currentSession==presentation.session,presentation.revision==handoffPresentationRevision else{throw ShopError.contextChanged};try await api.reviewInvoice(presentation.url,expected:presentation.session);try check();try journey.reviewOpened(presentation.session.account,review:presentation.review);state="payment_pending"}catch{failure(error)}}}
    func resumeOriginalOrder()async {guard signedIn else{return};do{let check=try api.capture();guard let account=api.currentSession?.account,let review=try journey.load(account).review else{return};let value=try await api.raw("orders/\(review.original.orderID)",method:"GET",json:[:]);try check();let order=try AppleBuyerReceipt.decode(value,account:account);try journey.observed(account,order:order,journal:invoiceHandoffs);await loadOrders()}catch{failure(error)}}
    func retryPending(){
        guard signedIn,!mutationBusy else{return};mutationBusy=true;let revision=operationRevision,view=handoffPresentationRevision
        Task{defer{if revision==operationRevision{mutationBusy=false;refreshCheckoutRecovery();refreshOrderRecoveries()}};do{let authorization=try api.capture();let check:()throws->Void={try authorization();guard view==self.handoffPresentationRevision else{throw ShopError.contextChanged}};guard let session=api.currentSession else{throw ShopError.signedOut};let originals=try queue.load(account:session.account)
            for item in originals{try check();guard let body=try JSONSerialization.jsonObject(with:item.body) as? [String:Any] else{throw ShopError.security}
                if item.path.hasSuffix("/transition"){do{if try queue.dispatchPhase(item)=="prepared"{let result=try await api.raw(item.path,method:item.method,json:body,beforeDispatch:{try check();try self.queue.beginDispatch(item)});try check();let order=try AppleBuyerReceipt.decode(result,account:session.account);guard item.path=="orders/\(order.orderID)/transition" else{throw ShopError.security}}else{let result=try await api.raw(item.path+"-intent-lookup",json:body,beforeDispatch:{try check()});try check();_ = try BuyerTransitionRecovery.receipt(result,session:session,item:item)};try queue.confirmedTracked(item)}catch{try queue.markUnknown(item);throw error}}
                else if item.path=="orders"{guard let key=body["IdempotencyKey"] as? String else{throw ShopError.security};let result=try await api.raw("orders/intent-lookup",json:["IdempotencyKey":key],beforeDispatch:{try check()});try check();let order=try AppleBuyerReceipt.decode(result,account:session.account);try journey.checkoutConfirmed(session.account,item:item,order:order);try queue.confirmed(item);cart=try journey.load(session.account).items}
            };await loadOrders();state=""
        }catch{failure(error)}}
    }
    private func clearProfilePresentation(){profileName="";profileRecipient="";profileAddress="";profileCity="";profileCountry=""}
    func loadProfile(){guard signedIn else{return};Task{do{let check=try api.capture();let value=try await api.raw("profile",method:"GET",json:[:]);try check();guard let profile=value["profile"] as? [String:Any] else{throw ShopError.invalidResponse};let address=(profile["Addresses"] as? [[String:Any]])?.first ?? [:];profileName=profile["DisplayName"] as? String ?? "";profileRecipient=address["Recipient"] as? String ?? "";profileAddress=address["Line1"] as? String ?? "";profileCity=address["City"] as? String ?? "";profileCountry=address["Country"] as? String ?? ""}catch{failure(error)}}}
    func saveProfile(){guard signedIn,!mutationBusy else{return};let input:[String:Any]=["DisplayName":profileName,"Addresses":[["Recipient":profileRecipient,"Line1":profileAddress,"City":profileCity,"Country":profileCountry]]];mutationBusy=true;let revision=operationRevision;Task{defer{if revision==operationRevision{mutationBusy=false;refreshCheckoutRecovery();refreshOrderRecoveries()}};do{let check=try api.capture();_ = try await api.raw("profile",method:"PUT",json:input);try check();state="profile_saved"}catch{failure(error)}}}
    func exportPrivacyData(){guard signedIn else{signIn();return};Task{do{let check=try api.capture();let data=try await api.data("privacy/export");try check();let url=FileManager.default.temporaryDirectory.appendingPathComponent("ynx-shop-data-\(UUID().uuidString).json");try data.write(to:url,options:.atomic);try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path);privacyExportURL=url;state="privacy_export_ready"}catch{failure(error)}}}
    func deletePrivacyData(_ confirmation:String){guard signedIn else{signIn();return};guard confirmation=="DELETE_MY_SHOP_DATA" else{state="privacy_exact_required";return};guard !mutationBusy else{state="queued_offline";return};mutationBusy=true;let revision=operationRevision;Task{defer{if revision==operationRevision{mutationBusy=false;refreshCheckoutRecovery();refreshOrderRecoveries()}};do{let check=try api.capture();guard let account=api.currentSession?.account,try !queue.hasPending(account:account),try !invoiceHandoffs.hasPending(account:account),try nativeInvoices.records(account).isEmpty,try comparisonJournal.active(account)==nil,try journey.deletionPermitted(account) else{throw ShopError.unresolvedMutation};_ = try await api.raw("privacy/delete",json:["confirmation":confirmation]);try check();try comparisonJournal.redactCompleted(account);try journey.deletedDraft(account);clearProfilePresentation();cart=[];orders=[];checkoutResult=nil;if let url=privacyExportURL{try? FileManager.default.removeItem(at:url)};privacyExportURL=nil;privacyRevision+=1;state="privacy_deleted"}catch{if let error=error as? ShopError,error == .contextChanged || error == .signedOut{failure(error)}else{state="privacy_delete_failed"}}}}
    // An AI comparison is a disclosure proposal first. It is never a Task Grant,
    // spending allowance, order, or payment approval.
    func runAI(workflow:String,summary:String){guard workflow=="search_comparison" else{state="unavailable";return};prepareComparison()}
    func prepareComparison(ids:[String]=[]) {
        guard !agentBusy else{return}
        // An unresolved original owns its disclosure context until reconciled.
        // Reopening comparison must never put a new selection around an old job.
        if let account=api.currentSession?.account {
            do {if let original=try comparisonJournal.active(account) {
                agentPresentation=original.phase=="prepared" ? AgentComparisonPresentation(id:original.key,query:"",contextSummary:original.contextSummary,products:[]):nil
                publishComparison(original);agentWorkspaceVisible=true;return
            }} catch {failure(error);return}
        }
        let selected=ids.isEmpty ? Array(products.prefix(3)):products.filter{ids.contains($0.productID)}
        if selected.isEmpty && ids.isEmpty {
            agentRevision+=1;agentActiveKey=nil;agentJob=nil
            agentPresentation=AgentComparisonPresentation(id:UUID().uuidString,query:search,contextSummary:"",products:[])
            agentPhase="proposal";agentWorkspaceVisible=true;return
        }
        guard !selected.isEmpty,selected.count<=3,Set(selected.map(\.productID)).count==selected.count,ids.isEmpty || Set(ids)==Set(selected.map(\.productID)) else{state="empty_catalog";return}
        var context="Public catalog comparison; outputLanguage="+aiLanguage+"\n"
        for product in selected {
            context+="product="+product.productID+"; title="+product.name+"\n"
            for variant in product.variants.prefix(8) {context+="sku="+variant.variantID+"; priceYNXT="+String(variant.priceYNXT)+"; available="+String(variant.available)+"\n"}
        }
        guard context.utf8.count<=2000 else{state="unavailable";return}
        agentRevision+=1;agentActiveKey=nil;agentJob=nil
        agentPresentation=AgentComparisonPresentation(id:UUID().uuidString,query:search,contextSummary:context,products:selected)
        agentPhase="proposal";agentWorkspaceVisible=true
    }
    private func clearAgentPresentation(){agentWorkspaceVisible=false;agentRevision+=1;agentBusy=false;agentActiveKey=nil;agentPresentation=nil;agentJob=nil;agentJobs=[];agentPhase="proposal"}
    private func comparisonRecord()throws->ShopComparisonJournal.Record {
        guard let account=api.currentSession?.account else{throw ShopError.signedOut}
        if let key=agentActiveKey,let record=try comparisonJournal.records(account)[key]{return record}
        guard let original=try comparisonJournal.active(account) else{throw ShopError.unavailable};agentActiveKey=original.key;return original
    }
    private func publishComparison(_ record:ShopComparisonJournal.Record){agentActiveKey=record.key;agentJob=record.job;agentPhase=record.phase;if let job=record.job{agentJobs.removeAll{$0.jobID==job.jobID};agentJobs.insert(job,at:0)}}
    func authorizeComparison(){
        guard !agentBusy,let proposal=agentPresentation,signedIn,!localDataLocked else{state="wallet_sign_in";return}
        agentBusy=true;let generation=agentRevision
        Task{defer{if generation==agentRevision{agentBusy=false}};do{
            let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut}
            guard !proposal.contextSummary.isEmpty else{throw ShopError.security}
            let original=try comparisonJournal.prepare(account:account,summary:proposal.contextSummary);agentActiveKey=original.key
            guard original.phase=="prepared" else{publishComparison(original);throw ShopError.unresolvedMutation}
            let input=try comparisonJournal.input(original)
            let value=try await api.raw("ai/jobs",json:input,beforeDispatch:{try check();guard generation==self.agentRevision else{throw ShopError.contextChanged};try self.comparisonJournal.dispatch(original,phase:"creation_unknown")})
            try check();let job=try JSONDecoder().decode(ShopAgentJob.self,from:CanonicalJSON.data(value));let record=try comparisonJournal.observe(original,job:job)
            guard generation==agentRevision else{return};publishComparison(record)
        }catch{guard generation==agentRevision else{return};if let record=try? comparisonRecord(){publishComparison(record)};failure(error)}}
    }
    func selectComparisonJob(_ job:ShopAgentJob){
        do{guard let account=api.currentSession?.account else{throw ShopError.signedOut};try job.validate(account:account)
            agentRevision+=1;agentPresentation=nil;agentJob=job
            if let record=try comparisonJournal.records(account).values.first(where:{$0.jobID==job.jobID}){publishComparison(record)}
            else{agentActiveKey=nil;agentPhase="history_read_only"}
        }catch{failure(error)}
    }
    func discardPreparedComparison(){
        guard !agentBusy,signedIn else{return}
        do{let original=try comparisonRecord();let record=try comparisonJournal.discardPrepared(original);agentPresentation=nil;publishComparison(record)}catch{failure(error)}
    }
    func runComparison(){
        guard !agentBusy,signedIn else{return};agentBusy=true;let generation=agentRevision
        Task{defer{if generation==agentRevision{agentBusy=false}};do{
            let check=try api.capture();let original=try comparisonRecord();guard original.phase=="permission_granted",let id=original.jobID else{throw ShopError.unresolvedMutation}
            let value=try await api.raw("ai/jobs/"+id+"/run",json:[:],beforeDispatch:{try check();guard generation==self.agentRevision else{throw ShopError.contextChanged};try self.comparisonJournal.dispatch(original,phase:"run_unknown")})
            try check();let job=try JSONDecoder().decode(ShopAgentJob.self,from:CanonicalJSON.data(value));let record=try comparisonJournal.observe(original,job:job)
            guard generation==agentRevision else{return};publishComparison(record)
        }catch{guard generation==agentRevision else{return};if let record=try? comparisonRecord(){publishComparison(record)};failure(error)}}
    }
    func refreshComparison(){
        guard !agentBusy,signedIn else{return};agentBusy=true;let generation=agentRevision
        Task{defer{if generation==agentRevision{agentBusy=false}};do{
            let check=try api.capture();guard let account=api.currentSession?.account else{throw ShopError.signedOut}
            if let original=try comparisonJournal.active(account) {
                let job:ShopAgentJob
                if let id=original.jobID{job=try await api.request("ai/jobs/"+id)}
                else {
                    let value=try await api.raw("ai/jobs/intent-lookup",json:comparisonJournal.input(original))
                    let lookup=try JSONDecoder().decode(ShopAgentLookupResponse.self,from:CanonicalJSON.data(value))
                    guard lookup.Actor==account,lookup.IdempotencyKey==original.key,lookup.QueryOnly else{throw ShopError.security};job=lookup.Job
                }
                try check();let record=try comparisonJournal.observe(original,job:job,authoritativeRead:true);guard generation==agentRevision else{return};publishComparison(record)
            }
            let response:ShopAgentJobsResponse=try await api.request("ai/jobs");try check();guard response.Limit==50,response.jobs.count<=50 else{throw ShopError.security}
            var jobs:[ShopAgentJob]=[]
            for job in response.jobs where job.workflow=="search_comparison" && job.contextClasses==["public_catalog"]{try job.validate(account:account);jobs.append(job)}
            guard generation==agentRevision else{return};agentJobs=jobs
        }catch{guard generation==agentRevision else{return};if let record=try? comparisonRecord(){publishComparison(record)};failure(error)}}
    }
    func decideComparison(apply:Bool){
        guard !agentBusy,signedIn else{return};agentBusy=true;let generation=agentRevision
        Task{defer{if generation==agentRevision{agentBusy=false}};do{
            let check=try api.capture();let original=try comparisonRecord();guard original.phase=="review_required",let id=original.jobID else{throw ShopError.unresolvedMutation};let choice=apply ? "apply":"reject"
            let value=try await api.raw("ai/jobs/"+id+"/decision",json:["Decision":choice],beforeDispatch:{try check();guard generation==self.agentRevision else{throw ShopError.contextChanged};try self.comparisonJournal.dispatch(original,phase:"decision_unknown",action:choice)})
            try check();let job=try JSONDecoder().decode(ShopAgentJob.self,from:CanonicalJSON.data(value));let record=try comparisonJournal.observe(original,job:job)
            guard generation==agentRevision else{return};publishComparison(record)
        }catch{guard generation==agentRevision else{return};if let record=try? comparisonRecord(){publishComparison(record)};failure(error)}}
    }
    func cancelComparison(){
        guard signedIn else{return}
        // Cancellation can race an in-flight provider call, but cannot erase its
        // original reference or claim an already executed effect was undone.
        agentRevision+=1;let generation=agentRevision;agentBusy=true
        Task{defer{if generation==agentRevision{agentBusy=false}};do{
            let check=try api.capture();let original=try comparisonRecord();guard let id=original.jobID else{throw ShopError.unresolvedMutation}
            let value=try await api.raw("ai/jobs/"+id+"/cancel",json:[:],beforeDispatch:{try check();guard generation==self.agentRevision else{throw ShopError.contextChanged};try self.comparisonJournal.dispatch(original,phase:"cancel_unknown")})
            try check();let job=try JSONDecoder().decode(ShopAgentJob.self,from:CanonicalJSON.data(value));let record=try comparisonJournal.observe(original,job:job)
            guard generation==agentRevision else{return};publishComparison(record)
        }catch{guard generation==agentRevision else{return};if let record=try? comparisonRecord(){publishComparison(record)};failure(error)}}
    }
}
