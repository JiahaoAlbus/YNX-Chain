#pragma once
#include <array>
#include <cstdint>
#include <memory>
namespace ynx::auth::sourceparent {
enum class ProfileRole:uint8_t {ParentCreator=1,CoreChild=2,NativeChild=3};
enum class ProfileCode:int32_t {NotSupplied=1,Registration,Path,Identity,Content,Role,Retired,Pending,WrongActor,IO};
struct ProfileFailure {bool present=false;int32_t code=0;int systemError=0;};
struct ProfileImages {std::array<uint8_t,32>parentCreator{},coreChild{},nativeChild{};};
// CODE image expectations only. This can never create SourceBIND, an account
// Source, a native engine receipt, a Manager, process or transport capability.
class OriginalSourceParentImageProfile final {
 struct Impl;std::unique_ptr<Impl>impl_;
 OriginalSourceParentImageProfile();
 friend struct OriginalProfileFactory;
public:
 ~OriginalSourceParentImageProfile();
 OriginalSourceParentImageProfile(const OriginalSourceParentImageProfile&)=delete;
 ProfileFailure current()noexcept;
 ProfileFailure readOriginalImagesDATA(ProfileImages&)noexcept;
 ProfileFailure retainChild()noexcept;
 ProfileFailure releaseChild()noexcept;
 void retire()noexcept;
 ProfileFailure close(bool&physicalDone)noexcept;
 bool isClosed()const noexcept;
};
struct OriginalProfileAcquisition {std::shared_ptr<OriginalSourceParentImageProfile>owner;ProfileFailure failure;};
// All three fixed normal entries are zero-input. No caller may select paths,
// expected hashes, a profile JSON, Manager options, FD, Source or callbacks.
OriginalProfileAcquisition acquireOriginalSourceParentParentProfile()noexcept;
OriginalProfileAcquisition acquireOriginalSourceParentCoreProfile()noexcept;
OriginalProfileAcquisition acquireOriginalSourceParentNativeProfile()noexcept;
}
