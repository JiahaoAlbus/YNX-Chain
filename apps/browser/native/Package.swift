// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "YNXBrowserNative",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "YNXBrowserNative", targets: ["YNXBrowserNative"])],
    targets: [.executableTarget(name: "YNXBrowserNative")]
)
