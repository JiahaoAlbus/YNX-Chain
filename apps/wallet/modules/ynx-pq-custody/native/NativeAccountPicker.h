#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace ynx::mobilepq::picker {
enum Code:int32_t {ok=0,invalid=9801,unavailable=9802,cancelled=9803,expired=9804,pending=9805,wrongThread=9806,closed=9807,capacity=9808};
struct AccountChoice {std::string account,network,originalOperation;};
/* Native lifecycle identities and UI tickets ONLY, never JS values or grants.
 * Caller supplies the SAME real Native account inventory's public observations
 * and checks its actual account/epoch/current before AND after selection. No
 * Source/registered proof, review, sign/restore/submit approval is inferred.
 * No create/setter for an account/Source, paths, keys or credentials exists. */
bool bindRuntime(uint64_t)noexcept;
void retireRuntime(uint64_t)noexcept;
bool releaseRuntime(uint64_t)noexcept;
int32_t open(uint64_t,const std::vector<AccountChoice>&,uint32_t timeoutMS,uint64_t*outTicket)noexcept;
int32_t wait(uint64_t,uint32_t*outIndex)noexcept; // dedicated worker only
int32_t close(uint64_t)noexcept;
int32_t releaseClosed(uint64_t)noexcept;
/* Platform main-thread callbacks; late/foreign/stale tokens are rejected. */
bool presentationCurrent(uint64_t)noexcept;
bool selected(uint64_t,uint32_t index,int32_t result)noexcept;
void presentationClosed(uint64_t)noexcept;
/* Implemented by actual Android/iOS UI. Nonzero show means NOTHING posted or
 * presented; after posting, failures must report selected(error)+closed.
 * dismiss is nonblocking and must ACK only actual absence/dismissal. */
int32_t platformShow(uint64_t,const std::vector<std::string>&)noexcept;
void platformDismiss(uint64_t)noexcept;
}
