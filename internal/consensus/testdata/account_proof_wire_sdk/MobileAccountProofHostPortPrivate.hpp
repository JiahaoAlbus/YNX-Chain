#pragma once
#include <array>
#include <cstdint>
#include <string>
#include <vector>
#include <optional>
#include <memory>
// Sole SDK PRIVATE purpose/type contract. Declarations only: no engine lookup,
// constructor/provider, proof algorithm or claimed normal host implementation.
namespace ynx::auth::mobile::receipt { struct OriginalEngineSource; }
namespace ynx::sdk::mobile::accountproof {
inline constexpr char purpose[]="wallet-mobile-committed-account-proof-v1";
inline constexpr uint32_t version=1;
inline constexpr size_t maxLightBlockBytes=10u<<20;
inline constexpr size_t maxPolicyBytes=8u<<20;
using Bytes=std::vector<uint8_t>;
struct Failure { bool present=false; int32_t code=0; };
struct CheckpointDATA { std::string chainID; int64_t height=0; std::array<uint8_t,32> appHash{}; };
struct RegistrationDATA {
 std::string algorithmVersion,owner; Bytes pkA,pkB;
 uint64_t revision=0,registeredAt=0,activeFrom=0,ledgerNonce=0;
};
// Exact semantic map of original PQWalletPolicyAtCheckpointView; policyOriginal
// is original Go EncodeWalletPolicyProjection bytes, NOT sorted/re-marshalled.
struct AccountDATA {
 std::string owner; std::array<uint8_t,32> networkID{};
 int64_t nativeChainID=0,committedHeight=0;
 uint64_t executionHeight=0,ledgerNonce=0;
 Bytes policyOriginal;
 std::string committedAuthorizationStatus; bool committedPQSigningEnabled=false;
 std::string authorizationStatus; bool pqSigningEnabled=false;
 std::optional<RegistrationDATA> committedRegistration,executionRegistration;
};
// Two EXISTING Comet JSON LightBlock originals. No single ledgerSeal envelope,
// no compression, no newly invented signature/domain or re-encoded originals.
struct CommittedProofViewDATA {
 CheckpointDATA proof; AccountDATA historicalAccount;
 CheckpointDATA currentCheckpoint; AccountDATA currentAccount;
 Bytes blockOriginal,successorOriginal;
};
enum class Operation:uint32_t { Open=1,Read=2,Current=3,Retire=4,Join=5,Close=6 };
enum class ReadState:uint32_t { Ready=1,NotReady=2,Failed=3 };
struct HostPort; struct Reader; // recognized original private inventories ONLY
struct Acquisition {Reader*owner=nullptr;Failure failure;};
struct ReadOutcome {ReadState state=ReadState::Failed;Failure failure;};
// hostPort is captured by genuine OriginalEngineSource through actual normal
// App/engine owner. No public path/engineReference/chain/H/account DTO resolver.
// These are REQUIRED NEW private port declarations, NOT supplied symbols/body.
Acquisition open(HostPort*,ynx::auth::mobile::receipt::OriginalEngineSource*)noexcept;
ReadOutcome read(Reader*,CommittedProofViewDATA& ownedCopy)noexcept;
ReadOutcome current(Reader*,CommittedProofViewDATA& ownedCopy)noexcept;
void retire(Reader*)noexcept;
Failure join(Reader*)noexcept;
Failure close(Reader*)noexcept;
bool isClosed(Reader*)noexcept;
Failure releaseClosed(Reader*)noexcept;
// NotReady preserves SAME captured H/context/deadline; explicit same Reader
// read later only. No automatic retry/reopen/older H/Source window renewal.
// Ready DATA itself is NOT Root, Native receipt, transaction or finality grant.
}
