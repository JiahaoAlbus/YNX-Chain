#include "normal_native_backend_private.hpp"
#include "SourceParentOriginalProfilePrivate.hpp"
#include "SourceParentManagerProfileDATA.h"
#include <thread>
namespace ynx::network::normalnative::qualified {
namespace {struct State{std::thread::id actor=std::this_thread::get_id();bool selected=false,closeDone=false;Outcome closeResult{};ynx::auth::sourceparent::OriginalProfileAcquisition original;};State&state(){static auto*s=new State;return*s;}Outcome local(Failure f){Outcome o;o.failure=f;return o;}}
Outcome readOriginalNormalHostProfile(Profile&out)noexcept{auto&s=state();if(s.actor!=std::this_thread::get_id())return local(Failure::WrongActor);if(!s.selected){s.selected=true;s.original=ynx::auth::sourceparent::acquireOriginalSourceParentNativeProfile();}// nonnull partial retained before original failure
 if(s.original.failure.present||!s.original.owner)return local(s.original.failure.code==int32_t(ynx::auth::sourceparent::ProfileCode::NotSupplied)?Failure::NotSupplied:Failure::StartupFailed);
 ynx::auth::sourceparent::ProfileImages images;if(s.original.owner->readOriginalImagesDATA(images).present)return local(Failure::StartupFailed);Profile candidate;candidate.independentlyExpectedImages={images.parentCreator,images.coreChild,images.nativeChild};auto data=ynx::sdk::sourceparent::copyOriginalProfileImagesDATA(candidate);(void)data;if(s.original.owner->current().present)return local(Failure::StartupFailed);out=candidate;return{};
}
Outcome assertOriginalNormalHostProfileCurrent()noexcept{auto&s=state();if(s.actor!=std::this_thread::get_id())return local(Failure::WrongActor);if(!s.selected||!s.original.owner||s.original.failure.present)return local(Failure::NotSupplied);return s.original.owner->current().present?local(Failure::StartupFailed):Outcome{};}
Outcome retireOriginalNormalHostProfile()noexcept{auto&s=state();if(s.actor!=std::this_thread::get_id())return local(Failure::WrongActor);if(s.original.owner)s.original.owner->retire();return{};}
Outcome closeOriginalNormalHostProfile()noexcept{auto&s=state();if(s.actor!=std::this_thread::get_id())return local(Failure::WrongActor);if(s.closeDone)return s.closeResult;if(!s.original.owner){s.closeDone=true;s.closeResult=s.original.failure.present?local(s.original.failure.code==int32_t(ynx::auth::sourceparent::ProfileCode::NotSupplied)?Failure::NotSupplied:Failure::StartupFailed):Outcome{};return s.closeResult;}bool done=false;auto f=s.original.owner->close(done);if(!done)return local(Failure::Pending);s.closeDone=true;s.closeResult=f.present?local(Failure::StartupFailed):Outcome{};s.original.owner.reset();return s.closeResult;}
}
