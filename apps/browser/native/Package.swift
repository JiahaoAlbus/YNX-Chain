// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "YNXBrowserNative",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "YNXBrowserCore", targets: ["YNXBrowserCore"]),
        .executable(name: "YNXBrowserNative", targets: ["YNXBrowserNative"])
    ],
    targets: [
        .target(name: "YNXBrowserCore"),
        .executableTarget(name: "YNXBrowserNative", dependencies: ["YNXBrowserCore"]),
        .testTarget(name: "YNXBrowserCoreTests", dependencies: ["YNXBrowserCore"])
    ]
)
