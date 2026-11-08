cmake_minimum_required(VERSION 3.22)
# Thin objects only, consumed by original Main Cargo ynx-native-operation SAME
# image. Never a new JNI/runtime/archive or a replacement Auth Source producer.
foreach(required YNX_PENDING_AUTH_INCLUDE YNX_PENDING_JOURNAL_INCLUDE YNX_PENDING_MAIN_INCLUDE)
  if(NOT DEFINED ${required} OR NOT IS_DIRECTORY "${${required}}")
    message(FATAL_ERROR "Exact matching ${required} is required")
  endif()
endforeach()
if(NOT EXISTS "${YNX_PENDING_AUTH_INCLUDE}/AndroidDeviceRegistrationPortsPrivate.h" OR
   NOT EXISTS "${YNX_PENDING_JOURNAL_INCLUDE}/AndroidDevicePendingJournalPrivate.h")
  message(FATAL_ERROR "Matching private registration/journal contracts absent")
endif()
if(CMAKE_CXX_FLAGS MATCHES "YNX_ANDROID_PENDING_DIRECTORY_PUBLIC_CONTROLS")
  message(FATAL_ERROR "PUBLIC close fault seam is forbidden in normal images")
endif()
add_library(ynx_android_pending_directory OBJECT PendingDirectory.cpp PendingReviewOwner.cpp)
target_compile_features(ynx_android_pending_directory PRIVATE cxx_std_17)
target_compile_options(ynx_android_pending_directory PRIVATE -Wall -Wextra -Werror)
target_include_directories(ynx_android_pending_directory PRIVATE
  "${YNX_PENDING_AUTH_INCLUDE}" "${YNX_PENDING_JOURNAL_INCLUDE}" "${YNX_PENDING_MAIN_INCLUDE}")
set_target_properties(ynx_android_pending_directory PROPERTIES POSITION_INDEPENDENT_CODE ON)
# Required MainAppdir4 and genuine Auth Source/approval/journal callees remain
# strong imports. This target does not supply weak/default/provider bodies.

# The six additional original Native ports use the SAME canonical Main header
# and Auth typedReview gate. They never create or clone an AbortContext.
add_library(ynx_android_pending_pair_abort OBJECT PendingDevicePair.cpp PendingAbort.cpp)
target_compile_features(ynx_android_pending_pair_abort PRIVATE cxx_std_17)
target_compile_options(ynx_android_pending_pair_abort PRIVATE -Wall -Wextra -Werror)
target_include_directories(ynx_android_pending_pair_abort PRIVATE
  "${YNX_PENDING_AUTH_INCLUDE}" "${YNX_PENDING_MAIN_INCLUDE}")
set_target_properties(ynx_android_pending_pair_abort PROPERTIES POSITION_INDEPENDENT_CODE ON)
