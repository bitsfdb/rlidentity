cmake_minimum_required(VERSION 3.10)
project(RLIdentityDLL)

set(CMAKE_CXX_STANDARD 14)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Set output directory to x64/Release for consistency with VS project
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)

add_library(RLIdentity SHARED
        RLIdentity.cpp)

# Make local headers visible to the compiler and IntelliSense
target_include_directories(RLIdentity BEFORE PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# Link MinHook
target_link_libraries(RLIdentity PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/libMinHook.x64.lib)

# Add definitions if needed
target_compile_definitions(RLIdentity PRIVATE _USRDLL RLIDENTITYDLL_EXPORTS)
