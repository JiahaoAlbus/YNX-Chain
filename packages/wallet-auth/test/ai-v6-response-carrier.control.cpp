#include "AIResponseOriginalsCarrierDATA.hpp"
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
std::string hex(const std::vector<uint8_t>&b){const char*h="0123456789abcdef";std::string s;for(auto x:b){s+=h[x>>4];s+=h[x&15];}return s;}
int main(int argc,char**argv){if(argc!=2)return 3;try{std::ifstream f(argv[1],std::ios::binary);if(!f)throw std::runtime_error("FIXTURE");std::vector<uint8_t>raw{std::istreambuf_iterator<char>(f),std::istreambuf_iterator<char>()};auto v=ynx::sdk::ai::v6::decodeOriginalAITaskResponseCarrierV6DATA(raw);if(v.transportOriginal!=raw||!v.dataOnly||v.SourceAdmission||v.RootAdmission||v.operationVerified||v.receiptProvenanceVerified)return 4;std::cout<<hex(v.bodyOriginal)<<'\n'<<hex(v.outcomeMetadataOriginal)<<'\n'<<(v.businessReceiptOriginal?hex(*v.businessReceiptOriginal):"-")<<'\n';return 0;}catch(...){return 2;}}
