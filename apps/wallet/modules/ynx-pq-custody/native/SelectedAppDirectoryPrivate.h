#pragma once
#include "SelectedDirectoryInventory.h"
#include <atomic>
#include <memory>
#include <string>
#include <sys/stat.h>
#include <thread>
namespace ynx::mobilepq::directories {
struct ApplicationDirectoryIdentity {
 uint64_t device=0,inode=0;
 uint32_t uid=0,gid=0;
};
/* Platform implementation obtains ONLY the actual process Application Context
 * directory. No JS input, Root locator, account name or provider is accepted.
 * Android Context.getDataDir / iOS NSHomeDirectory, not a host-path substitute.
 * This is physical ownership only; it never supplies registered account trust.
 */
int32_t platformApplicationDirectory(std::string&)noexcept;
class NativeApplicationDirectory final {
 const std::thread::id actor_=std::this_thread::get_id();
 std::atomic<bool> retired_{false};
 std::string originalPath_;
 struct stat identity_{};
 int fd_=-1;
 bool ready_=false,closeSelected_=false,closed_=false,closeUncertain_=false;
 int32_t first_=0,cleanup_=0;
 NativeApplicationDirectory()=default;
 int32_t fail(int32_t)noexcept;
public:
 ~NativeApplicationDirectory();
 NativeApplicationDirectory(const NativeApplicationDirectory&)=delete;
 NativeApplicationDirectory&operator=(const NativeApplicationDirectory&)=delete;
 /* Adopt nonnull partial before rc. No create/mkdir/chmod or ancestor walk. */
 static int32_t acquire(std::unique_ptr<NativeApplicationDirectory>&)noexcept;
 int32_t current()noexcept;
 /* Native constructor-only borrowed FD. Caller must never close it. Its own
  * account directory inventory duplicates pins, and SAME selected current
  * must retain/check this app owner. Close child inventory before this owner.
  * Nothing here may be projected to JSI, JNI public arguments or JS storage.
  */
 int32_t borrowForNativeInventory(int&borrowedFD,ApplicationDirectoryIdentity&)noexcept;
 void retire()noexcept;
 int32_t close()noexcept;
 bool isClosed()const noexcept{return closed_;} // actor-thread witness only
};
}
