import Foundation
import YNXWalletMacCore

let capability = DeviceSecurityProbe.run()
let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(capability))
FileHandle.standardOutput.write(Data([0x0a]))
if !capability.keychainAvailable || !capability.keychainRoundTripVerified || !capability.keychainDeletionVerified {
  exit(1)
}
