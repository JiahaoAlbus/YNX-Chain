#pragma once
#include <MobileAITaskRuntimePrivate.h>
// Agent7 exact strong ABI is declared by the one matching Auth RuntimePrivate.
// This header adds no installed JS API. All new implementation resides here.
namespace ynx::mobilepq::aiagent {
// Exceptions carrying these codes must have the same int32_t type consumed by
// the owning acquisition/sign catches. A C++ enum bypasses catch(int32_t).
inline constexpr int32_t invalid=11101,wrongThread=11102,closed=11103,capacity=11104,notSupplied=10407,cleanupDebt=11106,unknown=11107;
}
