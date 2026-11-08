#pragma once
#include <array>
#include <cstdint>
#include <cstddef>
namespace ynx::auth::android_capture {
// Private reviewed release material, NOT an install API or a new trust model.
// Root's original public-key/enrollment/profile/current signatures and sole
// schema still decide trust. Locators/pins only select physical originals.
// Expected image facts must originate in independent protected post-build Root
// registration; never fill them from the file being observed or compile a
// binary's final SHA back into that same binary. Empty normal rows stay empty.
struct ImageExpectation{std::uint64_t bytes;const char*sha256;};
struct FileResource{const char*path;std::uint64_t device,inode;std::uint32_t uid,gid,mode;std::size_t maximum;bool image=false;const ImageExpectation*image_expectation=nullptr;};
struct SelectedSignatureContract{const char*purpose;const char*enrollment_frame;const char*profile_frame;const char*current_frame;};
// Exactly the independently selected eight SDK policy fields, never populated
// by parsing the received policy file or by App/HTTP input. No new Root key.
struct SelectedPolicy{
 const char*product_id;const char*application_id;const char*endpoint;const char*spki;
 const char*root_digest;const char*enrollment_digest;SelectedSignatureContract signature_contract;
 const char*platform;
};
struct Resource{
 std::array<std::uint8_t,32> resource,registered_resource,query_resource;
 std::uint32_t kind,application_uid,application_gid;
 const char*process_name;FileResource module_image;
 // Existing public original files; never mkdir, rewrite, repair or create.
 FileResource root,enrollment,profile,baseline_head,policy,previous;
 const char*node_origin;const char*node_spki;const char*native_chain_id;
 // Original preparePQAuthorizationQuery paths for Root/profile/current/
 // subject owners. They are GET constraints; sole parser independently
 // derives owners from verified originals and rejects the wrong response.
 std::array<const char*,4> original_authorization_paths;
 const char*current_endpoint;const char*current_spki;const char*profile_sha256;
 // Original Source-current challenge lifetime, never DEVICE op/nonce/time.
 std::int64_t maximum_capture_ms;
 const SelectedPolicy*selected_policy=nullptr;
};
// Source-owned reviewed release table. A row is not Source/approval. The
// actual Android compatible purpose policy must separately be supplied to
// the sole SDK and pass its original full mathematics. Default has no rows.
inline const Resource*const* original_root_resources(std::size_t&count){count=0;return nullptr;}
}
