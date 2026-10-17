#include "original-ide-parent-lifetime.h"
#include <cassert>
#include <iostream>
using namespace ynx_auth_ide_private;
static ProcessOriginal wallet{20,10,501,20,1,2}, ide{30,20,501,20,3,4}, node{40,30,501,20,5,6};
static Lifetime pending(){Lifetime l;assert(l.begin("original-once-intent",wallet,ide,1000,1100,2000));return l;}
static void adopt(Lifetime&l){assert(l.beginAdopt("original-once-intent",node));assert(l.completeAdopt("original-once-intent",node,wallet,ide,1001,2001));}
int main(){
 {auto l=pending();for(int i=0;i<20;i++)assert(l.current(wallet,ide,1000,2000));assert(l.phase()==Phase::pending);assert(!l.borrow());adopt(l);assert(l.nodeCurrent(node));assert(l.borrow());l.retire();assert(!l.joined());assert(!l.selectClose());assert(l.giveBack());assert(l.joined());assert(l.selectClose());assert(l.finishClose(true));assert(l.finishClose(false));assert(!l.selectClose());}
 {auto l=pending();assert(!l.beginAdopt("wrong",node));assert(!l.current(wallet,ide,1000,2000));assert(!l.begin("other",wallet,ide,1000,1200,2000));assert(l.firstCause()=="IDE_PARENT_CHILD_ADOPT_MISMATCH");}
 {auto l=pending();auto other=node;other.parent=wallet.pid;assert(!l.beginAdopt("original-once-intent",other));}
 {auto l=pending();auto other=node;other.uid++;assert(!l.beginAdopt("original-once-intent",other));}
 {auto l=pending();assert(l.beginAdopt("original-once-intent",node));assert(!l.completeAdopt("original-once-intent",node,wallet,ide,1100,2001));assert(!l.borrow());}
 {auto l=pending();assert(l.beginAdopt("original-once-intent",node));assert(!l.completeAdopt("original-once-intent",node,wallet,ide,1001,2100));assert(!l.borrow());}
 {auto l=pending();assert(l.beginAdopt("original-once-intent",node));auto reused=node;reused.startMicros++;assert(!l.completeAdopt("original-once-intent",reused,wallet,ide,1001,2001));}
 {auto l=pending();adopt(l);assert(!l.beginAdopt("original-once-intent",node));assert(!l.borrow());}
 {auto l=pending();assert(l.current(wallet,ide,1005,2005));assert(!l.current(wallet,ide,1004,2006));}
 {auto l=pending();assert(l.current(wallet,ide,1005,2005));assert(!l.current(wallet,ide,1006,2004));}
 {auto l=pending();auto changed=ide;changed.startSeconds++;assert(!l.current(wallet,changed,1001,2001));}
 {auto l=pending();adopt(l);auto changed=node;changed.startSeconds++;assert(!l.nodeCurrent(changed));assert(!l.borrow());}
 {auto l=pending();l.unknown("EOF");l.unknown("SECOND");assert(l.firstCause()=="EOF");assert(l.joined());assert(l.selectClose());assert(!l.finishClose(false));assert(!l.finishClose(true));assert(!l.begin("new",wallet,ide,1000,1100,2000));}
 {Lifetime l;l.retire();assert(!l.begin("late",wallet,ide,1000,1100,2000));}
 {auto l=pending();assert(!l.giveBack());assert(l.firstCause()=="IDE_PARENT_FOREIGN_LOAN_RETURN");}
 std::cout<<"PASS 15 internal lifetime controls; NOT Native/source admission\n";
}
