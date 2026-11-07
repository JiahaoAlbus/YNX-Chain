#include "../../native/mobile-accountproof-host-v1/MobileAccountProofWireDATA.hpp"
#include <cassert>
#include <iostream>
using namespace ynx::sdk::mobile::accountproof;namespace w=ynx::sdk::mobile::accountproof::wire;
int main(){w::SequenceDATA s;w::FrameDATA q;q.sequence=1;s.request(q);auto r=q;r.status=w::Status::Failed;r.reader[0]=5;r.failure={true,0};s.response(r);assert(s.firstCause.present&&s.firstCause.code==0);q.operation=Operation::Close;q.sequence=2;q.reader=r.reader;s.request(q);r=q;r.status=w::Status::Closed;r.failure={true,8};s.response(r);assert(s.firstCause.present&&s.firstCause.code==0&&s.retired);std::cout<<"PASS explicit code0 original firstcause survives later close cause and physical closed\n";}
