// RLIdentity.cpp - v2.1.1 Crash-Resistant Edition
#include <Windows.h>
#include <shlobj.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "MinHook.h" 

#pragma comment(lib, "libMinHook.x64.lib")
#pragma comment(lib, "shell32.lib")

static char g_SpoofedName[256] = "Player";

struct EOS_UserInfo {
    int32_t ApiVersion;
    void* UserId; 
    const char* Country;
    const char* DisplayName;
    const char* PreferredLanguage;
    const char* Nickname;
    const char* DisplayNameSanitized;
};

// --- Safety Helper ---
// Checks if memory is actually readable before we touch it
bool IsValidPtr(void* ptr) {
    if (!ptr) return false;
    MEMORY_BASIC_INFORMATION mbi;
    if (VirtualQuery(ptr, &mbi, sizeof(mbi))) {
        return (mbi.Protect & (PAGE_READONLY | PAGE_READWRITE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE)) != 0;
    }
    return false;
}

void LoadConfig() {
    char path[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_APPDATA, NULL, 0, path))) {
        char jPath[MAX_PATH];
        sprintf_s(jPath, "%s\\RLidentity\\config.json", path);
        
        FILE* fp = NULL;
        if (fopen_s(&fp, jPath, "r") == 0 && fp) {
            char buffer[1024] = { 0 };
            size_t bytes = fread(buffer, 1, sizeof(buffer)-1, fp);
            fclose(fp);

            if (bytes > 0) {
                const char* key = "\"spoofedName\"";
                char* pos = strstr(buffer, key);
                if (pos) {
                    char* start = strchr(strstr(pos, ":"), '\"');
                    if (start) {
                        char* end = strchr(start + 1, '\"');
                        if (end) {
                            size_t len = end - (start + 1);
                            if (len > 0 && len < 255) {
                                memcpy(g_SpoofedName, start + 1, len);
                                g_SpoofedName[len] = '\0';
                            }
                        }
                    }
                }
            }
        }
    }
}

// --- Hooks with Strict Safety ---

typedef int(__stdcall* CopyUserInfo_t)(void*, void*, void**);
static CopyUserInfo_t oEOS_UserInfo_CopyUserInfo = nullptr;

int __stdcall hkEOS_UserInfo_CopyUserInfo(void* pHandle, void* pOptions, void** pOutUserInfo) {
    int res = oEOS_UserInfo_CopyUserInfo(pHandle, pOptions, pOutUserInfo);

    // CRASH FIX 1: Verify all pointers before dereferencing
    if (res == 0 && pOutUserInfo && IsValidPtr(*pOutUserInfo) && IsValidPtr(pOptions)) {
        EOS_UserInfo* info = (EOS_UserInfo*)*pOutUserInfo;
        
        // CRASH FIX 2: Check if LocalUserId exists at the expected offset
        void* localPlayerId = *(void**)((uintptr_t)pOptions + 8);

        if (info->UserId == localPlayerId) {
            // CRASH FIX 3: SEH Protection for string assignments
            __try {
                info->DisplayName = g_SpoofedName;
                if (info->Nickname) info->Nickname = g_SpoofedName;
                if (info->DisplayNameSanitized) info->DisplayNameSanitized = g_SpoofedName;
            } 
            __except (EXCEPTION_EXECUTE_HANDLER) {
                // Silently fail if the memory becomes invalid
            }
        }
    }
    return res;
}

typedef int(__stdcall* GetConnectMap_t)(void*, void*, char*, int32_t*);
static GetConnectMap_t oEOS_Connect_GetExternalAccountMapping = nullptr;

int __stdcall hkEOS_Connect_GetExternalAccountMapping(void* handle, void* options, char* buffer, int32_t* length) {
    int res = oEOS_Connect_GetExternalAccountMapping(handle, options, buffer, length);
    
    // CRASH FIX 4: Check buffer length before copying
    if (res == 0 && buffer && length && IsValidPtr(buffer)) {
        if (*length > (int32_t)strlen(g_SpoofedName)) {
            strcpy_s(buffer, *length, g_SpoofedName);
        }
    }
    return res;
}

DWORD WINAPI HookThread(LPVOID lpParam) {
    LoadConfig();

    if (MH_Initialize() == MH_OK) {
        HMODULE h = NULL;
        // Wait for SDK with a timeout (don't hang forever)
        for (int i = 0; i < 200 && !h; i++) {
            h = GetModuleHandleA("EOSSDK-Win64-Shipping.dll");
            Sleep(100);
        }

        if (h) {
            LPVOID f1 = (LPVOID)GetProcAddress(h, "EOS_UserInfo_CopyUserInfo");
            LPVOID f2 = (LPVOID)GetProcAddress(h, "EOS_Connect_GetExternalAccountMapping");

            if (f1) MH_CreateHook(f1, (LPVOID)&hkEOS_UserInfo_CopyUserInfo, (LPVOID*)&oEOS_UserInfo_CopyUserInfo);
            if (f2) MH_CreateHook(f2, (LPVOID)&hkEOS_Connect_GetExternalAccountMapping, (LPVOID*)&oEOS_Connect_GetExternalAccountMapping);
            
            MH_EnableHook((LPVOID)MH_ALL_HOOKS);
        }
    }
    return 0;
}

BOOL APIENTRY DllMain(HMODULE h, DWORD r, LPVOID) {
    if (r == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(h);
        HANDLE hThread = CreateThread(NULL, 0, HookThread, NULL, 0, NULL);
        if (hThread) CloseHandle(hThread);
    }
    else if (r == DLL_PROCESS_DETACH) {
        // CRASH FIX 5: Ensure hooks are cleaned up before DLL memory is wiped
        MH_DisableHook((LPVOID)MH_ALL_HOOKS);
        MH_Uninitialize();
    }
    return TRUE;
}