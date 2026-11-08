#pragma once
#include "OriginalServices.hpp"

namespace ynx::social::joint::original {
// Actual Auth R5 recognized-capture loan. No Go pointer, raw-register setter,
// Source reconstruction or caller-selected provider. The uint64 is checked by
// the original SAME-process/OS-actor inventory on EVERY call.
class CaptureLoan final {
 std::uint64_t loan_=0;
 Result first_;
 bool retire_selected_=false,retired_=false,join_selected_=false,joined_=false,close_selected_=false,closed_=false;
 void remember(Result) noexcept;
public:
 CaptureLoan()=default;
 CaptureLoan(const CaptureLoan&)=delete;
 CaptureLoan&operator=(const CaptureLoan&)=delete;
 void acquire(const SourceInput&,Result&) noexcept;
 Result current() noexcept;
 Result close() noexcept;
 std::uint64_t sameProcessLoan() const noexcept {return loan_;}
 bool hasDebt() const noexcept {return loan_!=0;}
};
}
