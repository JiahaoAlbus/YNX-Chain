#pragma once
#include "AndroidCodeImageRootPrivate.h"
#include "RootCaptureResource.hpp"
#include <string>

namespace ynx::auth::android_capture {
// Concrete same-image CODE expectation consumer. Never a Source, approval,
// resource installer, observed-image self-pin or caller supplied provider.
// Serialized by the SAME Captured actor. No Store/global inventory lock may
// span current/read: the actual 9C owner does physical IO/current checks.
class RootImageLease final {
public:
 using Failure=ynx_native_android_code_image_failure_v1;
 using Drain=ynx_native_android_code_image_drain_v1;
 struct CloseObservation{Drain view,root,release;}; // diagnostics, never authority
 RootImageLease()=default;
 RootImageLease(const RootImageLease&)=delete;
 RootImageLease&operator=(const RootImageLease&)=delete;
 RootImageLease(RootImageLease&&)=delete;
 RootImageLease&operator=(RootImageLease&&)=delete;
 ~RootImageLease(); // unresolved original owner/debt is fail-stop, never dropped
 Failure acquire(const Resource&constraint)noexcept;
 Failure current()noexcept; // CODE only; Captured must independently AND Source
 Failure read_resource(const FileResource**out)noexcept;
 void retire()noexcept;
 // Captured must first close ALL evaluator/7 FD/Source children. Does not close
 // those resources or infer their completion. Only retires this view/root.
 Drain close()noexcept;
 Failure first_failure()const noexcept{return first_;}
 Failure cleanup_failure()const noexcept{return cleanup_first_;}
 CloseObservation close_observation()const noexcept{return{view_receipt_,root_receipt_,release_receipt_};}
 bool debt()const noexcept{return root_||view_;}
 bool physically_closed()const noexcept{return closed_;}
private:
 ynx_native_android_code_image_root_v1*root_=nullptr;
 ynx_native_android_code_image_view_v1*view_=nullptr;
 std::string path_,sha_,process_;
 ImageExpectation expectation_{};
 FileResource resource_{};
 Failure first_{},cleanup_first_{};
 Drain view_receipt_{},root_receipt_{},release_receipt_{};
 bool entered_=false,ready_=false,retired_=false,closed_=false;
 bool view_done_=false,root_done_=false,view_unknown_=false,root_unknown_=false,release_unknown_=false,outcome_unknown_=false;
 static Failure local(int)noexcept;
 static Failure valid(Failure)noexcept;
 Failure keep(Failure,bool cleanup=false)noexcept;
 Drain result(bool)const noexcept;
 bool accept_drain(Drain,bool&done,bool&unknown,Drain&receipt)noexcept;
 void materialize(const ynx_native_android_code_image_data_v1&,const Resource&);
};
}
