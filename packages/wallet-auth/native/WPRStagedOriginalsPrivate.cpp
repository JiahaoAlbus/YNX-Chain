#include "WPRStagedOriginalsPrivate.hpp"
#include <CommonCrypto/CommonDigest.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <map>
#include <mutex>
namespace ynx::wallet::product::publication {
namespace {std::mutex mutex;auto&held=*new std::map<const StagedOriginals*,std::shared_ptr<StagedOriginals>>;
constexpr const char*names[]={"root.original","enrollment.original","profile.original","head.original"};
bool same(const struct stat&a,const struct stat&b){return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_uid==b.st_uid&&a.st_gid==b.st_gid&&a.st_mode==b.st_mode&&a.st_nlink==b.st_nlink&&a.st_size==b.st_size&&a.st_mtimespec.tv_sec==b.st_mtimespec.tv_sec&&a.st_mtimespec.tv_nsec==b.st_mtimespec.tv_nsec&&a.st_ctimespec.tv_sec==b.st_ctimespec.tv_sec&&a.st_ctimespec.tv_nsec==b.st_ctimespec.tv_nsec;}
std::string sha(const std::vector<unsigned char>&b){unsigned char h[32];if(!CC_SHA256(b.data(),(CC_LONG)b.size(),h))throw std::runtime_error("WPR_INPUT_SHA_FAILED");std::string s;constexpr char hex[]="0123456789abcdef";for(auto c:h){s+=hex[c>>4];s+=hex[c&15];}return s;}
}
int StagedOriginals::fail(const char*s)noexcept{if(first_.empty())first_=s;return 1;}
StagedOriginals::Acquisition StagedOriginals::acquire(const InstallationRelease*r)noexcept{
 Acquisition result;try{result.owner=std::shared_ptr<StagedOriginals>(new StagedOriginals);{std::lock_guard<std::mutex>l(mutex);held.emplace(result.owner.get(),result.owner);}auto&o=*result.owner;
 // Private pointer must be the actual external Root-reviewed table element.
 // Root0 refuses before reading even a public target/materialized path.
 if(!registered(r)||!valid_installation_release(*r)){result.error=o.fail("WPR_INSTALL_RELEASE_NOT_SUPPLIED");return result;}o.row_=r;o.same_=*r;
 if(!ynx_auth_private::SourcePublicInstallation::protectedRootAncestors(r->materialized_directory)){result.error=o.fail("WPR_INPUT_ANCESTRY_REQUIRED");return result;}
 o.directory_=open(r->materialized_directory.c_str(),O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);if(o.directory_<0){result.error=o.fail("WPR_INPUT_DIRECTORY_REQUIRED");return result;}
 if(fstat(o.directory_,&o.directory_identity_)||!S_ISDIR(o.directory_identity_.st_mode)||o.directory_identity_.st_uid!=0||(o.directory_identity_.st_mode&0022)||uint64_t(o.directory_identity_.st_dev)!=r->materialized_device||uint64_t(o.directory_identity_.st_ino)!=r->materialized_inode){result.error=o.fail("WPR_INPUT_DIRECTORY_CHANGED");return result;}
 for(size_t n=0;n<4;n++){o.fds_[n]=openat(o.directory_,names[n],O_RDONLY|O_NOFOLLOW|O_CLOEXEC|O_NONBLOCK);auto&st=o.identities_[n];const auto cap=n==0?ynx_auth_private::OriginalAuthPublicRootMax:ynx_auth_private::OriginalAuthPublicOriginalMax;
 if(o.fds_[n]<0||fstat(o.fds_[n],&st)||!S_ISREG(st.st_mode)||st.st_uid!=0||st.st_nlink!=1||!ynx_auth_private::SourcePublicInstallation::protectedOriginalDescriptorACL(o.fds_[n])||(st.st_mode&07777)!=0644||st.st_size<=0||uint64_t(st.st_size)>cap){result.error=o.fail("WPR_INPUT_FILE_REQUIRED");return result;}auto&bytes=o.originals_[n];bytes.resize(st.st_size);size_t at=0;while(at<bytes.size()){ssize_t count=pread(o.fds_[n],bytes.data()+at,bytes.size()-at,at);if(count<0&&errno==EINTR)continue;if(count<=0){result.error=o.fail("WPR_INPUT_READ_UNKNOWN");return result;}at+=size_t(count);}if(sha(bytes)!=r->public_original_sha256[n]){result.error=o.fail("WPR_INPUT_DIGEST_MISMATCH");return result;}}
 result.error=o.current();return result;
 }catch(...){if(result.owner)result.error=result.owner->fail("WPR_INPUT_CAPTURE_UNKNOWN");return result;}
}
int StagedOriginals::current()noexcept{try{
 if(worker_!=std::this_thread::get_id())return 27;if(retired_||closed_||!first_.empty())return 1;if(!registered(row_)||!same_installation_release(*row_,same_)||!valid_installation_release(*row_))return fail("WPR_INPUT_RELEASE_CHANGED");
 struct stat d{},named{};if(directory_<0||fstat(directory_,&d)||lstat(row_->materialized_directory.c_str(),&named)||!same(d,directory_identity_)||!same(d,named)||!ynx_auth_private::SourcePublicInstallation::protectedRootAncestors(row_->materialized_directory))return fail("WPR_INPUT_DIRECTORY_CHANGED");
 for(size_t n=0;n<4;n++){struct stat s{},namedFile{},after{};if(fds_[n]<0||fstat(fds_[n],&s)||fstatat(directory_,names[n],&namedFile,AT_SYMLINK_NOFOLLOW)||!same(s,identities_[n])||!same(s,namedFile)||!ynx_auth_private::SourcePublicInstallation::protectedOriginalDescriptorACL(fds_[n]))return fail("WPR_INPUT_FILE_CHANGED");std::vector<unsigned char>readback(originals_[n].size());size_t at=0;while(at<readback.size()){ssize_t count=pread(fds_[n],readback.data()+at,readback.size()-at,at);if(count<0&&errno==EINTR)continue;if(count<=0)return fail("WPR_INPUT_READ_UNKNOWN");at+=size_t(count);}if(readback!=originals_[n]||sha(readback)!=row_->public_original_sha256[n]||fstat(fds_[n],&after)||!same(s,after))return fail("WPR_INPUT_CONTENT_CHANGED");}
 if(fstat(directory_,&d)||lstat(row_->materialized_directory.c_str(),&named)||!same(d,directory_identity_)||!same(d,named))return fail("WPR_INPUT_POST_DIRECTORY_CHANGED");return 0;
 }catch(...){return fail("WPR_INPUT_CURRENT_UNKNOWN");}}
int StagedOriginals::close()noexcept{
 if(worker_!=std::this_thread::get_id())return 27;if(closed_)return 0;retired_=true;
 for(size_t reverse=4;reverse>0;--reverse){size_t n=reverse-1;if(fds_[n]<0)continue;if(close_selected_[n])return fail("WPR_INPUT_CHILD_CLOSE_UNKNOWN");close_selected_[n]=true;if(::close(fds_[n]))return fail("WPR_INPUT_CHILD_CLOSE_UNKNOWN");fds_[n]=-1;}
 if(directory_>=0){if(directory_close_selected_)return fail("WPR_INPUT_PARENT_CLOSE_UNKNOWN");directory_close_selected_=true;if(::close(directory_))return fail("WPR_INPUT_PARENT_CLOSE_UNKNOWN");directory_=-1;}
 closed_=true;std::lock_guard<std::mutex>l(mutex);held.erase(this);return 0;
}
}
