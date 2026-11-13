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
# Original A supplies ONE matching combined archive. Do not link a second Go
# runtime or replace the decoder with a generic Android signing provider.
if(NOT YNX_AUTH_MOBILE_ARCHIVE OR NOT EXISTS "${YNX_AUTH_MOBILE_ARCHIVE}")
 message(FATAL_ERROR "Original matching Android Auth custody/mobile producer archive not supplied")
endif()
add_library(ynx_auth_mobile STATIC IMPORTED)
set_target_properties(ynx_auth_mobile PROPERTIES IMPORTED_LOCATION "${YNX_AUTH_MOBILE_ARCHIVE}")
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
option(YNX_ANDROID_DEVICE_APPROVAL "Link original Android DEVICE approval" OFF)
if(YNX_ANDROID_DEVICE_APPROVAL)
 add_subdirectory(../native/android-account-approval android-account-approval)
 target_sources(ynx_pq_custody PRIVATE src/main/cpp/DeviceApprovalJournalBridge.cpp
  $<TARGET_OBJECTS:ynx_android_account_approval>)
endif()
