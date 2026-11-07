#pragma once
#include <MobileAITaskPlatformPrivate.h>
#include <cstdint>
#include <string>
#include <vector>
/* PRIVATE Native payload ownership contract for original LINK/Auth only.
 * This loan is not a TLS/FD/credential grant and is never a JS object/DTO.
 * Actual Auth transport authority must be supplied independently by its
 * recognized original Source; sourceOriginURL DATA cannot mint that holder. */
namespace ynx::mobileai::transport {
struct OriginalRequestLoan; // Native inventory only, no public constructor
using Failure=YNXAIMobileFailureV6;
struct RequestDATA {
 uint32_t version=6;
 std::string method,path,sourceOriginURL;
 std::vector<uint8_t>finalHead,bodyOriginal;
 uint64_t issuedAtMs=0,expiresAtMs=0;
};
/* Only the original Native producer dispatch body acquires the opaque loan
 * after intrinsic source/review/operation association and its once selection.
 * Parent stores the nonnull partial before Failure.present (even code0). */
struct Acquisition {OriginalRequestLoan*owner=nullptr;Failure failure{};};
// No caller bytes/path/Source pointer/FD/approved bool is an acquisition input.
// This internal callback-free acquisition is linked directly to the executing
// producer's private original-dispatch frame, never a public provider setter.
Acquisition acquireOriginalRequestForDispatch()noexcept;
Failure readOriginalRequest(OriginalRequestLoan*,RequestDATA&ownedPublicCopy)noexcept;
/* current is ORIGINAL Native actor only and checks same captured Source and
 * original lifetime/deadline; it cannot renew/rebind. Link may additionally
 * inspect atomic cancellation, but this does not replace Auth grant current. */
Failure originalRequestCurrent(OriginalRequestLoan*)noexcept;
bool originalRequestCancelled(OriginalRequestLoan*)noexcept;
void requestOriginalRequestCancel(OriginalRequestLoan*)noexcept;
Failure joinOriginalRequest(OriginalRequestLoan*)noexcept;
Failure closeOriginalRequest(OriginalRequestLoan*)noexcept;
bool originalRequestClosed(OriginalRequestLoan*)noexcept;
Failure releaseClosedOriginalRequest(OriginalRequestLoan*)noexcept;
}
