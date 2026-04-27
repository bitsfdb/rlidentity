// injector.cpp
// A simple, standalone DLL injector for Rocket League.
// Compile as a x64 Console Application in Visual Studio.

#include <windows.h>
#include <tlhelp32.h>
#include <iostream>
#include <string>

// Find the Process ID by name
DWORD GetProcessIdByName(const wchar_t* processName) {
    DWORD pid = 0;
    HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnapshot != INVALID_HANDLE_VALUE) {
        PROCESSENTRY32W pe;
        pe.dwSize = sizeof(PROCESSENTRY32W);
        if (Process32FirstW(hSnapshot, &pe)) {
            do {
                if (_wcsicmp(pe.szExeFile, processName) == 0) {
                    pid = pe.th32ProcessID;
                    break;
                }
            } while (Process32NextW(hSnapshot, &pe));
        }
        CloseHandle(hSnapshot);
    }
    return pid;
}

int wmain(int argc, wchar_t* argv[]) {
    if (argc < 3) {
        std::wcout << L"Usage: injector.exe <ProcessName> <DllPath>" << std::endl;
        return 1;
    }

    const wchar_t* targetProcess = argv[1];
    const wchar_t* dllPath = argv[2];

    DWORD pid = GetProcessIdByName(targetProcess);
    if (pid == 0) {
        std::wcout << L"[-] Failed to find process: " << targetProcess << std::endl;
        return 1;
    }

    std::wcout << L"[+] Found process " << targetProcess << L" (PID: " << pid << L")" << std::endl;

    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
    if (hProcess == NULL) {
        std::wcout << L"[-] Failed to open process. Error: " << GetLastError() << std::endl;
        return 1;
    }

    // Allocate memory in target process for the DLL path string
    size_t pathLen = (wcslen(dllPath) + 1) * sizeof(wchar_t);
    void* remoteMem = VirtualAllocEx(hProcess, NULL, pathLen, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (remoteMem == NULL) {
        std::wcout << L"[-] Failed to allocate memory in target process." << std::endl;
        CloseHandle(hProcess);
        return 1;
    }

    // Write the DLL path string into the allocated memory
    if (!WriteProcessMemory(hProcess, remoteMem, dllPath, pathLen, NULL)) {
        std::wcout << L"[-] Failed to write memory in target process." << std::endl;
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return 1;
    }

    // Create a remote thread that calls LoadLibraryW with the path to our DLL
    HANDLE hThread = CreateRemoteThread(hProcess, NULL, 0, (LPTHREAD_START_ROUTINE)LoadLibraryW, remoteMem, 0, NULL);
    if (hThread == NULL) {
        std::wcout << L"[-] Failed to create remote thread. Error: " << GetLastError() << std::endl;
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return 1;
    }

    std::wcout << L"[+] DLL injected successfully!" << std::endl;

    // Clean up
    WaitForSingleObject(hThread, INFINITE);
    VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
    CloseHandle(hThread);
    CloseHandle(hProcess);

    return 0;
}