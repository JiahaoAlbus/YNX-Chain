#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace ynx::wallet::pay::root_physical {
// PRIVATE physical DATA checks ONLY. This type cannot implement OriginalRootSource
// and never grants Root admission. The dedicated signed SDK Source scope must
// independently authenticate every pin before using this physical component.
enum class Code { ok, not_supplied, path, identity, content, window, retired, close_debt, io };
struct Identity { uint64_t device,inode,uid,gid,mode,links,bytes; };
struct Spec {
 std::string canonical_parent, literal_leaf;
 Identity parent, original;
 std::string sha256;
 uint64_t not_before_ms, expires_ms; // original verified window, never renewed
 uint64_t maximum_bytes;
};
struct Acquisition;
struct RootPublicLocator {std::string parent,leaf;Identity parent_identity;uint64_t not_before_ms,expires_ms,maximum_bytes;};
class PublicOriginalHold final {
public:
 ~PublicOriginalHold();
 PublicOriginalHold(const PublicOriginalHold&)=delete;
 Code current() noexcept;
 // CODE-only physical re-observation, never an operational permission. Keeps
 // original FD/path/hash/tuple and sticky failures; ignores ONLY read expiry.
 Code current_code_only() noexcept;
 // SAME held image FD/hash+actual mapped vnode, pre/post current; no new path.
 Code current_native_image(const void* original_entry,const void* own_hidden_marker) noexcept;
 Code current_native_image_code_only(const void* original_entry,const void* own_hidden_marker) noexcept;
 Code read_original(std::vector<unsigned char>& out) noexcept;
 void retire() noexcept;
 Code close() noexcept;
 bool closed() const noexcept;
private:
 struct Impl;
 std::unique_ptr<Impl> p_;
 explicit PublicOriginalHold(std::unique_ptr<Impl>);
 friend struct Acquisition;
 friend Acquisition hold_original(const Spec&) noexcept;
 friend Acquisition hold_internal(const Spec&,bool) noexcept;
};
struct Acquisition { std::unique_ptr<PublicOriginalHold> owner; Code error; };
// Adopt a nonnull owner BEFORE interpreting error; close failure preserves the
// same owner and parent FDs. Destruction with outstanding ambiguous debt is a
// fail-stop, not an implicit retry or silent parent close.
Acquisition hold_original(const Spec&) noexcept;
// PRIVATE independently released Root0 locator ONLY. Used for external
// postbuild records so their self-image SHA is never compiled into own image.
// Captured file tuple/hash come from the SAME actually held Root0 FD.
Acquisition capture_root_public_original(const RootPublicLocator&) noexcept;
// Actual native addresses, not a JS path callback. Requires both symbols to
// resolve to the SAME actual mapped image and the independently verified path.
Code same_native_image(const void* original_entry,const void* own_hidden_marker,
 const std::string& independent_canonical_image) noexcept;
}
