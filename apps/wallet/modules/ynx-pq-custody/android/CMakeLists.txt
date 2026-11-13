cmake_minimum_required(VERSION 3.22)
project(ynx_pq_custody LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)
# The account-purpose mother consumes the original P09 held launch, Auth
# Source and sole SDK97 codec. A supplies this exact private header cohort.
if(NOT YNX_ACCOUNT_PROOF_INCLUDE_ROOTS)
 message(FATAL_ERROR "Matching Auth/P09/SDK account-proof private headers not supplied")
endif()
foreach(required_header OriginalAccountPurposeChildPrivate.hpp normal_native_backend_private.hpp account_source_acquisition_private.hpp MobileAccountProofWireDATA.hpp)
 unset(account_header)
 unset(account_header CACHE)
 find_file(account_header "${required_header}" PATHS ${YNX_ACCOUNT_PROOF_INCLUDE_ROOTS} NO_DEFAULT_PATH)
 if(NOT account_header)
  message(FATAL_ERROR "Matching account-proof header missing: ${required_header}")
 endif()
endforeach()
# Original A supplies one provider for the full image.
option(YNX_ANDROID_DEVICE_APPROVAL "Link original Android DEVICE approval" OFF)
if(YNX_ANDROID_DEVICE_APPROVAL)
 if(YNX_AUTH_MOBILE_ARCHIVE)
  message(FATAL_ERROR "Android approval requires a single shared provider; remove the static archive")
 endif()
 if(NOT ANDROID OR NOT IS_ABSOLUTE "${YNX_AUTH_MOBILE_PROVIDER}" OR
    NOT EXISTS "${YNX_AUTH_MOBILE_PROVIDER}" OR IS_DIRECTORY "${YNX_AUTH_MOBILE_PROVIDER}")
  message(FATAL_ERROR "Original Android approval shared provider not supplied")
 endif()
 get_filename_component(provider_name "${YNX_AUTH_MOBILE_PROVIDER}" NAME)
 if(NOT provider_name STREQUAL "libynx_wallet_pq.so")
  message(FATAL_ERROR "Original Android approval provider basename differs")
 endif()
 file(SHA256 "${YNX_AUTH_MOBILE_PROVIDER}" provider_sha)
 if(NOT provider_sha STREQUAL YNX_AUTH_MOBILE_PROVIDER_SHA256)
  message(FATAL_ERROR "Original Android approval provider digest differs")
 endif()
 add_library(ynx_auth_mobile SHARED IMPORTED)
 set_target_properties(ynx_auth_mobile PROPERTIES
  IMPORTED_LOCATION "${YNX_AUTH_MOBILE_PROVIDER}" IMPORTED_NO_SONAME TRUE)
else()
 if(NOT YNX_AUTH_MOBILE_ARCHIVE OR NOT EXISTS "${YNX_AUTH_MOBILE_ARCHIVE}")
  message(FATAL_ERROR "Original matching Android Auth custody/mobile producer archive not supplied")
 endif()
 add_library(ynx_auth_mobile STATIC IMPORTED)
 set_target_properties(ynx_auth_mobile PROPERTIES IMPORTED_LOCATION "${YNX_AUTH_MOBILE_ARCHIVE}")
endif()
add_library(ynx_pq_custody SHARED src/main/cpp/JNI.cpp src/main/cpp/OS43Android.cpp src/main/cpp/SelectedAppDirectoryAndroid.cpp src/main/cpp/NativeAccountPickerAndroid.cpp
 src/main/cpp/auth-ordinary/NativeBackupFormat.cpp
 src/main/cpp/auth-ordinary/NativeOrdinary.cpp
 src/main/cpp/auth-ordinary/AndroidOrdinaryCrypto.cpp
 ../native/MobileSecure43.cpp ../native/Wrapped43Record.cpp ../native/SelectedDirectoryInventory.cpp ../native/SelectedAppDirectory.cpp
 ../native/CustodySession.cpp ../native/SerialCustodyWorker.cpp ../native/CustodyJSI.cpp ../native/NativeAccountPicker.cpp ../native/NativeRegisteredReceiptOwner.cpp ../native/NativeReceiptDirectoryPolicy.cpp ../native/NativeRegisteredAccountPhase.cpp
 ../native/account-proof/NativeAccountPurposeChild.cpp ../native/account-proof/NativeAccountProofReader.cpp)
target_include_directories(ynx_pq_custody PRIVATE ${YNX_ACCOUNT_PROOF_INCLUDE_ROOTS} ../native)
target_link_libraries(ynx_pq_custody PRIVATE ReactAndroid::jsi ReactAndroid::reactnative fbjni::fbjni ynx_auth_mobile log)
target_link_options(ynx_pq_custody PRIVATE -Wl,--no-undefined)


# The approval signer shares the existing decoder and the single Auth/Core
# archive. A complete approval build must resolve all holder ports at link.
if(YNX_ANDROID_DEVICE_APPROVAL)
 add_subdirectory(../native/android-account-approval android-account-approval)
 include("${CMAKE_CURRENT_LIST_DIR}/AttachOriginalAndroidApproval.cmake")
 ynx_attach_original_android_approval(ynx_pq_custody)
 target_sources(ynx_pq_custody PRIVATE src/main/cpp/DeviceApprovalJournalBridge.cpp
  $<TARGET_OBJECTS:ynx_android_account_approval>)
 if(NOT CMAKE_READELF OR NOT EXISTS "${CMAKE_READELF}")
  message(FATAL_ERROR "Android approval requires the NDK readelf")
 endif()
 add_custom_command(TARGET ynx_pq_custody POST_BUILD
  COMMAND "${CMAKE_COMMAND}" "-DREADELF=${CMAKE_READELF}" "-DIMAGE=$<TARGET_FILE:ynx_pq_custody>"
   -P "${CMAKE_CURRENT_LIST_DIR}/VerifyApprovalProviderNeeded.cmake"
  VERBATIM)
endif()
