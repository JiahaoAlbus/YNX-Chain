#pragma once
#include "MobileLedgerProofBackendPrivate.hpp"
#include "MobileAccountProofHostPortPrivate.hpp"
namespace ynx::auth::mobile::receipt {
struct OriginalAccountProofHost; // genuine Root-selected original native inventory
struct HostAcquisition {OriginalAccountProofHost*owner=nullptr;ynx::sdk::mobile::accountproof::Failure failure;};
// Required original normal protected-host producer. Source context is genuine
// Auth inventory; the producer resolves its independently Root-reviewed backend
// resource through the ORIGINAL qualified private host/caller. No public
// endpoint/FD/config/engineReference global map/provider or Current4 fallback.
HostAcquisition acquireOriginalAccountProofHost(OriginalEngineSource*)noexcept;
ynx::sdk::mobile::accountproof::Failure readOriginalAccountProofHost(OriginalAccountProofHost*,OriginalEngineSource*,ynx::sdk::mobile::accountproof::HostPort*&)noexcept;
ynx::sdk::mobile::accountproof::Failure originalAccountProofHostCurrent(OriginalAccountProofHost*,OriginalEngineSource*)noexcept;
void retireOriginalAccountProofHost(OriginalAccountProofHost*)noexcept;
ynx::sdk::mobile::accountproof::Failure joinOriginalAccountProofHost(OriginalAccountProofHost*)noexcept;
ynx::sdk::mobile::accountproof::Failure closeOriginalAccountProofHost(OriginalAccountProofHost*)noexcept;
bool originalAccountProofHostClosed(OriginalAccountProofHost*)noexcept;
ynx::sdk::mobile::accountproof::Failure releaseClosedOriginalAccountProofHost(OriginalAccountProofHost*)noexcept;
}
