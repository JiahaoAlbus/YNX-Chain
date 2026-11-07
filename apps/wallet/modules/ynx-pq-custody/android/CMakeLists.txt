cmake_minimum_required(VERSION 3.22)
project(ynx_pq_custody LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)
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
 ../native/CustodySession.cpp ../native/SerialCustodyWorker.cpp ../native/CustodyJSI.cpp ../native/NativeAccountPicker.cpp ../native/NativeRegisteredReceiptOwner.cpp)
target_include_directories(ynx_pq_custody PRIVATE ../native)
target_link_libraries(ynx_pq_custody PRIVATE ReactAndroid::jsi ReactAndroid::reactnative fbjni::fbjni ynx_auth_mobile log)
target_link_options(ynx_pq_custody PRIVATE -Wl,--no-undefined)
