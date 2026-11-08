cmake_minimum_required(VERSION 3.22)
# Thin objects for the ONE normal JNI image. Parser and SHA bodies are provided
# by its existing matching Auth/SDK and libsodium composition, never duplicated.
if(NOT ANDROID AND NOT APPLE)
  message(FATAL_ERROR "Android CODE image root supports Android and Apple PUBLIC host controls only")
endif()
foreach(required YNX_ANDROID_CODE_CANONICAL_INCLUDE YNX_ANDROID_CODE_SHA_INCLUDE)
  if(NOT DEFINED ${required} OR NOT IS_DIRECTORY "${${required}}")
    message(FATAL_ERROR "Matching ${required} is required; no header fallback")
  endif()
endforeach()
if(NOT EXISTS "${YNX_ANDROID_CODE_CANONICAL_INCLUDE}/MobileCanonicalDATA.hpp" OR
   NOT EXISTS "${YNX_ANDROID_CODE_SHA_INCLUDE}/OriginalSHA256.hpp")
  message(FATAL_ERROR "Missing matching canonical DATA / original SHA headers")
endif()
if(CMAKE_CXX_FLAGS MATCHES "YNX_ANDROID_CODE_IMAGE_PUBLIC_CONTROLS")
  message(FATAL_ERROR "PUBLIC filesystem controls must never enter a product image")
endif()
add_library(ynx_android_code_image_root OBJECT AndroidCodeImageRoot.cpp)
target_compile_features(ynx_android_code_image_root PRIVATE cxx_std_17)
target_include_directories(ynx_android_code_image_root PRIVATE
  "${YNX_ANDROID_CODE_CANONICAL_INCLUDE}" "${YNX_ANDROID_CODE_SHA_INCLUDE}")
target_compile_options(ynx_android_code_image_root PRIVATE -Wall -Wextra -Werror)
set_target_properties(ynx_android_code_image_root PROPERTIES POSITION_INDEPENDENT_CODE ON)
# Original normal image owner must compose these objects with its existing
# sole CanonicalDATA and SHA implementations and the Auth consumer. No static
# library, second runtime or PUBLIC fixture linkage is supplied by this target.
