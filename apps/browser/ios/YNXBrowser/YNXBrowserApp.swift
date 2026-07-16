import SwiftUI

@main struct YNXBrowserApp: App {
    @StateObject private var model = BrowserModel()
    var body: some Scene {
        WindowGroup { BrowserScreen().environmentObject(model).environment(\.layoutDirection, model.locale == "ar" ? .rightToLeft : .leftToRight).onOpenURL { model.handleWalletCallback($0) } }
    }
}
