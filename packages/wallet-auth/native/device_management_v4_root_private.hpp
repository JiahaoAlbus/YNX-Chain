#pragma once
#import <Foundation/Foundation.h>
#include <memory>
namespace ynx::device::management {
struct RootOutcome;struct RootFactory;
class OriginalManagementRoot final {
 struct State;std::shared_ptr<State>state_;
 explicit OriginalManagementRoot(std::shared_ptr<State>);
 friend struct RootFactory;
public:
 ~OriginalManagementRoot();
 OriginalManagementRoot(const OriginalManagementRoot&)=delete;
 bool current(NSError**)noexcept;
 bool observed_current(NSError**)noexcept;
 NSDictionary*read_original(NSError**)noexcept;
 // Immutable acquisition tuple. It binds observation/custody only; fresh
 // full current is independently required and is not inferred from these bytes.
 NSDictionary*read_capture_originals(NSError**)noexcept;
 bool retain_child(NSError**)noexcept;
 void drop_child()noexcept;
 void retire()noexcept;
 bool join(NSError**)noexcept;
 bool close(NSError**)noexcept;
};
struct RootOutcome{std::shared_ptr<OriginalManagementRoot>owner;NSError*error=nil;};
RootOutcome acquire_original_device_v4_management_root()noexcept;
bool is_original_device_v4_management_root(const std::shared_ptr<OriginalManagementRoot>&)noexcept;
}
