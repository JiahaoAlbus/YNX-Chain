import SwiftUI

@main struct YNXShopApp: App {
    @StateObject private var model = ShopModel()
    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(model)
                .environment(\.locale, Locale(identifier: model.appLanguage))
                .environment(\.layoutDirection, model.appLanguage == "ar" ? .rightToLeft : .leftToRight)
                .onOpenURL { model.walletCallback($0) }
        }
    }
}
