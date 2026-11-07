import SwiftUI

@main struct YNXShopApp: App {
    @StateObject private var model = ShopModel()
    @StateObject private var seller = ShopSellerModel()
    @StateObject private var authorizationReturn = ShopAuthorizationReturnRouter()
    @AppStorage("shop-text-size") private var textSize="standard"
    @AppStorage("shop-color-scheme") private var themeChoice="system"
    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(model).environmentObject(seller).id(model.privacyRevision)
                .environment(\.shopTextScale,textSize=="compact" ? 0.925:textSize=="larger" ? 1.15:1)
                .preferredColorScheme(themeChoice=="dark" ? .dark:themeChoice=="light" ? .light:nil)
                .environment(\.locale, Locale(identifier: model.appLanguage))
                .environment(\.layoutDirection, model.appLanguage == "ar" ? .rightToLeft : .leftToRight)
                .sheet(isPresented:$seller.workspaceVisible){SellerWorkspaceView().environmentObject(seller).environmentObject(model)}
                .safeAreaInset(edge:.bottom){if authorizationReturn.original != nil{Button("restore_pending"){authorizationReturn.presented=true}.padding(12)}}
                .confirmationDialog("shop_authorization_receiver",isPresented:$authorizationReturn.presented,titleVisibility:.visible){
                    Button("shop_buyer_authorization"){authorizationReturn.chooseBuyer(model)}
                    Button("shop_seller_authorization"){authorizationReturn.chooseSeller(seller)}
                    Button("cancel",role:.cancel){}
                }
                .onOpenURL { url in
                    if url.scheme=="ynxshop",url.host=="wallet-auth",url.path=="/callback" {do{try authorizationReturn.receive(url)}catch{model.state="security_error"}}
                    else{model.walletCallback(url)}
                }
        }
    }
}
