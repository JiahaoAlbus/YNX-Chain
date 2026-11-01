#pragma once
#include <string>
#include <stdexcept>
namespace ynx_auth_private {
// Original Native attempt mechanics, NOT a cryptographic verifier/grant. The
// owning NAPI must retain Source/journal and verify original signed witness.
struct FirstEnterSelection {
 bool captured=false,selected=false,verified=false,effectSelected=false,retired=false,closed=false;
 std::string first;
 void fail(const char *cause){if(first.empty())first=cause;throw std::runtime_error(first);}
 void capture(){if(captured||retired||closed)fail("FIRST_ENTER_CAPTURE_UNAVAILABLE");captured=true;}
 void current(){if(!first.empty())throw std::runtime_error(first);if(!captured||retired||closed)fail("FIRST_ENTER_ORIGINAL_UNAVAILABLE");}
 void select(){current();if(selected)fail("FIRST_ENTER_ALREADY_SELECTED");selected=true;}
 void accept(){current();if(!selected||verified)fail("FIRST_ENTER_VERIFICATION_ORDER");verified=true;}
 void selectEffect(){current();if(!verified||effectSelected)fail("FIRST_ENTER_EFFECT_ALREADY_SELECTED");effectSelected=true;}
 void retire(){retired=true;}
 void close(){retired=true;closed=true;}
};
}
