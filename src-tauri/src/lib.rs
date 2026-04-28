use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tokio::fs;
use tauri::{Manager, State, WebviewWindow};
use window_vibrancy::apply_acrylic;
use sysinfo::{ProcessRefreshKind, RefreshKind, System};
use sha2::{Sha256, Digest};

// --- types ---

#[derive(Serialize)]
pub struct Status {
    pub is_running: bool,
    pub is_injected: bool,
}

#[derive(Serialize, Deserialize)]
pub struct UserInfo {
    #[serde(rename = "userId")]
    pub user_id: Option<String>,
    #[serde(rename = "discordId")]
    pub discord_id: Option<String>,
    #[serde(rename = "epicId")]
    pub epic_id: Option<String>,
    pub username: Option<String>,
    #[serde(rename = "globalName")]
    pub global_name: Option<String>,
    pub logins: Option<i32>,
}

#[derive(Serialize, Deserialize)]
pub struct KeyValidationResponse {
    pub status: String,
    pub user: Option<UserInfo>,
}

#[derive(Deserialize)]
struct AssetManifest {
    injector_hash: String,
    dll_hash: String,
}

struct AppState {
    client: Client,
    app_data: PathBuf,
    sys: Mutex<System>,
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
    // strictly avoid returning "unknown" to prevent key sharing bypasses
    "00000000-0000-0000-0000-000000000000".to_string()
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

    res.json::<KeyValidationResponse>()
        .await
        .map_err(|e| format!("api schema mismatch: {}", e))
}

#[tauri::command]
async fn inject_dll(state: State<'_, AppState>) -> Result<String, String> {
    let injector_path = state.app_data.join("injector.exe");
    let dll_path = state.app_data.join("RLIdentity.dll");
    
    {
        let mut sys = state.sys.lock().unwrap();
        // fix: use refresh_processes_specifics and add the remove_dead_processes bool
sys.refresh_processes_specifics(ProcessRefreshKind::new());        
        if sys.processes_by_exact_name("RocketLeague.exe").next().is_none() {
            return Err("rocket league is not running".into());
        }
    }

    if !injector_path.exists() || !dll_path.exists() {
        return Err("files missing, please update".into());
    }

    let output = Command::new(injector_path)
        .arg("RocketLeague.exe")
        .arg(&dll_path)
        .output()
        .map_err(|e| format!("exec failed: {}", e))?;

    if output.status.success() {
        Ok("injected".into())
    } else {
        Err("injection failed: check admin privileges".into())
    }
}

#[tauri::command]
async fn download_assets(state: State<'_, AppState>) -> Result<(), String> {
    fs::create_dir_all(&state.app_data).await.map_err(|e| e.to_string())?;

    // dynamically fetch latest hashes to avoid brittle hardcoding
    let manifest: AssetManifest = state.client.get("https://api.rlidentity.me/manifest")
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let assets = [
        ("injector.exe", "https://git.rlidentity.me/bits/RLidentity/raw/branch/main/injector.exe", manifest.injector_hash),
        ("RLIdentity.dll", "https://git.rlidentity.me/bits/RLidentity/raw/branch/main/RLIdentity.dll", manifest.dll_hash),
    ];

    for (name, url, expected_hash) in assets {
        let file_path = state.app_data.join(name);
        let res = state.client.get(url).send().await.map_err(|e| e.to_string())?;
        let bytes = res.bytes().await.map_err(|e| e.to_string())?;

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual_hash = hex::encode(hasher.finalize());

        if actual_hash != expected_hash {
            return Err(format!("integrity check failed for {}", name));
        }

        fs::write(file_path, bytes).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn check_status(state: State<'_, AppState>) -> Result<Status, String> {
    let mut sys = state.sys.lock().unwrap();
    // fix: use refresh_processes_specifics and add the remove_dead_processes bool
sys.refresh_processes_specifics(ProcessRefreshKind::new());    
    let is_running = sys.processes_by_exact_name("RocketLeague.exe").next().is_some();
    Ok(Status { is_running, is_injected: false })
}

#[tauri::command]
async fn save_config(config_data: String, state: State<'_, AppState>) -> Result<(), String> {
    let config_path = state.app_data.join("config.json");
    let temp_path = state.app_data.join("config.json.tmp");

    // atomic write: write to tmp then rename to prevent corruption on crash
    fs::write(&temp_path, config_data).await.map_err(|e| e.to_string())?;
    fs::rename(temp_path, config_path).await.map_err(|e| e.to_string())
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
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap(),
            app_data: dirs::data_dir().expect("could not find data dir").join("RLidentity"),
            sys: Mutex::new(System::new_with_specifics(
                RefreshKind::new().with_processes(ProcessRefreshKind::new())
            )),
        })
        .invoke_handler(tauri::generate_handler![
            minimize_to_tray, 
            inject_dll,
            validate_key,
            check_status,
            get_hwid,
            download_assets,
            save_config
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