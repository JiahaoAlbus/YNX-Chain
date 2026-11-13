cmake_minimum_required(VERSION 3.22)

# Same Wallet Android image as auth-ordinary; no standalone runtime or archive.
foreach(include_var YNX_APPROVAL_AUTH_INCLUDE YNX_APPROVAL_PLAN_INCLUDE
                    YNX_APPROVAL_FAILURE_INCLUDE YNX_APPROVAL_CORE_INCLUDE)
  if(NOT DEFINED ${include_var} OR NOT IS_DIRECTORY "${${include_var}}")
    message(FATAL_ERROR "Exact original ${include_var} is required")
  endif()
endforeach()

add_library(ynx_android_account_approval OBJECT
  AccountApprovalCustody.cpp AccountApprovalSign.cpp)
target_compile_features(ynx_android_account_approval PRIVATE cxx_std_17)
target_compile_options(ynx_android_account_approval PRIVATE -Wall -Wextra -Werror)
target_include_directories(ynx_android_account_approval PRIVATE
  "${YNX_APPROVAL_AUTH_INCLUDE}" "${YNX_APPROVAL_PLAN_INCLUDE}"
  "${YNX_APPROVAL_FAILURE_INCLUDE}" "${YNX_APPROVAL_CORE_INCLUDE}")
set_target_properties(ynx_android_account_approval PROPERTIES POSITION_INDEPENDENT_CODE ON)
