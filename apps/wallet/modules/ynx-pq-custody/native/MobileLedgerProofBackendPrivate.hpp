#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <optional>
// PRIVATE same-image binding of Core f77a original Go sealed reader. This is
// NOT C20/new crypto/a public provider, or a constructor from detached DATA.
namespace ynx::auth::mobile::receipt {struct OriginalEngineSource;}
namespace ynx::core::mobile::registered {
struct CommittedAccountProof; // private inventory: actual owning host reader
struct Failure {bool present=false;int32_t code=0;};
struct ReadResult {bool ready=false;Failure failure;bool notReady=false;Failure pendingCause{};};
using Bytes=std::vector<uint8_t>;
struct Checkpoint {std::string chainId;uint64_t height=0;Bytes fullAppHash;};
struct Registration {
 std::string algorithmVersion,owner;Bytes pkA,pkB;
 uint64_t revision=0,registeredAt=0,activeFrom=0,ledgerNonce=0;
};
struct AccountView {
 std::string owner;Bytes networkId;int64_t nativeChainID=0;
 uint64_t committedHeight=0,executionHeight=0,ledgerNonce=0;
 Bytes policyOriginal; // EXACT Core json.Marshal bytes, NEVER reordered/parsed as Source canonical
 std::string committedAuthorizationStatus,authorizationStatus;
 bool committedPQSigningEnabled=false,pqSigningEnabled=false;
 std::optional<Registration>committedRegistration,executionRegistration;
};
struct CapturedPolicy {
 uint32_t version=2;std::string platform,engineReference;
 Checkpoint proof;AccountView historicalAccount;
 Bytes blockOriginal,successorOriginal; // existing Comet JSON LightBlocks, two originals
};
struct Continuation {
 uint32_t version=2;Checkpoint captured,currentCheckpoint;AccountView currentAccount;
};
struct Acquisition {CommittedAccountProof*owner=nullptr;Failure failure;};
// Root-selected OriginalEngineSource -> protected original host port -> SAME
// actual *consensus.Application -> OpenPQCommittedAccountReader. No string
// global App lookup, mathematical49 App fiction, Current4 socket, or CLI JSON.
// The host must Origin().OwnedBy(actualApp), preserving original Source begin/wg.
Acquisition acquireCommittedAccountProof(ynx::auth::mobile::receipt::OriginalEngineSource*)noexcept;
// ready=false/failure.absent is ONLY Core ErrPQCommittedAccountNotReady.
// SAME captured H/owner/deadline remains held; explicit later same-owner Read
// is allowed. Do not recapture older H, renew, automatically retry or invent an
// error number. Any other error keeps original failure presence/code.
ReadResult readCaptured(CommittedAccountProof*,CapturedPolicy&ownedPublicCopy)noexcept;
ReadResult current(CommittedAccountProof*,Continuation&ownedPublicCopy)noexcept;
// The adapter obtains actual PQCommittedAccountProof.View/Origin, not a caller
// View. Core verifies original H/H+1 dual AND and engine/App before/after fences.
// Both AccountView records are original Core typed facts from its existing
// policy decoder/TrustedRegistration. No invented top-level policy fields.
// PolicyOriginal and Block/SuccessorOriginal remain exact byte originals.
void retire(CommittedAccountProof*)noexcept;
Failure join(CommittedAccountProof*)noexcept;
Failure close(CommittedAccountProof*)noexcept;
bool isClosed(CommittedAccountProof*)noexcept; // actual Close AND drained wg
Failure releaseClosed(CommittedAccountProof*)noexcept;
}
namespace ynx::auth::mobile::receipt {
struct EngineSelection {
 uint32_t version=1;
 std::string platform,engineReference,chainId,canonicalOwner,sourceId,instanceId;
 uint64_t minimumHeight=0,deadlineMs=0;
};
// ACTUAL Auth implementations: genuine opaque Root/Source inventory only.
ynx::core::mobile::registered::Failure readOriginalEngineSelection(OriginalEngineSource*,EngineSelection&)noexcept;
ynx::core::mobile::registered::Failure originalEngineSourceCurrent(OriginalEngineSource*)noexcept;
ynx::core::mobile::registered::Failure retainOriginalEngineSource(OriginalEngineSource*)noexcept;
ynx::core::mobile::registered::Failure releaseOriginalEngineSource(OriginalEngineSource*)noexcept;
}
