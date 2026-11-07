import Foundation
@main struct SellerConsumerChecks {
    @MainActor static func main()throws {
        var checks=0
        func check(_ value:Bool,_ name:String)throws{guard value else{throw NSError(domain:name,code:1)};checks+=1;print("PASS "+name)}
        func refused(_ name:String,_ action:()throws->Void)throws{do{try action()}catch is ShopError{try check(true,name);return};throw NSError(domain:name,code:2)}
        let key=NativeWire.base64(Data([2])+Data(repeating:0,count:32))
        var buyerBytes:Data?,sellerBytes:Data?
        let buyer=try AppleNativeProductState(platform:"macos",deviceId:"original-seller-device-01",deviceKey:key,securityLevel:"hardware-backed",read:{buyerBytes},write:{buyerBytes=$0})
        let seller=try AppleNativeProductState(platform:"macos",deviceId:"original-seller-device-01",deviceKey:key,securityLevel:"hardware-backed",profile:.seller,read:{sellerBytes},write:{sellerBytes=$0})
        let bc=try buyer.context(),sc=try seller.context()
        try check(try buyer.scope(bc) != seller.scope(sc),"same device and product still have distinct Buyer and Seller revocation scopes")
        try check(ShopAccessProfile.buyer.stateStorageKey != ShopAccessProfile.seller.stateStorageKey,"Seller protected state never replaces the original Buyer namespace")
        var request=seller.tuple();request.merge(["deviceId":"original-seller-device-01","deviceKey":key,"deviceAlgorithm":"p256-sha256","scopes":ShopAccessProfile.seller.scopes]){_,new in new}
        try seller.checkWalletRequest(request,sc)
        try refused("Buyer cannot request Seller scopes under its existing grant"){try buyer.checkWalletRequest(request,bc)}
        request["scopes"]=AppleNativeProductState.scopes
        try refused("Seller cannot adopt Buyer approval as its own grant"){try seller.checkWalletRequest(request,sc)}
        let originalBuyerIntent=try NativeWire.canonical(["version":1,"intentId":String(repeating:"i",count:43),"scope":buyer.scope(bc),"session":NSNull()])
        try refused("Seller cannot retire the Buyer original revocation intent"){_ = try seller.saveRevocationIntent("ynx.native-product-session.v2:"+String(repeating:"a",count:64),seller.root+":revoke",originalBuyerIntent,sc)}
        for (method,path) in [("GET","/api/seller/stores"),("GET","/api/orders"),("POST","/api/seller/inventory/batch"),("POST","/api/seller/stores/store_original/roles/member_original/native-revoke")] {
            try check(try AppleNativeBusinessPolicy.scopes(method,path,profile:.seller)==["account:read","shop:seller:operate"],"Seller route uses only its separate registered operations scopes")
            if path.hasPrefix("/api/seller/"){try refused("Buyer cannot borrow a Seller business route"){_ = try AppleNativeBusinessPolicy.scopes(method,path)}}
            else{try check(try AppleNativeBusinessPolicy.scopes(method,path)==AppleNativeProductState.scopes,"shared order read preserves the original Buyer scope set")}

        }
        for path in ["/api/orders","/api/orders/original/native-pay-intent","/api/privacy/delete","/api/seller/stores/../roles/member/native-revoke"] {
            try refused("Seller cannot create Buyer orders, payments, privacy effects or path aliases"){_ = try AppleNativeBusinessPolicy.scopes("POST",path,profile:.seller)}
        }
        var storage=["original-Pay-UNKNOWN":Data("retain original payment".utf8)],reads=0,allowWrite=true
        let sentinel=storage["original-Pay-UNKNOWN"]
        let journal=SellerMutationJournal(read:{reads+=1;return storage[$0]},write:{guard allowWrite else{throw ShopError.security};storage[$0]=$1})
        try check(reads==0,"Seller journal construction opens no protected data")
        let account="ynx1"+String(repeating:"q",count:38)
        let input:[String:Any]=["StoreID":"store_original","Items":[["ProductID":"p1","VariantID":"v1","ExpectedRevision":"1","Inventory":"9223372036854775807"]]]
        let original=try journal.prepare(account:account,storeID:"store_original",target:"p1",kind:"inventory",path:"/seller/inventory/batch",input:input)
        let same=try journal.prepare(account:account,storeID:"store_original",target:"p1",kind:"inventory",path:"/seller/inventory/batch",input:input)
        try check(original==same,"known unsent Seller request reuses exact original bytes and key")
        try journal.dispatch(original)
        let cold=SellerMutationJournal(read:{storage[$0]},write:{storage[$0]=$1})
        try check(try cold.records(account)[original.key]?.phase=="unknown" && CanonicalJSON.data(cold.input(original))==original.body,"cold Seller recovery preserves original UNKNOWN body and key")
        try refused("UNKNOWN Seller mutation cannot be sent a second time"){try cold.dispatch(original)}
        try refused("changed request cannot replace an UNKNOWN target"){_ = try cold.prepare(account:account,storeID:"store_original",target:"p1",kind:"inventory",path:"/seller/inventory/batch",input:["StoreID":"store_original","Items":[]])}
        let independent=try cold.prepare(account:account,storeID:"store_original",target:"p2",kind:"inventory",path:"/seller/inventory/batch",input:["StoreID":"store_original","Items":[]])
        try check(independent.key != original.key,"independent Seller target continues while another target is UNKNOWN")
        allowWrite=false
        try refused("failed durable Seller dispatch prevents an HTTP effect"){try journal.dispatch(independent)}
        try check(try cold.records(account)[independent.key]?.phase=="prepared","failed durable dispatch retains known unsent state")
        try check(storage["original-Pay-UNKNOWN"]==sentinel,"Seller profile and journals preserve unrelated original payment UNKNOWN")
        print("Seller consumer checks PASS \(checks); controlled state only, no real OS/Wallet/Source/funds")
    }
}
