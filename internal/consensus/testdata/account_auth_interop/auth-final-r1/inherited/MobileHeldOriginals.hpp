#pragma once
#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#include <sys/stat.h>

namespace ynx::auth::mobile::qualified::physical {
// STORAGE ONLY. The compiled Root producer selects these PUBLIC originals;
// neither this spec nor a successful physical read is Source qualification.
struct FileSpec {std::string leaf;size_t maximum=0;};
struct DirectorySpec {std::string canonicalPath;uint32_t uid=0,gid=0;uint64_t device=0,inode=0;std::vector<FileSpec> files;int borrowedNativeFD=-1;};
enum Code:int32_t {ok=0,invalid=8501,changed=8502,io=8503,closed=8504,wrongThread=8505,debt=8506};
class HeldOriginals final {
 struct Entry {int fd=-1;std::string name;struct stat identity{};std::vector<uint8_t>bytes;};
 std::thread::id actor_=std::this_thread::get_id();
 DirectorySpec spec_;std::vector<Entry>parents_,files_;int directory_=-1;struct stat identity_{};
 std::atomic<bool>retired_{false};bool closeSelected_=false,closed_=false,physicalUnknown_=false;int32_t first_=0,closeResult_=0;size_t loans_=0;
 explicit HeldOriginals(DirectorySpec);
 int32_t fail(int32_t)noexcept;
 int32_t initialize()noexcept;
 friend struct Acquisition;
 friend struct Factory;
public:
 ~HeldOriginals();
 HeldOriginals(const HeldOriginals&)=delete;HeldOriginals&operator=(const HeldOriginals&)=delete;
 int32_t current()noexcept; // outside Store/OS locks: actual held+named+bytes IO
 int32_t observedCurrent()const noexcept; // local revocation ONLY, not unseen FS
 int32_t copy(const std::string&leaf,std::vector<uint8_t>&)noexcept;
 int32_t copyCaptured(const std::string&leaf,std::vector<uint8_t>&)const noexcept; // retained PUBLIC bytes only, no current/authority claim
 int32_t borrowDirectory(int&fd,struct stat&identity)noexcept;
 int32_t retain()noexcept;void release()noexcept;
 void retire()noexcept{retired_.store(true,std::memory_order_release);}
 int32_t close()noexcept;bool closed()const noexcept{return closed_;}
 int32_t firstCause()const noexcept{return first_;}
};
struct Acquisition {std::shared_ptr<HeldOriginals>owner;int32_t error=invalid;};
// Private native call only. Allocates owner BEFORE opening anything, preserving
// a nonnull partial for every later failure. There is no global setter.
Acquisition openSelectedPublicOriginals(DirectorySpec)noexcept;
}
