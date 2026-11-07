#pragma once
// PRIVATE matching ports, not an implementation/qualification claim. No caller
// can install a provider, key, signature domain, path, clock or registration.
// Definitions must come from the original registered services in this image.
#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace ynx::social::joint::original {
using Bytes = std::vector<unsigned char>;
using Resource = std::array<unsigned char,32>;
inline constexpr std::size_t OriginalMax=65536, BodyMax=32768;
struct Result {
 bool error_present=false;
 std::int32_t first=0;
 bool unknown=false;
 bool physical_done=false;
 bool ok() const noexcept { return !error_present&&!unknown&&first==0; }
};
struct SourceInput {
 Resource resource;
 std::array<Bytes,4> originals;
 std::uint64_t same_process_capture_reference=0;
};
struct Window { std::int64_t not_before_ms=0,expires_ms=0; };
struct SocialData {
 std::array<std::string,6> application;
 Bytes classic_public,pq_public;
 Window window;
};
struct DeviceData {
 std::array<std::string,17> expected;
 std::uint32_t null_mask=0;
 Window window;
};
struct SocialView {
 virtual const SocialData& data() const noexcept=0;
 virtual Result release() noexcept=0;
 virtual ~SocialView()=default;
};
struct DeviceView {
 virtual const DeviceData& data() const noexcept=0;
 virtual Result release() noexcept=0;
 virtual ~DeviceView()=default;
};
struct SocialHolder {
 virtual Result current() noexcept=0;
 virtual void view(std::shared_ptr<SocialView>&,Result&) noexcept=0;
 virtual Result close() noexcept=0;
 virtual ~SocialHolder()=default;
};
struct DeviceHolder {
 virtual Result current() noexcept=0;
 virtual void view(std::shared_ptr<DeviceView>&,Result&) noexcept=0;
 virtual Result close() noexcept=0;
 virtual ~DeviceHolder()=default;
};
struct Role {
 // A finite original operation is selected at acquisition. These methods take
 // no new body/key/nonce/provider. Intent is durable BEFORE any key entry.
 virtual Result current() noexcept=0;
 virtual Result enterOriginalOnce() noexcept=0;
 virtual Result durableOriginalIntentCurrent() noexcept=0;
 virtual Result signOnceOriginalSourceProof() noexcept=0;
 virtual Result copyOriginal(Bytes&) noexcept=0;
 virtual Result queryOriginal(Bytes&) noexcept=0;
 virtual Result retire() noexcept=0;
 virtual Result join() noexcept=0;
 virtual Result close() noexcept=0;
 virtual ~Role()=default;
};
struct Source {
 virtual Result current() noexcept=0;
 virtual Window window() const noexcept=0;
 // Reuses the registered Source/approved_profiles, credentials, history,
 // catalog, Root registration, scope7 and both policy10 current owners.
 // It must not regard these input public originals as an admission.
 virtual Result matchCurrentOriginals(const SourceInput&) noexcept=0;
 virtual Result matchBinding(SocialHolder&,DeviceHolder&) noexcept=0;
 // Sole PrepareBodyDATA/InspectBodyOriginalDATA implementation, independently
 // supplied with THIS source and both genuine held originals; not a C++ codec.
 virtual Result inspectOriginalBodyDATA(SocialHolder&,DeviceHolder&,
                                      const Bytes&) noexcept=0;
 virtual void role(SocialHolder&,DeviceHolder&,const Resource& binding_resource,
                   const Resource& role_resource,std::uint32_t,
                   const Bytes& body_original,const Bytes& source_frame_original,
                   std::shared_ptr<Role>&,Result&) noexcept=0;
 virtual Result close() noexcept=0;
 virtual ~Source()=default;
};
// These are required private matching-service definitions, NOT symbols claimed
// to exist already. Their concrete adapters and provenance are a separate
// normal-link requirement. PUBLIC tests define them only in their own binary.
// Source acquisition must recognize its resource in the original service, and
// recheck the independently held raw originals before returning even partial.
void acquireRegisteredSource(const SourceInput&,std::shared_ptr<Source>&,Result&) noexcept;
// Two independent original holders; their combination is implemented here in
// Native binding, never returned as an expected17/public-DTO authority token.
void acquireCommittedSocialPair(Source&,const Resource&,std::shared_ptr<SocialHolder>&,Result&) noexcept;
void acquireRegisteredDeviceSession(Source&,SocialHolder&,const Resource&,std::shared_ptr<DeviceHolder>&,Result&) noexcept;
// Finite registered custodian operation. Must select the SAME role resource,
// independently check policy10 and hold original own-UID sealed custody. The
// body/frame are constraints, never a generic signing capability.
void acquireOriginalFiniteRole(Source&,SocialHolder&,DeviceHolder&,
 const Resource& binding_resource,const Resource& role_resource,
 std::uint32_t,const Bytes&,const Bytes&,
 std::shared_ptr<Role>&,Result&) noexcept;
// Public originals copied ONLY from the recognized, current concrete source.
// They remain constraints. The private capture reference MUST NOT be sent to
// another process/UID or used instead of the service's own Source validation.
void copyOriginalCapturedSourceInputs(Source&,SourceInput&,Result&) noexcept;
// Synchronous SAME-process/private-holder composition only. Recognizes the
// concrete capture owner and checks current before AND after reading its loan.
// Caller must hold the Source for the entire composed holder lifetime. This is
// not a new retain, registration token, public DTO, or cross-UID capability.
Result borrowCapturedSourceLoan(Source&,std::uint64_t&) noexcept;
// Thin private adapter to Auth's actual pure SOURCE-PROOF Go frame writer.
// Role is fixed to 1/2 here; this neither grants admission nor selects keys.
Result prepareOriginalSourceFrame(std::uint32_t,const Bytes&,Bytes&);
} // namespace ynx::social::joint::original
