use reqwest;
use tauri::{Manager, WebviewWindow};
use window_vibrancy::apply_acrylic;
use serde::Serialize;
use std::fs;
use sysinfo::System;
use std::process::Command;
use std::path::Path;

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

#[tauri::command]
fn minimize_to_tray(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn get_hwid() -> String {
    // Simple HWID using Windows UUID
    let output = Command::new("wmic")
        .args(["csproduct", "get", "uuid"])
        .output()
        .ok();
    
    if let Some(out) = output {
        let s = String::from_utf8_lossy(&out.stdout);
        let lines: Vec<&str> = s.lines().collect();
        if lines.len() >= 2 {
            return lines[1].trim().to_string();
        }
    }
    "UNKNOWN-HWID".to_string()
}

fn get_last_epic_id() -> String {
    if let Some(mut path) = dirs::data_dir() {
        path.push("RLidentity");
        path.push("last_epic_id.txt");
        
        if let Ok(content) = fs::read_to_string(path) {
            let trimmed = content.trim();
            if trimmed.len() == 32 {
                return trimmed.to_string();
            }
        }
    }
    "".to_string()
}

#[tauri::command]
async fn validate_key(key: String, hwid: String) -> Result<KeyValidationResponse, String> {
    let epic_id = get_last_epic_id();
    // Added epicId query parameter to the URL
    let url = format!(
        "https://api.rlidentity.me/keys/{}?hwid={}&epicId={}", 
        key, hwid, epic_id
    );
    
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("Client Error: {}", e))?;
    
    println!("[LOG] Connecting to: {}", url);
    println!("[LOG] Sending Epic ID: {}", epic_id);

    let res = client.get(&url)
        .send()
        .await
        .map_err(|e| {
            let err_msg = format!("Network Error: {}. Is the server on 443?", e);
            println!("[ERROR] {}", err_msg);
            err_msg
        })?;

    println!("[LOG] HTTP Status: {}", res.status());

    let json: serde_json::Value = res.json().await.map_err(|e| {
        let err_msg = format!("JSON Parse Error: {}", e);
        println!("[ERROR] {}", err_msg);
        err_msg
    })?;
    
    println!("[LOG] Server Payload: {:?}", json);

    let status = json.get("status").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
    
    let user = json.get("user").map(|u| UserInfo {
        userId: u.get("userId").and_then(|v| {
            v.as_str().map(|s| s.to_string()).or_else(|| v.as_i64().map(|n| n.to_string()))
        }),
        discordId: u.get("discordId").and_then(|v| v.as_str()).map(|s| s.to_string()),
        epicId: u.get("epicId").and_then(|v| v.as_str()).map(|s| s.to_string()),
        username: u.get("username").and_then(|v| v.as_str()).map(|s| s.to_string()),
        globalName: u.get("globalName").and_then(|v| v.as_str()).map(|s| s.to_string()),
        logins: u.get("logins").and_then(|v| v.as_i64()).map(|n| n as i32),
    });

    Ok(KeyValidationResponse { status, user })
}

#[tauri::command]
async fn save_config(name: String, platform: String) -> Result<(), String> {
    let mut path = dirs::data_dir().ok_or("Could not find AppData")?;
    path.push("RLidentity");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.push("config.json");

    let json = serde_json::json!({
        "spoofedName": name,
        "platform": platform
    });

    fs::write(path, serde_json::to_string_pretty(&json).unwrap()).map_err(|e| e.to_string())?;
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
async fn download_assets() -> Result<(), String> {
    let mut path = dirs::data_dir().ok_or("Could not find AppData")?;
    path.push("RLidentity");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();
    let assets = [
        ("injector.exe", "https://git.rlidentity.me/bits/RLidentity/raw/branch/dll/injector.exe"),
        ("RLIdentity.dll", "https://git.rlidentity.me/bits/RLidentity/raw/branch/dll/RLIdentity.dll"),
    ];

    for (name, url) in assets {
        let mut file_path = path.clone();
        file_path.push(name);
        
        let response = client.get(url).send().await.map_err(|e| e.to_string())?;
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        fs::write(file_path, bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn inject_dll(_discordId: Option<String>) -> Result<String, String> {
    let mut base_path = dirs::data_dir().ok_or("Could not find AppData")?;
    base_path.push("RLidentity");
    
    let injector_path = base_path.join("injector.exe");
    let dll_path = base_path.join("RLIdentity.dll");
    
    let mut s = System::new_all();
    s.refresh_processes();
    if s.processes_by_exact_name("RocketLeague.exe").next().is_none() {
        return Err("Rocket League is not running!".into());
    }

    if !injector_path.exists() || !dll_path.exists() {
        return Err("Required files missing. Please wait for update to finish.".into());
    }

    // Run the injector and capture FULL output
    let output = Command::new(injector_path)
        .arg("RocketLeague.exe")
        .arg(dll_path)
        .output()
        .map_err(|e| format!("Execution failed: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let full_log = format!("STDOUT:\n{}\n\nSTDERR:\n{}", stdout, stderr);
    println!("[LOG] Injector results:\n{}", full_log);

    if output.status.success() {
        Ok(format!("Successfully injected!\n\n{}", stdout))
    } else {
        Err(format!("Injection failed!\n\n{}", full_log))
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            minimize_to_tray, 
            save_config, 
            inject_dll,
            validate_key,
            check_status,
            get_hwid,
            download_assets
        ])
        .setup(|app| {
            let icon_bytes = include_bytes!("../icons/32x32.png");
            let icon = tauri::image::Image::from_bytes(icon_bytes)?;

            let window = app.get_webview_window("main").unwrap();
            window.set_icon(icon.clone())?;

            #[cfg(target_os = "windows")]
            apply_acrylic(&window, Some((18, 18, 18, 125))).ok();

            let handle = app.handle().clone();
            let tray_menu = tauri::menu::Menu::with_items(app, &[
                &tauri::menu::MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?,
            ])?;

            tauri::tray::TrayIconBuilder::new()
                .icon(icon)
                .menu(&tray_menu)
                .on_menu_event(move |_app, event| {
                    if event.id().as_ref() == "tray_quit" { handle.exit(0); }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { 
                        button: tauri::tray::MouseButton::Left, 
                        .. 
                    } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
