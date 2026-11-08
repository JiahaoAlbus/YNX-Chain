#pragma once
// Read-only actual FD/named-binding mechanism; never Root/schema authority.
#include "RootCaptureResource.hpp"
#include "OriginalSHA256.hpp"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <string>
#include <cstring>
#include <stdexcept>
#include <limits.h>
#include <algorithm>
namespace ynx::auth::android_capture {
class RootFile{
 const FileResource*resource_=nullptr;int fd_=-1;struct stat initial_{};std::string original_;bool close_selected_=false,closed_=false;
 static bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtime==b.st_mtime&&a.st_ctime==b.st_ctime
#ifdef __APPLE__
 &&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec
#else
 &&a.st_mtim.tv_nsec==b.st_mtim.tv_nsec&&a.st_ctim.tv_nsec==b.st_ctim.tv_nsec
#endif
 ;}
 std::string read()const{struct stat before{},after{};if(fd_<0||fstat(fd_,&before)||!S_ISREG(before.st_mode)||before.st_nlink!=1||before.st_size<=0||std::uint64_t(before.st_size)>resource_->maximum)throw 3;std::string out(static_cast<std::size_t>(before.st_size),'\0');std::size_t at=0;while(at<out.size()){auto n=pread(fd_,out.data()+at,out.size()-at,at);if(n<=0)throw 3;at+=n;}if(fstat(fd_,&after)||!same(before,after))throw 6;return out;}
 void verify_image(){auto*e=resource_->image_expectation;if(!e||!e->bytes||e->bytes!=std::uint64_t(initial_.st_size)||e->bytes>268435456u||!digest_shape(e->sha256))throw 2;current();OriginalSHA256Stream hash;std::array<unsigned char,65536>chunk{};std::uint64_t at=0;while(at<e->bytes){auto n=pread(fd_,chunk.data(),std::min<std::uint64_t>(chunk.size(),e->bytes-at),static_cast<off_t>(at));if(n<=0)throw 3;hash.update(chunk.data(),static_cast<size_t>(n));at+=static_cast<std::uint64_t>(n);}current();if(hash.finish()!=e->sha256)throw 6;}
public:
 RootFile()=default;RootFile(const RootFile&)=delete;RootFile&operator=(const RootFile&)=delete;
 void open(const FileResource&r){if(fd_>=0||close_selected_||!r.path||r.path[0]!='/'||!r.device||!r.inode||!r.maximum||r.maximum>(r.image?268435456u:2097152u))throw 2;resource_=&r;char resolved[PATH_MAX];if(!realpath(r.path,resolved)||std::strcmp(resolved,r.path))throw 6;fd_=::open(r.path,O_RDONLY|O_NOFOLLOW|O_NONBLOCK|O_CLOEXEC);if(fd_<0)throw 3;if(fstat(fd_,&initial_)||!S_ISREG(initial_.st_mode)||initial_.st_nlink!=1||std::uint64_t(initial_.st_dev)!=r.device||std::uint64_t(initial_.st_ino)!=r.inode||initial_.st_uid!=r.uid||initial_.st_gid!=r.gid||(initial_.st_mode&07777)!=r.mode||initial_.st_size<=0||std::uint64_t(initial_.st_size)>r.maximum)throw 6;if(r.image)verify_image();else{if(r.image_expectation)throw 2;original_=read();}current();}
 void current()const{if(closed_||close_selected_||fd_<0||!resource_)throw 8;char resolved[PATH_MAX];struct stat held{},named{};auto named_current=[&](){return realpath(resource_->path,resolved)&&!std::strcmp(resolved,resource_->path)&&!fstat(fd_,&held)&&!lstat(resource_->path,&named)&&same(initial_,held)&&same(initial_,named)&&held.st_nlink==1;};if(!named_current()||(!resource_->image&&read()!=original_)||!named_current())throw 6;}
 const std::string&original()const{return original_;}
 bool close()noexcept{if(closed_)return true;if(close_selected_)return false;close_selected_=true;if(fd_>=0&&::close(fd_)!=0)return false;fd_=-1;closed_=true;original_.clear();return true;}
 bool debt()const noexcept{return!closed_&&(fd_>=0||close_selected_);}
 ~RootFile(){if(debt())std::abort();}
};
}
