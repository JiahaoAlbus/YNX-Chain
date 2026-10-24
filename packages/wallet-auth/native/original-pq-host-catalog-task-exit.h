#pragma once
#import <Foundation/Foundation.h>
#include <algorithm>
#include <chrono>
#include <thread>
namespace ynx_auth_private {
// A bounded observation, NEVER permission to release an unjoined child. The
// original NSTask (not a serialized/re-looked-up PID) remains the only handle.
inline bool observePQCatalogTaskExit(NSTask*task,unsigned budgetMS){
 if(!task)return true;using C=std::chrono::steady_clock;
 const auto end=C::now()+std::chrono::milliseconds(std::min(budgetMS,1000u));
 for(;;){if(!task.running)return true;if(C::now()>=end)return false;
  std::this_thread::sleep_for(std::chrono::milliseconds(2));}
}
}
