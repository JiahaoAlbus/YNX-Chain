#pragma once
#include "MobileSelectedOriginalPrivate.h"
#include <array>
#include <memory>
#include <string>

namespace ynx::mobilepq::directories {
enum Code : int32_t {
 ok=0, invalid=9701, changed=9702, closed=9703, wrongThread=9704,
 debt=9705, io=9706, bounds=9707, notSupplied=9708
};
/* Private Native backend input ONLY. All FDs already belong to the actual
 * selected app/account inventory. These are borrowed; pin duplicates them.
 * parent_fd is the protected Native container immediately naming leaf, NOT
 * an OS ancestor such as Android /data. root_locator is an opaque lookup key,
 * never interpreted as a path. There is no mkdir/discovery/JS registration.
 */
struct NativeDirectory {
 uint32_t kind=0;
 std::string root_locator,leaf;
 int parent_fd=-1,directory_fd=-1;
};
class SelectedDirectoryInventory final {
 struct Impl;
 std::unique_ptr<Impl> impl_;
 explicit SelectedDirectoryInventory(YNXMobilePQSelectedOriginal*);
 static int32_t pinImpl(YNXMobilePQSelectedOriginal*,const std::array<NativeDirectory,3>&,
                        bool sourceOnly,std::shared_ptr<SelectedDirectoryInventory>&);
public:
 ~SelectedDirectoryInventory();
 SelectedDirectoryInventory(const SelectedDirectoryInventory&)=delete;
 SelectedDirectoryInventory& operator=(const SelectedDirectoryInventory&)=delete;
 /* Nonnull partial adopted before pin status. Caller closes partial as well.
  * These physical pins confer no Root/Source/review/account authority. */
 static int32_t pin(YNXMobilePQSelectedOriginal*,const std::array<NativeDirectory,3>&,
                    std::shared_ptr<SelectedDirectoryInventory>&);
 /* Independent pre-capture registered-account observation. Pins Source role1
  * ONLY; no journal/slot directory (even an empty one) is a prerequisite.
  * This owner cannot gain more roles or claim a review after construction. */
 static int32_t pinRegisteredSourceOnly(YNXMobilePQSelectedOriginal*,const NativeDirectory&,
                                       std::shared_ptr<SelectedDirectoryInventory>&);
 bool belongsTo(YNXMobilePQSelectedOriginal*)const noexcept;
 bool registeredSourceOnly()const noexcept;
 int32_t current();
 void retire()noexcept; // called by actual account/epoch invalidation, any thread
 int32_t close();       // stops borrows, retains pins until ALL child releases
 bool isClosed()const noexcept;
 size_t childDebt()const noexcept;
 int32_t borrow(uint32_t,YNXMobileSelectedPublicSpan,YNXMobilePQSelectedDirectoryLoan**,
                YNXMobilePQSelectedDirectoryDATA*,const std::shared_ptr<SelectedDirectoryInventory>&);
 int32_t releaseChild();
};
/* REQUIRED strong callee owned by the REAL selected-original implementation.
 * Return that SAME mother's already pinned inventory, after validating its
 * Native token; never populate an alternate selected map/provider in this
 * module. Mother close must call inventory.close(), and mother release must
 * require inventory.isClosed(). Its current(phase1) must check actual Native
 * account/epoch/review lifetime without recursing into Auth/these children.
 * Missing implementation fails matching platform link; no denial stub exists.
 */
std::shared_ptr<SelectedDirectoryInventory> selectedDirectoryInventory(YNXMobilePQSelectedOriginal*);
// Strong SAME registered mother Source/Root/clock-only fence. It never reads
// or advances its ledger proof. Strict three-role inventories keep legacy
// selected_original_current instead; outer registered v2 still gates READY.
int32_t registeredSourceFenceForDirectory(YNXMobilePQSelectedOriginal*);
}
