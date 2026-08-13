// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "YNXWalletMac",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "YNXWalletMacCore", targets: ["YNXWalletMacCore"]),
    .executable(name: "YNXWalletMac", targets: ["YNXWalletMac"]),
    .executable(name: "YNXWalletMacSecurityProbe", targets: ["YNXWalletMacSecurityProbe"]),
  ],
  targets: [
    .target(name: "YNXWalletMacCore"),
    .executableTarget(name: "YNXWalletMac", dependencies: ["YNXWalletMacCore"]),
    .executableTarget(name: "YNXWalletMacSecurityProbe", dependencies: ["YNXWalletMacCore"]),
    .testTarget(name: "YNXWalletMacCoreTests", dependencies: ["YNXWalletMacCore"]),
  ]
)
