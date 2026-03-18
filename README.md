# RLidentity v2.0.0

> **Be anyone, Win everything.**

RLidentity is a modern, high-performance identity management tool for Rocket League. It features a sleek, glass-morphism GUI built with Tauri and React, backed by a powerful C++ injection system.

![App Logo]https://cdn.discordapp.com/icons/1470914465515049083/88f78baaa66b440109a59a7999951cd8.webp?size=256)

## Features

*   **Identity Spoofing**: Change your in-game name and platform identity on the fly.
*   **Dual Platform Support**: Seamlessly switch between **Epic Games** and **Steam**.
*   **Smart Injection**: Automated DLL injection with real-time Rocket League status detection.
*   **Auto-Sync System**: The GUI automatically stays up-to-date by syncing the latest `injector.exe` and `RLIdentity.dll` directly from Gitea.
*   **Modern UI**: High-performance, transparent "Acrylic" interface with interactive tutorials and a built-in log viewer.

## Installation (First Time Users)

1.  Navigate to the [Releases](https://git.rlidentity.me/bits/RLidentity/releases) page on Gitea.
2.  Download the latest `rlidentitygui_x.x.x_x64-setup.exe`.
3.  Run the installer.
4.  **Launch RLidentity**: On first launch, the app will automatically download the necessary core assets (`injector.exe` and `RLIdentity.dll`) to your `AppData/RLidentity` folder.

## Developer Setup

This repository uses a multi-branch structure to keep the codebase clean:

*   **`gui` Branch**: Contains the Tauri/React frontend and Rust backend.
*   **`dll` Branch**: Contains the C++ source code for the DLL and the Injector.

### Building the GUI
```bash
npm install
npm run build
npx tauri build
```

### Building the DLL
The DLL and Injector are built using Visual Studio 2022 (v143 toolset). Ensure `MinHook` is correctly linked for the identity hooking logic.

## Credits & Debug

*   **Lead Dev & Owner**: Bits
*   **Dev & Admin**: Danni
*   **Co-Owner**: Deniz
*   **Administrator**: Kairo
*   **Helpers**: Quinn, sndr
*   **Tester**: Emir

## 🔗 Links

*   **Official Website**: [rlidentity.me](https://rlidentity.me)
*   **Discord**: [rlidentity.me/discord](https://rlidentity.me/discord)
*   **FAQ**: [rlidentity.me/faq](https://rlidentity.me/faq)

---
*Disclaimer: Use this tool responsibly. RLidentity is not affiliated with Psyonix or Epic Games.*
