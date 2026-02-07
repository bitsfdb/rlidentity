#include <Windows.h>
#include <MinHook.h>
#include <shlobj.h>
#include <stdio.h>

#pragma comment(lib, "MinHook.x64.lib")
#pragma comment(lib, "shell32.lib")

static char g_SpoofedName[256] = "Player";
static char g_ConfigPath[MAX_PATH] = { 0 };

typedef int(__stdcall* EOS_Func_t)(void*, void*, void**);
EOS_Func_t oEOS_UserInfo_CopyUserInfo = nullptr;

void LoadConfig() {
    // Get AppData path
    char appDataPath[MAX_PATH];
    SHGetFolderPathA(NULL, CSIDL_APPDATA, NULL, 0, appDataPath);

    sprintf_s(g_ConfigPath, "%s\\RLidentity\\config.txt", appDataPath);

    FILE* fp = NULL;
    fopen_s(&fp, g_ConfigPath, "r");
    if (fp) {
        char line[256] = { 0 };
        if (fgets(line, sizeof(line), fp)) {
            line[strcspn(line, "\r\n")] = 0;

            if (strlen(line) > 0 && strlen(line) < 50) {
                strcpy_s(g_SpoofedName, sizeof(g_SpoofedName), line);
            }
        }
        fclose(fp);
    }
}

int __stdcall hkEOS_UserInfo_CopyUserInfo(void* p1, void* p2, void** p3) {
    int result = oEOS_UserInfo_CopyUserInfo(p1, p2, p3);

    if (result == 0 && p3 && *p3) {
        char** structPtr = (char**)*p3;

        __try {
            if (structPtr[3] && !IsBadReadPtr(structPtr[3], 6)) {
                if (strstr(structPtr[3], "sfdb.") != nullptr) {
                    structPtr[3] = g_SpoofedName;
                }
            }
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
        }
    }

    return result;
}

DWORD WINAPI ConfigReloadThread(LPVOID lpParam) {
    while (true) {
        Sleep(2000);
        LoadConfig();
    }
    return 0;
}

BOOL InstallHooks() {
    LoadConfig();

    if (MH_Initialize() != MH_OK) {
        return FALSE;
    }

    HMODULE hEOSSDK = NULL;
    for (int i = 0; i < 50; i++) {
        hEOSSDK = GetModuleHandleA("EOSSDK-Win64-Shipping.dll");
        if (hEOSSDK) break;
        Sleep(100);
    }

    if (!hEOSSDK) {
        return FALSE;
    }

    LPVOID pFunc = (LPVOID)GetProcAddress(hEOSSDK, "EOS_UserInfo_CopyUserInfo");
    if (!pFunc) {
        return FALSE;
    }

    if (MH_CreateHook(pFunc, &hkEOS_UserInfo_CopyUserInfo, (LPVOID*)&oEOS_UserInfo_CopyUserInfo) != MH_OK) {
        return FALSE;
    }

    if (MH_EnableHook(pFunc) != MH_OK) {
        return FALSE;
    }

    CreateThread(NULL, 0, ConfigReloadThread, NULL, 0, NULL);

    return TRUE;
}

DWORD WINAPI HookThread(LPVOID lpParam) {
    Sleep(3000);
    InstallHooks();
    return 0;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD dwReason, LPVOID lpReserved) {
    if (dwReason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        CreateThread(NULL, 0, HookThread, NULL, 0, NULL);
    }
    else if (dwReason == DLL_PROCESS_DETACH) {
        MH_DisableHook(MH_ALL_HOOKS);
        MH_Uninitialize();
    }
    return TRUE;
}