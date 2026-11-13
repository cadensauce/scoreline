//! Scoreline native app (Windows, Android): a Rust/Tauri shell around the Scoreline web UI,
//! with native OS notifications for score alerts.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        // Opens the update download (installer / APK) from the in-app "Update available" banner.
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Scoreline");
}
