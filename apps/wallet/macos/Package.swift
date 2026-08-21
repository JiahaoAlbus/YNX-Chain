// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "YNXWalletMac",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "YNXWalletMacCore", targets: ["YNXWalletMacCore"]),
    .executable(name: "YNXWalletMac", targets: ["YNXWalletMac"]),
    .executable(name: "YNXWalletMacSecurityProbe", targets: ["YNXWalletMacSecurityProbe"]),
    .executable(name: "YNXWalletMacRecoveryProbe", targets: ["YNXWalletMacRecoveryProbe"]),
    .executable(name: "YNXWalletMacGatewayProbe", targets: ["YNXWalletMacGatewayProbe"]),
  ],
  targets: [
    .target(name: "YNXWalletMacCore", resources: [.process("Resources")]),
    .executableTarget(name: "YNXWalletMac", dependencies: ["YNXWalletMacCore"]),
    .executableTarget(name: "YNXWalletMacSecurityProbe", dependencies: ["YNXWalletMacCore"]),
    .executableTarget(name: "YNXWalletMacRecoveryProbe", dependencies: ["YNXWalletMacCore"]),
    .executableTarget(name: "YNXWalletMacGatewayProbe", dependencies: ["YNXWalletMacCore"]),
    .testTarget(name: "YNXWalletMacCoreTests", dependencies: ["YNXWalletMacCore"]),
  ]
)
