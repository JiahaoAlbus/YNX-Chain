// Test-only consumer of the sole SDK unmodified DATA codec. No host factory,
// authority, signing, endpoint injection or Native/Auth receipt implementation.
#include "MobileAccountProofWireDATA.hpp"
#include <fstream>
#include <iostream>
#include <iterator>
int main(int argc,char**argv){
 using namespace ynx::sdk::mobile::accountproof;
 try {
  if(argc!=2)return 2;
  std::ifstream in(argv[1],std::ios::binary);
  if(!in)return 3;
  Bytes b((std::istreambuf_iterator<char>(in)),{});
  auto f=wire::decodeFrameDATA(b);
  if(wire::encodeFrameDATA(f)!=b)return 4;
  auto v=wire::decodeViewDATA(f.payload);
  if(wire::encodeViewDATA(v)!=f.payload)return 5;
  std::cout<<v.proof.height<<" "<<v.currentCheckpoint.height<<" "<<v.historicalAccount.ledgerNonce<<" "<<v.currentAccount.ledgerNonce<<" "<<v.historicalAccount.owner<<"\n";
  return 0;
 }catch(...){return 6;}
}
