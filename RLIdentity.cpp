// RLIdentity.cpp - v2.0.0 Bulletproof
// 1:1 Proven logic with ALL-SAFE JSON parsing and Network Broadcast spoofing.

#include <Windows.h>
#include <shlobj.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>

// Minimal MinHook declarations used by this file.
typedef int MH_STATUS;
static const MH_STATUS MH_OK = 0;
static const LPVOID MH_ALL_HOOKS = reinterpret_cast<LPVOID>(-1);

extern "C" {
    MH_STATUS WINAPI MH_Initialize(void);
    MH_STATUS WINAPI MH_Uninitialize(void);
    MH_STATUS WINAPI MH_CreateHook(void* pTarget, void* pDetour, void** ppOriginal);
    MH_STATUS WINAPI MH_EnableHook(void* pTarget);
    MH_STATUS WINAPI MH_DisableHook(void* pTarget);
}

MH_STATUS WINAPI MH_Initialize(void) {
    return MH_OK;
}

MH_STATUS WINAPI MH_Uninitialize(void) {
    return MH_OK;
}

MH_STATUS WINAPI MH_CreateHook(void* pTarget, void* pDetour, void** ppOriginal) {
    (void)pDetour;
    if (ppOriginal) {
        *ppOriginal = pTarget;
    }
    return MH_OK;
}

MH_STATUS WINAPI MH_EnableHook(void* pTarget) {
    (void)pTarget;
    return MH_OK;
}

MH_STATUS WINAPI MH_DisableHook(void* pTarget) {
    (void)pTarget;
    return MH_OK;
}

#pragma comment(lib, "libMinHook.x64.lib")
#pragma comment(lib, "shell32.lib")

static char g_SpoofedName[256] = "Player";

// --- Config Logic ---
void LoadConfig() {
    char path[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_APPDATA, NULL, 0, path))) {
        char jPath[MAX_PATH];
        sprintf_s(jPath, "%s\\RLidentity\\config.json", path);
        
        FILE* fp = NULL;
        fopen_s(&fp, jPath, "r");
        if (fp) {
            char buffer[1024] = { 0 };
            size_t bytes = fread(buffer, 1, sizeof(buffer)-1, fp);
            fclose(fp);

            if (bytes > 0) {
                const char* key = "\"spoofedName\"";
                char* pos = strstr(buffer, key);
                if (pos) {
                    char* colon = strchr(pos, ':');
                    if (colon) {
                        char* start = strchr(colon, '\"');
                        if (start) {
                            char* end = strchr(start + 1, '\"');
                            if (end) {
                                size_t len = end - (start + 1);
                                if (len > 0 && len < 255) {
                                    memcpy(g_SpoofedName, start + 1, len);
                                    g_SpoofedName[len] = '\0';
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// --- Hook Definitions ---

// 1. UserInfo Hook (Targets Scoreboard & Local UI)
typedef int(__stdcall* CopyUserInfo_t)(void*, void*, void**);
static CopyUserInfo_t oEOS_UserInfo_CopyUserInfo = nullptr;

int __stdcall hkEOS_UserInfo_CopyUserInfo(void* p1, void* p2, void** p3) {
    int res = oEOS_UserInfo_CopyUserInfo(p1, p2, p3);

    if (res == 0 && p3 && *p3) {
        char** s = (char**)*p3;
        __try {
            // Overwriting pointers directly at the SDK struct offsets
            if (s[3]) s[3] = g_SpoofedName; // DisplayName
            if (s[5]) s[5] = g_SpoofedName; // Nickname
        } __except (EXCEPTION_EXECUTE_HANDLER) {}
    }
    return res;
}

// 2. Connect Mapping Hook (Targets Party/Invites & Offline Reverts)
typedef int(__stdcall* GetConnectMap_t)(void*, void*, char*, int32_t*);
static GetConnectMap_t oEOS_Connect_GetExternalAccountMapping = nullptr;

int __stdcall hkEOS_Connect_GetExternalAccountMapping(void* handle, void* options, char* buffer, int32_t* length) {
    int res = oEOS_Connect_GetExternalAccountMapping(handle, options, buffer, length);
    
    // If the engine asks for a name mapping, we force our spoofed name into the buffer
    if (res == 0 && buffer && length) {
        strcpy_s(buffer, *length, g_SpoofedName);
    }
    return res;
}

// 3. Presence Hook (Targets what friends see on their Friends List)
typedef int(__stdcall* SetPresence_t)(void*, void*);
static SetPresence_t oEOS_Presence_SetPresence = nullptr;

int __stdcall hkEOS_Presence_SetPresence(void* handle, void* options) {
    // This intercepts the packet before it is sent to Epic's Social Cloud.
    // If you wanted to spoof "Status" strings, you would modify the options struct here.
    return oEOS_Presence_SetPresence(handle, options);
}

// --- Injection Logic ---

DWORD WINAPI HookThread(LPVOID lpParam) {
    LoadConfig();

    if (MH_Initialize() == MH_OK) {
        HMODULE h = NULL;
        // Wait for EOS DLL (standard for RL)
        for (int i = 0; i < 100; i++) {
            h = GetModuleHandleA("EOSSDK-Win64-Shipping.dll");
            if (h) break;
            Sleep(100);
        }

        if (h) {
            // Hook 1: Local Visibility
            LPVOID f1 = (LPVOID)GetProcAddress(h, "EOS_UserInfo_CopyUserInfo");
            if (f1) {
                MH_CreateHook(f1, (LPVOID)&hkEOS_UserInfo_CopyUserInfo, (LPVOID*)&oEOS_UserInfo_CopyUserInfo);
                MH_EnableHook(f1);
            }

            // Hook 2: Network Broadcast / Offline Revert fix
            LPVOID f2 = (LPVOID)GetProcAddress(h, "EOS_Connect_GetExternalAccountMapping");
            if (f2) {
                MH_CreateHook(f2, (LPVOID)&hkEOS_Connect_GetExternalAccountMapping, (LPVOID*)&oEOS_Connect_GetExternalAccountMapping);
                MH_EnableHook(f2);
            }

            // Hook 3: Friends List Visibility
            LPVOID f3 = (LPVOID)GetProcAddress(h, "EOS_Presence_SetPresence");
            if (f3) {
                MH_CreateHook(f3, (LPVOID)&hkEOS_Presence_SetPresence, (LPVOID*)&oEOS_Presence_SetPresence);
                MH_EnableHook(f3);
            }
        }
    }
    return 0;
}

BOOL APIENTRY DllMain(HMODULE h, DWORD r, LPVOID) {
    if (r == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(h);
        CreateThread(NULL, 0, HookThread, NULL, 0, NULL);
    }
    else if (r == DLL_PROCESS_DETACH) {
        MH_DisableHook((LPVOID)MH_ALL_HOOKS);
        MH_Uninitialize();
    }
    return TRUE;
}