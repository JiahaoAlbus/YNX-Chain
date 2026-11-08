#pragma once
// The actual original Main owner now supplies this SAME-image private header
// and real Rust bodies. No copied declarations, weak fallback, provider or
// alternate app context. Its original OS parent FD is borrowed, never closed
// by Native; the owned Native child must drain before this Main loan returns.
#include <PendingMainCalleePrivate.h>
