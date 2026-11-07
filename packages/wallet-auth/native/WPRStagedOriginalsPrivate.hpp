#pragma once
#include "WPRPublicationReleasePrivate.hpp"
#include "original-source-public-installation.h"
#include <memory>
#include <thread>
namespace ynx::wallet::product::publication {
// Protected PUBLIC materialization holder only. Qualification is still the
// original independently pinned Source-v2 verifier; files/hash/row != grant.
class StagedOriginals final {
 const InstallationRelease*row_=nullptr;InstallationRelease same_;std::thread::id worker_=std::this_thread::get_id();
 int directory_=-1;struct stat directory_identity_{};std::array<int,4>fds_{{-1,-1,-1,-1}};
 std::array<struct stat,4>identities_{};std::array<bool,4>close_selected_{};
 ynx_auth_private::SourcePublicInstallation::Bundle originals_;
 bool directory_close_selected_=false,closed_=false,retired_=false;std::string first_;
 StagedOriginals()=default;
 int fail(const char*)noexcept;
public:
 struct Acquisition;
 static Acquisition acquire(const InstallationRelease*)noexcept;
 int current()noexcept;
 const auto&originals_DATA()const noexcept{return originals_;}
 const InstallationRelease*registered_release_DATA()const noexcept{return row_;}
 void retire()noexcept{retired_=true;}
 int close()noexcept;
 bool physically_closed()const noexcept{return closed_;}
 const std::string&first_cause()const noexcept{return first_;}
};
struct StagedOriginals::Acquisition{std::shared_ptr<StagedOriginals>owner;int error=1;};
}
