import Foundation
import YNXWalletMacCore

struct GatewayProbeResult: Codable {
  let matrixID: String
  let chainID: String
  let layer1Verified: Bool
  let restStatus: Int?
  let gatewayNegativeVerified: Bool
  let privateServiceDegraded: Bool
  let walletCompletionError: String?
  let walletIntrospectionError: String?
  let productSessionIntrospectionError: String?
  let walletStateDigest: String?
  let stateUnchanged: Bool?
  let authorizationSuccess: Bool
  let accountAvailable: Bool
  let signing: Bool
  let send: Bool
  let transaction: Bool
}

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write(Data("usage: YNXWalletMacGatewayProbe <endpoint-matrix.json>\n".utf8))
  exit(64)
}

do {
  let matrixURL = URL(fileURLWithPath: CommandLine.arguments[1])
  let configuration = try EndpointMatrixPolicy.parse(Data(contentsOf: matrixURL))
  let chain = try await ChainRPCProbe().run(configuration: configuration)
  let rest = try? await AppGatewayReachabilityProbe().run(configuration: configuration)
  let gateway = try? await WalletGatewayFailClosedProbe().run(configuration: configuration)
  let capabilities = configuration.nativeCapabilities
  let layer1Verified = chain.chainIDHex == "0x1917"
  let gatewayNegativeVerified = rest?.statusCode == 200 && gateway != nil
  let result = GatewayProbeResult(
    matrixID: configuration.matrixID,
    chainID: chain.chainIDHex,
    layer1Verified: layer1Verified,
    restStatus: rest?.statusCode,
    gatewayNegativeVerified: gatewayNegativeVerified,
    privateServiceDegraded: !gatewayNegativeVerified,
    walletCompletionError: gateway?.walletCompletionError,
    walletIntrospectionError: gateway?.walletIntrospectionError,
    productSessionIntrospectionError: gateway?.productSessionIntrospectionError,
    walletStateDigest: gateway?.walletStateDigest,
    stateUnchanged: gateway?.stateUnchanged,
    authorizationSuccess: false,
    accountAvailable: capabilities.accountAvailable,
    signing: capabilities.signAvailable,
    send: capabilities.sendAvailable,
    transaction: false
  )
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  FileHandle.standardOutput.write(try encoder.encode(result))
  FileHandle.standardOutput.write(Data([0x0a]))
  guard result.layer1Verified,
        !result.authorizationSuccess,
        !result.accountAvailable,
        !result.signing,
        !result.send,
        !result.transaction else {
    exit(1)
  }
} catch {
  FileHandle.standardError.write(Data("gateway probe failed closed: \(String(describing: error))\n".utf8))
  exit(1)
}
