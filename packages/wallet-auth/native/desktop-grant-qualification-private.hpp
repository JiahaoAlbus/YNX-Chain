#pragma once
#include <memory>
#include <string>
#include <cstdint>
namespace ynx::auth::desktopgrant {
class Qualification final {
 struct Impl;std::unique_ptr<Impl>impl_;
 Qualification();friend struct QualificationAccess;
 public:
 ~Qualification();Qualification(const Qualification&)=delete;Qualification&operator=(const Qualification&)=delete;
};
struct Acquired {std::shared_ptr<Qualification>owner;bool error_present=true;std::string cause;};
Acquired acquire_original_qualification(const void*same_addon_address)noexcept;
int32_t qualification_current(const std::shared_ptr<Qualification>&)noexcept;
int32_t qualification_observed_current(const std::shared_ptr<Qualification>&)noexcept;
// key is a CLOSED compile-time dispatch in the implementation, never a path.
int32_t qualification_json(const std::shared_ptr<Qualification>&,const char*key,std::string&out)noexcept;
int32_t qualification_module(const std::shared_ptr<Qualification>&,bool link,std::string&out)noexcept;
int32_t qualification_task_read_module(const std::shared_ptr<Qualification>&,std::string&out)noexcept;
int32_t qualification_task_read_continuation_module(const std::shared_ptr<Qualification>&,std::string&out)noexcept;
void qualification_retire(const std::shared_ptr<Qualification>&)noexcept;
int32_t qualification_join(const std::shared_ptr<Qualification>&)noexcept;
int32_t qualification_close(const std::shared_ptr<Qualification>&)noexcept;
bool qualification_closed(const std::shared_ptr<Qualification>&)noexcept;
}
