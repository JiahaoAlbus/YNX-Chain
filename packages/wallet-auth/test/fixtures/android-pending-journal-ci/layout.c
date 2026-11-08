#include "AndroidDevicePendingJournalPrivate.h"
#include <stddef.h>
_Static_assert(sizeof(ynx_auth_android_pending_directory_identity_v1)==32,"directory identity ABI");
_Static_assert(sizeof(ynx_auth_android_pending_journal_constraints_v1)==104,"journal constraints ABI");
_Static_assert(offsetof(ynx_auth_android_pending_journal_constraints_v1,leaf)==72,"fixed leaf ABI");
