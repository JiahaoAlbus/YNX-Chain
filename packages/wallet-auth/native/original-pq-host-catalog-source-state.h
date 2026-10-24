#pragma once
namespace ynx_auth_private {
// Private lifetime bookkeeping only. NOT qualification, a Root constructor,
// a signer, FD carrier or permission. Native still checks its actual Source.
class PQCatalogSourceAttempt final {
 bool selected_=false,entered_=false,active_=false,result_=false,unknown_=false,retired_=false;
 bool closeSelected_=false,closeCompleted_=false,closed_=false;const char* first_=nullptr;
public:
 bool select(){if(selected_||retired_||closeSelected_)return false;selected_=true;unknown_=true;return true;}
 bool enter(){if(!selected_||entered_||active_||retired_||closeSelected_)return false;entered_=true;active_=true;return true;}
 void joined(){active_=false;}
 void captureResult(){result_=true;}
 bool complete(){if(!selected_||active_||!result_||first_||retired_||closeSelected_)return false;unknown_=false;return true;}
 void fail(const char*code){if(!first_)first_=code;unknown_=true;retired_=true;}
 void retire(){retired_=true;}
 bool joinReady()const{return retired_&&!active_;}
 bool selectClose(){if(closeSelected_||!joinReady())return false;closeSelected_=true;return true;}
 void closeResult(bool actual){if(closeSelected_&&!closeCompleted_){closeCompleted_=true;closed_=actual;}}
 bool selected()const{return selected_;}bool active()const{return active_;}bool result()const{return result_;}
 bool unknown()const{return unknown_;}bool retired()const{return retired_;}
 bool closeSelected()const{return closeSelected_;}bool closed()const{return closed_;}
 const char*firstCause()const{return first_;}
};
}
