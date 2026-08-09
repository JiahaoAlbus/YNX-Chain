import SwiftUI

@main struct YNXVideoApp: App {
    @StateObject private var model = VideoModel()
    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(model).onOpenURL { model.handle(url: $0) }
        }
    }
}
