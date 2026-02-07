#include <Windows.h>
#include <d3d9.h>

#pragma comment(lib, "d3d9.lib")

BOOL APIENTRY DllMain(HMODULE hModule, DWORD dwReason, LPVOID lpReserved) {
    if (dwReason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);

        // INSTANT visual feedback
        MessageBoxA(NULL, "RLNameSpoofer.dll loaded successfully!", "DLL Injected", MB_OK | MB_ICONINFORMATION);
    }
    return TRUE;
}