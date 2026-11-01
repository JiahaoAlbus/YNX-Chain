#pragma once
#include "OS43Private.h"
#include <sys/types.h>
#include <vector>
namespace ynx::mobilepq::os43::storage_only {
// Physical ciphertext IO only, never Root/Source/approval or decryption.
struct Identity {dev_t device=0;ino_t inode=0;};
class Lock final {
 int fd_=-1;
 explicit Lock(int fd):fd_(fd){}
 friend Lock lockDirectory(const YNXMobileOS43Descriptor&);
 public:
 Lock()=default;
 Lock(const Lock&)=delete;Lock&operator=(const Lock&)=delete;
 Lock(Lock&& other)noexcept:fd_(other.fd_){other.fd_=-1;}
 ~Lock();bool valid()const{return fd_>=0;}
};
bool directory(const YNXMobileOS43Descriptor&);
Lock lockDirectory(const YNXMobileOS43Descriptor&);
int32_t readRecord(const YNXMobileOS43Descriptor&,std::vector<uint8_t>&,Identity* =nullptr);
// Caller must retain SAME directory lock across per-item Keystore creation and
// this write. O_EXCL; uncertain publication stays intact, never auto-rollback.
Effect writeAbsent(const YNXMobileOS43Descriptor&,const Lock&,const std::vector<uint8_t>&);
int32_t removeExact(const YNXMobileOS43Descriptor&,const Lock&,const Identity&);
}
