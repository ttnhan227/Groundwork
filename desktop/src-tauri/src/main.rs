#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone, serde::Serialize)]
struct CoreConnection { url: String, token: String }
struct CoreProcessState { child: Option<Child>, connection: Option<CoreConnection> }
static CORE_STATE: Mutex<CoreProcessState> = Mutex::new(CoreProcessState { child: None, connection: None });

fn start_core_inner(app: tauri::AppHandle) -> Result<CoreConnection, String> {
    let mut state = CORE_STATE.lock().map_err(|e| e.to_string())?;
    if let Some(child) = state.child.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return state.connection.clone().ok_or("Core connection unavailable".into());
        }
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    let connection = CoreConnection { url: format!("http://127.0.0.1:{}", port), token: uuid::Uuid::new_v4().to_string() };
    let data_dir = std::env::var_os("GROUNDWORK_DATA_DIR").map(std::path::PathBuf::from)
        .unwrap_or(app.path().app_local_data_dir().map_err(|e| e.to_string())?);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let binary = resources.join("resources/groundwork-core/groundwork-core.exe");
    let mut command = if binary.is_file() {
        Command::new(binary)
    } else if cfg!(debug_assertions) {
        let server = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../server");
        let mut cmd = Command::new("python");
        cmd.arg(server.join("core_entry.py")).current_dir(server);
        cmd
    } else {
        return Err("The bundled local core is missing. Reinstall Groundwork.".into());
    };
    command.env("GROUNDWORK_CORE_PORT", port.to_string())
        .env("GROUNDWORK_CORE_TOKEN", &connection.token)
        .env("GROUNDWORK_DATA_DIR", &data_dir)
        .current_dir(&data_dir);
    let log_path = data_dir.join("local-core.log");
    let log = std::fs::OpenOptions::new().create(true).append(true).open(&log_path).map_err(|e| e.to_string())?;
    command.stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?)).stderr(Stdio::from(log));
    #[cfg(target_os = "windows")]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn().map_err(|e| format!("Cannot start local core: {}", e))?;
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_millis(500)).build().map_err(|e| e.to_string())?;
    for _ in 0..60 {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            return Err(format!("Local core exited during startup: {}. Details: {}", status, log_path.display()));
        }
        if let Ok(response) = client.get(format!("{}/health", connection.url)).bearer_auth(&connection.token).send() {
            if let Ok(body) = response.json::<serde_json::Value>() {
                if body["service"] == "groundwork-local" && body["status"] == "healthy" {
                    state.connection = Some(connection.clone());
                    state.child = Some(child);
                    return Ok(connection);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let _ = child.kill(); let _ = child.wait();
    Err("Local core did not become ready within the startup deadline.".into())
}

#[tauri::command]
async fn start_local_core(app: tauri::AppHandle) -> Result<CoreConnection, String> {
    tauri::async_runtime::spawn_blocking(move || start_core_inner(app)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn stop_local_core() -> Result<(), String> {
    let mut state = CORE_STATE.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = state.child.take() {
        if let Some(connection) = &state.connection {
            if let Ok(client) = reqwest::blocking::Client::builder().timeout(Duration::from_secs(2)).build() {
                let _ = client.post(format!("{}/api/system/shutdown", connection.url)).bearer_auth(&connection.token).send();
            }
        }
        for _ in 0..50 {
            if child.try_wait().ok().flatten().is_some() { break; }
            std::thread::sleep(Duration::from_millis(100));
        }
        if child.try_wait().ok().flatten().is_none() { let _ = child.kill(); }
        let _ = child.wait();
    }
    state.connection = None;
    Ok(())
}

#[tauri::command]
fn get_platform_info() -> String { format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH) }

#[tauri::command]
fn pick_workspace_folder() -> Option<String> {
    rfd::FileDialog::new().set_title("Choose a Groundwork workspace").pick_folder().map(|p| p.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("groundwork-search", ());
                }
            }
        }).build())
        .setup(|app| {
            // Another app may own the shortcut; this must not prevent startup.
            if let Err(error) = app.global_shortcut().register("Ctrl+Space") { eprintln!("Search shortcut unavailable: {}", error); }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_local_core, stop_local_core, get_platform_info, pick_workspace_folder])
        .build(tauri::generate_context!())
        .expect("Cannot initialize Groundwork desktop")
        .run(|_, event| { if let tauri::RunEvent::Exit = event { let _ = stop_local_core(); } });
}
