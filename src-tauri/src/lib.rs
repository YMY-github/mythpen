use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct SidecarProcess {
    child: Mutex<Option<CommandChild>>,
    status: Mutex<String>,
    shutdown_token: String,
}

#[tauri::command]
fn sidecar_status(state: tauri::State<'_, SidecarProcess>) -> String {
    state.status.lock().unwrap().clone()
}

fn server_request(method: &str, route: &str, token: &str) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:3101".parse().unwrap(),
        Duration::from_millis(500),
    ).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(500))).ok()?;
    stream.set_write_timeout(Some(Duration::from_millis(500))).ok()?;
    let body = if method == "POST" { "{}" } else { "" };
    write!(stream,
        "{method} {route} HTTP/1.1\r\nHost: 127.0.0.1:3101\r\nX-Mythpen-Sidecar-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    ).ok()?;
    let mut response = String::new();
    stream.take(8192).read_to_string(&mut response).ok()?;
    Some(response)
}

fn owned_server_ready(token: &str) -> bool {
    server_request("GET", "/api/health", token)
        .is_some_and(|response| response.starts_with("HTTP/1.1 200") && response.contains("\"sidecarOwned\":true"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![sidecar_status])
        .setup(|app| {
            let token = uuid::Uuid::new_v4().to_string();
            app.manage(SidecarProcess {
                child: Mutex::new(None),
                status: Mutex::new("starting".into()),
                shutdown_token: token.clone(),
            });
            let state = app.state::<SidecarProcess>();
            if TcpStream::connect_timeout(&"127.0.0.1:3101".parse().unwrap(), Duration::from_millis(500)).is_ok() {
                // tauri dev deliberately uses the beforeDevCommand server.
                *state.status.lock().unwrap() = if cfg!(debug_assertions) { "ready" } else { "port-in-use" }.into();
                return Ok(());
            }
            let keyring_path = app.path().resource_dir()?.join("sync-keyring").join("index.js");
            let command = app.shell().sidecar("mythpen-server")?
                .env("MYTHPEN_KEYRING_DIR", keyring_path.to_string_lossy().to_string())
                .env("MYTHPEN_SIDECAR_TOKEN", &token);
            let (mut events, child) = match command.spawn() {
                Ok(child) => child,
                Err(_) => {
                    *state.status.lock().unwrap() = "start-failed".into();
                    return Ok(());
                }
            };
            *state.child.lock().unwrap() = Some(child);
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    if matches!(event, CommandEvent::Terminated(_)) {
                        *app_handle.state::<SidecarProcess>().status.lock().unwrap() = "exited".into();
                        break;
                    }
                }
            });
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(45);
                while Instant::now() < deadline {
                    let state = app_handle.state::<SidecarProcess>();
                    if *state.status.lock().unwrap() != "starting" { return; }
                    if owned_server_ready(&token) {
                        *state.status.lock().unwrap() = "ready".into();
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                let state = app_handle.state::<SidecarProcess>();
                let mut status = state.status.lock().unwrap();
                if *status == "starting" { *status = "start-failed".into(); }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Mythpen Sync Dev")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<SidecarProcess>() {
                    if let Some(child) = state.child.lock().unwrap().take() {
                        // Only the process started by this window accepts its token.
                        let _ = server_request("POST", "/api/shutdown", &state.shutdown_token);
                        for _ in 0..10 {
                            if !owned_server_ready(&state.shutdown_token) { break; }
                            std::thread::sleep(Duration::from_millis(200));
                        }
                        let _ = child.kill();
                    }
                }
            }
        });
}
