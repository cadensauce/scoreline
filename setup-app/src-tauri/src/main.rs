// Scoreline Setup: a small custom window that installs and uninstalls Scoreline.
// Install: carries the real installer (payload/Scoreline-Windows-Setup.exe, added by the build), runs it silently,
//          copies itself next to the app, and points Windows' "Uninstall" button at itself.
// Uninstall (`--uninstall`): runs from a temp copy, removes the app silently, optionally its data on this PC.
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
const UNINSTALL_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Scoreline";
const SELF_NAME: &str = "Scoreline Setup.exe";

fn hidden(cmd: &str) -> Command { let mut c = Command::new(cmd); c.creation_flags(CREATE_NO_WINDOW); c }

/// The app's folder, as the installer recorded it; falls back to the default location.
fn install_dir() -> PathBuf {
    if let Ok(o) = hidden("reg").args(["query", UNINSTALL_KEY, "/v", "InstallLocation"]).output() {
        let text = String::from_utf8_lossy(&o.stdout);
        if let Some(v) = text.lines().find(|l| l.contains("InstallLocation")).and_then(|l| l.split("REG_SZ").nth(1)) {
            let dir = v.trim().trim_matches('"');
            if !dir.is_empty() { return PathBuf::from(dir); }
        }
    }
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join("Scoreline")
}
fn app_exe() -> PathBuf { install_dir().join("scoreline.exe") }
fn local(name: &str) -> PathBuf { PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join(name) }
fn roaming(name: &str) -> PathBuf { PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join(name) }

/// Wait for a child process while easing the progress bar toward `cap`.
fn wait_with_progress(mut child: std::process::Child, send: &dyn Fn(f64), from: f64, cap: f64) -> Result<std::process::ExitStatus, String> {
    let start = Instant::now();
    let mut p = from;
    loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? { return Ok(s); }
        if start.elapsed() > Duration::from_secs(180) { let _ = child.kill(); return Err("It took too long. Try again.".into()); }
        p += (cap - p) * 0.06;
        send(p);
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn run_install(window: &tauri::Window) -> Result<(), String> {
    let send = |p: f64| { let _ = window.emit("progress", p.round() as u32); };
    send(4.0);
    let tmp = std::env::temp_dir().join("scoreline-setup-payload.exe");
    std::fs::write(&tmp, PAYLOAD).map_err(|e| format!("Couldn't unpack Scoreline ({e}). Check your disk space."))?;
    send(18.0);
    // Close a running Scoreline first so its files can be replaced.
    let _ = hidden("taskkill").args(["/IM", "scoreline.exe", "/F"]).output();
    let child = hidden(tmp.to_str().unwrap_or_default()).arg("/S").spawn().map_err(|e| format!("Couldn't start the installer ({e})."))?;
    let status = wait_with_progress(child, &send, 18.0, 92.0)?;
    let _ = std::fs::remove_file(&tmp);
    if !status.success() { return Err(format!("The installer stopped (code {}). Try again.", status.code().unwrap_or(-1))); }
    if !app_exe().exists() { return Err("Scoreline didn't end up where expected. Try again.".into()); }
    // Keep a copy of this window next to the app and make Windows' "Uninstall" button open it.
    let me = install_dir().join(SELF_NAME);
    if let Ok(cur) = std::env::current_exe() {
        if cur != me { let _ = std::fs::copy(&cur, &me); }
    }
    if me.exists() {
        let cmd = format!("\"{}\" --uninstall", me.display());
        let _ = hidden("reg").args(["add", UNINSTALL_KEY, "/v", "UninstallString", "/t", "REG_SZ", "/d", &cmd, "/f"]).output();
    }
    send(100.0);
    Ok(())
}

fn run_uninstall(window: &tauri::Window, delete_data: bool) -> Result<(), String> {
    let send = |p: f64| { let _ = window.emit("progress", p.round() as u32); };
    let dir = install_dir();
    send(6.0);
    let _ = hidden("taskkill").args(["/IM", "scoreline.exe", "/F"]).output();
    send(14.0);
    let un = dir.join("uninstall.exe");
    if un.exists() {
        // `_?=` makes the uninstaller run in place and wait, so we know when it's done.
        let child = hidden(un.to_str().unwrap_or_default()).args(["/S", &format!("_?={}", dir.display())]).spawn()
            .map_err(|e| format!("Couldn't start removing Scoreline ({e})."))?;
        let status = wait_with_progress(child, &send, 14.0, 80.0)?;
        if !status.success() { return Err(format!("Removing stopped (code {}). Try again.", status.code().unwrap_or(-1))); }
    }
    send(84.0);
    let _ = std::fs::remove_dir_all(&dir);                       // leftovers: uninstall.exe and this window's copy
    let _ = hidden("reg").args(["delete", UNINSTALL_KEY, "/f"]).output();
    if delete_data {
        for p in [local("io.github.cadensauce.scoreline"), roaming("io.github.cadensauce.scoreline")] { let _ = std::fs::remove_dir_all(p); }
    }
    send(100.0);
    Ok(())
}

#[tauri::command]
async fn install(window: tauri::Window) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_install(&window)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn uninstall(window: tauri::Window, delete_data: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_uninstall(&window, delete_data)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn mode() -> &'static str { if std::env::args().any(|a| a == "--uninstall") { "uninstall" } else { "install" } }
#[tauri::command]
fn open_app() -> Result<(), String> { Command::new(app_exe()).spawn().map(|_| ()).map_err(|e| e.to_string()) }

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // Uninstalling from the app's own folder: copy this window to temp and run from there, so the folder can go.
    if args.iter().any(|a| a == "--uninstall") && !args.iter().any(|a| a == "--from-temp") {
        if let Ok(cur) = std::env::current_exe() {
            let tmp = std::env::temp_dir().join("scoreline-uninstall.exe");
            if std::fs::copy(&cur, &tmp).is_ok() && Command::new(&tmp).args(["--uninstall", "--from-temp"]).spawn().is_ok() {
                return;
            }
        }
    }
    let from_temp = args.iter().any(|a| a == "--from-temp");
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![install, uninstall, mode, open_app])
        .build(tauri::generate_context!())
        .expect("error while starting Scoreline Setup");
    app.run(move |_, event| {
        // After uninstalling: once this window has closed, remove its temp copy and its own window data.
        if let tauri::RunEvent::Exit = event {
            if from_temp {
                if let Ok(cur) = std::env::current_exe() {
                    let data = local("io.github.cadensauce.scoreline.setup");
                    let _ = hidden("cmd").args(["/C", &format!("ping -n 3 127.0.0.1 >nul & del \"{}\" & rmdir /s /q \"{}\"", cur.display(), data.display())]).spawn();
                }
            }
        }
    });
}
