#include "archive_read_contract.hpp"
#include <iostream>

// DATA interoperability projection only, never a Root/Source grant or client.
int main(int argc,char**argv){
 using namespace ynx::wallet::product::archive_data;
 if(argc!=6&&argc!=7)return 2;
 Ref ref{argv[2],argv[3],argv[4],argv[5],std::nullopt};
 if(argc==7)ref.native_hash=argv[6];
 const auto value=fixed_path_DATA(argv[1],ref);
 if(!value)return 3;
 std::cout<<*value<<'\n';return 0;
}
