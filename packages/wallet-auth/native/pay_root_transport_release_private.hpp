#pragma once
#include "pay_root_transport_private.hpp"
#include <memory>
#include <mutex>
namespace ynx::wallet::pay::root_physical {
struct RegisteredTransportAcquisition;
struct OriginalReadWindow {uint64_t not_before_ms,expires_ms;};
class RegisteredTransportOriginal final {
public:
 ~RegisteredTransportOriginal();
 Code copy_profile(TransportProfile&) noexcept;
 Code current() noexcept;
 void retire() noexcept;
 Code close() noexcept;
 bool closed() const noexcept;
private:
 mutable std::mutex mutex_;
 std::unique_ptr<PublicOriginalHold> held_;
 std::string ref_;
 Code first_=Code::ok;
 RegisteredTransportOriginal(std::string,std::unique_ptr<PublicOriginalHold>);
 friend RegisteredTransportAcquisition acquire_registered_transport_original(const std::string&,OriginalReadWindow) noexcept;
};
struct RegisteredTransportAcquisition {std::unique_ptr<RegisteredTransportOriginal> owner;Code error;};
// Ref-only private lookup in independent reviewed release literals. No caller
// file path/Spec/provider/table setter. Returned object is protected DATA only,
// never an OriginalRootSource. Final genuine Source checks signed scope Ref.
// Window must be taken from the original authenticated Source current, not
// newly invented now+N or compiled prebuild expiration. It only constrains DATA.
RegisteredTransportAcquisition acquire_registered_transport_original(const std::string& authenticated_ref,OriginalReadWindow) noexcept;
}
