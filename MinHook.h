/*
 * MinHook.h - Minimal Hooking Library Header
 * 
 * This header provides the interface for the MinHook library.
 * The library file (libMinHook.x64.lib) must be linked.
 */

#ifndef MINHOOK_H
#define MINHOOK_H

#ifdef _WIN64
#pragma comment(lib, "libMinHook.x64.lib")
#else
#pragma comment(lib, "libMinHook.x86.lib")
#endif

#ifdef __cplusplus
extern "C" {
#endif

// Status codes
typedef enum _MH_STATUS {
    MH_OK = 0,
    MH_ERROR_ALREADY_INITIALIZED,
    MH_ERROR_NOT_INITIALIZED,
    MH_ERROR_ALREADY_CREATED,
    MH_ERROR_NOT_CREATED,
    MH_ERROR_ENABLED,
    MH_ERROR_DISABLED,
    MH_ERROR_NOT_EXECUTABLE,
    MH_ERROR_UNSUPPORTED_FUNCTION,
    MH_ERROR_MEMORY_ALLOC,
    MH_ERROR_MEMORY_PROTECT,
    MH_ERROR_MODULE_NOT_FOUND,
    MH_ERROR_FUNCTION_NOT_FOUND
} MH_STATUS;

// Hook creation flags
typedef enum _MH_HOOK_FLAGS {
    MH_NONE = 0,
    MH_ALL_HOOKS = (int)-1
} MH_HOOK_FLAGS;

// Initialize the MinHook library
MH_STATUS WINAPI MH_Initialize(void);

// Uninitialize the MinHook library
MH_STATUS WINAPI MH_Uninitialize(void);

// Create a hook
MH_STATUS WINAPI MH_CreateHook(
    void* pTarget,
    void* pDetour,
    void** ppOriginal
);

// Enable a hook
MH_STATUS WINAPI MH_EnableHook(
    void* pTarget
);

// Disable a hook
MH_STATUS WINAPI MH_DisableHook(
    void* pTarget
);

// Enable all hooks
MH_STATUS WINAPI MH_EnableAllHooks(void);

// Disable all hooks
MH_STATUS WINAPI MH_DisableAllHooks(void);

// Remove a hook
MH_STATUS WINAPI MH_RemoveHook(
    void* pTarget
);

// Queue an enable hook
MH_STATUS WINAPI MH_QueueEnableHook(
    void* pTarget
);

// Queue a disable hook
MH_STATUS WINAPI MH_QueueDisableHook(
    void* pTarget
);

// Apply queued hooks
MH_STATUS WINAPI MH_ApplyQueued(void);

// Find a function address in a module
MH_STATUS WINAPI MH_FindHook(
    void* pTarget,
    void** ppHook
);

// Check if a hook is enabled
MH_STATUS WINAPI MH_IsHookEnabled(
    void* pTarget,
    int* pbEnabled
);

// Get the last error message (optional, for debugging)
const char* WINAPI MH_StatusToString(MH_STATUS status);

#ifdef __cplusplus
}
#endif

#endif // MINHOOK_H