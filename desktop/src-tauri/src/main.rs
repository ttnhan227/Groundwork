// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn check_local_core() -> bool {
    // Quick TCP probe to 127.0.0.1:8000
    std::net::TcpStream::connect("127.0.0.1:8000").is_ok()
}

#[tauri::command]
fn get_platform_info() -> String {
    format!("Windows (x64) - Tauri 2 Native Container")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_local_core, get_platform_info])
        .run(tauri::generate_context!())
        .expect("error while running Groundwork desktop application");
}
