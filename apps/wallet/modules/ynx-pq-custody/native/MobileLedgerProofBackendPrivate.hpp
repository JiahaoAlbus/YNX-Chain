#pragma once
#include <cstdint>
#include <string>
#include <vector>
/* PRIVATE same-image C++ contract proposal for the original Core and sole SDK
 * owners. No new C20 export/algorithm/archive/JS API. DATA structs below are
 * not constructible authority. Only recognized opaque native owners qualify.
 * Version/field spellings to be frozen by sole SDK with Core implementation. */
namespace ynx::auth::mobile::receipt {struct OriginalEngineSource;}
namespace ynx::core::mobile::registered {
struct CommittedAccountProof; // Core inventory ONLY; never subclass/new/JSON.
struct Failure {bool present=false;int32_t code=0;};
using Bytes=std::vector<uint8_t>;
struct CapturedPolicy {
 uint32_t version=1;
 std::string platform,engineReference,chainId,canonicalOwner;
 uint64_t height=0,originHeight=0,activeRevision=0,ledgerNonce=0;
 Bytes fullAppHash,policyOriginal,ledgerSealOriginal,pkA,pkB;
};
struct Continuation {
 uint32_t version=1;
 uint64_t capturedHeight=0,originHeight=0,currentEngineHeight=0;
 Bytes capturedAppHash,currentEngineAppHash,currentPolicyOriginal;
};
struct Acquisition {CommittedAccountProof*owner=nullptr;Failure failure;};
/* Auth supplies ONLY a genuine recognized Root/Source-selected strong ctx.
 * Core queries Auth selection/current getters below, then its ORIGINAL native
 * engine. Never accept a caller checkpoint/path/JSON/current boolean. Capture
 * owns immutable H/policy/checkpoint and independently authenticates ledger
 * seal + actual H+1->H fullAppHash via existing Core proof/light machinery.
 * Source18/N1 mathematical validity alone is NOT a ledger seal. NotReady when
 * actual H has no H+1; do not select older/other checkpoint or retry/rebind. */
Acquisition acquireCommittedAccountProof(ynx::auth::mobile::receipt::OriginalEngineSource*)noexcept;
Failure readCaptured(CommittedAccountProof*,CapturedPolicy&ownedPublicCopy)noexcept;
/* Original handle keeps capture H fixed. Core continuation independently
 * re-observes actual engine/current policy and proves same capture seal. It
 * must not silently rebase H, renew Source window, or return an unsealed latest
 * DATA snapshot as current. No Store locks may be held across this operation. */
Failure current(CommittedAccountProof*,Continuation&ownedPublicCopy)noexcept;
void retire(CommittedAccountProof*)noexcept;
Failure join(CommittedAccountProof*)noexcept;
Failure close(CommittedAccountProof*)noexcept; // selected once, sticky cause
bool isClosed(CommittedAccountProof*)noexcept; // actual wg/child/physical drain
Failure releaseClosed(CommittedAccountProof*)noexcept; // tombstone/no ABA
}
namespace ynx::auth::mobile::receipt {
struct EngineSelection {
 uint32_t version=1;
 std::string platform,engineReference,chainId,canonicalOwner,sourceId,instanceId;
 uint64_t minimumHeight=0,deadlineMs=0;
};
/* ACTUAL Auth implementations use native inventory and separately reviewed
 * compiled Root row. Selection is DATA for Core's own engine lookup only;
 * these functions cannot create a Root ctx from a tuple, JS ref, or Native
 * account selector. Source Current may perform physical/public proof I/O. */
ynx::core::mobile::registered::Failure readOriginalEngineSelection(OriginalEngineSource*,EngineSelection&)noexcept;
ynx::core::mobile::registered::Failure originalEngineSourceCurrent(OriginalEngineSource*)noexcept;
ynx::core::mobile::registered::Failure retainOriginalEngineSource(OriginalEngineSource*)noexcept;
ynx::core::mobile::registered::Failure releaseOriginalEngineSource(OriginalEngineSource*)noexcept;
}
