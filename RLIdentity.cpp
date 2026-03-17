// RLIdentity.cpp
// 1:1 Proven logic with ALL-SAFE JSON parsing (no dynamic allocations).

#include <Windows.h>
#include <MinHook.h>
#include <shlobj.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>

#pragma comment(lib, "libMinHook.x64.lib")
#pragma comment(lib, "shell32.lib")

static char g_SpoofedName[256] = "Player";
static void* g_LocalUserId = nullptr;

void ClearLog() {
    char path[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_APPDATA, NULL, 0, path))) {
        char logFile[MAX_PATH];
        sprintf_s(logFile, "%s\\RLidentity\\log.txt", path);
        FILE* f = NULL;
        fopen_s(&f, logFile, "w");
        if (f) {
            fprintf(f, "[RLidentity] --- New Session Started ---\n");
            fclose(f);
        }
    }
}

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

        char tPath[MAX_PATH];
        sprintf_s(tPath, "%s\\RLidentity\\config.txt", path);
        fopen_s(&fp, tPath, "r");
        if (fp) {
            char line[256] = { 0 };
            if (fgets(line, sizeof(line), fp)) {
                line[strcspn(line, "\r\n")] = 0;
                if (strlen(line) > 0) strcpy_s(g_SpoofedName, 256, line);
            }
            fclose(fp);
        }
    }
}

typedef int(__stdcall* CopyUserInfo_t)(void*, void*, void**);
static CopyUserInfo_t oEOS_UserInfo_CopyUserInfo = nullptr;

typedef int(__stdcall* ToString_t)(void*, char*, int32_t*);
static ToString_t oEOS_EpicAccountId_ToString = nullptr;

int __stdcall hkEOS_EpicAccountId_ToString(void* handle, char* buffer, int32_t* length) {
    if (handle && g_LocalUserId && handle == g_LocalUserId) {
        size_t spoofLen = strlen(g_SpoofedName);
        if (buffer && length && *length > (int32_t)spoofLen) {
            strcpy_s(buffer, *length, g_SpoofedName);
            *length = (int32_t)spoofLen + 1;
            return 0; // EOS_Success
        }
    }
    return oEOS_EpicAccountId_ToString(handle, buffer, length);
}

int __stdcall hkEOS_UserInfo_CopyUserInfo(void* p1, void* p2, void** p3) {
    if (p2) {
        void** options = (void**)p2;
        g_LocalUserId = options[1]; // Capture LocalUserId handle
    }

    int res = oEOS_UserInfo_CopyUserInfo(p1, p2, p3);

    if (res == 0 && p2 && p3 && *p3) {
        void** options = (void**)p2;
        if (options[1] == options[2]) { // If targeting our own info
            char** s = (char**)*p3;
            __try {
                // Offset 24: DisplayName, Offset 40: Nickname
                if (s[3]) s[3] = g_SpoofedName;
                if (s[5]) s[5] = g_SpoofedName;
            } __except (EXCEPTION_EXECUTE_HANDLER) {}
        }
    }
    return res;
}

DWORD WINAPI HookThread(LPVOID lpParam) {
    ClearLog();
    LoadConfig();

    if (MH_Initialize() == MH_OK) {
        HMODULE h = NULL;
        for (int i = 0; i < 100; i++) {
            h = GetModuleHandleA("EOSSDK-Win64-Shipping.dll");
            if (h) break;
            Sleep(100);
        }
        if (h) {
            LPVOID f1 = (LPVOID)GetProcAddress(h, "EOS_UserInfo_CopyUserInfo");
            if (f1 && MH_CreateHook(f1, (LPVOID)&hkEOS_UserInfo_CopyUserInfo, (LPVOID*)&oEOS_UserInfo_CopyUserInfo) == MH_OK) {
                MH_EnableHook(f1);
            }

            LPVOID f2 = (LPVOID)GetProcAddress(h, "EOS_EpicAccountId_ToString");
            if (f2 && MH_CreateHook(f2, (LPVOID)&hkEOS_EpicAccountId_ToString, (LPVOID*)&oEOS_EpicAccountId_ToString) == MH_OK) {
                MH_EnableHook(f2);
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
        MH_DisableHook(MH_ALL_HOOKS);
        MH_Uninitialize();
    }
    return TRUE;
}