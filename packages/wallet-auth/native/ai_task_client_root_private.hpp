#pragma once
#import <Foundation/Foundation.h>
#include <memory>
namespace ynx::ai::client {
// Final private owner. A caller class/name/JSON cannot construct a Root loan.
class OriginalClientRoot final {
 struct State;std::shared_ptr<State>state_;
 explicit OriginalClientRoot(std::shared_ptr<State>);
 friend struct RootOutcome;
 friend struct RootFactory;
public:
 ~OriginalClientRoot();
 OriginalClientRoot(const OriginalClientRoot&)=delete;
 bool current(NSError**)noexcept;
 // Pure local observed fence for the SAME SQLite commit; no FS/network/JS.
 // Does not detect an external revocation that full current has not observed.
 bool observed_current(NSError**)noexcept;
 NSDictionary*read_original(NSError**)noexcept;
 bool retain_child(NSError**)noexcept;
 void drop_child()noexcept;
 void retire()noexcept;
 bool join(NSError**)noexcept;
 bool close(NSError**)noexcept;
};
struct RootOutcome{std::shared_ptr<OriginalClientRoot>owner;NSError*error=nil;};
RootOutcome acquire_original_ai_task_client_root()noexcept;
bool is_original_ai_task_client_root(const std::shared_ptr<OriginalClientRoot>&)noexcept;
}
