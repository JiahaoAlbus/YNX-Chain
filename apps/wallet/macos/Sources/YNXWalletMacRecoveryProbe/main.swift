import Foundation
import YNXWalletMacCore

struct RecoveryProbeResult: Codable {
  let keychainRoundTripVerified: Bool
  let biometricPolicyAvailable: Bool
  let recoveryCreateAttempted: Bool
  let recoveryCreated: Bool
  let recoveryMaterialPersisted: Bool
  let failedClosed: Bool
  let error: String?
  let errorCode: Int?
}

func emit(_ result: RecoveryProbeResult) throws {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  FileHandle.standardOutput.write(try encoder.encode(result))
  FileHandle.standardOutput.write(Data([0x0a]))
}

let capability = DeviceSecurityProbe.run()
if capability.biometricPolicyAvailable {
  try emit(RecoveryProbeResult(
    keychainRoundTripVerified: capability.keychainRoundTripVerified,
    biometricPolicyAvailable: true,
    recoveryCreateAttempted: false,
    recoveryCreated: false,
    recoveryMaterialPersisted: false,
    failedClosed: true,
    error: "PHYSICAL_BIOMETRIC_INTERACTION_REQUIRED",
    errorCode: nil
  ))
  exit(0)
}

do {
  let vault = KeychainRecoveryVault(
    service: "com.ynxweb4.wallet.macos.ci-recovery-probe",
    account: UUID().uuidString
  )
  try await vault.create(reason: "Verify YNX Wallet recovery remains locked without biometrics")
  try emit(RecoveryProbeResult(
    keychainRoundTripVerified: capability.keychainRoundTripVerified,
    biometricPolicyAvailable: false,
    recoveryCreateAttempted: true,
    recoveryCreated: true,
    recoveryMaterialPersisted: true,
    failedClosed: false,
    error: "UNEXPECTED_RECOVERY_CREATION",
    errorCode: nil
  ))
  exit(1)
} catch DeviceSecurityError.biometricUnavailable(let code) {
  try emit(RecoveryProbeResult(
    keychainRoundTripVerified: capability.keychainRoundTripVerified,
    biometricPolicyAvailable: false,
    recoveryCreateAttempted: true,
    recoveryCreated: false,
    recoveryMaterialPersisted: false,
    failedClosed: true,
    error: "BIOMETRIC_UNAVAILABLE",
    errorCode: code
  ))
  exit(0)
} catch {
  try emit(RecoveryProbeResult(
    keychainRoundTripVerified: capability.keychainRoundTripVerified,
    biometricPolicyAvailable: false,
    recoveryCreateAttempted: true,
    recoveryCreated: false,
    recoveryMaterialPersisted: false,
    failedClosed: true,
    error: "UNEXPECTED_ERROR_\(String(describing: error))",
    errorCode: nil
  ))
  exit(1)
}
