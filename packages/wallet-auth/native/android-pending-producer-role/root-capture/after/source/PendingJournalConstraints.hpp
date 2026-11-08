#pragma once
#include "RootCaptureResource.hpp"
#include "AndroidDevicePendingJournalPrivate.h"
#include <cstring>
namespace ynx::auth::android_capture {
// Pure projection of independently reviewed row DATA. Caller still must hold
// the actual capture, perform both physical/current fences and OS FD checks.
inline int copy_pending_journal_constraints(const Resource&r,ynx_auth_android_pending_journal_constraints_v1&out){
 out={};if(r.kind!=4||!r.pending_journal)return 1;
 const auto&j=*r.pending_journal;
 auto valid=[&](const PendingJournalDirectory&d){return d.device&&d.inode&&d.uid==r.application_uid&&d.gid==r.application_gid&&d.mode==0700;};
 if(!valid(j.parent)||!valid(j.directory)||(j.parent.device==j.directory.device&&j.parent.inode==j.directory.inode))return 2;
 out.version=1;out.size=sizeof(out);
 out.parent={j.parent.device,j.parent.inode,j.parent.uid,j.parent.gid,j.parent.mode,0};
 out.directory={j.directory.device,j.directory.inode,j.directory.uid,j.directory.gid,j.directory.mode,0};
 constexpr char leaf[]="ynx-product-device-v4";
 static_assert(sizeof(leaf)<=sizeof(out.leaf));std::memcpy(out.leaf,leaf,sizeof(leaf));return 0;
}
}
