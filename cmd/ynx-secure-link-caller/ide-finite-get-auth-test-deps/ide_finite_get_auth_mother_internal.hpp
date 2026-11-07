#pragma once
#include "ide_finite_get_auth_mother_v1.h"
#include <memory>
#include <string>
#include <array>
#include <vector>
namespace ynx::auth::ide_get {
// PRIVATE concrete original Root qualification handle. No public constructor,
// virtual methods, callable provider or DATA->qualified conversion exists.
class OriginalTargetQualification final {
 public:
  ~OriginalTargetQualification();
  int32_t assert_current_original()const noexcept;
  int32_t read_native_target_original(ynx_auth_ide_finite_get_view_v1*,ynx_auth_ide_finite_get_credential_view_v1*)const noexcept;
 private:
  OriginalTargetQualification();
  struct Storage;std::unique_ptr<Storage>storage_;
  friend class OriginalTargetProducer;
  friend struct TicketSource;
};
// Likewise actual same-image Source/DEVICE/context/proof custody, not a JS
// boolean. The producer alone may construct it from actual original owners.
class OriginalRequestCustody final {
 public:
  ~OriginalRequestCustody();
  int32_t assert_current_original()const noexcept;
  int32_t read_native_request_original(ynx_auth_ide_finite_get_view_v1*)const noexcept;
 private:
  OriginalRequestCustody();
  struct Storage;std::unique_ptr<Storage>storage_;
  friend class OriginalRequestProducer;
  friend struct TicketSource;
};
struct TicketSource final {
 static ynx_auth_ide_finite_get_ticket_v1*open_original(
  std::shared_ptr<OriginalTargetQualification>,std::shared_ptr<OriginalRequestCustody>,int32_t*error)noexcept;
 // Actor-only cleanup. false means SAME ticket/parent debt must stay held.
 static int32_t close_original(ynx_auth_ide_finite_get_ticket_v1*,uint8_t*closed)noexcept;
 static int32_t free_original(ynx_auth_ide_finite_get_ticket_v1*)noexcept;
};
}
