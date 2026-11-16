// Scoreline Setup: a small custom installer window. It carries the real Scoreline installer inside it
// (payload/Scoreline-Windows-Setup.exe, added by the build), runs it silently, and shows progress.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
    time::{Duration, Instant},
};
use tauri::Emitter;

const PAYLOAD: &[u8] = include_bytes!("../payload/Scoreline-Windows-Setup.exe");
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Where the app ends up: the installer records it in the uninstall entry; fall back to the default.
fn app_exe() -> PathBuf {
    let out = Command::new("reg")
        .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Scoreline", "/v", "InstallLocation"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    if let Ok(o) = out {
        let text = String::from_utf8_lossy(&o.stdout);
        if let Some(line) = text.lines().find(|l| l.contains("InstallLocation")) {
            if let Some(v) = line.split("REG_SZ").nth(1) {
                let dir = v.trim().trim_matches('"');
                if !dir.is_empty() {
                    return PathBuf::from(dir).join("scoreline.exe");
                }
            }
        }
    }
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("Scoreline").join("scoreline.exe")
}

fn run_install(window: &tauri::Window) -> Result<(), String> {
    let send = |p: f64| { let _ = window.emit("progress", p.round() as u32); };
    send(4.0);
    let tmp = std::env::temp_dir().join("scoreline-setup-payload.exe");
    std::fs::write(&tmp, PAYLOAD).map_err(|e| format!("Couldn't unpack Scoreline ({e}). Check your disk space."))?;
    send(18.0);
    // Close a running Scoreline first so its files can be replaced (the installer would ask otherwise).
    let _ = Command::new("taskkill").args(["/IM", "scoreline.exe", "/F"]).creation_flags(CREATE_NO_WINDOW).output();
    let mut child = Command::new(&tmp)
        .arg("/S")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Couldn't start the installer ({e})."))?;
    // The silent installer doesn't report progress, so ease toward 95% while it works.
    let start = Instant::now();
    let mut p = 18.0_f64;
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > Duration::from_secs(180) {
            let _ = child.kill();
            return Err("The installer took too long. Try again.".into());
        }
        p += (95.0 - p) * 0.06;
        send(p);
        std::thread::sleep(Duration::from_millis(100));
    };
    let _ = std::fs::remove_file(&tmp);
    if !status.success() {
        return Err(format!("The installer stopped (code {}). Try again.", status.code().unwrap_or(-1)));
    }
    if !app_exe().exists() {
        return Err("Scoreline didn't end up where expected. Try again.".into());
    }
    send(100.0);
    Ok(())
}

#[tauri::command]
async fn install(window: tauri::Window) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_install(&window))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn open_app() -> Result<(), String> {
    Command::new(app_exe()).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![install, open_app])
        .run(tauri::generate_context!())
        .expect("error while running Scoreline Setup");
}
