import Foundation

@MainActor final class StartupAuthority:AppleNativeAuthority {
    var current:ShopSession?
    var restores=0,connections=0,disconnects=0
    var returned:[URL]=[]
    func restore()async throws{restores+=1}
    func connect()async throws{connections+=1;throw ShopError.unavailable}
    func disconnect()throws{disconnects+=1}
    func handleReturn(_ url:URL)async throws{returned.append(url);throw ShopError.unavailable}
    func proof(method:String,path:String,body:String,expected:ShopSession)async throws->[String:Any]{throw ShopError.security}
}
final class StartupPublicHTTP:URLProtocol,@unchecked Sendable {
    @MainActor static var reads=0
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Task{@MainActor in
        precondition(["/api/products","/api/products/p"].contains(request.url?.path ?? ""))
        precondition(request.value(forHTTPHeaderField:"X-YNX-Product-Session-Proof-V2")==nil)
        Self.reads+=1
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:nil)!,cacheStoragePolicy:.notAllowed)
        let body=request.url?.path=="/api/products" ? "{\"products\":[]}" : "{\"ID\":\"p\",\"StoreID\":\"s\",\"Title\":\"Original\",\"Variants\":[{\"ID\":\"v\",\"Name\":\"Original\",\"PriceYNXT\":1,\"Inventory\":20}]}"
        client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)
    }}
    override func stopLoading(){}
}
@main struct LocalStorageStartupChecks {
    @MainActor static func main()async throws {
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};print("PASS "+name)}
        var factories=0,reads=0,writes=0,allowRead=false
        let authority=StartupAuthority(),configuration=URLSessionConfiguration.ephemeral
        configuration.protocolClasses=[StartupPublicHTTP.self]
        let api=APIClient(session:URLSession(configuration:configuration),authorityFactory:{factories+=1;return authority})
        try check(factories==0,"normal API initialization opens no protected authority")
        do{try await api.restoreNative();throw NSError(domain:"unexpected cold authority",code:1)}catch ShopError.unavailable{}
        try check(factories==0,"cold restore cannot trigger OS authentication")
        let original=Data("[{\"ProductID\":\"p\",\"VariantID\":\"v\",\"Quantity\":3}]".utf8)
        var saved=["apple-buyer-guest-cart-v1":original,"original-UNKNOWN":Data("retained-unknown".utf8)]
        let preserved=saved
        let journey=AppleBuyerJourney(read:{key in reads+=1;guard allowRead else{throw ShopError.security};return saved[key]},write:{key,value in writes+=1;saved[key]=value})
        let model=ShopModel(api:api,queue:OfflineQueue(read:{nil},write:{_ in},readPhase:{nil},writePhase:{_ in}),invoiceHandoffs:InvoiceHandoffJournal(read:{_ in nil},write:{_,_ in}),journey:journey,localDataInitiallyLocked:true)
        try check(model.localDataLocked && reads==0 && writes==0,"locked Model initialization never reads or replaces the old cart")
        for _ in 0..<100_000{if model.state=="empty_catalog"{break};await Task.yield()}
        try check(model.state=="empty_catalog" && StartupPublicHTTP.reads==1 && reads==0 && factories==0,"public catalog remains usable while protected storage is locked")
        let product=try JSONDecoder().decode(Product.self,from:Data("{\"ID\":\"p\",\"StoreID\":\"s\",\"Title\":\"Original\",\"Variants\":[{\"ID\":\"v\",\"Name\":\"Original\",\"PriceYNXT\":1,\"Inventory\":20}]}".utf8))
        model.add(product,product.variants[0])
        try check(model.cart.isEmpty && writes==0 && saved==preserved,"editing a locked presentation cannot overwrite original cart or UNKNOWN")
        model.unlockLocalData()
        try check(model.localDataLocked && writes==0 && saved==preserved,"denied user unlock retains locked state and original bytes")
        do{try journey.editGuest([]);throw NSError(domain:"unexpected denied write",code:1)}catch ShopError.security{}
        try check(writes==0 && saved==preserved,"guest writes require a readable original record before replacement")
        allowRead=true;model.unlockLocalData()
        try check(!model.localDataLocked && model.cart.first?.quantity==3 && writes==0,"explicit permitted unlock restores the original cart without a write")
        try check(api.currentSession==nil && factories==0,"local data unlock grants no Native or Wallet authority")
        await model.refreshProduct("p")
        model.add(product,product.variants[0])
        try check(model.cart.first?.quantity==4 && writes==1 && saved["original-UNKNOWN"]==preserved["original-UNKNOWN"],"subsequent user edit starts from restored original quantity and retains UNKNOWN")
        do{try await api.connectNative();throw NSError(domain:"unexpected approval",code:1)}catch ShopError.unavailable{}
        try check(factories==1 && authority.restores==1 && authority.connections==1 && api.currentSession==nil,"only explicit sign-in opens the original authority and refusal grants no session")
        do{let _:OrdersResponse=try await api.request("orders");throw NSError(domain:"unexpected private read",code:1)}catch ShopError.signedOut{}
        try check(StartupPublicHTTP.reads==2,"refused sign-in cannot dispatch a protected order read")
        try api.disconnectNative()
        try check(authority.disconnects==1 && saved["original-UNKNOWN"]==preserved["original-UNKNOWN"],"normal disconnect retains original recovery records")
        var returnFactories=0
        let returnAuthority=StartupAuthority()
        let returnAPI=APIClient(session:URLSession(configuration:configuration),authorityFactory:{returnFactories+=1;return returnAuthority})
        let returnModel=ShopModel(api:returnAPI,queue:OfflineQueue(read:{nil},write:{_ in},readPhase:{nil},writePhase:{_ in}),invoiceHandoffs:InvoiceHandoffJournal(read:{_ in nil},write:{_,_ in}),journey:journey,localDataInitiallyLocked:true)
        for _ in 0..<100_000{if returnModel.state=="empty_catalog"{break};await Task.yield()}
        let callback=URL(string:"ynxshop://wallet-auth/callback?state=original-return")!
        returnModel.walletCallback(callback)
        returnModel.walletCallback(URL(string:"ynxshop://wallet-auth/callback?state=replacement")!)
        try check(returnModel.nativeReturnPending && returnFactories==0 && returnAuthority.returned.isEmpty,"cold callback is retained without opening OS authentication or accepting replacement")
        returnModel.signIn();returnModel.signIn()
        for _ in 0..<100_000{if returnModel.state=="unavailable"{break};await Task.yield()}
        try check(returnFactories==1 && returnAuthority.returned==[callback] && returnAuthority.connections==0 && returnAuthority.restores==0,"explicit resume handles the one original callback without a replacement connect or duplicate dispatch")
        try check(returnModel.nativeReturnPending && !returnModel.signedIn && returnAPI.currentSession==nil,"failed original callback resume retains its reference and grants no authority")
        returnModel.signOut()
        try check(!returnModel.nativeReturnPending && saved["original-UNKNOWN"]==preserved["original-UNKNOWN"],"local sign-out retires the pending presentation without deleting durable recovery records")
        print("Actual Model/API locked-startup checks PASS; no real Keychain, Wallet, Source or funds used")
    }
}
