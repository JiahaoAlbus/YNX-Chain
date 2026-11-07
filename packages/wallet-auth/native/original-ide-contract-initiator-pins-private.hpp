#pragma once
#include <array>
#include <cstdint>
namespace ynx::ide::initiator_private {
// These are actual sole-SDK inputs, byte-identical in published7a/archive14.
// They pin CODE only. Actual Source-v2/project/peer/current are separate ANDs.
struct Pin {const char*path;uint64_t bytes;const char*sha256;};
inline constexpr std::array<Pin,8>pins={{
 {"src/walletconnect-contract-initiator-boundary.js",6669,"063c81eb18e2247b49d32b77911e2562050acb53068283b5857ea9e5bc8fc917"},
 {"src/walletconnect-contract-initiator-boundary-node.js",2366,"4abc7f4d496ef5787b725f2bdbef712f3405633c79f1eeaf7edfdb21c96bd9d9"},
 {"src/walletconnect-dapp-connection.js",36228,"f8d4e290c31fb8c277479e59743383121f9f9185eba47cb12cfb698fa8d8ce52"},
 {"src/original-ide-contract-relay-guard-node.js",7251,"783a36891e1dcbdaa2f963c98b98fe9f053c4ad8d4428dd860b83c82cb12421c"},
 {"src/original-ide-contract-relay-guard-core.js",4983,"6c8f3a799370100d14f2f5d1600bc9ee5d73712b8e6f20575a4ea9b69c8678bd"},
 {"node_modules/@walletconnect/core/dist/index.cjs",77008,"79c9586939e619950d63fde0cddee9d9342117142b74409f5c951947950b3a6b"},
 {"node_modules/@walletconnect/sign-client/dist/index.cjs",72464,"28537cb3f5e5a6178311508a5480257682e0660e4d6e306dc5c8f5a58420c3aa"},
 {"node_modules/@walletconnect/utils/dist/index.cjs",42882,"f790ba8ac0ac64b3653ef5a75837d45359c4813b4591fdf9081c30018ee406f0"}
}};
}
