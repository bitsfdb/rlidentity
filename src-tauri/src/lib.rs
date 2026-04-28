use reqwest::Client;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::fs;
use tauri::{Manager, State, WebviewWindow};
use window_vibrancy::apply_acrylic;
use sysinfo::System;
use sha2::{Sha256, Digest};

// --- types ---

#[derive(Serialize)]
pub struct Status {
    pub is_running: bool,
    pub is_injected: bool,
}

#[derive(Serialize)]
pub struct UserInfo {
    pub userId: Option<String>,
    pub discordId: Option<String>,
    pub epicId: Option<String>,
    pub username: Option<String>,
    pub globalName: Option<String>,
    pub logins: Option<i32>,
}

#[derive(Serialize)]
pub struct KeyValidationResponse {
    pub status: String,
    pub user: Option<UserInfo>,
}

// global state for optimization
struct AppState {
    client: Client,
    app_data: PathBuf,
}

// --- helpers ---

async fn get_last_epic_id(base_path: &Path) -> String {
    let path = base_path.join("last_epic_id.txt");
    if let Ok(content) = fs::read_to_string(path).await {
        let trimmed = content.trim();
        if trimmed.len() == 32 {
            return trimmed.to_string();
        }
    }
    "".to_string()
}

// --- commands ---

#[tauri::command]
fn get_hwid() -> String {
    // direct registry query for speed
    let output = Command::new("reg")
        .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
        .output();

    if let Ok(out) = output {
        let s = String::from_utf8_lossy(&out.stdout);
        if let Some(guid) = s.split_whitespace().last() {
            if guid.len() == 36 && guid.contains('-') {
                return guid.to_string();
            }
        }
    }
    "UNKNOWN-HWID".to_string()
}



#[tauri::command]
async fn validate_key(
    key: String, 
    hwid: String, 
    state: State<'_, AppState>
) -> Result<KeyValidationResponse, String> {
    let epic_id = get_last_epic_id(&state.app_data).await;
    let url = format!("https://api.rlidentity.me/keys/{}?hwid={}&epicId={}", key, hwid, epic_id);
    
    let res = state.client.get(&url)
        .send()
        .await
        .map_err(|e| format!("network error: {}", e))?;

    let json: serde_json::Value = res.json().await.map_err(|e| format!("json error: {}", e))?;
    
    let status = json.get("status").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
    let user = json.get("user").map(|u| UserInfo {
        userId: u.get("userId").and_then(|v| v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string()))),
        discordId: u.get("discordId").and_then(|v| v.as_str()).map(|s| s.to_string()),
        epicId: u.get("epicId").and_then(|v| v.as_str()).map(|s| s.to_string()),
        username: u.get("username").and_then(|v| v.as_str()).map(|s| s.to_string()),
        globalName: u.get("globalName").and_then(|v| v.as_str()).map(|s| s.to_string()),
        logins: u.get("logins").and_then(|v| v.as_i64()).map(|n| n as i32),
    });

    Ok(KeyValidationResponse { status, user })
}

#[tauri::command]
async fn inject_dll(state: State<'_, AppState>) -> Result<String, String> {
    let injector_path = state.app_data.join("injector.exe");
    let dll_path = state.app_data.join("RLIdentity.dll");
    
    let mut s = System::new_all();
    s.refresh_processes();
    if s.processes_by_exact_name("RocketLeague.exe").next().is_none() {
        return Err("rocket league is not running".into());
    }

    if !injector_path.exists() || !dll_path.exists() {
        return Err("files missing, wait for update".into());
    }

    let output = Command::new(injector_path)
        .arg("RocketLeague.exe")
        .arg(dll_path)
        .output()
        .map_err(|e| format!("exec failed: {}", e))?;

    if output.status.success() {
        Ok("injected".into())
    } else {
        Err("injection failed".into())
    }
}

#[tauri::command]
async fn download_assets(state: State<'_, AppState>) -> Result<(), String> {
    fs::create_dir_all(&state.app_data).await.map_err(|e| e.to_string())?;

    // in a real scenario, you'd fetch these hashes from your api first
    let assets = [
        (
            "injector.exe", 
            "https://git.rlidentity.me/bits/RLidentity/src/branch/dll/injector.exe",
            "EXPECTED_SHA256_HASH_HERE" 
        ),
        (
            "RLIdentity.dll", 
            "https://git.rlidentity.me/.../RLIdentity.dll",
            "EXPECTED_SHA256_HASH_HERE"
        ),
    ];

    for (name, url, expected_hash) in assets {
        let file_path = state.app_data.join(name);
        
        // download
        let res = state.client.get(url).send().await.map_err(|e| e.to_string())?;
        let bytes = res.bytes().await.map_err(|e| e.to_string())?;

        // verify integrity (signature check)
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual_hash = hex::encode(hasher.finalize());

        if actual_hash != expected_hash {
            return Err(format!("integrity check failed for {}: hash mismatch", name));
        }

        // only write if the "signature" (hash) is correct
        fs::write(file_path, bytes).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn check_status() -> Status {
    let mut s = System::new_all();
    s.refresh_processes();
    let is_running = s.processes_by_exact_name("RocketLeague.exe").next().is_some();
    Status { is_running, is_injected: false }
}

#[tauri::command]
fn minimize_to_tray(window: WebviewWindow) {
    let _ = window.hide();
}

// --- main ---

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            client: Client::builder()
                .danger_accept_invalid_certs(false)
                .build()
                .unwrap(),
            app_data: dirs::data_dir().unwrap().join("RLidentity"),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            minimize_to_tray, 
            inject_dll,
            validate_key,
            check_status,
            get_hwid,
            download_assets
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            #[cfg(target_os = "windows")]
            apply_acrylic(&window, Some((18, 18, 18, 125))).ok();

            let handle = app.handle().clone();
            let tray_menu = tauri::menu::Menu::with_items(app, &[
                &tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
            ])?;

            let _ = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .on_menu_event(move |_app, event| {
                    if event.id().as_ref() == "quit" { handle.exit(0); }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                        let _ = tray.app_handle().get_webview_window("main").unwrap().show();
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}