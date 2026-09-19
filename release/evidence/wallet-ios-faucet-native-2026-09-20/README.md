# YNX Wallet iOS Faucet native activation evidence

This evidence binds source commit `0dfb25fd9` and the iOS build 16 candidate to the compiled
`productionEnabled=true` source gate and summarizes isolated loopback tests.
The engine suite passed 36 cases; the bridge suite passed 14; the JS Faucet
contract suite passed 78; typecheck and plist lint passed. Expo autolinking found
`YnxFaucetTransportModule`.

No public Faucet/RPC endpoint was called. The evidence intentionally omits wire
bodies, response bodies, headers, accounts, keys and tokens. This host has only
Apple Command Line Tools: no full Xcode, iOS SDK, CocoaPods or Simulator was
available. Consequently iOS SDK compilation, Expo/UIKit adapter compilation,
Simulator installation, device validation, production signing, TestFlight and
App Store publication remain false.

A second serial Swift-host rerun was terminated by the host with exit 137 before
creating a compiler log while Android Emulator and other shared processes were
retained. No Swift assertion failure was observed. The recorded 36/36 and 14/14
results come from the completed isolated harness run against the same source
hashes; iOS SDK and device gates remain false.
