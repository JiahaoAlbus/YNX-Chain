#pragma once
#include "OriginalSHA256.hpp"
#include "AndroidDeviceRegistrationPortsPrivate.h"
#include <array>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <string>
#include <stdexcept>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>
namespace ynx::auth::android_pending {
// Existing R5 v4 durable once framing. Never removes, overwrites, repairs,
// re-signs or re-arms an existing original. FD comes from genuine Native loan.
class PendingJournal final {
 int fd_=-1;struct stat identity_{};bool cleanupUnknown_=false;std::vector<int>unknownFDs_;
 std::string key_,entered_,terminal_;bool reserved_=false,enteredCore_=false,recovered_=false,ack_=false,terminalSelected_=false;
 std::vector<uint8_t>member_;int32_t rc_=-1;uint32_t cleanup_=0;size_t reported_=0;
 static void field(std::string&out,const std::string&s){if(s.size()>UINT32_MAX)throw std::runtime_error("PENDING_JOURNAL_BOUND");auto n=static_cast<uint32_t>(s.size());for(int i=24;i>=0;i-=8)out.push_back(char(n>>i));out+=s;}
 static bool hex(const std::string&s){if(s.size()!=64)return false;for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true;}
 static bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode;}
 std::string read(const std::string&leaf,size_t cap){current();int fd=::openat(fd_,leaf.c_str(),O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK);if(fd<0){if(errno==ENOENT)return {};throw std::runtime_error("PENDING_JOURNAL_READ_OPEN");}std::string raw;bool failed=false;struct stat a{},b{};if(fstat(fd,&a)||!S_ISREG(a.st_mode)||a.st_uid!=geteuid()||(a.st_mode&07777)!=0600||a.st_nlink!=1||a.st_size<1||uint64_t(a.st_size)>cap)failed=true;
  try{if(!failed){raw.resize(size_t(a.st_size));size_t at=0;while(at<raw.size()){auto n=::read(fd,raw.data()+at,raw.size()-at);if(n<=0){failed=true;break;}at+=size_t(n);}char extra;if(::read(fd,&extra,1)!=0||fstat(fd,&b)||!same(a,b)||a.st_size!=b.st_size)failed=true;}}
  catch(...){if(::close(fd)){cleanupUnknown_=true;unknownFDs_.push_back(fd);}throw;}
  if(::close(fd)){cleanupUnknown_=true;unknownFDs_.push_back(fd);throw std::runtime_error("PENDING_JOURNAL_READ_CLOSE_UNKNOWN");}if(failed)throw std::runtime_error("PENDING_JOURNAL_ORIGINAL_CHANGED");current();return raw;
 }
 void write(const std::string&leaf,const std::string&raw){current();int fd=::openat(fd_,leaf.c_str(),O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600);if(fd<0)throw std::runtime_error("PENDING_JOURNAL_WRITE_SELECTED_OR_FAILED");bool failed=false;size_t at=0;while(at<raw.size()){auto n=::write(fd,raw.data()+at,raw.size()-at);if(n<=0){failed=true;break;}at+=size_t(n);}if(::fsync(fd))failed=true;const auto closed=::close(fd);if(closed){cleanupUnknown_=true;unknownFDs_.push_back(fd);}if(closed||failed||::fsync(fd_))throw std::runtime_error("PENDING_JOURNAL_WRITE_ACK_UNKNOWN");current();if(read(leaf,131072)!=raw)throw std::runtime_error("PENDING_JOURNAL_READBACK");}
 void recover(const std::string&raw){const std::string magic="YNX-PRODUCT-DEVICE-PENDING-OUTCOME/v4";if(raw.compare(0,magic.size(),magic))throw std::runtime_error("PENDING_JOURNAL_OUTCOME_FORMAT");size_t at=magic.size();auto take=[&](size_t cap){if(raw.size()-at<4)throw std::runtime_error("PENDING_JOURNAL_FIELD");uint32_t n=0;for(unsigned i=0;i<4;i++)n=(n<<8)|uint8_t(raw[at++]);if(n>cap||n>raw.size()-at)throw std::runtime_error("PENDING_JOURNAL_FIELD_BOUND");auto v=raw.substr(at,n);at+=n;return v;};if(take(64)!=android_capture::original_sha256(entered_))throw std::runtime_error("PENDING_JOURNAL_BINDING");const auto r=take(11),c=take(10),n=take(20),m=take(98304);if(at!=raw.size())throw std::runtime_error("PENDING_JOURNAL_TRAILING");size_t used=0;auto rv=std::stoll(r,&used);if(used!=r.size()||std::to_string(rv)!=r||rv<INT32_MIN||rv>INT32_MAX)throw std::runtime_error("PENDING_JOURNAL_STATUS");auto cv=std::stoull(c,&used);if(used!=c.size()||std::to_string(cv)!=c||cv>UINT32_MAX)throw std::runtime_error("PENDING_JOURNAL_CLEANUP");auto nv=std::stoull(n,&used);if(used!=n.size()||std::to_string(nv)!=n||nv>SIZE_MAX)throw std::runtime_error("PENDING_JOURNAL_LENGTH");rc_=int32_t(rv);cleanup_=uint32_t(cv);reported_=size_t(nv);member_.assign(m.begin(),m.end());recovered_=true;ack_=true;terminal_=raw;}
public:
 void openBorrowed(int fd,unsigned kind,const std::string&network,const std::string&registration,const std::string&pending,const std::string&scope){if(fd_<0&&fd>=0&&kind>=1&&kind<=2&&hex(network)&&hex(registration)&&hex(pending)&&!scope.empty()&&scope.size()<=65536){fd_=fd;if(fstat(fd_,&identity_)||!S_ISDIR(identity_.st_mode)||identity_.st_uid!=geteuid()||(identity_.st_mode&07777)!=0700||!identity_.st_nlink)throw std::runtime_error("PENDING_JOURNAL_DIRECTORY");std::string identity="YNX-PRODUCT-DEVICE-PENDING-ONCE/v4";field(identity,std::to_string(kind));field(identity,network);field(identity,registration);field(identity,pending);key_=android_capture::original_sha256(identity);entered_="YNX-PRODUCT-DEVICE-PENDING-ENTERED/v4";field(entered_,identity);field(entered_,scope);return;}throw std::runtime_error("PENDING_JOURNAL_ARGUMENTS");}
 void current(){if(fd_<0||cleanupUnknown_)throw std::runtime_error("PENDING_JOURNAL_NOT_OPEN_OR_CLEANUP_UNKNOWN");struct stat now{};if(fstat(fd_,&now)||!same(identity_,now)||!now.st_nlink)throw std::runtime_error("PENDING_JOURNAL_DIRECTORY_CHANGED");}
 void reserve(){if(reserved_)throw std::runtime_error("PENDING_JOURNAL_SELECTED");reserved_=true;const auto entered=read(key_+".entered",131072),terminal=read(key_+".terminal",131072);if(!entered.empty()||!terminal.empty()){if(entered!=entered_)throw std::runtime_error("PENDING_JOURNAL_ORIGINAL_MISMATCH");if(!terminal.empty())recover(terminal);throw std::runtime_error("PENDING_JOURNAL_ORIGINAL_QUERY_ONLY");}write(key_+".entered",entered_);}
 void enter(){if(!reserved_||recovered_||enteredCore_)throw std::runtime_error("PENDING_JOURNAL_ENTRY_NOT_FRESH");enteredCore_=true;}
 void capture(int32_t rc,uint32_t cleanup,size_t reported,const std::vector<uint8_t>&member){if(!enteredCore_||member.size()>98304)throw std::runtime_error("PENDING_JOURNAL_CAPTURE_PHASE");std::string raw="YNX-PRODUCT-DEVICE-PENDING-OUTCOME/v4";field(raw,android_capture::original_sha256(entered_));field(raw,std::to_string(rc));field(raw,std::to_string(cleanup));field(raw,std::to_string(reported));field(raw,std::string(member.begin(),member.end()));if(terminalSelected_){if(raw!=terminal_)throw std::runtime_error("PENDING_JOURNAL_CHANGED_OUTCOME");if(!ack_)throw std::runtime_error("PENDING_JOURNAL_OUTCOME_ACK_UNKNOWN");return;}terminalSelected_=true;terminal_=raw;member_=member;rc_=rc;cleanup_=cleanup;reported_=reported;write(key_+".terminal",terminal_);ack_=true;}
 bool recovered()const{return recovered_;}bool ack()const{return ack_;}const std::vector<uint8_t>&member()const{return member_;}int32_t rc()const{return rc_;}uint32_t cleanup()const{return cleanup_;}size_t reported()const{return reported_;}
 bool cleanupUnknown()const{return cleanupUnknown_;}
 // No destructor close: the actual Native directory loan owns this FD. Its
 // physical release occurs only after the operation's flush/cleanup debt.
};
}
