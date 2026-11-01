#include "Wrapped43Record.h"
#include <algorithm>
#include <cerrno>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
namespace ynx::mobilepq::os43::storage_only {
namespace {struct File {int fd;explicit File(int n):fd(n){}~File(){if(fd>=0)::close(fd);}};
std::string name(const YNXMobileOS43Descriptor& d){return itemID(d)+".wrapped43";}}
Lock::~Lock(){if(fd_>=0)::close(fd_);}
bool directory(const YNXMobileOS43Descriptor& d){struct stat st{};return d.directory_fd>=0&&fstat(d.directory_fd,&st)==0&&S_ISDIR(st.st_mode)&&(st.st_mode&0777)==0700&&uint64_t(st.st_dev)==d.directory_device&&uint64_t(st.st_ino)==d.directory_inode&&st.st_uid==d.directory_uid&&st.st_gid==d.directory_gid;}
Lock lockDirectory(const YNXMobileOS43Descriptor& d){
 if(!directory(d))return Lock(-1);int fd=openat(d.directory_fd,".pq43.lock",O_RDWR|O_CREAT|O_NOFOLLOW|O_CLOEXEC,0600);if(fd<0)return Lock(-1);
 struct stat st{};if(fstat(fd,&st)||!S_ISREG(st.st_mode)||(st.st_mode&0777)!=0600||st.st_uid!=d.directory_uid||st.st_gid!=d.directory_gid||st.st_nlink!=1||flock(fd,LOCK_EX|LOCK_NB)){::close(fd);return Lock(-1);}return Lock(fd);
}
int32_t readRecord(const YNXMobileOS43Descriptor& d,std::vector<uint8_t>& out,Identity* identity){
 if(!directory(d))return changed;File f(openat(d.directory_fd,name(d).c_str(),O_RDONLY|O_NOFOLLOW|O_CLOEXEC));if(f.fd<0)return errno==ENOENT?missing:io;
 struct stat before{},after{},named{};if(fstat(f.fd,&before)||!S_ISREG(before.st_mode)||before.st_nlink!=1||(before.st_mode&0777)!=0600||before.st_uid!=d.directory_uid||before.st_gid!=d.directory_gid||before.st_size!=159)return changed;
 std::vector<uint8_t> bytes(160);size_t n=0;while(n<bytes.size()){auto count=read(f.fd,bytes.data()+n,bytes.size()-n);if(count<0&&errno==EINTR)continue;if(count<0)return io;if(!count)break;n+=size_t(count);}
 if(n!=159||fstat(f.fd,&after)||fstatat(d.directory_fd,name(d).c_str(),&named,AT_SYMLINK_NOFOLLOW)||before.st_dev!=after.st_dev||before.st_ino!=after.st_ino||before.st_size!=after.st_size||before.st_dev!=named.st_dev||before.st_ino!=named.st_ino)return changed;
 bytes.resize(159);auto aad=metadata(d);if(!std::equal(aad.begin(),aad.end(),bytes.begin()))return changed;
 if(identity)*identity={before.st_dev,before.st_ino};out=std::move(bytes);return 0;
}
Effect writeAbsent(const YNXMobileOS43Descriptor& d,const Lock& lock,const std::vector<uint8_t>& bytes){
 if(!lock.valid()||!directory(d)||bytes.size()!=159)return {invalid,false};auto aad=metadata(d);if(!std::equal(aad.begin(),aad.end(),bytes.begin()))return {changed,false};
 File f(openat(d.directory_fd,name(d).c_str(),O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600));if(f.fd<0)return {errno==EEXIST?exists:io,false};
 size_t n=0;while(n<bytes.size()){auto count=write(f.fd,bytes.data()+n,bytes.size()-n);if(count<0&&errno==EINTR)continue;if(count<=0)return {unknown,true};n+=size_t(count);}
 if(fsync(f.fd)||fsync(d.directory_fd))return {unknown,true};return {0,true};
}
int32_t removeExact(const YNXMobileOS43Descriptor& d,const Lock& lock,const Identity& original){
 struct stat named{};if(!lock.valid()||!directory(d)||fstatat(d.directory_fd,name(d).c_str(),&named,AT_SYMLINK_NOFOLLOW)||named.st_dev!=original.device||named.st_ino!=original.inode)return changed;
 if(unlinkat(d.directory_fd,name(d).c_str(),0)||fsync(d.directory_fd))return unknown;return 0;
}
}
