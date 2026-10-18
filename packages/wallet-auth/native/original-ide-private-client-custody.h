#pragma once
namespace ynx_auth_ide_private {
// Custody only, never Source admission or a fake client capability.
// Exactly one private child selection per original once-adopted Node delivery.
class PrivateClientCustody final {
 bool selected_=false;unsigned count_=0;
public:
 bool select(bool parentClosing){if(selected_||parentClosing||count_)return false;selected_=true;count_=1;return true;}
 bool returnOnce(){if(count_!=1)return false;count_=0;return true;}
 unsigned count()const{return count_;}
 bool parentCanClose()const{return count_==0;}
};
}
