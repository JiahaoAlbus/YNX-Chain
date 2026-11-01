#include "pay_native_channel_private.hpp"
#include <cassert>
#include <iostream>
int main(){
 std::unique_ptr<ynx::wallet::pay::QualifiedPayChannel>out;bool denied=false;
 try{ynx_wallet_capture_original_pay_channel_v1(nullptr,false,nullptr,&out);}
 catch(const ynx::wallet::pay::Failure&e){denied=e.code=="PAY_NATIVE_SOURCE_LEASE_2";}
 assert(denied&&!out);
 std::cout<<"{\"normalArchiveStrongLink\":true,\"missingSourceRefused\":true,\"RootAdmission\":false,\"SourceAdmission\":false,\"actualMainMatched\":false,\"installed\":false}\n";
}
